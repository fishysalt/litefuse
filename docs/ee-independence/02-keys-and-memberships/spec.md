# 行为规格：keys-and-memberships（批次 2，19 个文件）

- 状态：待实现
- 批次：2
- **角色（净室命名约定见 `../README.md`）**：本规格由 **Select DB** 撰写（该方已阅原实现，负责规格、测试与门禁）；实现方为 **Zhang Mo**（未接触原实现，仅依据本规格与验收测试编码）
- 目标文件（13 个业务模块 + 6 个路由包装器）：
  - `web/src/features/enterprise/http.ts`
  - `web/src/features/enterprise/apiKeys/createOrgApiKey.ts`
  - `web/src/features/enterprise/apiKeys/deleteOrgApiKey.ts`
  - `web/src/features/enterprise/apiKeys/listOrgApiKeys.ts`
  - `web/src/features/enterprise/apiKeys/createProjectApiKey.ts`
  - `web/src/features/enterprise/apiKeys/deleteProjectApiKey.ts`
  - `web/src/features/enterprise/apiKeys/listProjectApiKeys.ts`
  - `web/src/features/enterprise/memberships/listOrgMemberships.ts`
  - `web/src/features/enterprise/memberships/deleteOrgMembership.ts`
  - `web/src/features/enterprise/memberships/listProjectMemberships.ts`
  - `web/src/features/enterprise/memberships/deleteProjectMembership.ts`
  - `web/src/features/enterprise/memberships/upsertOrgMembership.ts`
  - `web/src/features/enterprise/memberships/upsertProjectMembership.ts`
  - `web/src/pages/api/public/organizations/apiKeys/index.ts`
  - `web/src/pages/api/public/organizations/memberships/index.ts`
  - `web/src/pages/api/public/organizations/projects/index.ts`
  - `web/src/pages/api/public/projects/[projectId]/apiKeys/index.ts`
  - `web/src/pages/api/public/projects/[projectId]/apiKeys/[apiKeyId].ts`
  - `web/src/pages/api/public/projects/[projectId]/memberships/index.ts`
- 规格作者：主控会话（可读原实现）
- 实现者：**只依据本规格**，不得接触上述 19 个文件的原实现及其 git 历史
- 相关既有测试（已存在，本轮**不得修改**；作为 L1 特征测试的既有部分）：
  - `web/src/__tests__/server/memberships-api.servertest.ts`（18 条）
  - `web/src/__tests__/server/projects-api.servertest.ts`（与本批次相关 19 条）
  - `web/src/__tests__/server/organizations-api.servertest.ts`（与本批次相关 18 条）
  - `web/src/__tests__/server/admin-api-key-auth.servertest.ts`（**与本批次无关**，见 §9）
  - `web/src/__tests__/server/organizations-api-key-trpc.servertest.ts`（**与本批次无关**，见 §9）

---

## 0. 契约边界

本批次全部是**服务端**代码（Next.js API handler 与 Prisma 访问层），没有 React 组件。

| 冻结（必须完全一致） | 自由（可自行拟定） |
| --- | --- |
| 导出符号名与函数签名；HTTP 方法、状态码、响应 JSON 的字段名与字段集；**错误文本**（测试按子串断言）；校验顺序（认证 → 权益 → 方法 → 资源归属 → 请求体）；数据库表/列、过滤条件、`select` 投影、`orderBy`、唯一约束引发的冲突行为；审计日志字段；密钥的散列/明文处理 | 内部函数命名、辅助函数拆分、注释、日志文案（`logger.*` 的字符串）、`import` 分组、错误对象的构造方式 |

### 0.1 文案与 i18n

本批次**没有任何用户可见 UI 文案**，全部字符串都是 HTTP 响应体中的错误/成功消息，由 API 消费方（SDK、脚本）读取，**不是 i18n key**：

- 这些文件不使用 `t(...)`；
- `web/src/features/i18n/locales/en.json` 与 `zh-CN.json` **无需任何改动**（已核对：这些错误串均不在 locale 中）；因此本批次验收**不涉及** `pnpm run i18n:check` 的 key 增删，只需保证既有 i18n 检查仍然通过；
- 错误文本允许被测试按 `toContain` 子串断言，**不得改写、不得翻译、不得加前缀后缀**。§7 中凡是写出的字符串都是必须逐字保留的。

### 0.2 净室纪律（与批次 1 相同）

- 不得打开、读取、diff、grep 上述 19 个目标文件的原实现，也不得查看包含它们的 git 历史/提交 diff。
- 不得对包含目标文件的目录做全仓 grep。
- 实现产物写到新的临时路径（`*.impl.ts`），由主控会话审查后换入原位。
- 完成后由主控会话补 `record.md`。

---

## 1. 公共基础设施

### 1.1 `http.ts`

模块：`web/src/features/enterprise/http.ts`。用途：方法白名单与按方法分发的两个小工具，被本批次全部路由包装器复用。

| 导出 | 签名 |
| --- | --- |
| `allowMethods` | `(req: NextApiRequest, res: NextApiResponse, allowed: readonly string[]) => boolean` |
| `routeByMethod` | `(req: NextApiRequest, res: NextApiResponse, handlers: Record<string, (req: NextApiRequest, res: NextApiResponse) => unknown>) => unknown` |

行为：

1. `allowMethods`：`req.method`（缺失时按空串处理）命中 `allowed` → 返回 `true`，**不写响应**。
2. `allowMethods`：未命中 → 写 `405`，响应体 `{ "error": "Method not allowed. Allowed methods: " + allowed.join(", ") }`（顺序即数组顺序），返回 `false`。调用方据此提前返回，**在认证与数据库访问之前**。
3. `routeByMethod`：`handlers[req.method ?? ""]` 存在 → 调用该 handler 并返回其返回值（不做 `await`，返回值原样透传）。
4. `routeByMethod`：不存在 → 写 `405`，响应体 `{ "error": "Method not allowed. Allowed methods: " + Object.keys(handlers).join(", ") }`（顺序即对象字面量的插入顺序），返回该 `res.status(...).json(...)` 的返回值。

两个函数都不抛异常、不读数据库、不做认证。

### 1.2 认证与权益（外部依赖，本批次不得修改，只按契约调用）

组织级 admin API 守卫：`web/src/features/public-api/server/adminApiGuard.ts`，经由企业侧入口 `web/src/features/enterprise/auth/requireAdminApi.ts` 暴露为
`requireAdminApi(req, res): Promise<ApiAccessScope | null>`（这一层只是转发，无自己的逻辑）。

三次检查，**严格按此顺序**，任一失败即写响应并返回 `null`（调用方 `if (!scope) return;`）：

| # | 检查 | 失败响应 |
| --- | --- | --- |
| 1 | `Basic` 头解析并校验 API key（`ApiAuthService.verifyAuthHeaderAndReturnScope`） | `401 { "error": <auth.error> }`，典型值 `"No authorization header"`、`"Invalid credentials"` |
| 2 | `auth.scope.accessLevel === "organization"` 且 `orgId` 非空 | `403 { "error": "Invalid API key. Organization-scoped API key required for this operation." }` |
| 3 | 该 key 所属组织解析出的 `plan` 含 `admin-api` 权益 | `403 { "error": "This feature is not available on your current plan." }` |

`ApiAccessScope`（来自 `@langfuse/shared/src/server`，`packages/shared/src/server/auth/types.ts`）字段：

```
{ projectId: string | null; accessLevel: "organization" | "project" | "scores";
  orgId: string; plan: Plan; rateLimitOverrides: ...;
  apiKeyId: string; publicKey: string; isIngestionSuspended: boolean | null | undefined }
```

组织级 key 的 `projectId` 为 `null`，`accessLevel` 为 `"organization"`。

权益判定：`hasEntitlementBasedOnPlan({ plan, entitlement })`（`web/src/features/entitlements/server/hasEntitlement.ts`），`plan` 为 `null` 时返回 `false`；相关权益取值：
`"admin-api"` 属于 `cloud:pro` 与 `self-hosted:enterprise`；`"rbac-project-roles"` 属于 `cloud:pro` 与 `self-hosted:enterprise`，**不属于** `oss` 与 `cloud:developer`。

### 1.3 依赖助手（外部依赖，本批次按契约调用）

**(a) `createAndAddApiKeysToDb`**（`@langfuse/shared/src/server/auth/apiKeys`）
入参 `{ prisma, entityId, scope: "PROJECT" | "ORGANIZATION", note?, predefinedKeys?: { publicKey, secretKey } }`。
返回 `{ id: string; createdAt: Date; note: string | null; publicKey: string; secretKey: string; displaySecretKey: string }`。

必须保持的密钥不变量（MIT 侧的鉴权代码依赖它们，实现者必须复现同一算法）：

| 列 | 内容 |
| --- | --- |
| `publicKey` | 未给定自定义密钥时生成 `pk-lf-<uuid>`；给定则原样使用 |
| `secretKey` | **仅在创建响应中返回一次**的明文；未给定时 `sk-lf-<uuid>` |
| `hashedSecretKey` | `bcrypt(secretKey, cost 11)`（唯一约束；每次加盐，因此同一明文两次结果不同） |
| `fastHashedSecretKey` | `sha256(secretKey ‖ sha256hex(盐))`，盐来自环境变量 `SALT`（唯一约束；**仅取决于 secretKey**） |
| `displaySecretKey` | `secretKey` 前 6 字符 + `"..."` + 后 4 字符 |
| `projectId` / `orgId` | `scope === "PROJECT"` → 写 `projectId = entityId`；否则 `orgId = entityId` |
| `scope` | 入参值 |

- `SALT` 未设置时抛 `Error("SALT is not set")`。
- 不检查 `entityId` 是否存在；由外键约束决定成败。
- 不做去重预检：唯一约束冲突由数据库抛出（Prisma `P2002`）。
- 无事务、无审计日志、无缓存写入。

**(b) `ApiAuthService.deleteApiKey(id, entityId, scope)`**（`web/src/features/public-api/server/apiAuth.ts`）
先 `findFirstOrThrow({ id, ...(scope==="PROJECT" ? {projectId: entityId} : {orgId: entityId}), scope })`（找不到会**抛** Prisma 异常，不会返回 falsy），再按 `fastHashedSecretKey` 失效 Redis 缓存键 `api-key:<fastHashedSecretKey>`（仅当 redis 已配置且该字段非空），最后按 `id` 删除 `api_keys` 行并返回 `true`。返回 `false` 的分支不可达。

**(c) `auditLog(log, prisma?)`**（`web/src/features/audit-logs/auditLog.ts`）
本批次全部使用 `apiKeyId` 变体，写一条 `audit_logs` 行：

| 列 | 值 |
| --- | --- |
| `type` | `API_KEY` |
| `apiKeyId` | 传入的 actor（组织 admin 路由传字面量 `"admin-api"`；公开路由传调用方 key 的 `scope.apiKeyId`） |
| `userId` | `NULL` |
| `orgId` | 传入的 orgId |
| `projectId` | 传入的 projectId（组织级操作为 `NULL`） |
| `userOrgRole` / `userProjectRole` | `NULL` |
| `resourceType` | `"apiKey"` |
| `resourceId` | 新建/删除的 key 的 `id` |
| `action` | `"create"` / `"delete"` |
| `before` / `after` | `NULL`（本批次不传） |

`auditLog` 不参与任何事务；本批次所有调用都在数据库写入**之后**，且没有把事务客户端传进去。

**(d) CORS**（`web/src/features/public-api/server/cors.ts`）
每个路由的第一件事是 `await runMiddleware(req, res, cors)`，`cors` 为 `cors({ origin: true, credentials: false })`。它在认证之前执行：会回显 `Origin`、加 `Vary: Origin`，并按该中间件默认值直接应答 `OPTIONS` 预检。

---

## 2. A 组：组织级 API key

### A.1 `createOrgApiKey`

- 路径：`web/src/features/enterprise/apiKeys/createOrgApiKey.ts`
- 用途：为组织创建一把组织级 API key，并写一条创建审计日志。**入口是实例管理路由**（`POST /api/admin/organizations/{organizationId}/apiKeys`，该路由不在本批次但会调用本函数，签名必须保持）。
- 导出：`createOrgApiKey(req: NextApiRequest, res: NextApiResponse, orgId: string, actorId: string)`（无显式返回类型；成功时 `res.json` 的返回值）。

请求体 zod schema：`{ note?: string }`（对象字面量；未知字段被丢弃，不报错）。

顺序与结果：

| 步 | 条件 | 结果 |
| --- | --- | --- |
| 1 | 请求体解析失败 | `400 { "error": "Invalid request body", "details": <zod error.format() 对象> }`，返回（**不抛**） |
| 2 | 解析成功 | 调 `createAndAddApiKeysToDb({ prisma, entityId: orgId, note, scope: "ORGANIZATION" })`；`note` 为 `undefined` 时落库为 `NULL` |
| 3 | 成功 | 写审计日志（见 §1.3c：`apiKeyId = actorId`、`orgId`、`resourceType="apiKey"`、`resourceId = apiKeyMeta.id`、`action="create"`、无 `projectId`） |
| 4 | 成功 | `logger.info`，随后 `201` + `apiKeyMeta` |

- **响应投影**：`{ id, createdAt, note, publicKey, secretKey, displaySecretKey }`。`createdAt` 由 `res.json` 序列化为 ISO 字符串；`secretKey` 为明文且只在此响应出现。
- `orgId` 不存在或 `SALT` 缺失时：函数内**不捕获**，异常向上抛给调用方路由（管理路由的 `try/catch` 需要 `await`；见 §9 的说明）。
- 数据库：`api_keys` 单行 `create`。无事务、无缓存写入。
- 本函数**不做**认证、不做权益检查、不校验 orgId 存在。

### A.2 `deleteOrgApiKey`

- 路径：`web/src/features/enterprise/apiKeys/deleteOrgApiKey.ts`；入口 `DELETE /api/admin/organizations/{organizationId}/apiKeys/{apiKeyId}`。
- 导出：`deleteOrgApiKey(req, res, orgId: string, apiKeyId: string, actorId: string)`。

顺序与结果：

| 步 | 条件 | 结果 |
| --- | --- | --- |
| 1 | `prisma.apiKey.findUnique({ where: { id: apiKeyId, orgId, scope: "ORGANIZATION" } })` 返回 `null` | `404 { "error": "API key not found" }`（响应键是 `error`） |
| 2 | 命中 | `new ApiAuthService(prisma, redis).deleteApiKey(apiKeyId, orgId, "ORGANIZATION")` |
| 3 | 返回 falsy | `500 { "error": "The API key could not be removed." }`（实际不可达，见 §9） |
| 4 | 返回 `true` | 写审计日志（`apiKeyId = actorId`、`orgId`、`resourceType="apiKey"`、`resourceId = apiKeyId`、`action="delete"`） |
| 5 | 成功 | `logger.info`，随后 `200 { "success": true }` |

- 归属不匹配（key 存在但属于别的组织，或同名 id 是 `PROJECT` 级 key）→ 第 1 步就是 `null` → **404**（不是 403）。
- 重复调用 → 第二次 404；即删除本身幂等，但**响应不同**。
- 数据库：1 次读 `api_keys`（唯一键 `id` + 附加非唯一过滤）、1 次删 `api_keys`；Redis：按 `fastHashedSecretKey` 删 `api-key:<hash>`。无事务。
- 无请求体校验（`DELETE` 不读 `req.body`）。

### A.3 `listOrgApiKeys`

- 路径：`web/src/features/enterprise/apiKeys/listOrgApiKeys.ts`；两个入口：`GET /api/public/organizations/apiKeys`（组织级 key 鉴权）与 `GET /api/admin/organizations/{organizationId}/apiKeys`（实例管理）。
- 导出：`listOrgApiKeys(req, res, orgId: string)`。

行为：

- `prisma.apiKey.findMany({ where: { orgId, scope: "ORGANIZATION" }, select: { id, createdAt, expiresAt, lastUsedAt, note, publicKey, displaySecretKey }, orderBy: { createdAt: "asc" } })`。
- `200 { "apiKeys": [ ... ] }`。
- **投影恰好这 7 个字段**；`secretKey`、`hashedSecretKey`、`fastHashedSecretKey`、`projectId`、`orgId`、`scope` 均**不得**出现。
- 无分页、无 limit、无总数；`expiresAt`/`lastUsedAt` 未设置时为 `null`。
- 排序为 `createdAt` 升序；同一毫秒的并列顺序未定义。
- 只返回 `scope = "ORGANIZATION"` 且 `orgId` 匹配的行：**看不见**该组织项目下的 `PROJECT` 级 key。
- 无认证、无权益检查（由路由负责）；`req` 未被使用。

---

## 3. B 组：项目级 API key

### B.1 `createProjectApiKey`

- 路径：`web/src/features/enterprise/apiKeys/createProjectApiKey.ts`；入口 `POST /api/public/projects/{projectId}/apiKeys`。
- 导出：`createProjectApiKey(req, res, projectId: string, scope: ApiAccessScope)`。

请求体 zod schema：`{ note?: string; publicKey?: string; secretKey?: string }`（未知字段丢弃）。

常量：公钥前缀 `"pk-lf-"`，密钥前缀 `"sk-lf-"`。
重复键判定：错误对象的 `code === "P2002"`，**或** `error instanceof Error && /unique constraint/i.test(error.message)`。

顺序与结果（严格按序）：

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | 请求体解析失败（含 `req.body` 为 `undefined`、非对象、`note` 非字符串） | `400 { "message": "Invalid request body", "details": <zod error.issues 数组> }` |
| 2 | `publicKey` 与 `secretKey` **只有一个**存在 | `400 { "message": "Both publicKey and secretKey are required together to register a custom key pair." }` |
| 3 | `publicKey` 不以 `pk-lf-` 开头 | `400 { "message": "publicKey has to use the 'pk-lf-' prefix" }` |
| 4 | `secretKey` 不以 `sk-lf-` 开头 | `400 { "message": "secretKey has to use the 'sk-lf-' prefix" }` |
| 5 | 两者都合法 | `createAndAddApiKeysToDb({ prisma, entityId: projectId, note, scope: "PROJECT", predefinedKeys: { publicKey, secretKey } })`；未提供自定义密钥时 `predefinedKeys` 为 `undefined`（生成 `pk-lf-`/`sk-lf-` + UUID） |
| 6 | 第 5 步抛错且命中重复键判定 | `409 { "message": "That publicKey or secretKey is already in use by another API key." }` |
| 7 | 第 5 步抛其他错 | `logger.error`，`500 { "message": "Internal server error" }` |
| 8 | 成功 | 审计日志：`apiKeyId = scope.apiKeyId`、`orgId = scope.orgId`、`projectId`、`resourceType="apiKey"`、`resourceId = apiKeyMeta.id`、`action="create"` |
| 9 | 成功 | `logger.info`，`201` + `apiKeyMeta` |

- 顺序要点：**前缀校验先于唯一性冲突**；zod 校验先于"成对"校验；`publicKey` 前缀先于 `secretKey` 前缀。
- **响应投影**：`{ id, createdAt, note, publicKey, secretKey, displaySecretKey }`；`secretKey` 明文只在这一次返回。不返回 `expiresAt`（测试 schema 把它标为可选）。
- 同一次请求里给出的自定义密钥会原样回显：`publicKey === 请求里的 publicKey`、`secretKey === 请求里的 secretKey`。
- `409` 覆盖三类唯一冲突：`public_key`、`hashed_secret_key`（bcrypt 加盐后几乎不冲突）、`fast_hashed_secret_key`（**相同 secretKey 必然冲突**，即使 publicKey 不同）。
- 函数内不校验 `projectId` 是否存在/是否属于 `scope.orgId`；由路由负责。外键失败会落到第 7 步 → 500。
- 数据库：`api_keys` 单行 `create`（`projectId = projectId`、`scope = "PROJECT"`）。无事务、无缓存写入。

### B.2 `deleteProjectApiKey`

- 路径：`web/src/features/enterprise/apiKeys/deleteProjectApiKey.ts`；入口 `DELETE /api/public/projects/{projectId}/apiKeys/{apiKeyId}`。
- 导出：`deleteProjectApiKey(req, res, projectId: string, apiKeyId: string, scope: ApiAccessScope)`。

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | `prisma.apiKey.findUnique({ where: { id: apiKeyId, projectId, scope: "PROJECT" } })` 为 `null` | `404 { "message": "API key not found" }`（响应键是 `message`，与组织级 `deleteOrgApiKey` 的 `error` 不同） |
| 2 | 命中 | `new ApiAuthService(prisma, redis).deleteApiKey(apiKeyId, projectId, "PROJECT")` |
| 3 | falsy | `500 { "message": "The API key could not be removed." }`（不可达，见 §9） |
| 4 | `true` | 审计日志：`apiKeyId = scope.apiKeyId`、`orgId = scope.orgId`、`projectId`、`resourceType="apiKey"`、`resourceId = apiKeyId`、`action="delete"` |
| 5 | 成功 | `logger.info`，`200 { "success": true }` |

- 其他项目的 key、或同 id 的 `ORGANIZATION` 级 key → 404（不是 403）。
- 无请求体校验。重复调用第二次 404（删除幂等，响应不幂等）。
- 数据库：1 次读 + 1 次删 `api_keys`；Redis 失效同 §1.3b。

### B.3 `listProjectApiKeys`

- 路径：`web/src/features/enterprise/apiKeys/listProjectApiKeys.ts`；入口 `GET /api/public/projects/{projectId}/apiKeys`。
- 导出：`listProjectApiKeys(req, res, projectId: string)`。

行为：与 A.3 完全同构，差别只有过滤条件与作用域：

- `where: { projectId, scope: "PROJECT" }`，`select` 与投影同 A.3（7 个字段），`orderBy: { createdAt: "asc" }`；
- `200 { "apiKeys": [ ... ] }`；无分页；
- 只返回该项目的 `PROJECT` 级 key，**看不见**组织级 key，也看不见其他项目的 key。

---

## 4. C 组：组织成员关系

### C.1 `listOrgMemberships`

- 路径：`web/src/features/enterprise/memberships/listOrgMemberships.ts`；入口 `GET /api/public/organizations/memberships`。
- 导出：`listOrgMemberships(req, res, orgId: string)`。

行为：

- `prisma.organizationMembership.findMany({ where: { orgId }, include: { user: { select: { id, email, name } } } })`。
- **没有 `orderBy`**：返回顺序由数据库决定，测试不得断言顺序。
- `200 { "memberships": [ { userId, role, email, name }, ... ] }`。
- 投影恰好 4 个字段；`email`、`name` 直接来自 `users` 表且**在数据库中可空**（`user.email` 为 `String?`），因此响应中可能是 `null`（见 §9）。
- 包含该组织内所有角色的成员（含 `NONE`），不做角色过滤或分页。

### C.2 `upsertOrgMembership`

- 路径：`web/src/features/enterprise/memberships/upsertOrgMembership.ts`；入口 `PUT /api/public/organizations/memberships`。
- 导出：`upsertOrgMembership(req, res, orgId: string)`。

请求体 zod schema：`{ userId: string; role: enum(Role) }`，`Role` 取值 `OWNER | ADMIN | MEMBER | VIEWER | NONE`。

顺序与结果：

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | 解析失败（缺 `userId`、`role` 不在枚举、类型不对） | `400 { "error": "Invalid request body", "details": <zod issues 数组> }` |
| 2 | `prisma.user.findUnique({ where: { id: userId } })` 为 `null` | `404 { "error": "User not found" }` |
| 3 | 已存在该 `(orgId, userId)` 成员关系且其 `role === "OWNER"`，且**请求的 role 不是 OWNER**，且该组织内除这条以外 `role = OWNER` 的成员数 `=== 0` | `403 { "error": "Cannot remove the last owner of an organization. Assign new owner or delete organization." }`，**不写库** |
| 4 | 其他情况 | `prisma.organizationMembership.upsert({ where: { orgId_userId: { orgId, userId } }, update: { role }, create: { orgId, userId, role } })` |
| 5 | 成功 | `200 { userId, role, email, name }`（`email`/`name` 取自第 2 步查到的 `user`） |

- 顺序要点：**用户存在性先于 last-OWNER 保护**；zod 校验先于两者。
- 创建与更新都是 **200**（不返回 201）。
- 第 3 步的计数把"当前这条 OWNER 自己"排除在外：`owners.count({ orgId, role: "OWNER", id: { not: existing.id } })`；只有等于 0 才拒绝。因此组织里有两名及以上 OWNER 时可以互相降级。
- `role === "OWNER"` 时**没有**任何限制（可以无上限地造出多个 OWNER）。
- 幂等：同一 `(orgId, userId, role)` 重复 PUT 结果一致，库中仍只有一行（`organization_memberships` 有 `@@unique([orgId, userId])`），第二次只刷新 `updatedAt`。
- 副作用：**无审计日志、无邀请邮件、无缓存失效**。仅写 `organization_memberships` 一行。
- 并发下第 3 步的检查不是原子的（无事务/无锁），两个并发降级请求都可能通过。

### C.3 `deleteOrgMembership`

- 路径：`web/src/features/enterprise/memberships/deleteOrgMembership.ts`；入口 `DELETE /api/public/organizations/memberships`。
- 导出：`deleteOrgMembership(req, res, orgId: string)`。

请求体 zod schema：`{ userId: string }`。

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | 解析失败（缺 `userId`） | `400 { "error": "Invalid request body", "details": <zod issues 数组> }` |
| 2 | `findUnique({ where: { orgId_userId: { orgId, userId } } })` 得到 `role === "OWNER"`，且 `count({ where: { orgId, role: "OWNER" } }) === 1` | `403 { "error": "Cannot remove the last owner of an organization. Assign new owner or delete organization." }`，**不删** |
| 3 | 其他情况（含成员关系不存在） | `prisma.organizationMembership.deleteMany({ where: { orgId, userId } })` |
| 4 | 总是成功 | `200 { "message": "Organization membership removed", "userId": <请求里的 userId> }` |

- **不校验用户是否存在**；成员关系不存在时也返回 200 且 `userId` 原样回显（`deleteMany` 不抛错）→ 删除是幂等的，**没有 404**。
- last-OWNER 保护只在"目标正好是唯一 OWNER"时触发；组织里有第二名 OWNER 时删除放行（计数包含目标自身，`=== 1` 判定）。
- 级联：删 `organization_memberships` 行会通过 `onDelete: Cascade` 连带删掉该行下的 `project_memberships`。
- 副作用：**无审计日志**、无缓存失效。仅操作 `organization_memberships`。

---

## 5. D 组：项目成员关系

### D.1 `listProjectMemberships`

- 路径：`web/src/features/enterprise/memberships/listProjectMemberships.ts`；入口 `GET /api/public/projects/{projectId}/memberships`。
- 导出：`listProjectMemberships(req, res, projectId: string, orgId: string)`。

行为：

- `prisma.projectMembership.findMany({ where: { projectId, organizationMembership: { orgId } }, include: { user: { select: { id, email, name } } } })`。
- **没有 `orderBy`**：顺序未定义。
- `200 { "memberships": [ { userId, role, email, name }, ... ] }`；投影恰好 4 个字段。
- 语义：只报告**显式的项目级成员关系**（覆盖继承自组织的角色）；组织成员但没有 `project_memberships` 行的人**不出现**。
- 归属过滤走 `organizationMembership` 关联：`project_memberships.orgMembershipId → organization_memberships.orgId` 必须等于调用方 `orgId`。因此**即使 `projectId` 匹配**，只要该行的 `orgMembershipId` 指向别的组织的成员关系，该行就**不出现**。
- 本函数不校验项目存在性/归属（由路由的 `project.findFirst` 负责）；`email` 可为 `null`。

### D.2 `upsertProjectMembership`

- 路径：`web/src/features/enterprise/memberships/upsertProjectMembership.ts`；入口 `PUT /api/public/projects/{projectId}/memberships`。
- 导出：`upsertProjectMembership(req, res, projectId: string, orgId: string)`。

请求体 zod schema：`{ userId: string; role: enum(Role) }`。

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | 解析失败 | `400 { "error": "Invalid request body", "details": <zod issues 数组> }` |
| 2 | `organizationMembership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { user: { select: { email, name } } } })` 为 `null` | `404 { "error": "User does not belong to this organization" }` |
| 3 | 命中 | `projectMembership.upsert({ where: { projectId_userId: { projectId, userId } }, update: { role }, create: { userId, projectId, role, orgMembershipId: organizationMembership.id } })` |
| 4 | 成功 | `200 { userId, role, email, name }`（`email`/`name` 取自组织成员关系关联的 `user`） |

- 顺序要点：**组织成员关系先于项目成员关系**；用户存在但不在本组织 → 404（而不是"创建成员关系"）。
- `update` **只写 `role`**：已存在的 `project_memberships` 行的 `orgMembershipId` **不会被修正**。详见 §9。
- 创建与更新都是 200；`project_memberships` 主键为 `@@id([projectId, userId])`，因此 upsert 天然幂等（重复同 role PUT 只刷新 `updatedAt`）。
- **没有**任何角色层级/权限检查：可以把任意组织成员直接设为项目 `OWNER`；项目级没有 last-OWNER 保护。
- 副作用：**无审计日志**、无邀请邮件、无缓存失效。只写 `project_memberships` 一行。
- 不校验 `projectId` 存在/属于 `orgId`（由路由负责）。

### D.3 `deleteProjectMembership`

- 路径：`web/src/features/enterprise/memberships/deleteProjectMembership.ts`；入口 `DELETE /api/public/projects/{projectId}/memberships`。
- 导出：`deleteProjectMembership(req, res, projectId: string, orgId: string)`。

请求体 zod schema：`{ userId: string }`。

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | 解析失败（缺 `userId`） | `400 { "error": "Invalid request body", "details": <zod issues 数组> }` |
| 2 | `findUnique({ where: { projectId_userId: { userId, projectId } }, include: { organizationMembership: { select: { orgId: true } } } })` 为 `null` | `404 { "error": "Project membership not found" }` |
| 3 | 命中但 `membership.organizationMembership.orgId !== orgId` | `403 { "error": "Project membership does not belong to this organization" }` |
| 4 | 归属正确 | `projectMembership.delete({ where: { projectId_userId: { userId, projectId } } })` |
| 5 | 成功 | `200 { "message": "Project membership removed", "userId": <请求里的 userId> }` |

- 与组织级删除不同：这里**不是** `deleteMany`，因此重复删除第二次得到 `404`。
- 第 3 步要求构造"项目归属 A、但成员关系的 `orgMembershipId` 指向 B 组织成员关系"的行（数据库层没有阻止这种不一致）；正常情况下路由的 `project.findFirst` 已经保证项目属于调用方组织。
- 副作用：无审计日志；级联仅涉及该行本身。

---

## 6. E 组：路由包装器

所有 6 个包装器都在第一行 `await runMiddleware(req, res, cors)`（见 §1.3d），随后按表中顺序执行。**顺序本身是契约的一部分。**

### E.1 `web/src/pages/api/public/organizations/apiKeys/index.ts`

| 顺序 | 步骤 | 失败响应 |
| --- | --- | --- |
| 1 | CORS | — |
| 2 | `requireAdminApi(req, res)` | 401/403（§1.2）；`null` → `return` |
| 3 | `routeByMethod(req, res, { GET: () => listOrgApiKeys(req, res, scope.orgId) })` | 非 `GET` → `405 { "error": "Method not allowed. Allowed methods: GET" }` |

**没有** `allowMethods` 早检查：方法判定在认证**之后**，所以未认证的 `POST` 得到 401 而不是 405。
外层 `try { return routeByMethod(...) } catch { logger.error(...); return res.status(500).json({ error: "Internal server error" }); }` —— 注意 §9 关于该 `try/catch` 是否真的能兜住异步异常的说明。500 响应键是 `error`。

### E.2 `web/src/pages/api/public/organizations/memberships/index.ts`

| 顺序 | 步骤 | 失败响应 |
| --- | --- | --- |
| 1 | CORS | — |
| 2 | `requireAdminApi` | 同 §1.2 |
| 3 | `routeByMethod(req, res, { GET: …, PUT: …, DELETE: … })`，依次调用 `listOrgMemberships` / `upsertOrgMembership` / `deleteOrgMembership`，均传 `scope.orgId` | 其他方法 → `405 { "error": "Method not allowed. Allowed methods: GET, PUT, DELETE" }` |

**方法判定在认证之后**；外层 `try/catch` → `500 { "error": "Internal server error" }`。
**注意**：组织成员关系**只**受 `admin-api` 权益门控，**不**要求 `rbac-project-roles`（与 E.6 不对称，见 §9）。

### E.3 `web/src/pages/api/public/organizations/projects/index.ts`

| 顺序 | 步骤 | 失败响应 |
| --- | --- | --- |
| 1 | CORS | — |
| 2 | `requireAdminApi` | 同 §1.2 |
| 3 | `routeByMethod(req, res, { GET: () => listProjects(req, res, scope.orgId) })` | 非 `GET` → `405 { "error": "Method not allowed. Allowed methods: GET" }` |

`listProjects` 位于 `web/src/features/enterprise/projects/listProjects.ts`（**不在本批次**，实现者不得改动其调用契约）：`where: { orgId, deletedAt: null }`，`select: { id, name, metadata, createdAt, updatedAt }`，无 `orderBy`，返回 `200 { "projects": [ { id, name, metadata, createdAt, updatedAt } ] }`。包装器必须原样保留 import 路径与调用形状。
外层 `try/catch` → `500 { "error": "Internal server error" }`。

### E.4 `web/src/pages/api/public/projects/[projectId]/apiKeys/index.ts`

| 顺序 | 步骤 | 失败响应 |
| --- | --- | --- |
| 1 | CORS | — |
| 2 | `typeof req.query.projectId !== "string"`（缺失或重复参数成数组） | `400 { "message": "Invalid project ID" }` |
| 3 | `allowMethods(req, res, ["GET", "POST"])` | 其他方法 → `405 { "error": "Method not allowed. Allowed methods: GET, POST" }`（**在认证之前**） |
| 4 | `requireAdminApi` | 同 §1.2 |
| 5 | `prisma.project.findFirst({ where: { id: projectId, orgId: scope.orgId, deletedAt: null } })` 为 `null` | `404 { "message": "Project not found or you don't have access to it" }` |
| 6 | `routeByMethod(req, res, { GET: () => listProjectApiKeys(req, res, projectId), POST: () => createProjectApiKey(req, res, projectId, scope) })` | 该分支不会失败（方法已被第 3 步限定） |

- 项目不存在、属于别的组织、或已软删除（`deletedAt` 非空）一律是同一个 404，响应键为 `message`。
- 外层 `try/catch` → `500 { "message": "Internal server error" }`。

### E.5 `web/src/pages/api/public/projects/[projectId]/apiKeys/[apiKeyId].ts`

| 顺序 | 步骤 | 失败响应 |
| --- | --- | --- |
| 1 | CORS | — |
| 2 | `projectId` 或 `apiKeyId` 不是字符串 | `400 { "message": "Invalid project ID or API key ID" }` |
| 3 | `allowMethods(req, res, ["DELETE"])` | 其他方法 → `405 { "error": "Method not allowed. Allowed methods: DELETE" }`（**在认证之前**） |
| 4 | `requireAdminApi` | 同 §1.2 |
| 5 | 项目查询（同 E.4）为 `null` | `404 { "message": "Project not found or you don't have access to it" }` |
| 6 | `routeByMethod(req, res, { DELETE: () => deleteProjectApiKey(req, res, projectId, apiKeyId, scope) })` | — |

外层 `try/catch` → `500 { "message": "Internal server error" }`。

### E.6 `web/src/pages/api/public/projects/[projectId]/memberships/index.ts`

| 顺序 | 步骤 | 失败响应 |
| --- | --- | --- |
| 1 | CORS | — |
| 2 | `!projectId \|\| typeof projectId !== "string"` | `400 { "error": "projectId is required" }`（注意与 E.4 的文案/键不同） |
| 3 | `allowMethods(req, res, ["GET", "PUT", "DELETE"])` | 其他方法 → `405 { "error": "Method not allowed. Allowed methods: GET, PUT, DELETE" }`（**在认证之前**） |
| 4 | `requireAdminApi` | 同 §1.2 |
| 5 | `!hasEntitlementBasedOnPlan({ plan: scope.plan, entitlement: "rbac-project-roles" })` | `403 { "error": "Your plan does not include project role management." }`（**在项目查询之前**） |
| 6 | `prisma.project.findFirst({ where: { id: projectId, orgId: scope.orgId, deletedAt: null } })` 为 `null` | `404 { "error": "Project not found or does not belong to this organization" }`（注意与 E.4/E.5 的文案/键不同） |
| 7 | `routeByMethod(req, res, { GET: …, PUT: …, DELETE: … })`，分别调 `listProjectMemberships` / `upsertProjectMembership` / `deleteProjectMembership`，均传 `(req, res, projectId, scope.orgId)` | — |

- 三步门控的顺序固定为：方法 → 组织级 admin key + `admin-api` 权益 → `rbac-project-roles` 权益 → 项目归属。
- 外层 `try/catch` → `500 { "error": "Internal server error" }`。

---

## 7. 特征测试计划

测试在**换入净室实现之前**先写、先跑、先在当前实现上变绿（L1）。全部为**黑盒断言**：HTTP 调用（`makeAPICall` / `makeZodVerifiedAPICall`，走 `http://localhost:3000`）+ Prisma 状态 + 响应体，不得断言内部函数或私有结构。

### 7.0 环境前提

- Postgres 已迁移；`SALT` 已设置；dev server 在 `:3000`；`ADMIN_API_KEY` 已设置（实例管理用例）；
- 组织需带 `cloudConfig.plan = "Pro"`，使其在云区域构建下解析为 `cloud:pro`、在带 `LITEFUSE_EE_LICENSE_KEY` 的自托管构建下解析为 `self-hosted:enterprise`（两者才有 `admin-api` / `rbac-project-roles`）；
- 本批次不新增测试文件之外的仓库文件；测试文件建议命名 `keys-and-memberships-api.servertest.ts`（新用例）。

### 7.1 `http.ts`（C1–C4）

1. **C1** 给定 `allowed = ["GET","POST"]`；当 `req.method` 为 `"POST"`；则 `allowMethods` 返回 `true` 且未写响应。— `new`
2. **C2** 给定 `allowed = ["GET","PUT","DELETE"]`；当 `req.method` 为 `"PATCH"`；则返回 `false`，`405`，响应体 `error === "Method not allowed. Allowed methods: GET, PUT, DELETE"`。— `new`
3. **C3** 给定 `req.method` 为 `undefined`；当调用 `allowMethods`；则按未命中处理，`405` 且 error 列出允许方法。— `new`
4. **C4** 给定 `handlers = { GET, PUT, DELETE }`；当 `routeByMethod` 收到未登记的方法；则 `405`，error 列出 `"GET, PUT, DELETE"`（对象键顺序）。— 间接：`organizations-api.servertest.ts` › `Admin Organizations API` › `it("should return 405 for non-supported methods")`；`projects-api.servertest.ts` › `GET /api/public/projects` › `it("should return 405 for non-GET methods")`

### 7.2 组织级 API key —— 创建（C5–C11）

5. **C5** 给定 `ADMIN_API_KEY` 与已存在的组织；当 `POST /api/admin/organizations/{organizationId}/apiKeys` 带 `{note:"Test API Key"}`；则 `201`，`publicKey` 匹配 `/^pk-lf-/`、`secretKey` 匹配 `/^sk-lf-/`、`note` 回显；`api_keys` 行 `orgId === 组织`、`scope === "ORGANIZATION"`；且 `displaySecretKey` 等于 `secretKey` 前 6 + `...` + 后 4；`hashedSecretKey !== secretKey`。— `organizations-api.servertest.ts` › `POST /api/admin/organizations/[organizationId]/apiKeys` › `it("should create a new API key for an organization with valid admin authentication")`
6. **C6** 给定有效 admin 认证；当请求体为 `{}`；则 `201` 且 `note === null`。— `new`
7. **C7** 给定有效 admin 认证；当请求体 `{note: 5}`（非字符串）；则 `400`，`body.error === "Invalid request body"`，存在 `body.details`。— `new`
8. **C8** 给定有效 admin 认证；当请求体带未知字段 `{note:"x", foo:"bar"}`；则 `201` 且未知字段被忽略（响应无 `foo`）。— `new`
9. **C9** 给定无/错误认证；当 `POST /api/admin/organizations/{id}/apiKeys`；则 `401`，`body.error` 含 `"Unauthorized"`。— `organizations-api.servertest.ts` › `POST /api/admin/organizations/[organizationId]/apiKeys` › `it("should return 401 when no authorization header is provided")`
10. **C10** 给定随机不存在的 organizationId；当 `POST …/apiKeys`；则 `404`，`body.error` 含 `"Organization not found"`（由管理路由而非本批次函数产生）。— `organizations-api.servertest.ts` › `POST /api/admin/organizations/[organizationId]/apiKeys` › `it("should return 404 when creating an API key for a non-existent organization")`
11. **C11** 给定有效 admin 认证；当创建成功；则 `audit_logs` 新增一行 `type="API_KEY"`、`apiKeyId="admin-api"`、`orgId=组织`、`projectId=NULL`、`resourceType="apiKey"`、`resourceId=新 key id`、`action="create"`。— `new`

### 7.3 组织级 API key —— 列表（C12–C21）

12. **C12** 给定组织有两把组织级 key；当 `GET /api/public/organizations/apiKeys` 用该组织 key；则 `200`，`apiKeys.length===3`（含鉴权用的那把），每条都有 `id/createdAt/expiresAt/lastUsedAt/note/publicKey/displaySecretKey`，无 `secretKey`、无 `hashedSecretKey`。— `organizations-api.servertest.ts` › `GET /api/public/organizations/apiKeys` › `it("should successfully list organization API keys with valid org API key")`
13. **C13** 给定两个各有一把 key 的组织；当用第二个组织的 key 列取；则只返回第二个组织的 key，不含第一个组织的 `note`。— 同上文件 › `it("should only return API keys for authenticated organization (data isolation)")`
14. **C14** 给定多把 key；当列取；则 `createdAt` 非递减。— 同上文件 › `it("should return API keys ordered by createdAt ascending")`
15. **C15** 给定同一组织下还有一把 `scope="PROJECT"` 的 key；当 `GET /api/public/organizations/apiKeys`；则该 PROJECT 级 key 不出现。— `new`
16. **C16** 给定项目级 API key；当 `GET /api/public/organizations/apiKeys`；则 `403`，`body.error` 含 `"Organization-scoped API key required"`。— 同上文件 › `it("should reject request with project API key (wrong scope)")`
17. **C17** 给定无效 key；当 `GET /api/public/organizations/apiKeys`；则 `401`。— 同上文件 › `it("should reject request with invalid API key")`
18. **C18** 给定有效组织 key；当 `POST /api/public/organizations/apiKeys`；则 `405`，`body.error` 含 `"Method not allowed"`。— 同上文件 › `it("should only allow GET method")`
19. **C19** 给定**无**鉴权头；当 `POST /api/public/organizations/apiKeys`；则 `401`（而非 405：方法判定在认证之后）。— `new`
20. **C20** 给定随机 organizationId；当 `GET /api/admin/organizations/{id}/apiKeys` 带 admin 认证；则 `404`，error 含 `"Organization not found"`。— `organizations-api.servertest.ts` › `GET /api/admin/organizations/[organizationId]/apiKeys` › `it("should return 404 when getting API keys for a non-existent organization")`
21. **C21** 给定组织有 `note="Test API Key"` 的一把 key；当 `GET /api/admin/organizations/{id}/apiKeys`；则 `200`，列表含该 `note`。— 同上文件 › `it("should get all API keys for an organization with valid admin authentication")`

### 7.4 组织级 API key —— 删除（C22–C29）

22. **C22** 给定组织与该组织的一把 key；当 `DELETE /api/admin/organizations/{id}/apiKeys/{keyId}` 带 admin 认证；则 `200`，`body.success===true`，`api_keys` 中该行消失，且 Redis 中 `api-key:<fastHashedSecretKey>` 被清除（可用 redis 测试工具断言，无 redis 时跳过）。— `organizations-api.servertest.ts` › `DELETE /api/admin/organizations/[organizationId]/apiKeys/[apiKeyId]` › `it("should delete an API key with valid admin authentication")`
23. **C23** 给定随机 keyId；当同一 DELETE；则 `404`，`body.error` 含 `"API key not found"`。— 同上 › `it("should return 404 when deleting a non-existent API key")`
24. **C24** 给定不存在的 organizationId；当同一 DELETE；则 `404`，error 含 `"Organization not found"`。— 同上 › `it("should return 404 when deleting an API key for a non-existent organization")`
25. **C25** 给定无鉴权头；当同一 DELETE；则 `401`。— 同上 › `it("should return 401 when no authorization header is provided")`
26. **C26** 给定组织 A 与组织 B，各有 key；当用 A 的 organizationId 去 DELETE B 的 keyId；则 `404 {error:"API key not found"}`，B 的 key 仍在。— `new`
27. **C27** 给定某 keyId 是同组织下的 `PROJECT` 级 key；当用组织管理路由 DELETE 它；则 `404`。— `new`
28. **C28** 给定一次成功的删除；则 `audit_logs` 新增 `action="delete"`、`apiKeyId="admin-api"`、`resourceId=被删 id`、`projectId=NULL` 的行。— `new`
29. **C29** 给定有效 admin 认证；当对 `.../apiKeys/{keyId}` 发 `GET`；则 `405`，error 含 `"Method not allowed"`。— `new`

### 7.5 项目级 API key —— 创建（C30–C46）

30. **C30** 给定组织级 key、项目属于该组织；当 `POST /api/public/projects/{projectId}/apiKeys` 带 `{note}`；则 `201`，`publicKey` 匹配 `/^pk-lf-/`、`secretKey` 匹配 `/^sk-lf-/`；`api_keys` 行 `projectId===项目`、`scope==="PROJECT"`；且用新 key 做 Basic 鉴权访问 `GET /api/public/projects` 得到该项目。— `projects-api.servertest.ts` › `POST /api/public/projects/[projectId]/apiKeys` › `it("should create a new API key with valid organization API key")`
31. **C31** 给定自定义 `pk-lf-…`/`sk-lf-…`；当 POST；则 `201`，响应 `publicKey`/`secretKey` 与请求逐字相同，`api_keys.publicKey` 相同。— 同上 › `it("should create an API key with predefined keys")`
32. **C32** 给定只给 `publicKey`；当 POST；则 `400`，`body.message` 含 `"Both publicKey and secretKey are required together"`。— 同上 › `it("should return 400 when only publicKey is provided without secretKey")`
33. **C33** 给定只给 `secretKey`；当 POST；则 `400`，同上文案。— 同上 › `it("should return 400 when only secretKey is provided without publicKey")`
34. **C34** 给定 `publicKey` 不以 `pk-lf-` 开头、`secretKey` 合法；当 POST；则 `400`，`body.message` 含 `"publicKey has to use the 'pk-lf-' prefix"`。— 同上 › `it("should return 400 when publicKey does not start with pk-lf-")`
35. **C35** 给定 `secretKey` 不以 `sk-lf-` 开头；当 POST；则 `400`，`body.message` 含 `"secretKey has to use the 'sk-lf-' prefix"`。— 同上 › `it("should return 400 when secretKey does not start with sk-lf-")`
36. **C36** 给定已用过的 `publicKey`；当再次 POST（不同 secretKey）；则 `409`，`body.message` 含 `"already in use"`。— 同上 › `it("should return 409 when predefined publicKey already exists")`
37. **C37** 给定已用过的 `secretKey`（不同 `publicKey`）；当 POST；则 `409`（`fast_hashed_secret_key` 唯一，同一 secretKey 必然冲突）。— `new`
38. **C38** 给定 `{note: 5}`；当 POST；则 `400`，`body.message === "Invalid request body"`，`details` 为**对象**（`error.format()` 的输出，形如 `{"_errors":[],"note":{"_errors":[...]}}`）——**不是** zod `issues` 数组。— `new`
39. **C39** 给定 `req.body` 为空（不发送 body）；当 POST；则 **`201`，并真的创建一把 key**。原因：Next.js 把无 body 的 POST 解析为 `{}`，而 body schema 的字段全为可选，因此校验通过。— `new`（**修订**：原文写"`400 Invalid request body`"是错的，特征测试阶段实测证伪）
40. **C40** 给定项目级 key；当 POST；则 `403`，`body.error` 含 `"Organization-scoped API key required"`；给定无效 key → `401`。— 同上 › `it("should return 403 when using project API key instead of organization API key")`、› `it("should return 401 when invalid API keys are provided")`
41. **C41** 给定组织级 key、随机不存在的 projectId；当 POST；则 `404`，`body.message` 含 `"Project not found"`。— 同上 › `it("should return 404 when project does not exist")`
42. **C42** 给定项目属于另一组织；当用本组织 key POST；则 `404`（同一个文案）。— `new`（`projects-api.servertest.ts` 有同类：`PUT /api/public/projects/[projectId]` › `it("should return 404 when project belongs to another organization")`）
43. **C43** 给定项目 `deletedAt` 非空；当 POST；则 `404`。— `new`
44. **C44** 给定一次成功创建；则 `audit_logs` 新增一行 `type="API_KEY"`、`apiKeyId=调用方 key 的 id`、`orgId=调用方组织`、`projectId=项目`、`resourceType="apiKey"`、`resourceId=新 key id`、`action="create"`。— `new`
45. **C45** 给定有效组织 key；当对 `.../apiKeys` 发 `PUT`；则 `405`，error 含 `"Method not allowed"`。— 同上 › `GET /api/public/projects/[projectId]/apiKeys` › `it("should return 405 for non-GET/POST methods")`
46. **C46** 给定**无**鉴权头；当 `PUT /api/public/projects/{id}/apiKeys`；则 `405`（方法判定先于认证）。— `new`

### 7.6 项目级 API key —— 列表（C47–C51）

47. **C47** 给定组织 key 与项目 fixture key；当 `GET /api/public/projects/{projectId}/apiKeys`；则 `200`，列表包含该 `publicKey`，每条含 7 个字段，且**不含** `secretKey`/`hashedSecretKey`。— `projects-api.servertest.ts` › `GET /api/public/projects/[projectId]/apiKeys` › `it("should return API keys with valid organization API key authentication")`
48. **C48** 给定另一项目的 key；当列取本项目；则该 key 不出现。— `new`
49. **C49** 给定项目级 key / 无效 key；当 GET；则分别 `403`（含 `"Organization-scoped API key required"`）/`401`。— 同上 › `it("should return 403 when using project API key instead of organization API key")`、› `it("should return 401 when invalid API keys are provided")`
50. **C50** 给定随机 projectId；当 GET；则 `404`，`body.message` 含 `"Project not found"`。— 同上 › `it("should return 404 when project does not exist")`
51. **C51** 给定项目级 key 与该项目的 key；当用项目级 key `GET`；则 `403`（不能用自己的项目 key 管理 key）。— `new`（与 C49 同族，可合并断言）

### 7.7 项目级 API key —— 删除（C52–C59）

52. **C52** 给定项目 fixture key；当 `DELETE /api/public/projects/{projectId}/apiKeys/{keyId}` 用组织 key；则 `200`，`body.success===true`，`api_keys` 中该行消失。— `projects-api.servertest.ts` › `DELETE /api/public/projects/[projectId]/apiKeys/[apiKeyId]` › `it("should delete an API key with valid organization API key")`
53. **C53** 给定随机 keyId；当 DELETE；则 `404`，`body.message` 含 `"API key not found"`。— 同上 › `it("should return 404 when API key does not exist")`
54. **C54** 给定另一项目的 keyId；当 DELETE；则 `404`。— `new`
55. **C55** 给定同组织下 `ORGANIZATION` 级 key 的 id；当用项目路由 DELETE；则 `404`。— `new`
56. **C56** 给定项目级 key / 无效 key；当 DELETE；则 `403` / `401`。— 同上 › `it("should return 403 when using project API key instead of organization API key")`、› `it("should return 401 when invalid API keys are provided")`
57. **C57** 给定随机 projectId；当 DELETE；则 `404`，`body.message` 含 `"Project not found"`。— 同上 › `it("should return 404 when project does not exist")`
58. **C58** 给定有效组织 key；当对 `.../apiKeys/{keyId}` 发 `GET`；则 `405`，error 含 `"Method not allowed"`。— `new`
59. **C59** 给定一次成功删除；则 `audit_logs` 新增 `action="delete"`、`projectId=项目`、`apiKeyId=调用方 key id` 的行。— `new`

### 7.8 组织成员关系（C60–C75）

60. **C60** 给定组织成员 fixture；当 `GET /api/public/organizations/memberships` 用组织 key；则 `200`，`memberships` 为数组且含该 `userId`，每条形如 `{userId, role, email, name}`。— `memberships-api.servertest.ts` › `Organization Memberships` › `GET /api/public/organizations/memberships` › `it("should get all organization memberships with valid API key")`
61. **C61** 给定第二个组织也有成员；当用第一个组织的 key GET；则不含第二个组织的 `userId`。— `new`
62. **C62** 给定项目级 key；当 GET `/api/public/organizations/memberships`；则 `403`，error 含 `"Organization-scoped API key required"`。— 同上 › `it("should return 403 when using a project-scoped API key")`
63. **C63** 给定有效组织 key；当 `PATCH /api/public/organizations/memberships`；则 `405`，error 含 `"Method not allowed. Allowed methods: GET, PUT, DELETE"`。— `new`
64. **C64** 给定无成员关系的用户；当 `PUT /api/public/organizations/memberships {userId, role:ADMIN}`；则 `200`，`body.userId===userId`、`body.role==="ADMIN"`，`organization_memberships` 出现该行。— 同上 › `PUT /api/public/organizations/memberships` › `it("should create a new organization membership with valid API key")`
65. **C65** 给定已有成员关系；当 PUT 新 role；则 `200`、`body.role` 为新值、库中 `role` 更新。— 同上 › `it("should update an existing organization membership with valid API key")`
66. **C66** 给定随机不存在的 `userId`；当 PUT；则 `404`，error 含 `"User not found"`，且不写库。— 同上 › `it("should return 404 when user does not exist")`
67. **C67** 给定某用户是该组织唯一 `OWNER`；当 PUT 把它降为 `MEMBER`；则 `403`，error 含 `"Cannot remove the last owner of an organization"`，且库中 role 仍为 `OWNER`。— 同上 › `it("should return 403 when demoting the last owner of the organization")`
68. **C68** 给定组织有两名 `OWNER`；当把其中一名降为 `MEMBER`；则 `200`，role 变更成功。— `new`
69. **C69** 给定 `role:"SUPERUSER"`；当 `PUT /api/public/organizations/memberships`；则 `400`，error 含 `"Invalid request body"`。— `new`（同文案已由项目级用例覆盖：同上 › `PUT /api/public/projects/[projectId]/memberships` › `it("should return 400 when role is invalid")`）
70. **C70** 给定缺少 `userId`；当 `DELETE /api/public/organizations/memberships` body `{}`；则 `400`，error 含 `"Invalid request body"`。— 同上 › `DELETE /api/public/organizations/memberships` › `it("should return 400 when userId is missing")`
71. **C71** 给定非 owner 成员关系；当 `DELETE /api/public/organizations/memberships {userId}`；则 `200`、`body.message==="Organization membership removed"`、`body.userId===userId`，库中该行消失。— 同上 › `it("should delete an existing organization membership with valid API key")`
72. **C72** 给定唯一 `OWNER`；当 DELETE；则 `403`，error 含 `"Cannot remove the last owner of an organization"`，行仍在。— 同上 › `it("should return 403 when deleting the last owner of the organization")`
73. **C73** 给定不存在的成员关系；当 DELETE；则 `200`（`deleteMany` 不报错），`body.message` 为成功文案，`body.userId` 原样回显。— `new`
74. **C74** 给定某成员的 `organization_memberships` 行；当对该 `userId` DELETE 组织成员关系；则其 `project_memberships` 行因级联一并消失。— `new`
75. **C75** 给定一次成功的 PUT 与 DELETE；当检查 `audit_logs`；则成员关系操作**不产生**任何 `audit_logs` 行。— `new`

### 7.9 项目成员关系（C76–C91）

76. **C76** 给定组织成员 + 显式项目成员关系 `VIEWER`；当 `GET /api/public/projects/{projectId}/memberships` 用组织 key；则 `200`，含 `{userId, role:"VIEWER", email, name}`（显式项目角色覆盖组织角色）。— `memberships-api.servertest.ts` › `Project Memberships` › `GET /api/public/projects/[projectId]/memberships` › `it("should get all project memberships with valid API key")`
77. **C77** 给定某用户只是组织成员、无 `project_memberships` 行；当 GET；则该用户不出现。— `new`
78. **C78** 给定一行 `project_memberships` 的 `orgMembershipId` 指向另一组织的成员关系；当 GET 本项目；则该行不出现。— `new`
79. **C79** 给定项目级 key；当 GET；则 `403`，error 含 `"Organization-scoped API key required"`。— 同上 › `it("should return 403 when using a non-organization API key")`
80. **C80** ~~给定组织 plan 为 `oss`（无 `rbac-project-roles`）；当 GET/PUT/DELETE 项目成员关系；则 `403 {error:"Your plan does not include project role management."}`。~~ **此用例不可达（死代码），不可断言**：`requireAdminApi` 会先拒绝任何不含 `admin-api` 的 plan，而 `entitlementAccess` 里 `admin-api` 只由 `cloud:pro` / `self-hosted:enterprise` 授予，这两者**同时**授予了 `rbac-project-roles` —— 因此该门控永远不可能是第一个失败点。另：在设了 `NEXT_PUBLIC_LITEFUSE_CLOUD_REGION` 时 `cloudConfig.plan` 只接受 `"Pro"|"Developer"`，`oss` 也无法构造。**可观察行为只有前者那条 403**，实现时必须保留该门控（它仍会被评估），但不要为它写断言。— **修订**（特征测试阶段实测证伪）
81. **C81** 给定随机 projectId（不属于本组织）；当 GET；则 `404`，error 含 `"Project not found"`。— 同上 › `it("should return 404 when project does not belong to the organization")`
82. **C82** 给定项目属于本组织、用户属于本组织、尚无项目成员关系；当 `PUT /api/public/projects/{projectId}/memberships {userId, role:ADMIN}`；则 `200`，`body.role==="ADMIN"`，库中 `project_memberships.role==="ADMIN"`、`orgMembershipId` 等于该用户在本组织的成员关系 id。— 同上 › `PUT /api/public/projects/[projectId]/memberships` › `it("should create a new project membership with valid API key")`
83. **C83** 给定已有项目成员关系；当 PUT 新 role；则 `200` 且库中 role 更新。— 同上 › `it("should update an existing project membership with valid API key")`
84. **C84** 给定用户存在但不在本组织；当 PUT；则 `404`，error 含 `"User does not belong to this organization"`，且不写库。— 同上 › `it("should return 404 when user is not a member of the organization")`
85. **C85** 给定 `role:"SUPERUSER"`；当 PUT；则 `400`，error 含 `"Invalid request body"`。— 同上 › `it("should return 400 when role is invalid")`
86. **C86** 给定已存在的项目成员关系，其 `orgMembershipId` 指向另一组织的成员关系；当对同一 `(projectId,userId)` PUT；则 `200`，但库中 `orgMembershipId` **未变**（update 只写 role）。— `new`（惊讶行为，见 §9）
87. **C87** 给定组织成员、项目属于本组织、已存在项目成员关系；当 `DELETE …/memberships {userId}`；则 `200`、`body.message==="Project membership removed"`、`body.userId===userId`，库中该行消失。— 同上 › `DELETE` › `it("should delete an existing project membership with valid API key")`
88. **C88** 给定没有该项目成员关系；当 DELETE；则 `404`，error 含 `"Project membership not found"`。— 同上 › `it("should return 404 when project membership does not exist")`
89. **C89** 给定一行 `project_memberships` 的 `orgMembershipId` 指向另一组织成员关系；当 DELETE；则 `403 {error:"Project membership does not belong to this organization"}`，行仍在。— `new`
90. **C90** 给定缺少 `userId`；当 DELETE；则 `400`，error 含 `"Invalid request body"`。— `new`
91. **C91** 给定一次成功的 PUT；当检查 `audit_logs`；则项目成员关系操作**不产生** `audit_logs` 行。— `new`

### 7.10 路由顺序与横切（C92–C97）

92. **C92** 给定无鉴权头；当 `PATCH /api/public/projects/{projectId}/memberships`；则 `405`（方法判定先于认证），error 含 `"Allowed methods: GET, PUT, DELETE"`。— `new`
93. **C93** ~~给定无 `projectId` 段（或重复 query 参数成数组）；当访问项目成员关系路由；则 `400 {error:"projectId is required"}`。~~ **此用例在 HTTP 层不可达，不可断言**：空动态段会被 Next 以 `308` 重定向，而重复的 `?projectId=` query 参数不会以数组形式出现（动态路由参数优先），均已实测。该分支在实际路由中保留原样即可，但不要为它写断言。— **修订**（特征测试阶段实测证伪）
94. **C94** 给定组织级 key；当 `PATCH /api/public/organizations/memberships`；则 `405`，error 含 `"Allowed methods: GET, PUT, DELETE"`。— `new`
95. **C95** 给定云区域构建下 plan 为 `cloud:developer`（无 `admin-api`）的组织 key；当 `GET /api/public/organizations/apiKeys`；则 `403 {error:"This feature is not available on your current plan."}`。— `new`
96. **C96** 给定有效组织 key；当发送 CORS 预检 `OPTIONS`（带 `Origin` 与 `Access-Control-Request-Method`）；则得到预检成功响应且带 `Access-Control-Allow-Origin`，**不**需要认证。— `new`；确切状态码与响应头集合需先在当前实现上实测记录，再固化为断言（见 §9 第 16 条）
97. **C97** 给定组织级 key；当 `GET /api/public/organizations/projects`；则 `200 {projects:[…]}`，只含本组织未删除项目，`metadata` 可为 `null`。— `organizations-api.servertest.ts` › `Public Organizations API` › `Organization Projects` › `it("should get all organization projects with valid API key")`、› `it("should not return soft-deleted projects")`、› `it("should only return projects belonging to the organization")`、› `it("should handle projects with null metadata")`、› `it("should handle organization with no projects")`

**统计：97 条**（其中既有测试已覆盖 51 条，`new` 45 条；C39/C80/C93 三条经特征测试阶段实测判定**不可断言**，见 §7.12）。映射到的既有测试文件：`memberships-api.servertest.ts`（18 条全部映射）、`projects-api.servertest.ts`（`GET|POST|DELETE /api/public/projects/[projectId]/apiKeys` 三个 describe 共 20 条全部映射）、`organizations-api.servertest.ts`（`/api/admin/organizations/[organizationId]/apiKeys[/*]`、`GET /api/public/organizations/apiKeys`、`GET /api/public/organizations/projects` 的用例）。`admin-api-key-auth.servertest.ts` 与 `organizations-api-key-trpc.servertest.ts` **未映射任何用例**（原因见 §9 第 24、25 条）。

### 7.11 变异检查（证明测试有牙齿，实施时执行）

至少覆盖以下变异，每种只应让对应用例失败：

| 变异 | 预期失败用例 |
| --- | --- |
| `allowMethods` 移到 `requireAdminApi` 之后（或反之） | C19、C46、C92 |
| `listOrgApiKeys` / `listProjectApiKeys` 去掉 `orderBy` 或改降序 | C14 |
| 列表改用 `include` 而非 `select`（泄漏 `secretKey`/`hashedSecretKey`） | C12、C47 |
| `deleteProjectMembership` 去掉归属检查（403 分支） | C89 |
| `deleteOrgMembership` 少了 last-OWNER 计数条件 | C72 |
| `upsertOrgMembership` 把 last-OWNER 检查移到用户存在性之前 | C66 |
| `createProjectApiKey` 把前缀校验放到 `createAndAddApiKeysToDb` 之后 | C34、C35 |
| ~~项目成员关系路由去掉 `rbac-project-roles` 门控~~ | **无法检测**：该门控不可达（见 C80 修订），去掉它不会让任何用例失败。不要把它当作有牙齿的变异 |
| `createProjectApiKey.isDuplicateKeyFailure` 认不出 P2002/`unique constraint` | C37（新文件）+ `projects-api` › `it("should return 409 when predefined publicKey already exists")` —— **已实测** |
| `upsertOrgMembership` 的 last-OWNER 计数条件改坏（如 `otherOwners === 0` → `=== -1`） | `memberships-api` › `it("should return 403 when demoting the last owner of the organization")` —— **已实测**；同时确认 `deleteOrgMembership` 的同类用例**仍绿**（两者在不同文件，测试能区分） |

### 7.12 规格修订（由特征测试阶段回填，2026-10-15）

写测试时以**原实现的实测行为**为准，发现规格有 4 处与事实不符。凡冲突，**以实现的行为为准**（本批次的契约是"保留现状"）：

| # | 位置 | 原文 | 实际（已实测） | 处理 |
| --- | --- | --- | --- | --- |
| 1 | C39 | 空 body 的 POST → `400` | **`201` 且真的建了一把 key**（Next 把无 body 解析为 `{}`，schema 字段全可选） | 已改正文；该用例不写断言（既不能断 400，也不宜把 201 固化成"规格"） |
| 2 | C38 | `details` 为 zod `issues` **数组** | `details` 是 `error.format()` 的**对象** | 已改正文；测试只钉 `400` + `message` + `details` 存在，**不钉**数组/对象 |
| 3 | C80 | plan `oss` → `403 "Your plan does not include project role management."` | **不可达**：`requireAdminApi` 先拒绝无 `admin-api` 的 plan，而 `admin-api` 只由 `cloud:pro`/`self-hosted:enterprise` 授予，两者同时含 `rbac-project-roles` | 已标注不可断言；**实现仍须保留该门控**，只是没有断言 |
| 4 | C93 | 缺 `projectId` → `400 "projectId is required"` | **HTTP 层不可达**：空动态段被 `308` 重定向；重复 query 参数不会成为数组 | 已标注不可断言 |

另：`new` 计数由 46 更正为 45（原文算错 1 条）。

> 修订由测试作者在写特征测试时发现并披露；主控已独立复核（变异测试与复跑见 `verification.md`）。**实现者请以本节的"实际"列与已改正的正文为准。**

---

## 8. 文件清单（行数）

| 文件 | 行数 |
| --- | --- |
| `web/src/features/enterprise/http.ts` | 45 |
| `web/src/features/enterprise/apiKeys/createOrgApiKey.ts` | 48 |
| `web/src/features/enterprise/apiKeys/deleteOrgApiKey.ts` | 53 |
| `web/src/features/enterprise/apiKeys/listOrgApiKeys.ts` | 27 |
| `web/src/features/enterprise/apiKeys/createProjectApiKey.ts` | 110 |
| `web/src/features/enterprise/apiKeys/deleteProjectApiKey.ts` | 57 |
| `web/src/features/enterprise/apiKeys/listProjectApiKeys.ts` | 27 |
| `web/src/features/enterprise/memberships/listOrgMemberships.ts` | 30 |
| `web/src/features/enterprise/memberships/deleteOrgMembership.ts` | 52 |
| `web/src/features/enterprise/memberships/listProjectMemberships.ts` | 32 |
| `web/src/features/enterprise/memberships/deleteProjectMembership.ts` | 56 |
| `web/src/features/enterprise/memberships/upsertOrgMembership.ts` | 70 |
| `web/src/features/enterprise/memberships/upsertProjectMembership.ts` | 64 |
| `web/src/pages/api/public/organizations/apiKeys/index.ts` | 28 |
| `web/src/pages/api/public/organizations/memberships/index.ts` | 32 |
| `web/src/pages/api/public/organizations/projects/index.ts` | 28 |
| `web/src/pages/api/public/projects/[projectId]/apiKeys/index.ts` | 45 |
| `web/src/pages/api/public/projects/[projectId]/apiKeys/[apiKeyId].ts` | 48 |
| `web/src/pages/api/public/projects/[projectId]/memberships/index.ts` | 63 |
| **合计** | **915** |

数据库对象（本批次触及）：

| 表 | 操作 |
| --- | --- |
| `api_keys` | 读（按 `id`/`orgId`/`projectId`/`scope`）、写（create / delete）、列表（`select` 7 列 + `orderBy created_at asc`） |
| `organization_memberships` | 读（`orgId_userId` 唯一键、`count`）、写（`upsert` / `deleteMany`）；级联删除 `project_memberships` |
| `project_memberships` | 读（`projectId_userId` 主键、关联 `organization_memberships.orgId`）、写（`upsert` / `delete`） |
| `users` | 读（`id` → `email`/`name`） |
| `projects` | 读（路由层归属校验：`id` + `orgId` + `deletedAt IS NULL`） |
| `audit_logs` | 写（仅 API key 的 create / delete；成员关系不写） |

**无事务**：本批次任何操作都不使用 `prisma.$transaction`；写库与写审计日志是两次独立提交。

---

## 9. 待解问题（Open questions）

以下行为按"现状即契约"保留；实现者必须复现，但项目组应知悉其可疑之处。凡无法从可读代码确定者，已明确标注。

1. **`try { return <Promise> } catch` 兜不住异步异常。** 6 个路由包装器都用 `try { return routeByMethod(...) } catch { … 500 … }`。`routeByMethod` 内部同步调用 async handler 并**返回**其 Promise，没有 `await`，因此该 Promise 的 rejection 不会进入 `catch`，`logger.error` 与 `500 {error|message:"Internal server error"}` 分支在数据库异常时**可能永不执行**。Next.js 对"handler 返回 rejected promise"的最终状态（状态码与响应体）**无法从本仓库静态确定**，需实测确认后再写断言。未在本规格中冻结为可断言行为。
2. **`deleteApiKey` 的 `500 "The API key could not be removed."` 实际不可达。** 该助手用 `findFirstOrThrow`，找不到会抛异常而不是返回 falsy，因此 `if (!apiKey) return false` 与两个调用方里的 500 分支都是死代码。并发删除（先 404 预检通过、再被别人删掉）会让 `findFirstOrThrow` 抛出 `P2025`，走的是未捕获的 rejection 路径（见第 1 条），不是 500 JSON。
3. **预检与删除不是原子的。** `findUnique` 预检与 `ApiAuthService.deleteApiKey` 之间存在竞态窗口。
4. **`fastHashedSecretKey` 唯一性推导出"同一 secretKey 不能建两把 key"。** 两个不同 `publicKey` 配同一 `secretKey` 会命中 `409 already in use`，尽管它们本是不同的 key。此行为没有任何测试，属实现推导（`fast_hashed_secret_key` 唯一约束 + 该字段只由 `secretKey` 决定）。
5. **审计日志与业务写入不同事务。** 业务写入先提交，`auditLog` 后执行；`auditLog` 失败时数据已生效但响应可能是 500（取决于第 1 条）。本规格不引入事务。
6. **`upsertProjectMembership` 的 `update` 不修 `orgMembershipId`。** 已存在的 `(projectId,userId)` 行若因外部原因（如用户先属于 B 组织、后加入 A 组织）携带了另一组织的 `orgMembershipId`，PUT 只改 `role`：该行随后在 `listProjectMemberships`（按 `organizationMembership.orgId` 过滤）中**不可见**，但 `deleteProjectMembership` 会返回 403。数据层没有约束阻止这种不一致。是否属于 bug、要不要在净室实现中修正为"顺带对齐 `orgMembershipId`"，需要产品决策——**本规格要求先原样复现**。
7. **`deleteProjectMembership` 的 403 分支无法用常规流程触发。** 需要先人工构造不一致行（见第 6 条）；C89 的设计即为如此。
8. **列表接口没有稳定排序。** `listOrgMemberships`、`listProjectMemberships`、`listProjects`（E.3 依赖）都没有 `orderBy`；测试不得断言其顺序。`listOrgApiKeys`/`listProjectApiKeys` 有 `createdAt asc`。
9. **`email` 可空但测试契约假定了非空。** `users.email` 是 `String?`，而 `listOrgMemberships`/`upsertOrgMembership`/`upsertProjectMembership` 直接返回 `user.email`；现有测试的 zod schema 用 `z.string().email()`，对无邮箱用户会失败。是"应当过滤/占位"还是"合同上假定非空"，无法从代码确定。
10. **成员关系操作完全没有审计日志。** 与 UI 侧（`membersRouter`）语义是否一致、是否算遗漏，无法从本批次文件确定。
11. **`createOrgApiKey` 缺少错误映射。** 它没有自己的 `try/catch`，也没有重复 key / 组织不存在的专门响应，错误全部交给调用方（实例管理路由的 `try/catch`，同样受第 1 条影响）。
12. **`409` 的判定偏宽。** `P2002` 或消息含 `unique constraint` 都会被映射为 `"That publicKey or secretKey is already in use by another API key."`，因此其它唯一约束（如 `hashed_secret_key`）也会给出这句文案。
13. **权益门控不对称。** 组织成员关系只需 `admin-api`；项目成员关系额外需要 `rbac-project-roles`。项目 API key 路由只要 `admin-api`。是否为有意设计无法从代码判定。
14. **组织级路由的方法判定在认证之后**（`routeByMethod`），项目级路由在认证之前（`allowMethods`）。因此"未认证 + 不支持的方法"在两类路由上分别得到 401 与 405。C19/C46/C92 固化这一差异。
15. **`405` 的允许方法列表来自对象键顺序**（`routeByMethod`）或数组顺序（`allowMethods`）；两者都必须按本规格列出的顺序输出。
16. **CORS 行为依赖第三方 `cors` 包默认值。** `OPTIONS` 预检被中间件直接应答这一点未在仓库内有测试；本规格只要求"预检在认证之前、不返回 401/403"。
17. **`deleteOrgMembership` 没有 404。** 目标不存在时仍返回 200；且不校验 `userId` 是否对应真实用户。与前端的删除语义是否一致无法确定。
18. **last-OWNER 保护不是原子的**：第 C.2 第 3 步 / C.3 第 2 步的计数与写入之间没有事务或锁，并发下仍可能出现零 OWNER。
19. **项目级没有 last-OWNER / 角色层级保护**：可以把任意组织成员设为项目 `OWNER`，也可以删除项目里唯一的 `OWNER` 成员关系。是否为有意（项目不需要 owner）无法确定。
20. **`createAndAddApiKeysToDb` 未校验 `entityId` 存在**；组织/项目不存在时靠外键报错，最终呈现为 500（或未捕获 rejection），而不是 404。
21. **`createOrgApiKey` 与 `deleteOrgApiKey`、`listOrgApiKeys` 的"actor"是字面量 `"admin-api"`**，写入 `audit_logs.api_key_id`。它不是真实 key id，任何按 `api_key_id` 关联 `api_keys` 的读取都会落空。
22. **`req` 参数在多个函数里未被使用**（列表函数、删除函数）；属签名兼容需要，不是行为。
23. **`note` 没有长度/空串规范化**：`""` 会被存为空串，`undefined` 存为 `NULL`，两者在列表响应里表现不同。
24. **`organizations-api-key-trpc.servertest.ts` 不覆盖本批次任何文件。** 它测的是 `web/src/features/public-api/server/organizationApiKeyRouter.ts`——一个 MIT 的、语义平行的 tRPC 路由器（含同样风格的 last-OWNER 保护）。它可以作为行为参照，但**不能**作为本批次的验收证据，改动本批次文件不会让它变红。
25. **`admin-api-key-auth.servertest.ts` 与本批次无关。** 它测的是另一套机制（环境变量 `ADMIN_API_KEY` 的 Bearer + `x-langfuse-admin-api-key` 头，`createAuthedProjectAPIRoute.verifyAuth`），既不是组织级 admin API key，也不经过 `requireAdminApi`/`requireAdminApiScope`。同理，`projects-api.servertest.ts` 中的 `PUT/DELETE /api/public/projects/[projectId]`、`POST /api/public/projects` 用例属于别的批次模块。
26. **`projects-api.servertest.ts` 的创建响应 schema 把 `expiresAt` 标为 `.optional()`**，而实现从不返回它；不要因此给响应补上 `expiresAt`。
27. **无法从可读代码确定的部分**：Next.js 对未捕获 rejection 的响应形状（第 1 条）；生产环境下 `auditLog` 失败后的可观测结果；`cors` 预检的确切响应头集合。
