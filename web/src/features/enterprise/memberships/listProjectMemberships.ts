import { type NextApiRequest, type NextApiResponse } from "next";
import { Prisma } from "@langfuse/shared";
import { getUserProjectRoles } from "@langfuse/shared/src/server";

/**
 * 列出项目成员（GET /api/public/projects/{id}/memberships）。
 * 语义与 UI 一致：所有组织成员（含 OWNER）+ 项目角色覆盖。
 * - OWNER 或无项目角色的成员：继承组织角色
 * - 有显式项目角色的成员：用项目角色
 * - NONE 排除
 */
export async function listProjectMemberships(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  orgId: string,
) {
  const users = await getUserProjectRoles({
    projectId,
    orgId,
    searchFilter: Prisma.empty,
    filterCondition: [],
    orderBy: Prisma.sql`ORDER BY all_eligible_users.name ASC NULLS LAST, all_eligible_users.email ASC NULLS LAST`,
  });

  return res.status(200).json({
    memberships: users.map((user) => ({
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
    })),
  });
}
