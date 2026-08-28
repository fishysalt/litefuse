import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireInstanceAdmin } from "@/src/features/enterprise/auth/requireInstanceAdmin";
import { routeByMethod } from "@/src/features/enterprise/http";
import { listOrganizations } from "@/src/features/enterprise/organizations/listOrganizations";
import { createOrganization } from "@/src/features/enterprise/organizations/createOrganization";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (!requireInstanceAdmin(req, res)) {
      return;
    }

    return routeByMethod(req, res, {
      GET: () => listOrganizations(req, res),
      POST: () => createOrganization(req, res),
    });
  } catch (e) {
    logger.error("Failed to process organization request", e);
    res.status(500).json({ error: "Internal server error" });
  }
}
