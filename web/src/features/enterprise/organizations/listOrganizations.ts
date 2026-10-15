import { prisma } from "@langfuse/shared/src/db";
import { type NextApiRequest, type NextApiResponse } from "next";

export async function listOrganizations(
  _req: NextApiRequest,
  res: NextApiResponse,
) {
  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      metadata: true,
      projects: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  return res.status(200).json({
    organizations: organizations.map((organization) => ({
      ...organization,
      metadata: organization.metadata ?? {},
    })),
  });
}
