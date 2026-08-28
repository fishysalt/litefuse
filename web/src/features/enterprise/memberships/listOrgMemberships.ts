import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";

/**
 * 列出组织成员（GET /api/public/organizations/memberships）。
 * 调用方已通过鉴权，orgId 来自组织级 key 的 scope。
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
    memberships: memberships.map((m: any) => ({
      userId: m.userId,
      role: m.role,
      email: m.user.email,
      name: m.user.name,
    })),
  });
}
