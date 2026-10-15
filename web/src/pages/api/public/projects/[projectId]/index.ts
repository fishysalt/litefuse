import { requireAdminApi } from "@/src/features/enterprise/auth/requireAdminApi";
import { allowMethods, routeByMethod } from "@/src/features/enterprise/http";
import { deleteProject } from "@/src/features/enterprise/projects/deleteProject";
import { updateProject } from "@/src/features/enterprise/projects/updateProject";
import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  try {
    const { projectId } = req.query;
    if (typeof projectId !== "string") {
      return res.status(400).json({ message: "Invalid project ID" });
    }

    if (!allowMethods(req, res, ["PUT", "DELETE"])) return;

    const scope = await requireAdminApi(req, res);
    if (!scope) return;

    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId: scope.orgId, deletedAt: null },
    });

    if (!project) {
      return res.status(404).json({
        message: "Project not found or you don't have access to it",
      });
    }

    return routeByMethod(req, res, {
      PUT: (request: NextApiRequest, response: NextApiResponse) =>
        updateProject(request, response, projectId, scope),
      DELETE: (request: NextApiRequest, response: NextApiResponse) =>
        deleteProject(request, response, projectId, scope),
    });
  } catch (error) {
    logger.error("Failed to process project request", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
