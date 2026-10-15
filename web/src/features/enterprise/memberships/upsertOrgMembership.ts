import { prisma } from "@langfuse/shared/src/db";
import { Role } from "@langfuse/shared";
import { type NextApiRequest, type NextApiResponse } from "next";
import * as z from "zod/v4";

const UpsertOrgMembershipBody = z.object({
  userId: z.string(),
  role: z.enum(Role),
});

export async function upsertOrgMembership(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
) {
  const parsedBody = UpsertOrgMembershipBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsedBody.error.issues,
    });
  }

  const { userId, role } = parsedBody.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const existingMembership = await prisma.organizationMembership.findUnique({
    where: {
      orgId_userId: { orgId, userId },
    },
  });

  if (existingMembership?.role === "OWNER" && role !== "OWNER") {
    const otherOwners = await prisma.organizationMembership.count({
      where: {
        orgId,
        role: "OWNER",
        id: {
          not: existingMembership.id,
        },
      },
    });

    if (otherOwners === 0) {
      return res.status(403).json({
        error:
          "Cannot remove the last owner of an organization. Assign new owner or delete organization.",
      });
    }
  }

  const membership = await prisma.organizationMembership.upsert({
    where: {
      orgId_userId: { orgId, userId },
    },
    update: { role },
    create: { orgId, userId, role },
  });

  return res.status(200).json({
    userId: membership.userId,
    role: membership.role,
    email: user.email,
    name: user.name,
  });
}
