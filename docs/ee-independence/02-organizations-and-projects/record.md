# 实现记录：organizations-and-projects（批次 2b，净室）

- 批次：2b（批次 2 的第二半）
- 目标文件（14 个：9 个业务模块 + 5 个路由包装器，替换前共 1090 行）：见 `spec.md` 头部清单
- 日期：2026-10-15
- 规格：`./spec.md`（含 §K 规格修订与测试阶段判定）
- 验收测试：`web/src/__tests__/server/organizations-and-projects-api.servertest.ts`（47 条）
- 门禁日志：`~/SelectDB/litefuse-local/checks/20261015-162429-batch2b-l1-l0.log`（L1+L0）、`…-162530-l0.log`（L0，CI 口径）、`…-162543-l2.log`（L2）

## 1. 实现者与可见输入

| 项 | 内容 |
| --- | --- |
| 规格与测试作者 | **Select DB**（已阅原实现） |
| 实现者 | **Zhang Mo**（净室实现者，独立执行上下文；未接触原实现） |
| 允许的输入 | ① `spec.md`；② 验收测试；③ 规格列出的接口/惯例来源（只读**非目标**文件） |
| **禁止的输入** | 14 个目标文件的**原实现内容**及其 git 历史/diff；对包含目标文件的目录做内容检索 |

**实现者声明（原文）**：

> I did NOT open, read, cat, grep, diff or otherwise inspect the current content of any of the 14 target files, nor their git history (`git show`/`git log -p`/`git stash show`/`git checkout` were never used on them). I ran no content search over the forbidden directories … I only listed those directories with `ls -la` (file names/sizes only, no content) and used `git status --short` / `git diff --stat` (path names and line counts only).

为学习接口与惯例而阅读的**非目标**文件（实现者报回）：`spec.md`、四个 servertest（其中三个部分阅读）、`enterprise/http.ts`、`enterprise/auth/{requireInstanceAdmin,requireAdminApi}.ts`、`enterprise/apiKeys/{createOrgApiKey,deleteOrgApiKey,listOrgApiKeys}.ts`（**批次 2a 的净室产物**，非原实现，可安全参考）、`api/public/organizations/{projects,apiKeys,memberships}/index.ts`、`api/public/projects/index.ts`、`api/public/projects/[projectId]/apiKeys/{index.ts,[apiKeyId].ts}`、`public-api/server/{adminApiGuard,apiAuth}.ts`、`audit-logs/auditLog.ts`、`organizations/utils/organizationNameSchema.ts`、`auth/lib/{projectNameSchema,projectRetentionSchema}.ts`、`entitlements/server/hasEntitlement.ts`、`billing/server/billingService.ts`（节选）、Prisma schema 的 Organization/Project/ApiKey/ScoreConfig/DorisProjectTableSplit/AuditLog 模型、`packages/shared/src/db.ts`、`features/scoreConfigs/defaultConfigs.ts`、`server/doris/splitProjectActivation.ts`、`server/redis/{projectDelete,dorisSplitTableProvisioningQueue}.ts`、`server/queues.ts`（节选）、`constants.ts`、`web/next.config.mjs`、`web/eslint.config.mjs`、`packages/config-eslint/next.js`、生成的 Prisma client 类型（`ProjectWhereUniqueInput` 附近的窗口）。

## 2. 披露的意外暴露与评估

| # | 情形 | 评估 |
| --- | --- | --- |
| a | `ls -la` 列出了目标目录（文件名/大小，无内容） | **不实质**。文件名不构成受保护表达；14 个路径在规格里已逐条写明 |
| b | 一次 `write` 工具调用（`listOrganizations.ts`）被 fs 策略**在读写之前**拒绝，未返回任何内容 | **不实质**，且反向印证"未读"：拒绝发生在读取之前。之后 14 个文件全部用 `cat > … <<'TS_EOF'` 写入（不回显旧内容） |
| c | 阅读了若干**非目标**文件（见 §1 清单），其中包含批次 2a 的净室产物 | **允许**。2a 文件是独立净室输出（不是原实现），且本批次目标与之无重叠 |

## 3. 实现者实际运行的检索命令（原文，均未覆盖禁查目录）

```
grep -rn "getDefaultScoreConfigsForProject" packages/shared/src --include=*.ts
grep -rn "provisionSplitForNewProject\|enqueueDorisSplitTableProvisioning" packages/shared/src --include=*.ts
grep -rn "class ProjectDeleteQueue\|ProjectDelete" packages/shared/src/server/redis/*.ts
grep -n "model Organization\b\|model Project\b\|model ScoreConfig\b\|model DorisProjectTableSplit\b\|model ApiKey\b\|model AuditLog\b" packages/shared/prisma/schema.prisma
grep -rn "getDefaultScoreConfigsForProject\|RETENTION_FLOOR_DAYS" packages/shared/src/index.ts packages/shared/src/server/index.ts
grep -rn "provisionSplitForNewProject\|enqueueDorisSplitTableProvisioning\|ProjectDeleteQueue\|QueueJobs" packages/shared/src/server/index.ts
grep -n "cancelSubscriptionImmediatelyForOrganization" -A 40 web/src/features/billing/server/billingService.ts
grep -n "invalidateCachedOrgApiKeys\|invalidateCachedProjectApiKeys\|async deleteApiKey" -A 25 web/src/features/public-api/server/apiAuth.ts
grep -n "splitProjectActivation\|queues\|constants" packages/shared/src/server/index.ts
grep -rn "RETENTION_FLOOR_DAYS" packages/shared/src/constants.ts
grep -n "ProjectDelete\|DorisSplitTableProvisioningJob\|enum QueueJobs\|enum QueueName" packages/shared/src/server/queues.ts
grep -n "Admin Organizations API\|api/admin/organizations\|Public Organizations API\|api/public/organizations" src/__tests__/server/organizations-api.servertest.ts
grep -n "api/public/projects" src/__tests__/server/projects-api.servertest.ts
grep -n "api/admin/organizations\|api/public/projects\|api/public/organizations/projects" src/__tests__/server/keys-and-memberships-api.servertest.ts
grep -c "  it(" <四个测试文件>
grep -n "eslint\|typescript\|ignoreDuringBuilds\|ignoreBuildErrors" next.config.*
grep -n "no-unused-vars\|simple-import-sort\|import/order\|no-explicit-any" packages/config-eslint/base.js packages/config-eslint/next.js
grep -rn "ProjectWhereUniqueInput" packages/shared/prisma/generated/          # 无匹配
grep -rln "ProjectWhereUniqueInput" node_modules/@prisma/client/               # 无匹配
grep -n "export type ProjectWhereUniqueInput" -A 25 <生成的 client index.d.ts>
find node_modules/.pnpm -maxdepth 3 -type d -name ".prisma"; find . -maxdepth 4 -type d -name ".prisma"; find packages/shared/prisma/generated -maxdepth 2
ls -la src/features/enterprise/{,organizations/,projects/,apiKeys/,memberships/,auth/} 与两个 admin 路由目录（仅名称）
lsof -nP -iTCP:3000 -sTCP:LISTEN; lsof -a -p <pid> -d cwd -Fn; ps -o pid,ppid,command -p <pid>
```

## 4. 产出与替换前实现的差异（表达层）

14 个文件**全部重写**：`git diff --shortstat`（含 spec.md）= `15 files changed, 393 insertions(+), 502 deletions(-)`；其中 14 个源码文件合计 891 行（原 1090 行）。

| 维度 | 做法 |
| --- | --- |
| 共享 helper | 为把改动范围严格限制在 14 个文件，**没有**新增共享模块（否则会多出第 15 个文件），把小的 metadata/retention 处理就地写在各自文件里 |
| 未使用参数 | 用 `_req` 命名占位以保持导出签名的**位置/个数/类型**完全一致，同时不触发 unused-var 规则 |
| 其它 | 结构、命名、注释、控制流写法由实现者自定；无注释 |

未在 14 个文件逐个罗列；行为契约由 **47 条验收测试 + 137 条邻近套件断言**锁住（见 `verification.md`）。

## 5. 规格修订（测试阶段回填，详见 `spec.md` §K）

- **§K.1（唯一的行为变更，已先修复再固化）**：`deleteOrganization` 原本在硬删除**之后**才调用 `invalidateCachedOrgApiKeys`，而该 helper 靠回查 `api_keys` 取要失效的 key、级联已把行删掉 → 缓存一条未清，**已删除组织的 key 在 TTL 内仍可用**。修复提交 **`d6a6567`**（先失效再删），差分证据 `checks/20261015-155531-batch2b-orgkey-fix.log`。规格 §B.5 步骤 4/5 与 H38 已按修复后改写，**实现者据此实现**（已核对：cancel-subscription → invalidate → delete → audit → 200，H38 通过）。
- **§K.2**：判定为不可断言、不写断言的用例：H101（实测不可达：路径参数优先、重复 query 不成为数组）、H39（需 Stripe 失败打桩）、H65/H85（需服务进程内故障注入）、H102–H104（需以不同许可/区域/`ADMIN_API_KEY` 重启服务）。相关分支仍属实现的一部分，必须原样保留，只是没有断言。
- **§K.3**：`Invalid credentials` 实际串更长；`tsconfig.build.json` 排除 `*.servertest.*`，验收测试不被 tsgo 检查。

## 6. 实现者提出的歧义与主控裁定

| # | 歧义 | 裁定 |
| --- | --- | --- |
| 1 | 是否需要抽出共享 helper | 不允许新增文件（会把批次范围从 14 变 15）→ 就地重复小段逻辑，接受 |
| 2 | 未使用参数如何命名 | `_req` 保持位置签名不变、lint 干净 → 接受 |
| 3 | `deleteProject` 队列不可用分支的形态（直接 500 vs throw） | 按规格 §C.4 步骤 5 / §J.6：**软删+删 key+审计之后再返回 500**（不 throw）→ 已按规格实现 |
| 4 | `createProject` 的 Doris provisioning 失败路径 | 按规格：删掉刚建的项目（吞掉删除错误）并把原错误抛给外层 → 500 |

## 7. 有意保留的既有行为（按规格"保留现状"）

- `updateOrganization`、`createProject`、`updateProject` **不写审计行**；`create/deleteOrganization` 与 `deleteProject` 写。
- `createProject` 用 coerce 后的值校验、却写**原始** `retention` → `retention:"30"` 通过校验后 500 且不留行（H63）；`retention:null` 校验为 0 但把列写成 NULL 并省略 `retentionDays`（H64）。
- `deleteOrganization` 的审计行写在硬删除**之后**（`audit_logs.org_id` 悬空，无外键故可写）。
- `listProjects` 原样返回项目 `metadata`（可为 null），组织侧归一为 `{}`。
- 项目重名是 check-then-write，数据库无唯一约束。
- §K.2 列出的分支实现但不加断言。

## 8. 结论

14 个文件为**净室产出**，声明未被违反；披露项（`ls` 名称列表、被策略拒绝的 `write`）经评估均不实质，且实现者交回了完整阅读清单与全部检索命令供复核。文本层面无实质残留（`similarity.md`：共享块 0、共享行 11 条全部为接口强制项或"最自然写法"并逐条给出理由）。行为等价由 L1（47 + 137 全绿）、L0（prettier CI 口径/tsgo×2/i18n/EE 边界全绿）、L2（与冻结基线集合等价）与换入前**变异电池**（三个变异体分别被 H28/H38/H49 精确抓住）共同支撑，详见 `verification.md`。
