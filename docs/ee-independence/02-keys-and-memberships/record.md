# 实现记录：keys-and-memberships（批次 2a，净室）

- 批次：2a（批次 2 的第一半）
- 目标文件（19 个：13 个业务模块 + 6 个路由包装器，替换前共 915 行）：
  - `web/src/features/enterprise/http.ts`
  - `web/src/features/enterprise/apiKeys/{createOrgApiKey,deleteOrgApiKey,listOrgApiKeys,createProjectApiKey,deleteProjectApiKey,listProjectApiKeys}.ts`
  - `web/src/features/enterprise/memberships/{listOrgMemberships,deleteOrgMembership,listProjectMemberships,deleteProjectMembership,upsertOrgMembership,upsertProjectMembership}.ts`
  - `web/src/pages/api/public/organizations/{apiKeys,memberships,projects}/index.ts`
  - `web/src/pages/api/public/projects/[projectId]/apiKeys/{index.ts,[apiKeyId].ts}`
  - `web/src/pages/api/public/projects/[projectId]/memberships/index.ts`
- 日期：2026-10-15
- 规格：`./spec.md`（含 §7.12 规格修订）
- 验收测试：`web/src/__tests__/server/keys-and-memberships-api.servertest.ts`（44 条）
- 门禁日志：`~/SelectDB/litefuse-local/checks/20261015-152512-batch2a-l1.log`（L1）、`…-153001-l0.log`（L0）、L2 见 `verification.md`

## 1. 实现者与可见输入

| 项 | 内容 |
| --- | --- |
| 规格与测试作者 | **Select DB**（已阅原实现） |
| 实现者 | **Zhang Mo**（净室实现者，独立执行上下文；未接触原实现） |
| 允许的输入 | ① `spec.md`；② 验收测试 `keys-and-memberships-api.servertest.ts`；③ 规格列出的接口/惯例来源（只读**非目标**文件） |
| **禁止的输入** | 19 个目标文件的**原实现内容**及其 git 历史/diff；对包含目标文件的目录做内容检索 |

**实现者声明（原文）**：

> I read the spec `docs/ee-independence/02-keys-and-memberships/spec.md` in full and the acceptance test `web/src/__tests__/server/keys-and-memberships-api.servertest.ts` in full. I did **not** open, cat, read, grep, diff, `git show`/`git log -p`/`git stash show` any of the 19 target files, and I never ran a repo-wide or directory-wide content search whose output would include them.

为学习接口与惯例而阅读的**非目标**文件（实现者报回的完整清单）：`public-api/server/adminApiGuard.ts`、`enterprise/auth/requireAdminApi.ts`、`enterprise/auth/requireInstanceAdmin.ts`、`entitlements/server/hasEntitlement.ts`、`audit-logs/auditLog.ts`、`public-api/server/cors.ts`、`enterprise/projects/listProjects.ts`（下一批次文件，仅读接口）、`public-api/server/apiAuth.ts`、`public-api/server/organizationApiKeyRouter.ts`、`rbac/server/membersRouter.ts`（节选）、`pages/api/public/projects/index.ts`、`pages/api/admin/organizations/[organizationId]/apiKeys/{index.ts,[apiKeyId].ts}`、`packages/shared/src/server/auth/{apiKeys,types}.ts`、`packages/shared/src/{db,index}.ts`、Prisma 的 `ApiKey`/`OrganizationMembership`/`ProjectMembership`/`User` 模型、`web/src/__tests__/test-utils.ts`、以及邻近套件 `memberships-api` / `organizations-api` / `projects-api`。

## 2. 披露的意外暴露与评估

| # | 情形 | 评估 |
| --- | --- | --- |
| a | `ls -1 web/src/features/enterprise/` **打印了目标文件名 `http.ts`**（以及子目录名），未读任何内容 | **不实质**。文件名不构成受保护的表达；且 19 个路径在规格里已逐条写明。实现者主动披露，属诚实留痕 |
| b | 首次尝试用 `write` 工具写 `http.ts` 时被拒绝（"file has not been read — read the file, then retry"），工具**未返回任何内容** | **不实质**，且反向印证"未读"：该拒绝恰好说明没有读取发生。之后 19 个文件全部用 `cat > … <<'EOF'` 写入（不回显旧内容） |
| c | 阅读了若干**非目标**文件（见 §1 清单）以获取接口与仓库惯例 | **允许**。这些是接口/惯例来源（MIT 守卫、共享 `ApiAuthService`、Prisma 模型、测试工具、邻近套件），**均非 19 个目标文件** |

**流程改进（沿用批次 1 的结论并已生效）**：实现者交回**确切检索命令**，使"未检索目标内容"这一主张可被复核（见 §3）。

## 3. 实现者实际运行的检索命令（原文）

```
ls -1 web/src/pages/api/admin/organizations/ 2>/dev/null; echo "---"; ls -1 web/src/pages/api/admin/organizations/*/ 2>/dev/null; echo "--- enterprise feature dirs ---"; ls -1 web/src/features/enterprise/      # 唯一输出触及目标路径（仅文件名 http.ts）
ls -1 web/src/pages/api/public/organizations/ 2>/dev/null; echo "=== projects dir ==="; ls -1 web/src/pages/api/public/projects/ 2>/dev/null
grep -n "export const makeAPICall\|export const makeZodVerifiedAPICall\|export async function makeAPICall\|export async function makeZodVerifiedAPICall" web/src/__tests__/test-utils.ts
grep -n "model ProjectMembership\|model OrganizationMembership\|model ApiKey\|model User " packages/shared/prisma/schema.prisma
grep -rn "Invalid request body" web/src/features/public-api web/src/pages/api/admin 2>/dev/null | head -20; echo "=== details patterns ==="; grep -rn "details:" web/src/features/public-api web/src/pages/api/admin 2>/dev/null | head -20
grep -n '"zod"' web/package.json packages/shared/package.json 2>/dev/null; ls -d web/node_modules/zod; ls -1 web/node_modules/zod/v4/
grep -rn "export enum Role\|export const Role\|Role," packages/shared/src/db.ts 2>/dev/null | head; grep -rn "Role" packages/shared/src/index.ts 2>/dev/null | head
grep -rn "enum Role\|Role =" packages/shared/src/ | head -20
grep -rn "format" web/node_modules/zod/v4/core/errors.d.ts; ls -1 web/node_modules/zod/v4/; grep -n "v4" web/node_modules/zod/package.json | head
grep -rn "z.enum(Role)\|nativeEnum(Role)\|z.nativeEnum" web/src/features/rbac web/src/server web/src/features/organizations 2>/dev/null | head -20
grep -rn "format()" web/node_modules/zod/dist/types/v4/classic/errors.d.ts web/node_modules/zod/dist/types/v4/core/errors.d.ts
sed -n '100,140p;500,640p' web/src/features/rbac/server/membersRouter.ts
grep -n "apiKeys\|describe\|it(" web/src/__tests__/server/projects-api.servertest.ts | sed -n '1,140p'
grep -m1 '"prisma"\|"@prisma/client"' web/package.json
ls -1 web/src/__tests__/server/ | grep -E "memberships-api|organizations-api|projects-api"
```

## 4. 产出与替换前实现的差异（表达层）

19 个文件**全部重写**：`git diff --stat` = `19 files changed, 331 insertions(+), 335 deletions(-)`；新实现合计 911 行（原 915 行）。表达层差异（以 `deleteOrgApiKey.ts` 为例，主控可对照两侧）：

| 维度 | 替换前 | 净室实现 |
| --- | --- | --- |
| 导入分组与顺序 | `next` → `prisma` → `shared/server` → 本仓库 | 本仓库（`auditLog`/`ApiAuthService`）→ `prisma` → `shared/server` → `next` |
| 错误串与响应体 | 抽成具名常量（`API_KEY_NOT_FOUND_ERROR`、`DELETE_SUCCEEDED_BODY`） | **内联**字面量（最短写法） |
| 注释 | 有 JSDoc 与说明性注释 | 无注释 |
| 查询对象写法 | `where: { id, orgId, scope }` 单行 | 展开为多行 |
| 服务实例 | `const apiAuth = new ApiAuthService(...)` 后再调用 | 直接链式 `await new ApiAuthService(...).deleteApiKey(...)` |
| 变量命名 | `removed` | `deleted` |

未在其它 18 个文件逐个罗列；主控已核对**行为契约由 44 条验收测试 + 111 条邻近套件断言锁住**，表达层差异不影响行为。

## 5. 规格修订（由特征测试阶段回填，详见 `spec.md` §7.12）

写测试时以原实现实测行为为准，发现规格 4 处与事实不符，已改正并明确"以实现的行为为准"：① C39 空 body POST 实为 201 建键（原文 400）；② C38 `details` 是 `error.format()` 对象而非 `issues` 数组；③ C80 的 `rbac-project-roles` 门控**不可达**（死代码，该变异无法被检测，实现仍保留门控但不写断言）；④ C93 缺 `projectId` 在 HTTP 层不可达（空动态段被 308 重定向）。另修正 `new` 计数 46 → 45。

## 6. 实现者提出的歧义与主控裁定

| # | 歧义 | 裁定 |
| --- | --- | --- |
| 1 | 四个 membership 的 400 分支 `details` 形状：规格 §C.2/C.3/D.2/D.3 说 `issues` 数组，而 §7.12 只把 B.1 改成 `format()` 对象（无测试锁定 membership 那一侧） | 实现者按规格字面用了 `.issues`。**主控已核对原实现：四个文件都确实是 `details: parsed.error.issues`（数组）** → 实现正确，规格 §C.2/C.3/D.2/D.3 无需修订 |
| 2 | E.4–E.6 外层 `try/catch` 的包裹范围规格未明示 | 不可观察（`routeByMethod` 返回的 promise 未被 await，§9.1 已记录该既有行为）→ 接受 |
| 3 | E.6 的 `!projectId \|\| typeof projectId !== "string"` 分支在 HTTP 层不可达（C93） | 保留原样（保留现状是本批次契约） |

## 7. 结论

19 个文件为**净室产出**，声明未被违反；披露的唯一检索暴露（`ls` 打印文件名）经评估不实质，且实现者自行交回了全部检索命令与阅读清单供复核。文本层面无实质残留（`similarity.md`：共享块 0、共享行 9 条全部为接口强制项并逐条给出理由）。行为等价由 L1（44 + 111 全绿）、L0（prettier/tsgo×2/i18n/EE 边界全绿）、L2（与冻结基线集合等价）与**换入前的变异测试**（两个变异体各自精确命中预期断言）共同支撑，详见 `verification.md`。
