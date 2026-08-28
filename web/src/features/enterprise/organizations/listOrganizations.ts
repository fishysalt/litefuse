import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";

/**
 * 列出所有组织（GET /api/admin/organizations，Instance 管理）。
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
    organizations: organizations.map((org: any) => ({
      ...org,
      metadata: org.metadata ?? {},
      projects: org.projects,
    })),
  });
}
