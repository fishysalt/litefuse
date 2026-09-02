import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import {
  logger,
  redis,
  type ApiAccessScope,
} from "@langfuse/shared/src/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";

/**
 * Delete a project-level API key (DELETE /api/public/projects/{id}/apiKeys/{keyId}).
 */
export async function deleteProjectApiKey(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  apiKeyId: string,
  scope: ApiAccessScope,
) {
  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId, projectId, scope: "PROJECT" },
  });

  if (!apiKey) {
    return res.status(404).json({ message: "API key not found" });
  }

  const deleted = await new ApiAuthService(prisma, redis).deleteApiKey(
    apiKeyId,
    projectId,
    "PROJECT",
  );

  if (!deleted) {
    return res.status(500).json({ message: "Failed to delete API key" });
  }

  await auditLog({
    apiKeyId: scope.apiKeyId,
    orgId: scope.orgId,
    projectId,
    resourceType: "apiKey",
    resourceId: apiKeyId,
    action: "delete",
  });

  logger.info(`Deleted API key ${apiKeyId} for project ${projectId}`);

  return res.status(200).json({ success: true });
}
