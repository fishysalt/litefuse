import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { logger, enqueueDorisSplitTableProvisioning, type ApiAccessScope } from "@langfuse/shared/src/server";
import { projectNameSchema } from "@/src/features/auth/lib/projectNameSchema";
import { projectRetentionSchema } from "@/src/features/auth/lib/projectRetentionSchema";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";

/**
 * 更新项目（PUT /api/public/projects/{id}）。
 * where 同时约束 id 与 orgId，防止跨组织操作。
 */
export async function updateProject(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  scope: ApiAccessScope,
) {
  try {
    const { name, retention, metadata } = req.body;

    try {
      projectNameSchema.parse({ name });
    } catch {
      return res.status(400).json({
        message: "Invalid project name. Should be between 3 and 60 characters.",
      });
    }

    if (metadata !== undefined && typeof metadata !== "object") {
      try {
        JSON.parse(metadata);
      } catch (error) {
        return res.status(400).json({
          message: `Invalid metadata. Should be a valid JSON object: ${error}`,
        });
      }
    }

    if (retention !== undefined) {
      try {
        projectRetentionSchema.parse({ retention });
      } catch {
        return res.status(400).json({
          message: "Invalid retention value. Must be 0 or at least 3 days.",
        });
      }

      if (retention > 0) {
        const hasRetentionEntitlement = hasEntitlementBasedOnPlan({
          entitlement: "data-retention",
          plan: scope.plan,
        });
        if (!hasRetentionEntitlement) {
          return res.status(403).json({
            message:
              "The data-retention entitlement is required to set a non-zero retention period.",
          });
        }
      }
    }

    const updatedProject = await prisma.project.update({
      where: { id: projectId, orgId: scope.orgId },
      data: {
        name,
        ...(retention !== undefined ? { retentionDays: retention } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
      select: {
        id: true,
        name: true,
        retentionDays: true,
        metadata: true,
      },
    });

    // Retention 单源于 Project.retentionDays：改了 retention 要让 split 表的
    // dynamic_partition TTL 跟着变（幂等 ALTER，无控制行时 no-op）。
    // 与 UI 的 setRetention（projectsRouter）保持一致。
    if (retention !== undefined) {
      await enqueueDorisSplitTableProvisioning(projectId).catch((e) =>
        logger.error(
          `[table-split] TTL re-provision enqueue for ${projectId} failed`,
          e,
        ),
      );
    }

    return res.status(200).json({
      id: updatedProject.id,
      name: updatedProject.name,
      metadata: updatedProject.metadata ?? {},
      ...(updatedProject.retentionDays
        ? { retentionDays: updatedProject.retentionDays }
        : {}),
    });
  } catch (error) {
    logger.error("Failed to update project", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
