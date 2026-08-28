import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { organizationNameSchema } from "@/src/features/organizations/utils/organizationNameSchema";

/**
 * 创建组织（POST /api/admin/organizations，Instance 管理）。
 */
export async function createOrganization(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const validationResult = organizationNameSchema.safeParse(req.body);
  if (!validationResult.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: validationResult.error.format(),
    });
  }

  const { name } = validationResult.data;

  const { metadata } = req.body;
  if (metadata !== undefined && typeof metadata !== "object") {
    try {
      JSON.parse(metadata);
    } catch (error) {
      return res.status(400).json({
        message: `Invalid metadata. Should be a valid JSON object: ${error}`,
      });
    }
  }

  const organization = await prisma.organization.create({
    data: { name, metadata },
    select: {
      id: true,
      name: true,
      createdAt: true,
      metadata: true,
      projects: {
        select: {
          id: true,
          name: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
        where: { deletedAt: null },
      },
    },
  });

  await auditLog({
    apiKeyId: "admin-api",
    orgId: organization.id,
    resourceType: "organization",
    resourceId: organization.id,
    action: "create",
    after: organization,
  });

  logger.info(`Created organization ${organization.id} via admin API`);

  return res.status(201).json({
    id: organization.id,
    name: organization.name,
    createdAt: organization.createdAt,
    metadata: organization.metadata ?? {},
    projects: organization.projects,
  });
}
