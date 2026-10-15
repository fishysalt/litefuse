import { prisma } from "@langfuse/shared/src/db";
import { Role } from "@langfuse/shared";
import { type NextApiRequest, type NextApiResponse } from "next";
import * as z from "zod/v4";

const UpsertProjectMembershipBody = z.object({
  userId: z.string(),
  role: z.enum(Role),
});

export async function upsertProjectMembership(
  req: NextApiRequest,
  res: NextApiResponse,
  projectId: string,
  orgId: string,
) {
  const parsedBody = UpsertProjectMembershipBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsedBody.error.issues,
    });
  }

  const { userId, role } = parsedBody.data;

  const organizationMembership = await prisma.organizationMembership.findUnique(
    {
      where: {
        orgId_userId: { orgId, userId },
      },
      include: {
        user: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    },
  );

  if (!organizationMembership) {
    return res
      .status(404)
      .json({ error: "User does not belong to this organization" });
  }

  const membership = await prisma.projectMembership.upsert({
    where: {
      projectId_userId: { projectId, userId },
    },
    update: { role },
    create: {
      userId,
      projectId,
      role,
      orgMembershipId: organizationMembership.id,
    },
  });

  return res.status(200).json({
    userId: membership.userId,
    role: membership.role,
    email: organizationMembership.user.email,
    name: organizationMembership.user.name,
  });
}
