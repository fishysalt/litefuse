import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireAdminApi } from "@/src/features/enterprise/auth/requireAdminApi";
import { routeByMethod } from "@/src/features/enterprise/http";
import { updateProject } from "@/src/features/enterprise/projects/updateProject";
import { deleteProject } from "@/src/features/enterprise/projects/deleteProject";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  const { projectId } = req.query;
  if (typeof projectId !== "string") {
    return res.status(400).json({ message: "Invalid project ID" });
  }

  const scope = await requireAdminApi(req, res);
  if (!scope) return;

  // 验证项目存在且属于当前组织
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
      PUT: () => updateProject(req, res, projectId, scope),
      DELETE: () => deleteProject(req, res, projectId, scope),
    });
  } catch (error) {
    logger.error(
      `Error handling project ${projectId} for ${req.method}`,
      error,
    );
    return res.status(500).json({ message: "Internal server error" });
  }
}
