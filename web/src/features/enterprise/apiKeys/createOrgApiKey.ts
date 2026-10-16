import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { createAndAddApiKeysToDb } from "@langfuse/shared/src/server/auth/apiKeys";
import { z } from "zod/v4";

const CreateOrgApiKeyBody = z.object({
  note: z.string().optional(),
});

/**
 * Create an organization-level API key.
 * Instance-admin entry: POST /api/admin/organizations/{id}/apiKeys (actorId is a fixed identifier used for the audit log)
 */
export async function createOrgApiKey(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
  actorId: string,
) {
  const parsed = CreateOrgApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.format(),
    });
  }

  const apiKeyMeta = await createAndAddApiKeysToDb({
    prisma,
    entityId: orgId,
    note: parsed.data.note,
    scope: "ORGANIZATION",
  });

  await auditLog({
    apiKeyId: actorId,
    orgId,
    resourceType: "apiKey",
    resourceId: apiKeyMeta.id,
    action: "create",
  });

  logger.info(`Created API key ${apiKeyMeta.id} for organization ${orgId}`);

  return res.status(201).json(apiKeyMeta);
}
