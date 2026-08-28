import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireAdminApi } from "@/src/features/enterprise/auth/requireAdminApi";
import { routeByMethod } from "@/src/features/enterprise/http";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { listProjectMemberships } from "@/src/features/enterprise/memberships/listProjectMemberships";
import { upsertProjectMembership } from "@/src/features/enterprise/memberships/upsertProjectMembership";
import { deleteProjectMembership } from "@/src/features/enterprise/memberships/deleteProjectMembership";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  const { projectId } = req.query;
  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: "projectId is required" });
  }

  const scope = await requireAdminApi(req, res);
  if (!scope) return;

  // 项目成员管理额外要求 rbac-project-roles entitlement
  if (
    !hasEntitlementBasedOnPlan({
      plan: scope.plan,
      entitlement: "rbac-project-roles",
    })
  ) {
    return res.status(403).json({
      error: "Your plan does not include project role management.",
    });
  }

  // 验证项目属于当前组织
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: scope.orgId, deletedAt: null },
  });
  if (!project) {
    return res.status(404).json({
      error: "Project not found or does not belong to this organization",
    });
  }

  try {
    return routeByMethod(req, res, {
      GET: () => listProjectMemberships(req, res, projectId, scope.orgId),
      PUT: () => upsertProjectMembership(req, res, projectId, scope.orgId),
      DELETE: () => deleteProjectMembership(req, res, projectId, scope.orgId),
    });
  } catch (error) {
    logger.error(
      `Error handling project memberships for ${req.method} on project ${projectId}`,
      error,
    );
    return res.status(500).json({ error: "Internal server error" });
  }
}
