import { createOrgApiKey } from "@/src/features/enterprise/apiKeys/createOrgApiKey";
import { listOrgApiKeys } from "@/src/features/enterprise/apiKeys/listOrgApiKeys";
import { requireInstanceAdmin } from "@/src/features/enterprise/auth/requireInstanceAdmin";
import { routeByMethod } from "@/src/features/enterprise/http";
import { prisma } from "@langfuse/shared/src/db";
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
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    return routeByMethod(req, res, {
      GET: (request: NextApiRequest, response: NextApiResponse) =>
        listOrgApiKeys(request, response, organizationId),
      POST: (request: NextApiRequest, response: NextApiResponse) =>
        createOrgApiKey(request, response, organizationId, "admin-api"),
    });
  } catch (error) {
    logger.error("Failed to process organization API keys request", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
