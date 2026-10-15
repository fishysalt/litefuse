import { projectNameSchema } from "@/src/features/auth/lib/projectNameSchema";
import { projectRetentionSchema } from "@/src/features/auth/lib/projectRetentionSchema";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { prisma, type Prisma } from "@langfuse/shared/src/db";
import {
  enqueueDorisSplitTableProvisioning,
  logger,
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

export async function updateProject(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
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

    const patch: Prisma.ProjectUpdateInput = { name };
    if (retention !== undefined) {
      patch.retentionDays = retention;
    }
    if (decodedMetadata.value !== undefined) {
      patch.metadata = decodedMetadata.value;
    }

    const project = await prisma.project.update({
      where: { id: projectId, orgId: scope.orgId },
      data: patch,
      select: {
        id: true,
        name: true,
        retentionDays: true,
        metadata: true,
      },
    });

    if (retention !== undefined) {
      try {
        await enqueueDorisSplitTableProvisioning(projectId);
      } catch (error) {
        logger.error("Failed to enqueue Doris split table provisioning", error);
      }
    }

    return res.status(200).json({
      id: project.id,
      name: project.name,
      metadata: project.metadata ?? {},
      ...(project.retentionDays
        ? { retentionDays: project.retentionDays }
        : {}),
    });
  } catch (error) {
    logger.error("Failed to update project", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
