import { prisma } from "@langfuse/shared/src/db";
import { type NextApiRequest, type NextApiResponse } from "next";
import * as z from "zod/v4";

const DeleteProjectMembershipBody = z.object({
  userId: z.string(),
});

export async function deleteProjectMembership(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  orgId: string,
) {
  const parsedBody = DeleteProjectMembershipBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsedBody.error.issues,
    });
  }

  const { userId } = parsedBody.data;

  const membership = await prisma.projectMembership.findUnique({
    where: {
      projectId_userId: { userId, projectId },
    },
    include: {
      organizationMembership: {
        select: { orgId: true },
      },
    },
  });

  if (!membership) {
    return res.status(404).json({ error: "Project membership not found" });
  }

  if (membership.organizationMembership.orgId !== orgId) {
    return res.status(403).json({
      error: "Project membership does not belong to this organization",
    });
  }

  await prisma.projectMembership.delete({
    where: {
      projectId_userId: { userId, projectId },
    },
  });

  return res.status(200).json({
    message: "Project membership removed",
    userId,
  });
}
