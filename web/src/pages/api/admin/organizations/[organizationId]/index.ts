import { requireInstanceAdmin } from "@/src/features/enterprise/auth/requireInstanceAdmin";
import { routeByMethod } from "@/src/features/enterprise/http";
import { deleteOrganization } from "@/src/features/enterprise/organizations/deleteOrganization";
import { getOrganization } from "@/src/features/enterprise/organizations/getOrganization";
import { updateOrganization } from "@/src/features/enterprise/organizations/updateOrganization";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { organizationId } = req.query;
  if (typeof organizationId !== "string") {
    return res.status(400).json({ error: "Invalid organization ID" });
  }

  if (!requireInstanceAdmin(req, res)) return;

  try {
    return routeByMethod(req, res, {
      GET: (request: NextApiRequest, response: NextApiResponse) =>
        getOrganization(request, response, organizationId),
      PUT: (request: NextApiRequest, response: NextApiResponse) =>
        updateOrganization(request, response, organizationId),
      DELETE: (request: NextApiRequest, response: NextApiResponse) =>
        deleteOrganization(request, response, organizationId),
    });
  } catch (error) {
    logger.error("Failed to process organization request", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
