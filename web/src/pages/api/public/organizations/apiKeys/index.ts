import { listOrgApiKeys } from "@/src/features/enterprise/apiKeys/listOrgApiKeys";
import { requireAdminApi } from "@/src/features/enterprise/auth/requireAdminApi";
import { routeByMethod } from "@/src/features/enterprise/http";
import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  const scope = await requireAdminApi(req, res);
  if (!scope) return;

  try {
    return routeByMethod(req, res, {
      GET: () => listOrgApiKeys(req, res, scope.orgId),
    });
  } catch (error) {
    logger.error("Failed to list organization API keys", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
