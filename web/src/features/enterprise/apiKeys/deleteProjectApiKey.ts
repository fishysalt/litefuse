import { auditLog } from "@/src/features/audit-logs/auditLog";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { prisma } from "@langfuse/shared/src/db";
import {
  type ApiAccessScope,
  logger,
  redis,
} from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

export async function deleteProjectApiKey(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  apiKeyId: string,
  scope: ApiAccessScope,
) {
  const apiKey = await prisma.apiKey.findUnique({
    where: {
      id: apiKeyId,
      projectId,
      scope: "PROJECT",
    },
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
    return res
      .status(500)
      .json({ message: "The API key could not be removed." });
  }

  await auditLog({
    apiKeyId: scope.apiKeyId,
    orgId: scope.orgId,
    projectId,
    resourceType: "apiKey",
    resourceId: apiKeyId,
    action: "delete",
  });

  logger.info(`Deleted project API key ${apiKeyId} for project ${projectId}`);

  return res.status(200).json({ success: true });
}
