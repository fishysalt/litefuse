import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";

/**
 * List project memberships (GET /api/public/projects/{id}/memberships).
 * Returns the explicit project-level memberships only (users whose access to
 * this project overrides their organization role), scoped to the organization.
 */
export async function listProjectMemberships(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  orgId: string,
) {
  const memberships = await prisma.projectMembership.findMany({
    where: {
      projectId,
      organizationMembership: { orgId },
    },
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  return res.status(200).json({
    memberships: memberships.map((membership) => ({
      userId: membership.userId,
      role: membership.role,
      email: membership.user.email,
      name: membership.user.name,
    })),
  });
}
