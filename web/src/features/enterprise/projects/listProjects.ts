import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";

/**
 * 列出组织下的项目（GET /api/public/organizations/projects）。
 * 只返回未删除（deletedAt 为 null）的项目。
 */
export async function listProjects(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
) {
  const projects = await prisma.project.findMany({
    where: { orgId, deletedAt: null },
    select: {
      id: true,
      name: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return res.status(200).json({
    projects: projects.map((p: any) => ({
      id: p.id,
      name: p.name,
      metadata: p.metadata,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  });
}
