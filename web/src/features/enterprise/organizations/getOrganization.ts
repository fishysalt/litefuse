import { prisma } from "@langfuse/shared/src/db";
import { type NextApiRequest, type NextApiResponse } from "next";

export async function getOrganization(
  _req: NextApiRequest,
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

  if (!organization) {
    return res.status(404).json({ error: "Organization not found" });
  }

  return res.status(200).json({
    ...organization,
    metadata: organization.metadata ?? {},
  });
}
