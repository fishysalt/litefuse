import { auditLog } from "@/src/features/audit-logs/auditLog";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { prisma } from "@langfuse/shared/src/db";
import {
  logger,
  ProjectDeleteQueue,
  QueueJobs,
  redis,
  type ApiAccessScope,
} from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";
import { randomUUID } from "crypto";

export async function deleteProject(
  _req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  scope: ApiAccessScope,
) {
  try {
    await new ApiAuthService(prisma, redis).invalidateCachedProjectApiKeys(
      projectId,
    );

    await prisma.apiKey.deleteMany({
      where: { projectId, scope: "PROJECT" },
    });

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
      action: "delete",
      before: project,
    });

    const projectDeleteQueue = ProjectDeleteQueue.getInstance();
    if (!projectDeleteQueue) {
      logger.error("Project delete queue is unavailable");
      return res.status(500).json({ message: "Internal server error" });
    }

    await projectDeleteQueue.add(QueueJobs.ProjectDelete, {
      timestamp: new Date(),
      id: randomUUID(),
      payload: { projectId, orgId: scope.orgId },
      name: QueueJobs.ProjectDelete,
    });

    return res.status(202).json({
      success: true,
      message:
        "The project is queued for deletion and will be removed in the background.",
    });
  } catch (error) {
    logger.error("Failed to delete project", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
