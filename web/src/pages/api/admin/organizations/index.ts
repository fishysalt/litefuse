import { requireInstanceAdmin } from "@/src/features/enterprise/auth/requireInstanceAdmin";
import { routeByMethod } from "@/src/features/enterprise/http";
import { createOrganization } from "@/src/features/enterprise/organizations/createOrganization";
import { listOrganizations } from "@/src/features/enterprise/organizations/listOrganizations";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!requireInstanceAdmin(req, res)) return;

  try {
    return routeByMethod(req, res, {
      GET: listOrganizations,
      POST: createOrganization,
    });
  } catch (error) {
    logger.error("Failed to process organizations request", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
