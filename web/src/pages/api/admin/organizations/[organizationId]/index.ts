import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireInstanceAdmin } from "@/src/features/enterprise/auth/requireInstanceAdmin";
import { routeByMethod } from "@/src/features/enterprise/http";
import { getOrganization } from "@/src/features/enterprise/organizations/getOrganization";
import { updateOrganization } from "@/src/features/enterprise/organizations/updateOrganization";
import { deleteOrganization } from "@/src/features/enterprise/organizations/deleteOrganization";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const { organizationId } = req.query;
    if (typeof organizationId !== "string") {
      res.status(400).json({ error: "Invalid organization ID" });
      return;
    }

    if (!requireInstanceAdmin(req, res)) {
      return;
    }

    return routeByMethod(req, res, {
      GET: () => getOrganization(req, res, organizationId),
      PUT: () => updateOrganization(req, res, organizationId),
      DELETE: () => deleteOrganization(req, res, organizationId),
    });
  } catch (e) {
    logger.error("Failed to process organization request", e);
    res.status(500).json({ error: "Internal server error" });
  }
}
