import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { Role } from "@langfuse/shared";
import { z } from "zod/v4";

// Matches the public MembershipRole contract (Fern): NONE is not assignable
// through the API. Use DELETE to revert a project membership to the
// organization role.
const ProjectMembershipBody = z.object({
  userId: z.string(),
  role: z.enum([Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER]),
});

/**
 * Create or update a project membership (PUT /api/public/projects/{id}/memberships).
 * Confirms the user is already in the organization (organizationMembership), then upserts projectMembership.
 */
export async function upsertProjectMembership(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  orgId: string,
) {
  const parsed = ProjectMembershipBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues,
    });
  }

  const orgMembership = await prisma.organizationMembership.findUnique({
    where: {
      orgId_userId: { userId: parsed.data.userId, orgId },
    },
    include: {
      user: { select: { email: true, name: true } },
    },
  });

  if (!orgMembership) {
    return res.status(404).json({
      error: "User is not a member of this organization",
    });
  }

  const membership = await prisma.projectMembership.upsert({
    where: {
      projectId_userId: { userId: parsed.data.userId, projectId },
    },
    update: { role: parsed.data.role },
    create: {
      userId: parsed.data.userId,
      projectId,
      role: parsed.data.role,
      orgMembershipId: orgMembership.id,
    },
  });

  return res.status(200).json({
    userId: membership.userId,
    role: membership.role,
    email: orgMembership.user.email,
    name: orgMembership.user.name,
  });
}
