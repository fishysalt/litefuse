import { auditLog } from "@/src/features/audit-logs/auditLog";
import { prisma } from "@langfuse/shared/src/db";
import { type ApiAccessScope, logger } from "@langfuse/shared/src/server";
import { createAndAddApiKeysToDb } from "@langfuse/shared/src/server/auth/apiKeys";
import { type NextApiRequest, type NextApiResponse } from "next";
import * as z from "zod/v4";

const PUBLIC_KEY_PREFIX = "pk-lf-";
const SECRET_KEY_PREFIX = "sk-lf-";

const CreateProjectApiKeyBody = z.object({
  note: z.string().optional(),
  publicKey: z.string().optional(),
  secretKey: z.string().optional(),
});

function isDuplicateKeyError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  ) {
    return true;
  }

  return error instanceof Error && /unique constraint/i.test(error.message);
}

export async function createProjectApiKey(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  scope: ApiAccessScope,
) {
  const parsedBody = CreateProjectApiKeyBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      message: "Invalid request body",
      details: parsedBody.error.format(),
    });
  }

  const { note, publicKey, secretKey } = parsedBody.data;

  if ((publicKey === undefined) !== (secretKey === undefined)) {
    return res.status(400).json({
      message:
        "Both publicKey and secretKey are required together to register a custom key pair.",
    });
  }

  if (publicKey !== undefined && !publicKey.startsWith(PUBLIC_KEY_PREFIX)) {
    return res.status(400).json({
      message: `publicKey has to use the '${PUBLIC_KEY_PREFIX}' prefix`,
    });
  }

  if (secretKey !== undefined && !secretKey.startsWith(SECRET_KEY_PREFIX)) {
    return res.status(400).json({
      message: `secretKey has to use the '${SECRET_KEY_PREFIX}' prefix`,
    });
  }

  let apiKeyMeta: Awaited<ReturnType<typeof createAndAddApiKeysToDb>>;
  try {
    apiKeyMeta = await createAndAddApiKeysToDb({
      prisma,
      entityId: projectId,
      note,
      scope: "PROJECT",
      predefinedKeys:
        publicKey !== undefined && secretKey !== undefined
          ? { publicKey, secretKey }
          : undefined,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({
        message:
          "That publicKey or secretKey is already in use by another API key.",
      });
    }

    logger.error("Failed to create project API key", error);
    return res.status(500).json({ message: "Internal server error" });
  }

  await auditLog({
    apiKeyId: scope.apiKeyId,
    orgId: scope.orgId,
    projectId,
    resourceType: "apiKey",
    resourceId: apiKeyMeta.id,
    action: "create",
  });

  logger.info(
    `Created project API key ${apiKeyMeta.id} for project ${projectId}`,
  );

  return res.status(201).json(apiKeyMeta);
}
