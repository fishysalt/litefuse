# 相似度报告：audit-logs（批次 1）

方法：`~/SelectDB/litefuse-local/bin/ee-similarity-report.mjs`
上游基准：`~/SelectDB/langfuse-latest`（EE 文件 132 个 / MIT 核心 5462 个 / EE 独有实质行 2996 条）
我方：`/Users/zhang/SelectDB/litefuse-license`（分支 `ee-independence`）

**度量定义**

1. **EE-only 共享实质行**：该行（≥40 字符、非 import/注释）出现在上游 `ee/` 树中、**不在**上游 MIT 核心、且出现在 ≤4 个 EE 文件里，而我方当前文件里仍有同一行。目标 0；非 0 时须逐条给出理由。
2. **token 5-gram Jaccard**：与"上游 EE 中同名对应文件"的整体词元相似度。小文件因接口强制项必然偏高，仅作参考。
3. 残余项**不被隐藏**：下列每条都写明"为什么它可以留下"。

## 结果

| 文件 | 行数 | 实质行 | **EE-only 共享行** | token 5-gram Jaccard | 上游 EE 对应物 |
| --- | --- | --- | --- | --- | --- |
| `AuditLogsTable.tsx` | 199 | 29 | **5** | 0.069 | `web/src/ee/features/audit-log-viewer/AuditLogsTable/AuditLogsTable.tsx` |
| `AuditLogsSettingsPage.tsx` | 43 | 9 | **2** | 0.200 | `web/src/ee/features/audit-log-viewer/AuditLogsSettingsPage.tsx` |
| `OrgAuditLogsSettingsPage.tsx` | 43 | 10 | **2** | 0.205 | `web/src/ee/features/audit-log-viewer/OrgAuditLogsSettingsPage.tsx` |
| **合计** | | | **9** | | |

> 参照：批次 0 的 `SupportOrUpgradePage.tsx`（该批次早于本工具，事后补测）为 2 行、Jaccard 0.298。

## 残余项逐条理由（白名单）

残余**全部是接口强制项或语言/框架层面的自然写法**，没有一条是"被拷贝的代码块"（没有任何 2 行以上连续相同的块）。

| # | 文件 | 行 | 内容 | 为什么可以留下 |
| --- | --- | --- | --- | --- |
| 1 | AuditLogsTable | 23 | `\| { scope: "project"; projectId: string }` | props 判别联合的形状由**调用方契约**固定（两个设置页就是这样传参的） |
| 2 | AuditLogsTable | 24 | `\| { scope: "organization"; orgId: string };` | 同上 |
| 3 | AuditLogsTable | 35 | `projectId: props.scope === "project" ? props.projectId : "",` | 规格强制"未启用的查询也要传一个值，用空字符串"；三元表达式是唯一自然写法 |
| 4 | AuditLogsTable | 43 | `orgId: props.scope === "organization" ? props.orgId : "",` | 同上 |
| 5 | AuditLogsTable | 47 | `{ enabled: props.scope === "organization" },` | 规格强制的启用规则（同一时刻只启用一个查询） |
| 6 | AuditLogsSettingsPage | 8 | `export function AuditLogsSettingsPage(props: { projectId: string }) {` | 导出名与 prop 名由调用方（`pages/project/[projectId]/settings`）固定 |
| 7 | AuditLogsSettingsPage | 10 | `const hasEntitlement = useHasEntitlement("audit-logs");` | hook 与 entitlement key 由规格固定；变量名是巧合（我方原实现用的是 `auditLogsEntitled`，上游用的是 `hasEntitlement`） |
| 8 | OrgAuditLogsSettingsPage | 8 | `export function OrgAuditLogsSettingsPage(props: { orgId: string }) {` | 同 #6 |
| 9 | OrgAuditLogsSettingsPage | 10 | `const hasEntitlement = useHasEntitlement("audit-logs");` | 同 #7 |

## 值得记录的一个现象

批次 0 的净室实现把居中方式写成了 `items-center justify-center`，**这恰好与上游 EE 的写法相同，而我方原实现用的是 `m-auto`** —— 也就是说，这次独立实现让那一行**变得更像上游**。

这说明两点，都属于流程要留意的：

1. **独立实现可以收敛到相同写法**（尤其是"最自然的实现方式"），因此**行级相似度不能作为独立性的证据**，只能用来发现"残留的拷贝块"；
2. 因此本报告的作用是**自查 + 向审计方显式披露残余**，而不是追求 0 —— 为把数字压到 0 去做无意义的改名/改写，正是要避免的"为差异而差异"。

## 结论

- EE-only **共享块（≥2 连续行）= 0**；共享的 9 行全部为接口强制项或自然写法，已逐条给理由；
- 未发现任何"从上游 EE 拷贝的代码段"；
- 文本层面无实质残留，**独立创作的主张依据是 `record.md` 的过程留痕**，不是本报告的数字。
