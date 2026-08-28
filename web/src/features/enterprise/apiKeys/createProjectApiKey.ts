import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { logger, type ApiAccessScope } from "@langfuse/shared/src/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { createAndAddApiKeysToDb } from "@langfuse/shared/src/server/auth/apiKeys";
import { z } from "zod/v4";

const CreateProjectApiKeyBody = z.object({
  note: z.string().optional(),
  publicKey: z.string().optional(),
  secretKey: z.string().optional(),
});

/**
 * 创建项目级 API key（POST /api/public/projects/{id}/apiKeys）。
 * 支持可选预定义 key（publicKey + secretKey 必须成对，且以 pk-lf-/sk-lf- 开头）。
 */
export async function createProjectApiKey(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  scope: ApiAccessScope,
) {
  const parsed = CreateProjectApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid request body",
      details: parsed.error.format(),
    });
  }

  const { note, publicKey, secretKey } = parsed.data;

  if (publicKey || secretKey) {
    if (!publicKey || !secretKey) {
      return res.status(400).json({
        message:
          "Both publicKey and secretKey must be provided together when specifying predefined keys",
      });
    }

    if (!publicKey.startsWith("pk-lf-")) {
      return res.status(400).json({
        message: "publicKey must start with 'pk-lf-'",
      });
    }

    if (!secretKey.startsWith("sk-lf-")) {
      return res.status(400).json({
        message: "secretKey must start with 'sk-lf-'",
      });
    }
  }

  try {
    const apiKeyMeta = await createAndAddApiKeysToDb({
      prisma,
      entityId: projectId,
      note,
      scope: "PROJECT",
      predefinedKeys:
        publicKey && secretKey ? { publicKey, secretKey } : undefined,
    });

    await auditLog({
      apiKeyId: scope.apiKeyId,
      orgId: scope.orgId,
      projectId,
      resourceType: "apiKey",
      resourceId: apiKeyMeta.id,
      action: "create",
    });

    logger.info(`Created API key ${apiKeyMeta.id} for project ${projectId}`);

    return res.status(201).json(apiKeyMeta);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Unique constraint") ||
        error.message.includes("unique constraint"))
    ) {
      return res.status(409).json({
        message:
          "API key with the provided publicKey or secretKey already exists",
      });
    }

    logger.error("Failed to create project API key", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
