import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { logger, redis } from "@langfuse/shared/src/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";

/**
 * 删除组织级 API key。
 * - public 入口：DELETE /api/public/organizations/apiKeys/{id}
 * - Instance 入口：DELETE /api/admin/organizations/{id}/apiKeys/{keyId}
 */
export async function deleteOrgApiKey(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
  apiKeyId: string,
  actorId: string,
) {
  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId, orgId, scope: "ORGANIZATION" },
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
    return res.status(500).json({ error: "Failed to delete API key" });
  }

  await auditLog({
    apiKeyId: actorId,
    orgId,
    resourceType: "apiKey",
    resourceId: apiKeyId,
    action: "delete",
  });

  logger.info(`Deleted API key ${apiKeyId} for organization ${orgId}`);

  return res.status(200).json({ success: true });
}
