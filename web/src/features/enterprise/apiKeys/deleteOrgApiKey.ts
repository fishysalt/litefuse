import { auditLog } from "@/src/features/audit-logs/auditLog";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { prisma } from "@langfuse/shared/src/db";
import { logger, redis } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

export async function deleteOrgApiKey(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
  apiKeyId: string,
  actorId: string,
) {
  const apiKey = await prisma.apiKey.findUnique({
    where: {
      id: apiKeyId,
      orgId,
      scope: "ORGANIZATION",
    },
  });

  if (!apiKey) {
    return res.status(404).json({ error: "API key not found" });
  }

  const deleted = await new ApiAuthService(prisma, redis).deleteApiKey(
    apiKeyId,
    orgId,
    "ORGANIZATION",
  );

  if (!deleted) {
    return res.status(500).json({ error: "The API key could not be removed." });
  }

  await auditLog({
    apiKeyId: actorId,
    orgId,
    resourceType: "apiKey",
    resourceId: apiKeyId,
    action: "delete",
  });

  logger.info(
    `Deleted organization API key ${apiKeyId} for organization ${orgId}`,
  );

  return res.status(200).json({ success: true });
}
