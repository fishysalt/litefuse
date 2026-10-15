import { BatchExportTableName } from "@langfuse/shared";
import { useMemo } from "react";
import { NumberParam, useQueryParams, withDefault } from "use-query-params";
import { BatchExportTableButton } from "@/src/components/BatchExportTableButton";
import { SettingsTableCard } from "@/src/components/layouts/settings-table-card";
import { DataTable } from "@/src/components/table/data-table";
import { useRowHeightLocalStorage } from "@/src/components/table/data-table-row-height-switch";
import { DataTableToolbar } from "@/src/components/table/data-table-toolbar";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/src/components/ui/avatar";
import { IOTableCell } from "@/src/components/ui/IOTableCell";
import { type RouterOutputs, api } from "@/src/utils/api";
import { safeExtract } from "@/src/utils/map-utils";

import { useTranslation } from "react-i18next";
type AuditLogRow = RouterOutputs["auditLogs"]["all"]["data"][number];

type AuditLogsTableProps =
  | { scope: "project"; projectId: string }
  | { scope: "organization"; orgId: string };

export function AuditLogsTable(props: AuditLogsTableProps) {
  const { t } = useTranslation();
  const [paginationState, setPaginationState] = useQueryParams({
    pageIndex: withDefault(NumberParam, 0),
    pageSize: withDefault(NumberParam, 50),
  });

  const projectQuery = api.auditLogs.all.useQuery(
    {
      projectId: props.scope === "project" ? props.projectId : "",
      page: paginationState.pageIndex,
      limit: paginationState.pageSize,
    },
    { enabled: props.scope === "project" },
  );
  const organizationQuery = api.auditLogs.allByOrg.useQuery(
    {
      orgId: props.scope === "organization" ? props.orgId : "",
      page: paginationState.pageIndex,
      limit: paginationState.pageSize,
    },
    { enabled: props.scope === "organization" },
  );

  const activeQuery =
    props.scope === "project" ? projectQuery : organizationQuery;
  const tableName = props.scope === "project" ? "auditLogs" : "orgAuditLogs";
  const [rowHeight, setRowHeight] = useRowHeightLocalStorage(tableName, "s");

  const columns = useMemo<LangfuseColumnDef<AuditLogRow>[]>(
    () => [
      {
        accessorKey: "createdAt",
        id: "createdAt",
        header: t("Time"),
        size: 150,
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
      {
        accessorKey: "actor",
        id: "actor",
        header: t("Actor"),
        headerTooltip: {
          description: t("The actor within Litefuse who performed the action."),
        },
        size: 200,
        cell: ({ row }) => {
          const actor = row.original.actor;
          if (!actor) return null;

          if (actor.type === "USER") {
            const label =
              actor.body.name ?? actor.body.email ?? actor.body.id ?? "";
            return (
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage
                    src={actor.body.image ?? undefined}
                    alt={label}
                  />
                  <AvatarFallback>
                    {label.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span>{label}</span>
              </div>
            );
          }

          if (actor.type === "API_KEY") {
            return <span>{actor.body.publicKey ?? actor.body.id}</span>;
          }

          return null;
        },
      },
      {
        accessorKey: "resourceType",
        id: "resourceType",
        header: t("Resource Type"),
        size: 150,
        cell: ({ row }) => row.original.resourceType,
      },
      {
        accessorKey: "resourceId",
        id: "resourceId",
        header: t("Resource ID"),
        size: 200,
        cell: ({ row }) => row.original.resourceId,
      },
      {
        accessorKey: "action",
        id: "action",
        header: t("Action"),
        size: 150,
        cell: ({ row }) => row.original.action,
      },
      {
        accessorKey: "before",
        id: "before",
        header: t("Before"),
        size: 300,
        cell: ({ row }) => {
          const value = row.original.before;
          if (value === null || value === undefined) return null;
          return <IOTableCell data={value} singleLine={rowHeight === "s"} />;
        },
      },
      {
        accessorKey: "after",
        id: "after",
        header: t("After"),
        size: 300,
        cell: ({ row }) => {
          const value = row.original.after;
          if (value === null || value === undefined) return null;
          return <IOTableCell data={value} singleLine={rowHeight === "s"} />;
        },
      },
    ],
    [rowHeight, t],
  );

  const actionButtons =
    props.scope === "project"
      ? [
          <BatchExportTableButton
            key="audit-logs-export"
            projectId={props.projectId}
            tableName={BatchExportTableName.AuditLogs}
            orderByState={{ column: "createdAt", order: "DESC" }}
            filterState={[]}
          />,
        ]
      : [];

  return (
    <SettingsTableCard>
      <DataTableToolbar
        columns={columns}
        rowHeight={rowHeight}
        setRowHeight={setRowHeight}
        actionButtons={actionButtons}
        className="px-0"
      />
      <DataTable
        tableName={tableName}
        columns={columns}
        data={
          activeQuery.isPending
            ? { isLoading: true, isError: false }
            : activeQuery.isError
              ? {
                  isLoading: false,
                  isError: true,
                  error: activeQuery.error.message,
                }
              : {
                  isLoading: false,
                  isError: false,
                  data: safeExtract(activeQuery.data, "data", []),
                }
        }
        pagination={{
          totalCount: activeQuery.data?.totalCount ?? 0,
          onChange: setPaginationState,
          state: paginationState,
        }}
        rowHeight={rowHeight}
      />
    </SettingsTableCard>
  );
}
