import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { logger, redis } from "@langfuse/shared/src/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { cancelSubscriptionImmediatelyForOrganization } from "@/src/features/billing/server/billingService";

/**
 * Delete an organization (DELETE /api/admin/organizations/{id}, instance admin).
 * Mirrors the UI path (organizationRouter.delete): refuses while the
 * organization still has projects (live or pending deletion), cancels any
 * Stripe subscription first, then hard-deletes and drops cached org API keys.
 */
export async function deleteOrganization(
  req: NextApiRequest,
  res: NextApiResponse,
  organizationId: string,
) {
  const existing = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Organization not found" });
  }

  const countNonDeletedProjects = await prisma.project.count({
    where: { orgId: organizationId, deletedAt: null },
  });
  const countAllProjects = await prisma.project.count({
    where: { orgId: organizationId },
  });

  if (countNonDeletedProjects > 0) {
    return res.status(400).json({
      error: "Cannot delete organization with existing projects",
      message:
        "Please delete or transfer all projects before deleting the organization.",
    });
  }
  if (countAllProjects > 0) {
    return res.status(400).json({
      error: "Cannot delete organization with existing projects",
      message:
        "Deletion of your projects is still being processed, please try deleting the organization later",
    });
  }

  // Never delete the local organization while leaving a billable Stripe
  // subscription behind. A Stripe failure aborts the deletion.
  await cancelSubscriptionImmediatelyForOrganization(organizationId);

  const deleted = await prisma.organization.delete({
    where: { id: organizationId },
  });

  // Cached API keys carry their org; drop them so deleted-org keys stop working.
  await new ApiAuthService(prisma, redis).invalidateCachedOrgApiKeys(
    organizationId,
  );

  await auditLog({
    apiKeyId: "admin-api",
    orgId: organizationId,
    resourceType: "organization",
    resourceId: organizationId,
    action: "delete",
    before: deleted,
  });

  logger.info(`Deleted organization ${organizationId} via admin API`);

  return res.status(200).json({ success: true });
}
