import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";

/**
 * List all organizations (GET /api/admin/organizations, instance admin).
 */
export async function listOrganizations(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const organizations = await prisma.organization.findMany({
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

  return res.status(200).json({
    organizations: organizations.map((org) => ({
      ...org,
      metadata: org.metadata ?? {},
      projects: org.projects,
    })),
  });
}
