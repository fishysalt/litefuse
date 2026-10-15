# 实现记录：audit-logs（批次 1，净室）

- 批次：1
- 目标文件（已原位替换）：
  - `web/src/features/audit-logs/AuditLogsTable.tsx`
  - `web/src/features/audit-logs/AuditLogsSettingsPage.tsx`
  - `web/src/features/audit-logs/OrgAuditLogsSettingsPage.tsx`
- 实现日期：2026-10-15
- 规格：`./spec.md`（本目录）
- 验收测试：三个同名 `*.clienttest.tsx`（18 条断言）

## 1. 实现者与可见输入

| 项 | 内容 |
| --- | --- |
| 实现者 | **独立执行上下文**（与规格作者不同的会话；主控会话未参与实现） |
| 规格允许的输入 | ① `spec.md`；② 三个验收测试；③ 规格中列出的项目模块接口（`utils/api`、`table/data-table`、`data-table-toolbar`、`data-table-row-height-switch`、`table/types`、`layouts/settings-table-card`、`layouts/header`、`BatchExportTableButton`、`ui/IOTableCell`、`ui/avatar`、`ui/alert`、`utils/tailwind`、`utils/map-utils`、`entitlements/hooks`、`rbac/utils/checkProjectAccess`、`rbac/utils/checkOrganizationAccess`，以及 `@langfuse/shared` / `react-i18next` / `use-query-params` / `i18next` 类型） |
| 实现者额外打开的（非禁止）文件 | `web/src/server/api/routers/auditLogs.ts`（actor/输出形状）、Prisma `AuditLog` 模型、`en.json` / `zh-CN.json`、i18next / jest / prettier 配置、`tableNames.ts`，以及其他功能表格（`BatchActionsTable`、eval-log、`BatchExportsSettingsPage`、`CodeJsonViewer`）用于对齐仓库惯例 |
| **禁止输入** | 三个目标文件的**原实现**及其 git 历史/diff；对包含目标文件的目录做全仓 grep |

**实现者声明（原文）**：
> I did not read AuditLogsTable.tsx, AuditLogsSettingsPage.tsx, OrgAuditLogsSettingsPage.tsx or any git history containing them.

## 2. 披露的意外暴露与评估

| # | 情形 | 评估 |
| --- | --- | --- |
| a | `find` / `git ls-files` / `git status` **列出了三个目标文件的文件名**（无内容） | **不实质**。文件名不构成受保护的表达；且文件名本就在规格中写明 |
| b | 若干次递归 grep 的**搜索集合包含** audit-logs 目录，但输出**显式过滤掉了该目录**（据实现者称未显示任何内容） | **采纳其披露**。主控会话无法独立复核其命令历史（本轮未要求留存命令）；旁证：产出与三个原实现存在**独立结构差异**（自拟文案、正向分支优先 vs `restricted ?? table`、不同的变量命名与组件拆分），且相似度报告中**无任何 ≥2 行的连续共享块**（见 `similarity.md`）。**流程改进**：后续批次要求实现者交回**确切的检索命令**，使该主张可被复核 |
| c | 打开了规格允许清单之外的**非禁止**文件（见上表） | **允许**。这些是接口/惯例来源（路由输出类型、Prisma 模型、locale、配置、其他表格），**均非三个目标文件**。注意：`routers/auditLogs.ts` 是数据契约来源，属规格输入范畴 |

## 3. 产出与替换前实现的差异（表达层）

| 维度 | 替换前 | 净室实现 |
| --- | --- | --- |
| 受限分支组织方式 | 先算出 `restricted` 元素、再 `restricted ?? <Table/>` | **正向分支优先**：`!hasEntitlement ? … : hasAccess ? <Table/> : <Alert/>` |
| props 接收 | 解构签名（`{ projectId }`） | 以 `props` 整体接收 |
| 变量命名 | `auditLogsEntitled` / `canReadAuditLogs` | `hasEntitlement` / `hasAccess` |
| 用户可见文案 | 见 §4（旧文案） | **全部自拟**（9 条新 key，含中文译文） |
| 表格列构造 | 组件内联构造 | 以 `useMemo` 构造并接收 `rowHeight`/`t` 依赖 |
| 注释 | 有说明性注释 | 无注释 |
| 其他 | — | 导入分组、类名组合（如段间距 `mb-2` → `mb-4`）不同 |

## 4. 文案与 locale 变更（依产品决策：文案可改）

新增 9 条 key（`en.json` 英文即 key；`zh-CN.json` 附中文译文）：
`Project Audit Log` / `Organization Audit Log` / `Access restricted` / `Ask a project administrator to grant you access.` / `Ask an organization administrator to grant you access.` / 两条 "Audit logs are part of the Enterprise plan…" / 两条 "See who changed what, and when, across your …"。

**被替换掉的旧文案**（旧实现使用、换入后成为孤儿，已由 `i18next-cli extract` 删除）：
`Audit Logs`(标题) / `Organization Audit Logs` / `Access Denied`(此处用法) / `Contact your project administrator to request access.` / `Contact your organization administrator to request access.` / 旧的两条 Enterprise 提示 / 旧的两条简介。

> `Access Denied`、`Audit Logs` 等字符串仍被仓库其它功能使用，因此**未**从 locale 中删除（extractor 只删无人引用的 key）。

## 5. 结论

三个文件为**净室产出**，声明未被违反；披露的两次暴露（文件名列表、被过滤的 grep）经评估不实质，并已转为后续批次的流程要求。文本层面无实质残留（`similarity.md`：共享块 0、共享行 9 条全部为接口强制项）。
