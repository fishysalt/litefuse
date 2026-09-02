import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireAdminApi } from "@/src/features/enterprise/auth/requireAdminApi";
import { allowMethods, routeByMethod } from "@/src/features/enterprise/http";
import { listProjectApiKeys } from "@/src/features/enterprise/apiKeys/listProjectApiKeys";
import { createProjectApiKey } from "@/src/features/enterprise/apiKeys/createProjectApiKey";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  const { projectId } = req.query;
  if (typeof projectId !== "string") {
    return res.status(400).json({ message: "Invalid project ID" });
  }

  if (!allowMethods(req, res, ["GET", "POST"])) return;

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
      GET: () => listProjectApiKeys(req, res, projectId),
      POST: () => createProjectApiKey(req, res, projectId, scope),
    });
  } catch (error) {
    logger.error(`Error handling project API keys for ${req.method}`, error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
