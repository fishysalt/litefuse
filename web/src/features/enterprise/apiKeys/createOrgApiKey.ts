import { auditLog } from "@/src/features/audit-logs/auditLog";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { createAndAddApiKeysToDb } from "@langfuse/shared/src/server/auth/apiKeys";
import { type NextApiRequest, type NextApiResponse } from "next";
import * as z from "zod/v4";

const CreateOrgApiKeyBody = z.object({
  note: z.string().optional(),
});

export async function createOrgApiKey(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
  actorId: string,
) {
  const parsedBody = CreateOrgApiKeyBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsedBody.error.format(),
    });
  }

  const apiKeyMeta = await createAndAddApiKeysToDb({
    prisma,
    entityId: orgId,
    note: parsedBody.data.note,
    scope: "ORGANIZATION",
  });

  await auditLog({
    apiKeyId: actorId,
    orgId,
    resourceType: "apiKey",
    resourceId: apiKeyMeta.id,
    action: "create",
  });

  logger.info(
    `Created organization API key ${apiKeyMeta.id} for organization ${orgId}`,
  );

  return res.status(201).json(apiKeyMeta);
}
