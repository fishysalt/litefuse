import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";

/**
 * 查询单个组织（GET /api/admin/organizations/{id}，Instance 管理）。
 */
export async function getOrganization(
  req: NextApiRequest,
  res: NextApiResponse,
  organizationId: string,
) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
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

  if (!organization) {
    return res.status(404).json({ error: "Organization not found" });
  }

  return res.status(200).json({
    ...organization,
    metadata: organization.metadata ?? {},
    projects: organization.projects,
  });
}
