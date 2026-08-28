import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { cors, runMiddleware } from "@/src/features/public-api/server/cors";
import { prisma } from "@langfuse/shared/src/db";
import { logger, redis } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { requireAdminApi } from "@/src/features/enterprise/auth/requireAdminApi";
import { createProject } from "@/src/features/enterprise/projects/createProject";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await runMiddleware(req, res, cors);

  if (req.method !== "GET" && req.method !== "POST") {
    logger.error(
      `Method not allowed for ${req.method} on /api/public/projects`,
    );
    return res.status(405).json({ message: "Method not allowed" });
  }

  // POST：创建项目（组织级 key + admin-api entitlement）
  if (req.method === "POST") {
    const scope = await requireAdminApi(req, res);
    if (!scope) return;
    return createProject(req, res, scope);
  }

  // GET：按 project key 查项目（保留原逻辑）
  const authCheck = await new ApiAuthService(
    prisma,
    redis,
  ).verifyAuthHeaderAndReturnScope(req.headers.authorization);
  if (!authCheck.validKey) {
    return res.status(401).json({
      message: authCheck.error,
    });
  }

  if (authCheck.scope.accessLevel !== "project" || !authCheck.scope.projectId) {
    return res.status(403).json({
      message: "Invalid API key. Are you using an organization key?",
    });
  }

  try {
    // Do not apply rate limits as it can break applications on lower tier plans when using auth_check in prod

    const projects = await prisma.project.findMany({
      select: {
        id: true,
        name: true,
        retentionDays: true,
        metadata: true,
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      where: {
        id: authCheck.scope.projectId,
        deletedAt: null,
      },
    });

    return res.status(200).json({
      data: projects.map((project) => ({
        id: project.id,
        name: project.name,
        organization: {
          id: project.organization.id,
          name: project.organization.name,
        },
        metadata: project.metadata ?? {},
        ...(project.retentionDays // Do not add if null or 0
          ? { retentionDays: project.retentionDays }
          : {}),
      })),
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
