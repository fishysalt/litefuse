import Header from "@/src/components/layouts/header";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { useHasEntitlement } from "@/src/features/entitlements/hooks";
import { useHasOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import { AuditLogsTable } from "./AuditLogsTable";

import { useTranslation } from "react-i18next";
export function OrgAuditLogsSettingsPage(props: { orgId: string }) {
  const { t } = useTranslation();
  const hasEntitlement = useHasEntitlement("audit-logs");
  const hasAccess = useHasOrganizationAccess({
    organizationId: props.orgId,
    scope: "auditLogs:read",
  });

  return (
    <>
      <Header title={t("Organization Audit Log")} />
      <p className="mb-4 text-sm">
        {t(
          "See who changed what, and when, across your organization. Keep track of organization settings, project creation and deletion, and membership changes over time.",
        )}
      </p>
      {!hasEntitlement ? (
        <p className="text-muted-foreground text-sm">
          {t(
            "Audit logs are part of the Enterprise plan. Upgrade to keep a complete record of every change made in your organization.",
          )}
        </p>
      ) : hasAccess ? (
        <AuditLogsTable scope="organization" orgId={props.orgId} />
      ) : (
        <Alert>
          <AlertTitle>{t("Access restricted")}</AlertTitle>
          <AlertDescription>
            {t("Ask an organization administrator to grant you access.")}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
