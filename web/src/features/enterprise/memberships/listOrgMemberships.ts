import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";

/**
 * List organization memberships (GET /api/public/organizations/memberships).
 * The caller is already authenticated; orgId comes from the organization-level key's scope.
 */
export async function listOrgMemberships(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
) {
  const memberships = await prisma.organizationMembership.findMany({
    where: { orgId },
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  return res.status(200).json({
    memberships: memberships.map((m) => ({
      userId: m.userId,
      role: m.role,
      email: m.user.email,
      name: m.user.name,
    })),
  });
}
