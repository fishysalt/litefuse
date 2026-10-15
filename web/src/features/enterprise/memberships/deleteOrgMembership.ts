import { prisma } from "@langfuse/shared/src/db";
import { type NextApiRequest, type NextApiResponse } from "next";
import * as z from "zod/v4";

const DeleteOrgMembershipBody = z.object({
  userId: z.string(),
});

export async function deleteOrgMembership(
  req: NextApiRequest,
  res: NextApiResponse,
  orgId: string,
) {
  const parsedBody = DeleteOrgMembershipBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsedBody.error.issues,
    });
  }

  const { userId } = parsedBody.data;

  const membership = await prisma.organizationMembership.findUnique({
    where: {
      orgId_userId: { orgId, userId },
    },
  });

  if (membership?.role === "OWNER") {
    const owners = await prisma.organizationMembership.count({
      where: {
        orgId,
        role: "OWNER",
      },
    });

    if (owners === 1) {
      return res.status(403).json({
        error:
          "Cannot remove the last owner of an organization. Assign new owner or delete organization.",
      });
    }
  }

  await prisma.organizationMembership.deleteMany({
    where: { orgId, userId },
  });

  return res.status(200).json({
    message: "Organization membership removed",
    userId,
  });
}
