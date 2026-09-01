import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { logger, provisionSplitForNewProject, type ApiAccessScope } from "@langfuse/shared/src/server";
import { projectNameSchema } from "@/src/features/auth/lib/projectNameSchema";
import { projectRetentionSchema } from "@/src/features/auth/lib/projectRetentionSchema";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { getDefaultScoreConfigsForProject } from "@langfuse/shared";

/**
 * 创建项目（POST /api/public/projects）。
 * 校验 name / metadata / retention，事务内创建项目 + 默认 score config。
 * scope 来自 requireAdminApi，含 orgId 与 plan。
 */
export async function createProject(
  req: NextApiRequest,
  res: NextApiResponse,
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

    const existingProject = await prisma.project.findFirst({
      where: { name, orgId: scope.orgId, deletedAt: null },
    });
    if (existingProject) {
      return res.status(409).json({
        message: "A project with this name already exists in your organization",
      });
    }

    const project = await prisma.$transaction(async (tx: any) => {
      const created = await tx.project.create({
        data: {
          name,
          orgId: scope.orgId,
          retentionDays: retention,
          metadata,
        },
      });

      await tx.scoreConfig.createMany({
        data: getDefaultScoreConfigsForProject(created.id),
      });

      return created;
    });

    // Universal Doris table split：每个新项目都要有自己的 Doris 表。
    // 与 UI 创建项目（projectsRouter.create）保持一致——designation 失败时
    // 删除刚创建的项目，让请求干净地失败，而不是留下一个未建表的项目。
    try {
      await provisionSplitForNewProject(project.id);
    } catch (e) {
      await prisma.project
        .delete({ where: { id: project.id } })
        .catch(() => undefined);
      throw e;
    }

    return res.status(201).json({
      id: project.id,
      name: project.name,
      metadata: project.metadata ?? {},
      ...(project.retentionDays
        ? { retentionDays: project.retentionDays }
        : {}),
    });
  } catch (error) {
    logger.error("Failed to create project", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
