# 行为规格：audit-logs（批次 1，三个文件）

- 状态：待实现
- 批次：1
- 目标文件：
  - `web/src/features/audit-logs/AuditLogsTable.tsx`
  - `web/src/features/audit-logs/AuditLogsSettingsPage.tsx`
  - `web/src/features/audit-logs/OrgAuditLogsSettingsPage.tsx`
- 规格作者：主控会话（可读原实现）
- 实现者：**只依据本规格**，不得接触上述三个文件的原实现及其 git 历史
- 验收测试（已存在，勿修改）：
  - `AuditLogsTable.clienttest.tsx`（8 条）
  - `AuditLogsSettingsPage.clienttest.tsx`（4 条）
  - `OrgAuditLogsSettingsPage.clienttest.tsx`（4 条）

---

## 0. 契约边界（产品决策 2026-10-15）

| 冻结（必须完全一致） | 自由（可自行拟定） |
| --- | --- |
| 功能行为：query 的启用规则与参数、状态映射、列集与顺序（`accessorKey`）、每 scope 的持久化表 id、导出动作的有无与绑定、权限/权益三态的分支结果、数据流与副作用 | 用户可见文案、标题措辞、布局与类名、组件结构、命名、注释、子组件拆分 |

**文案改写要求**：可以另拟措辞，但必须（a）保留原意，（b）保持"无权益 / 无权限"两种受限原因**可区分**，（c）全部经 `t(...)` 输出。
本仓库**英文文案即 i18n key**（`keySeparator: false`），因此：新引入的英文串必须同时加入
`web/src/features/i18n/locales/en.json` 与 `web/src/features/i18n/locales/zh-CN.json`（zh 需给出中文译文，且保持 100% 完整）；
复用已存在的 key（如 `Access Denied` 已被多处共用）则无需新增。验收命令：`pnpm run i18n:check`（与 CI 同款）必须通过。

---

## A. AuditLogsTable

### A.1 对外契约

- 模块：`web/src/features/audit-logs/AuditLogsTable.tsx`；具名导出 `AuditLogsTable`
- props 为**判别联合**，两种形态互斥：
  - `{ scope: "project"; projectId: string }`
  - `{ scope: "organization"; orgId: string }`

### A.2 数据获取契约

需要两个查询（项目维度、组织维度），**每次渲染都要调用两者**（不得条件式地跳过其中一个，以保证 hook 顺序稳定）；但同一时刻只有一个被启用：

| 情形 | 项目查询的参数与启用 | 组织查询的参数与启用 |
| --- | --- | --- |
| `scope === "project"` | `{ projectId: <真实 id>, page, limit }`，`enabled: true` | `{ orgId: "", page, limit }`，`enabled: false` |
| `scope === "organization"` | `{ projectId: "", page, limit }`，`enabled: false` | `{ orgId: <真实 id>, page, limit }`，`enabled: true` |

- `page` / `limit` 来自 URL 查询参数：`pageIndex` 默认 `0`，`pageSize` 默认 `50`。
- 两个查询的**结果形状相同**：`{ data: { data: Row[], totalCount: number }, isPending, isError, error }`。
- "当前查询结果" = 与 scope 对应的那一个；**所有下游状态都取它**（不得把未启用查询的结果混入）。

### A.3 状态映射（交给表格组件）

| 当前查询状态 | 传给表格的状态 |
| --- | --- |
| `isPending` | `{ isLoading: true, isError: false }` |
| `isError` | `{ isLoading: false, isError: true, error: <error.message> }` |
| 成功 | `{ isLoading: false, isError: false, data: <结果中的行数组，缺失时为空数组> }` |

- 分页信息：`totalCount` = 当前查询结果的 `totalCount`，缺失时 `0`；分页状态与变更回调均取自 URL 查询参数。

### A.4 列定义（顺序固定）

| # | 取值键 | 表头 | 单元格行为 |
| --- | --- | --- | --- |
| 1 | `createdAt` | 文案自拟 | 用本地化时间字符串展示 |
| 2 | `actor` | 文案自拟（带提示说明） | `type === "USER"` → 头像 + （姓名 ?? 邮箱 ?? id）；`type === "API_KEY"` → （公钥 ?? id）；其余 → 不渲染内容 |
| 3 | `resourceType` | 文案自拟 | 直接展示 |
| 4 | `resourceId` | 文案自拟 | 直接展示 |
| 5 | `action` | 文案自拟 | 直接展示 |
| 6 | `before` | 文案自拟 | 列宽 300；JSON 展示；**行高为小密度时单行显示**；值为空时不渲染内容 |
| 7 | `after` | 文案自拟 | 同 `before` |

> 判据是**列的集合与顺序**（`accessorKey` 序列）与每列的单元格行为；表头文字可自行拟定（见 §0）。

### A.5 表格标识（持久化用）

按 scope 使用**不同的表 id**，避免两种范围的列宽/行高互相污染：

- `scope === "project"` → `auditLogs`
- `scope === "organization"` → `orgAuditLogs`

行高使用本地持久化，默认小密度（`"s"`）。列定义由 `rowHeight` 参与构造（影响 JSON 单元格是否单行）。

### A.6 工具栏

- 接收：列定义、当前行高与其 setter；水平内边距为 0。
- `actionButtons`：
  - `scope === "project"` → **恰好一个**导出控件，绑定：当前 `projectId`、审计日志导出目标、空过滤条件、按 `createdAt` 降序。
  - `scope === "organization"` → **空数组**。

### A.7 结构

表格整体置于 settings 表格卡片容器内；除上述内容外不渲染其他东西、不产生其他副作用。

---

## B. AuditLogsSettingsPage（项目维度）

### B.1 对外契约

- 模块：`web/src/features/audit-logs/AuditLogsSettingsPage.tsx`；具名导出 `AuditLogsSettingsPage`；props `{ projectId: string }`

### B.2 输入

1. 该项目在 `auditLogs:read` scope 下的访问权限（布尔）
2. 实例是否具备 `audit-logs` 权益（布尔）

### B.3 三态（互斥，按此优先级）

| 条件 | 页面主体 |
| --- | --- |
| **无权益** | 一段说明文字，含义是"审计日志属于企业版功能，需要升级套餐"（**项目维度**表述）；**不渲染表格** |
| 有权益、**无访问权限** | 一个告警块，含义是"无权访问 + 请联系项目管理员申请"；**不渲染表格** |
| 有权益、有访问权限 | 渲染项目维度审计日志表格：`scope="project"`、`projectId` 透传 |

> 两种受限状态的文案必须**互不相同**（用户能分辨是"要升级"还是"要权限"），具体措辞自拟（见 §0）。

### B.4 恒定内容

- 页面标题（一条）与简介文字（一段），含义分别是"审计日志"与"追踪谁在何时改了什么，涵盖设置、配置与数据变更"，**项目维度**表述；措辞自拟。

### B.5 文案

以上所有可见文案必须经 `t(...)` 输出（可翻译 key），并按 §0 的 locale 要求同步。

---

## C. OrgAuditLogsSettingsPage（组织维度）

与 B 结构相同，差异仅在：

| 项 | 值 |
| --- | --- |
| props | `{ orgId: string }` |
| 权限输入 | 该组织在 `auditLogs:read` scope 下的访问权限 |
| 页面标题 | 含义为"组织审计日志"，**组织维度**表述；措辞自拟 |
| 简介文字 | 含义为"追踪谁在何时改了什么，涵盖组织设置、项目创建/删除与成员变更"，组织维度；措辞自拟 |
| 无权益文案 | 含义同 B.3，但用**组织维度**表述 |
| 无权限描述 | 含义为"请联系**组织**管理员申请访问" |
| 表格 | `scope="organization"`、`orgId` 透传 |

---

## D. 实现独立性纪律（净室）

- 本规格只约束**行为与对外契约**。组件结构、状态计算方式、条件渲染写法、类名组合、子组件拆分、命名、注释**由实现者自行决定**。
- **不得**打开、读取、diff 或 grep 上述三个目标文件的原实现，也不得查看包含它们的 git 历史/提交 diff。
- 不得对包含目标文件的目录做**全仓 grep**（上一批次曾因此意外看到原实现两行）；需要项目内约定时，直接打开规格中列出的具体路径。
- 实现产物写到**新的临时路径**（`*.impl.tsx`），由主控会话审查后再换入原位。
- 完成后由主控会话补 `record.md`（实现者、输入清单、声明、任何意外暴露）。
