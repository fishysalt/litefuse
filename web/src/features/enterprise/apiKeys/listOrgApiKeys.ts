import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";

/**
 * 列出组织级 API key（GET /api/public/organizations/apiKeys）。
 */
export async function listOrgApiKeys(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
) {
  const apiKeys = await prisma.apiKey.findMany({
    where: { orgId, scope: "ORGANIZATION" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
      note: true,
      publicKey: true,
      displaySecretKey: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return res.status(200).json({ apiKeys });
}
