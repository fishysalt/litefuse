import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireInstanceAdmin } from "@/src/features/enterprise/auth/requireInstanceAdmin";
import { routeByMethod } from "@/src/features/enterprise/http";
import { deleteOrgApiKey } from "@/src/features/enterprise/apiKeys/deleteOrgApiKey";

/**
 * Instance admin: delete an organization-level API key.
 * DELETE /api/admin/organizations/{id}/apiKeys/{keyId}
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const { organizationId, apiKeyId } = req.query;
    if (typeof organizationId !== "string" || typeof apiKeyId !== "string") {
      res.status(400).json({ error: "Invalid organization ID or API key ID" });
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
      DELETE: () =>
        deleteOrgApiKey(req, res, organizationId, apiKeyId, "admin-api"),
    });
  } catch (e) {
    logger.error("Failed to process organization API key request", e);
    res.status(500).json({ error: "Internal server error" });
  }
}
