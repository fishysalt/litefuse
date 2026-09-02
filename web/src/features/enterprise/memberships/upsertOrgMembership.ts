import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { Role } from "@langfuse/shared";
import { z } from "zod/v4";

const OrgMembershipBody = z.object({
  userId: z.string(),
  role: z.enum(Role),
});

/**
 * Create or update an organization membership (PUT /api/public/organizations/memberships).
 * Validates userId + role, then upserts organizationMembership.
 */
export async function upsertOrgMembership(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
) {
  const parsed = OrgMembershipBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues,
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
  });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Last-OWNER protection (matches the UI's membersRouter.updateOrgMembership):
  // reject demoting the only OWNER to a non-OWNER role, so the organization never ends up ownerless.
  const existing = await prisma.organizationMembership.findUnique({
    where: { orgId_userId: { orgId, userId: parsed.data.userId } },
  });
  if (existing?.role === Role.OWNER && parsed.data.role !== Role.OWNER) {
    const otherOwners = await prisma.organizationMembership.count({
      where: { orgId, role: Role.OWNER, id: { not: existing.id } },
    });
    if (otherOwners === 0) {
      return res.status(403).json({
        error:
          "Cannot remove the last owner of an organization. Assign new owner or delete organization.",
      });
    }
  }

  const membership = await prisma.organizationMembership.upsert({
    where: {
      orgId_userId: { orgId, userId: parsed.data.userId },
    },
    update: { role: parsed.data.role },
    create: {
      orgId,
      userId: parsed.data.userId,
      role: parsed.data.role,
    },
  });

  return res.status(200).json({
    userId: membership.userId,
    role: membership.role,
    email: user.email,
    name: user.name,
  });
}
