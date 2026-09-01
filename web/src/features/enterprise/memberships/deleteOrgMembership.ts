import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { Role } from "@langfuse/shared";
import { z } from "zod/v4";

const DeleteOrgMembershipBody = z.object({
  userId: z.string(),
});

/**
 * 删除组织成员（DELETE /api/public/organizations/memberships）。
 * 用 deleteMany 避免“成员不存在”时报错。
 */
export async function deleteOrgMembership(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
) {
  const parsed = DeleteOrgMembershipBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues,
    });
  }

  // 最后 OWNER 保护（与 UI membersRouter.deleteOrgMembership 一致）：
  // 不允许删除组织中唯一的 OWNER，防止组织失去所有者。
  const existing = await prisma.organizationMembership.findUnique({
    where: { orgId_userId: { orgId, userId: parsed.data.userId } },
  });
  if (existing?.role === Role.OWNER) {
    const owners = await prisma.organizationMembership.count({
      where: { orgId, role: Role.OWNER },
    });
    if (owners === 1) {
      return res.status(403).json({
        error:
          "Cannot remove the last owner of an organization. Assign new owner or delete organization.",
      });
    }
  }

  await prisma.organizationMembership.deleteMany({
    where: { orgId, userId: parsed.data.userId },
  });

  return res.status(200).json({
    message: "Membership deleted successfully",
    userId: parsed.data.userId,
  });
}
