import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireInstanceAdmin } from "@/src/features/enterprise/auth/requireInstanceAdmin";
import { routeByMethod } from "@/src/features/enterprise/http";
import { listOrgApiKeys } from "@/src/features/enterprise/apiKeys/listOrgApiKeys";
import { createOrgApiKey } from "@/src/features/enterprise/apiKeys/createOrgApiKey";

/**
 * Instance admin: list / create organization-level API keys.
 * GET /api/admin/organizations/{id}/apiKeys
 * POST /api/admin/organizations/{id}/apiKeys
 */
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

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    return routeByMethod(req, res, {
      GET: () => listOrgApiKeys(req, res, organizationId),
      POST: () => createOrgApiKey(req, res, organizationId, "admin-api"),
    });
  } catch (e) {
    logger.error("Failed to process organization API key request", e);
    res.status(500).json({ error: "Internal server error" });
  }
}
