import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import {
  logger,
  redis,
  QueueJobs,
  ProjectDeleteQueue,
  type ApiAccessScope,
} from "@langfuse/shared/src/server";
import { randomUUID } from "crypto";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";

/**
 * 删除项目（DELETE /api/public/projects/{id}）。
 * 失效缓存 key → 删项目级 key → 软删项目 → 审计 → 投递异步删除队列。
 */
export async function deleteProject(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  scope: ApiAccessScope,
) {
  try {
    // API keys need to be deleted from cache. Otherwise, they will still be valid.
    await new ApiAuthService(
      prisma,
      redis,
    ).invalidateCachedProjectApiKeys(projectId);

    // Delete API keys from DB
    await prisma.apiKey.deleteMany({
      where: { projectId, scope: "PROJECT" },
    });

    // Mark project as deleted (id + orgId 约束，防跨组织)
    const project = await prisma.project.update({
      where: { id: projectId, orgId: scope.orgId },
      data: { deletedAt: new Date() },
    });

    await auditLog({
      apiKeyId: scope.apiKeyId,
      orgId: scope.orgId,
      projectId,
      resourceType: "project",
      resourceId: projectId,
      before: project,
      action: "delete",
    });

    const projectDeleteQueue = ProjectDeleteQueue.getInstance();
    if (!projectDeleteQueue) {
      logger.error("ProjectDeleteQueue is not available");
      return res.status(500).json({ message: "Internal server error" });
    }

    await projectDeleteQueue.add(QueueJobs.ProjectDelete, {
      timestamp: new Date(),
      id: randomUUID(),
      payload: {
        projectId,
        orgId: scope.orgId,
      },
      name: QueueJobs.ProjectDelete,
    });

    return res.status(202).json({
      success: true,
      message:
        "Project deletion has been initiated and is being processed asynchronously",
    });
  } catch (error) {
    logger.error("Failed to delete project", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
