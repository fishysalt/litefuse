import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";

/**
 * 列出项目成员（GET /api/public/projects/{id}/memberships）。
 * 通过 organizationMembership.orgId 约束成员属于当前组织。
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
    memberships: memberships.map((m: any) => ({
      userId: m.userId,
      role: m.role,
      email: m.user.email,
      name: m.user.name,
    })),
  });
}
