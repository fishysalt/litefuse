import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
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

  await prisma.organizationMembership.deleteMany({
    where: { orgId, userId: parsed.data.userId },
  });

  return res.status(200).json({
    message: "Membership deleted successfully",
    userId: parsed.data.userId,
  });
}
