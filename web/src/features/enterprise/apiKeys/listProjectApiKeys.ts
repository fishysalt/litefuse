import { prisma } from "@langfuse/shared/src/db";
import { type NextApiRequest, type NextApiResponse } from "next";

export async function listProjectApiKeys(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
) {
  const apiKeys = await prisma.apiKey.findMany({
    where: {
      projectId,
      scope: "PROJECT",
    },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
      note: true,
      publicKey: true,
      displaySecretKey: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return res.status(200).json({ apiKeys });
}
