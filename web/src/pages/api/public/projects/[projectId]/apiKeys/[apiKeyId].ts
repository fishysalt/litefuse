import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireAdminApi } from "@/src/features/enterprise/auth/requireAdminApi";
import { allowMethods, routeByMethod } from "@/src/features/enterprise/http";
import { deleteProjectApiKey } from "@/src/features/enterprise/apiKeys/deleteProjectApiKey";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  const { projectId, apiKeyId } = req.query;
  if (typeof projectId !== "string" || typeof apiKeyId !== "string") {
    return res
      .status(400)
      .json({ message: "Invalid project ID or API key ID" });
  }

  if (!allowMethods(req, res, ["DELETE"])) return;

  const scope = await requireAdminApi(req, res);
  if (!scope) return;

  // Verify the project exists and belongs to the current organization
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: scope.orgId, deletedAt: null },
  });
  if (!project) {
    return res.status(404).json({
      message: "Project not found or you don't have access to it",
    });
  }

  try {
    return routeByMethod(req, res, {
      DELETE: () => deleteProjectApiKey(req, res, projectId, apiKeyId, scope),
    });
  } catch (error) {
    logger.error(
      `Error deleting project API key ${apiKeyId} for ${req.method}`,
      error,
    );
    return res.status(500).json({ message: "Internal server error" });
  }
}
