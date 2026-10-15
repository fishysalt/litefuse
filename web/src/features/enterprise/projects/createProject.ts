import { projectNameSchema } from "@/src/features/auth/lib/projectNameSchema";
import { projectRetentionSchema } from "@/src/features/auth/lib/projectRetentionSchema";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { getDefaultScoreConfigsForProject } from "@langfuse/shared";
import { prisma, type Prisma } from "@langfuse/shared/src/db";
import {
  logger,
  provisionSplitForNewProject,
  type ApiAccessScope,
} from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

type MetadataResult =
  | { ok: true; value: Prisma.InputJsonValue | undefined }
  | { ok: false; message: string };

function decodeProjectMetadata(metadata: unknown): MetadataResult {
  if (metadata === undefined) {
    return { ok: true, value: undefined };
  }

  let value = metadata;
  if (typeof metadata === "string") {
    try {
      value = JSON.parse(metadata);
    } catch (error) {
      return {
        ok: false,
        message: `Metadata is not decodable JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "Metadata must be a JSON object." };
  }

  return { ok: true, value: value as Prisma.InputJsonValue };
}

function validateRetention(
  retention: unknown,
  scope: ApiAccessScope,
): { ok: true } | { ok: false; status: number; message: string } {
  if (!projectRetentionSchema.safeParse({ retention }).success) {
    return {
      ok: false,
      status: 400,
      message: "Invalid retention value. Must be 0 or at least 7 days.",
    };
  }

  if (
    (retention as number) > 0 &&
    !hasEntitlementBasedOnPlan({
      plan: scope.plan,
      entitlement: "data-retention",
    })
  ) {
    return {
      ok: false,
      status: 403,
      message:
        "A retention period above zero requires the data-retention entitlement.",
    };
  }

  return { ok: true };
}

export async function createProject(
  req: NextApiRequest,
  res: NextApiResponse,
  scope: ApiAccessScope,
) {
  try {
    const { name, retention, metadata } = req.body;

    if (!projectNameSchema.safeParse({ name }).success) {
      return res.status(400).json({
        message: "Invalid project name. Use 3 to 60 characters.",
      });
    }

    const decodedMetadata = decodeProjectMetadata(metadata);
    if (!decodedMetadata.ok) {
      return res.status(400).json({ message: decodedMetadata.message });
    }

    if (retention !== undefined) {
      const retentionValidation = validateRetention(retention, scope);
      if (!retentionValidation.ok) {
        return res.status(retentionValidation.status).json({
          message: retentionValidation.message,
        });
      }
    }

    const existingProject = await prisma.project.findFirst({
      where: { orgId: scope.orgId, name, deletedAt: null },
      select: { id: true },
    });

    if (existingProject) {
      return res.status(409).json({
        message: "Your organization already has a project with this name.",
      });
    }

    const project = await prisma.$transaction(async (tx) => {
      const createdProject = await tx.project.create({
        data: {
          name,
          orgId: scope.orgId,
          retentionDays: retention,
          metadata: decodedMetadata.value,
        },
      });

      await tx.scoreConfig.createMany({
        data: getDefaultScoreConfigsForProject(createdProject.id),
      });

      return createdProject;
    });

    try {
      await provisionSplitForNewProject(project.id);
    } catch (error) {
      await prisma.project
        .delete({ where: { id: project.id } })
        .catch(() => undefined);
      throw error;
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
