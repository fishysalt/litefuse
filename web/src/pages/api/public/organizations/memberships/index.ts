import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireAdminApi } from "@/src/features/enterprise/auth/requireAdminApi";
import { routeByMethod } from "@/src/features/enterprise/http";
import { listOrgMemberships } from "@/src/features/enterprise/memberships/listOrgMemberships";
import { upsertOrgMembership } from "@/src/features/enterprise/memberships/upsertOrgMembership";
import { deleteOrgMembership } from "@/src/features/enterprise/memberships/deleteOrgMembership";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  const scope = await requireAdminApi(req, res);
  if (!scope) return;

  try {
    return routeByMethod(req, res, {
      GET: () => listOrgMemberships(req, res, scope.orgId),
      PUT: () => upsertOrgMembership(req, res, scope.orgId),
      DELETE: () => deleteOrgMembership(req, res, scope.orgId),
    });
  } catch (error) {
    logger.error(
      `Error handling organization memberships for ${req.method}`,
      error,
    );
    return res.status(500).json({ error: "Internal server error" });
  }
}
