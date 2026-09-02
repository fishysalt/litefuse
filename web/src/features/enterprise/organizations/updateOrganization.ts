import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { organizationNameSchema } from "@/src/features/organizations/utils/organizationNameSchema";

/**
 * Update an organization (PUT /api/admin/organizations/{id}, instance admin).
 */
export async function updateOrganization(
  req: NextApiRequest,
  res: NextApiResponse,
  organizationId: string,
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
  let parsedMetadata = metadata;
  if (metadata !== undefined && typeof metadata !== "object") {
    try {
      parsedMetadata = JSON.parse(metadata);
    } catch (error) {
      return res.status(400).json({
        error: `Invalid metadata. Should be a valid JSON object: ${error}`,
      });
    }
  }
  if (
    parsedMetadata !== undefined &&
    (typeof parsedMetadata !== "object" ||
      parsedMetadata === null ||
      Array.isArray(parsedMetadata))
  ) {
    return res.status(400).json({
      error: "Invalid metadata. Should be a valid JSON object.",
    });
  }

  const existing = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Organization not found" });
  }

  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: { name, metadata: parsedMetadata },
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

  logger.info(`Updated organization ${organizationId} via admin API`);

  return res.status(200).json({
    ...updated,
    metadata: updated.metadata ?? {},
    projects: updated.projects,
  });
}
