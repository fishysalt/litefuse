import { auditLog } from "@/src/features/audit-logs/auditLog";
import { cancelSubscriptionImmediatelyForOrganization } from "@/src/features/billing/server/billingService";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { prisma } from "@langfuse/shared/src/db";
import { logger, redis } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

export async function deleteOrganization(
  _req: NextApiRequest,
  res: NextApiResponse,
  organizationId: string,
) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!organization) {
    return res.status(404).json({ error: "Organization not found" });
  }

  const [liveProjectCount, projectCount] = await Promise.all([
    prisma.project.count({
      where: { orgId: organizationId, deletedAt: null },
    }),
    prisma.project.count({ where: { orgId: organizationId } }),
  ]);

  if (liveProjectCount > 0) {
    return res.status(400).json({
      error: "Organization cannot be deleted while it still has projects",
      message:
        "Please delete or transfer all projects before deleting the organization.",
    });
  }

  if (projectCount > 0) {
    return res.status(400).json({
      error: "Organization cannot be deleted while it still has projects",
      message:
        "Deletion of your projects is still being processed, please try deleting the organization later",
    });
  }

  await cancelSubscriptionImmediatelyForOrganization(organizationId);

  await new ApiAuthService(prisma, redis).invalidateCachedOrgApiKeys(
    organizationId,
  );

  const deletedOrganization = await prisma.organization.delete({
    where: { id: organizationId },
  });

  await auditLog({
    apiKeyId: "admin-api",
    orgId: organizationId,
    resourceType: "organization",
    resourceId: organizationId,
    action: "delete",
    before: deletedOrganization,
  });

  logger.info(`Deleted organization ${organizationId}`);

  return res.status(200).json({ success: true });
}
