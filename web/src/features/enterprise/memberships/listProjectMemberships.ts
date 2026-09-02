import { type NextApiRequest, type NextApiResponse } from "next";
import { Prisma } from "@langfuse/shared";
import { getUserProjectRoles } from "@langfuse/shared/src/server";

/**
 * List project memberships (GET /api/public/projects/{id}/memberships).
 * Same semantics as the UI: all organization members (including OWNERs) with project-role overrides.
 * - OWNERs and members without a project role: inherit the organization role
 * - Members with an explicit project role: use the project role
 * - NONE is excluded
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
