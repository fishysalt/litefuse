import Header from "@/src/components/layouts/header";
import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { useHasEntitlement } from "@/src/features/entitlements/hooks";
import { useHasProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { AuditLogsTable } from "./AuditLogsTable";

import { useTranslation } from "react-i18next";
export function AuditLogsSettingsPage(props: { projectId: string }) {
  const { t } = useTranslation();
  const hasEntitlement = useHasEntitlement("audit-logs");
  const hasAccess = useHasProjectAccess({
    projectId: props.projectId,
    scope: "auditLogs:read",
  });

  return (
    <>
      <Header title={t("Project Audit Log")} />
      <p className="mb-4 text-sm">
        {t(
          "See who changed what, and when, across your project. Keep track of settings, configuration, and data changes over time.",
        )}
      </p>
      {!hasEntitlement ? (
        <p className="text-muted-foreground text-sm">
          {t(
            "Audit logs are part of the Enterprise plan. Upgrade to keep a complete record of every change made in your project.",
          )}
        </p>
      ) : hasAccess ? (
        <AuditLogsTable scope="project" projectId={props.projectId} />
      ) : (
        <Alert>
          <AlertTitle>{t("Access restricted")}</AlertTitle>
          <AlertDescription>
            {t("Ask a project administrator to grant you access.")}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
