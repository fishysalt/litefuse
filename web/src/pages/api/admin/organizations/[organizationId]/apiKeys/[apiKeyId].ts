import { deleteOrgApiKey } from "@/src/features/enterprise/apiKeys/deleteOrgApiKey";
import { requireInstanceAdmin } from "@/src/features/enterprise/auth/requireInstanceAdmin";
import { routeByMethod } from "@/src/features/enterprise/http";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { organizationId, apiKeyId } = req.query;
  if (typeof organizationId !== "string" || typeof apiKeyId !== "string") {
    return res
      .status(400)
      .json({ error: "Invalid organization ID or API key ID" });
  }

  if (!requireInstanceAdmin(req, res)) return;

  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    return routeByMethod(req, res, {
      DELETE: (request: NextApiRequest, response: NextApiResponse) =>
        deleteOrgApiKey(
          request,
          response,
          organizationId,
          apiKeyId,
          "admin-api",
        ),
    });
  } catch (error) {
    logger.error("Failed to delete organization API key", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
