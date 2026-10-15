import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";

export const SupportOrUpgradePage = () => {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t("Access Restricted")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t("This feature requires additional permissions")}</p>
            <p>
              {t(
                "Contact your system/project administrator for access. Need help? Reach out to support.",
              )}
            </p>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
};
