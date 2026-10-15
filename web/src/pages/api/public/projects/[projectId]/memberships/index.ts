import { requireAdminApi } from "@/src/features/enterprise/auth/requireAdminApi";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { allowMethods, routeByMethod } from "@/src/features/enterprise/http";
import { deleteProjectMembership } from "@/src/features/enterprise/memberships/deleteProjectMembership";
import { listProjectMemberships } from "@/src/features/enterprise/memberships/listProjectMemberships";
import { upsertProjectMembership } from "@/src/features/enterprise/memberships/upsertProjectMembership";
import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  const { projectId } = req.query;
  if (!projectId || typeof projectId !== "string") {
    return res.status(400).json({ error: "projectId is required" });
  }

  if (!allowMethods(req, res, ["GET", "PUT", "DELETE"])) return;

  const scope = await requireAdminApi(req, res);
  if (!scope) return;

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

  try {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        orgId: scope.orgId,
        deletedAt: null,
      },
    });

    if (!project) {
      return res.status(404).json({
        error: "Project not found or does not belong to this organization",
      });
    }

    return routeByMethod(req, res, {
      GET: () => listProjectMemberships(req, res, projectId, scope.orgId),
      PUT: () => upsertProjectMembership(req, res, projectId, scope.orgId),
      DELETE: () => deleteProjectMembership(req, res, projectId, scope.orgId),
    });
  } catch (error) {
    logger.error("Failed to process project memberships request", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
