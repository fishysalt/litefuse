import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { Role } from "@langfuse/shared";
import { z } from "zod/v4";

const OrgMembershipBody = z.object({
  userId: z.string(),
  role: z.enum(Role),
});

/**
 * 创建或更新组织成员（PUT /api/public/organizations/memberships）。
 * 校验 userId + role，upsert organizationMembership。
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

  // 最后 OWNER 保护（与 UI membersRouter.updateOrgMembership 一致）：
  // 如果把唯一的 OWNER 降为非 OWNER，拒绝，防止组织失去所有者。
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
