# 行为规格：organizations-and-projects（批次 2，14 个文件）

- 状态：待实现
- 批次：2
- **角色（净室命名约定见 `../README.md`）**：本规格由 **Select DB** 撰写（该方已阅原实现，负责规格、测试与门禁）；实现方为 **Zhang Mo**（未接触原实现，仅依据本规格与验收测试编码）
- 目标文件：
  - 组织业务函数（`web/src/features/enterprise/organizations/`）
    - `listOrganizations.ts`、`getOrganization.ts`、`createOrganization.ts`、`updateOrganization.ts`、`deleteOrganization.ts`
  - 项目业务函数（`web/src/features/enterprise/projects/`）
    - `listProjects.ts`、`createProject.ts`、`updateProject.ts`、`deleteProject.ts`
  - 路由包装器
    - `web/src/pages/api/admin/organizations/index.ts`
    - `web/src/pages/api/admin/organizations/[organizationId]/index.ts`
    - `web/src/pages/api/admin/organizations/[organizationId]/apiKeys/index.ts`
    - `web/src/pages/api/admin/organizations/[organizationId]/apiKeys/[apiKeyId].ts`
    - `web/src/pages/api/public/projects/[projectId]/index.ts`
- 仅作参照、**禁止修改/禁止重许可**（ANNEX B，MIT）：
  - `web/src/pages/api/public/projects/index.ts`
  - `web/src/features/public-api/server/adminApiGuard.ts`
- 规格作者：主控会话（可读原实现）
- 实现者：**只依据本规格**，不得接触上述 14 个文件的原实现及其 git 历史
- 验收测试（已存在，勿修改）：
  - `web/src/__tests__/server/organizations-api.servertest.ts`（44 条 `it`）
  - `web/src/__tests__/server/projects-api.servertest.ts`（49 条 `it`）
  - `web/src/__tests__/server/admin-api-key-auth.servertest.ts`（14 条，覆盖的是另一套 admin 认证实现，见 §E.3）

---

## 0. 契约边界

| 冻结（必须完全一致） | 自由（可自行拟定） |
| --- | --- |
| HTTP 路由、允许的方法集合、每个分支的 **HTTP 状态码** 与 **JSON 响应体键名**（`error` / `message` / `details` / `success` / 业务字段） | 文件内部结构、私有辅助函数的名字与拆分方式、注释、日志文本（`logger.*` 的措辞不属契约）、变量命名 |
| **全部面向 API 调用方的错误字符串**（逐字符一致，见各节）；校验通过/失败的判定规则；校验、鉴权、权益检查、存在性检查的**先后顺序** | 内部实现风格（是否用 zod、map/循环写法、是否抽 helper） |
| 导出的函数名、参数个数与顺序、返回/响应投影 | 未在响应中出现的字段的内部处理方式 |
| 数据库表名、列名、过滤条件、事务边界、默认行、审计日志、队列/缓存副作用 | 实现中使用的 Prisma 调用形式（`create` vs `createMany` 等），只要可观察结果一致 |
| 与 MIT 边界的相互作用：`/api/public/projects/index.ts` 与 `adminApiGuard.ts` **不得改动**；POST 分支先过 guard 再动态 `import()` 目标实现 | — |

**i18n**：本批次全部是服务端 API 模块，**没有任何面向浏览器 UI 的文案**；上述错误字符串是 HTTP 协议的一部分，**不是 i18n key**，**不得**加入 `web/src/features/i18n/locales/en.json` / `zh-CN.json`，也**不得**改成 `t(...)`。本批次对 locale 文件应**零改动**（`pnpm run i18n:check` 保持通过）。

---

## A. 共同约定

### A.1 请求体解析

- 所有 `POST` / `PUT` 走 Next.js API route 的默认 JSON body 解析（`req.body` 为对象）。若请求 `Content-Type` 非 JSON 导致 `req.body` 为字符串/`undefined`，行为未定义；验收测试均发送 JSON，不覆盖该情形。
- 日期字段（`createdAt`、`updatedAt`、`deletedAt`）在 TypeScript 侧是 `Date`，经 `res.json` 序列化后是 ISO-8601 字符串。

### A.2 方法派发（`web/src/features/enterprise/http.ts`）

该模块属 ANNEX A 但**不在本批次文件清单内**（见 §J 开放问题）。路由包装器依赖它，语义如下：

- `allowMethods(req, res, allowed: readonly string[]): boolean`：`req.method` 在 `allowed` 中返回 `true`；否则写 **405** 且响应体为
  `{"error": "Method not allowed. Allowed methods: <allowed.join(\", \")>"}`，返回 `false`。
- `routeByMethod(req, res, handlers: Record<string, (req, res) => unknown>): unknown`：以 `req.method` 取 handler；
  存在则调用并返回其结果；不存在则写 **405**，响应体同上，其中允许列表 = **handlers 对象的键按插入顺序**用 `", "` 连接。
- 注意：两处 405 的 body 键是 `error`，而 §E.1 的社区路由 405 用的是 `message`。

### A.3 实例管理员守卫 `requireInstanceAdmin`（EE）

签名 `requireInstanceAdmin(req: NextApiRequest, res: NextApiResponse): boolean`（**同步**）。按顺序：

1. `AdminApiAuthService.handleAdminAuth(req, res)`（`web/src/server/adminApiAuth.ts`，非本批次）：
   - 无 `authorization` 头 → **401** `{"error": "Unauthorized: authorization header is missing"}`
   - `env.NEXT_PUBLIC_LITEFUSE_CLOUD_REGION` 已设置且 ≠ `"DEV"`（云部署）→ **403** `{"error": "Not accessible on Litefuse Cloud"}`
   - `env.ADMIN_API_KEY` 未配置 → **403** `{"error": "ADMIN_API_KEY is not set"}`
   - `authorization` 形如 `Bearer <token>` 且 `<token>` 与 `ADMIN_API_KEY` 常量时间相等才通过；否则 **401** `{"error": "Unauthorized: Invalid token"}`
2. 用 `process.env.LITEFUSE_EE_LICENSE_KEY` 解析实例 plan（`resolveSelfHostedPlan`：`litefuse_ee_` 前缀 → `self-hosted:enterprise`，否则 `null`），再检查 `admin-api` 权益；不通过 → **403** `{"error": "This feature is not available on your current plan."}`

守卫自身写响应并返回 `false`（调用方直接 `return`）；通过返回 `true`，不写响应。

### A.4 组织管理员 API 守卫 `requireAdminApi`（EE）

签名 `requireAdminApi(req, res): Promise<ApiAccessScope | null>`，等价于 MIT 的 `requireAdminApiScope`（§E.2），三检查按序：

1. `ApiAuthService.verifyAuthHeaderAndReturnScope(req.headers.authorization)`；`validKey === false` → **401** `{"error": <auth.error>}`（典型值 `"Invalid credentials"`、`"No authorization header"`）
2. `scope.accessLevel !== "organization" || !scope.orgId` → **403** `{"error": "Invalid API key. Organization-scoped API key required for this operation."}`
3. plan 不含 `admin-api` 权益 → **403** `{"error": "This feature is not available on your current plan."}`

成功返回 `scope`（含 `orgId`、`plan`、`apiKeyId`、`projectId`（组织键为 `null`）、`accessLevel`、`publicKey` 等）；失败已写响应并返回 `null`。

### A.5 审计日志 `auditLog`（依赖，非本批次）

`auditLog(log, prisma?)` 向 `audit_logs` 表插入一行。本批次使用 API-key 形态：`{ apiKeyId, orgId, resourceType, resourceId, action, before?, after? }` → 写入 `type = API_KEY`、`apiKeyId`、`orgId`、`projectId = null`、`userId = null`、`resourceType`、`resourceId`、`action`，以及 `before`/`after`（仅在原值为 truthy 时写入，值为 `JSON.stringify(...)` 的字符串）。**`audit_logs.org_id` 没有外键约束**，因此为已删除的组织写审计行不会失败。

---

## B. 组织模块

所有函数签名（**必须在实现中原样保留**）：

```ts
listOrganizations(req: NextApiRequest, res: NextApiResponse): Promise<...>
getOrganization(req: NextApiRequest, res: NextApiResponse, organizationId: string): Promise<...>
createOrganization(req: NextApiRequest, res: NextApiResponse): Promise<...>
updateOrganization(req: NextApiRequest, res: NextApiResponse, organizationId: string): Promise<...>
deleteOrganization(req: NextApiRequest, res: NextApiResponse, organizationId: string): Promise<...>
```

组织对象（响应中出现的字段集固定，**无 `updatedAt`、无 `cloudConfig`**）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | |
| `name` | string | |
| `createdAt` | ISO 字符串 | |
| `metadata` | object | DB 为 `null` 时返回 `{}`；否则原样返回 |
| `projects` | array | 每个元素 `{id, name, metadata, createdAt, updatedAt}`；`metadata` 可为 `null`（**不**默认成 `{}`）；只含 `deletedAt = null` 的项目 |

### B.1 listOrganizations

- 用途：列出实例内**所有**组织（`GET /api/admin/organizations`，实例管理员）。
- 行为：无入参校验、无分页、无排序、无 `where`（组织没有软删除）。读取 `organizations` 表上述字段 + 关联项目。响应 **200**：

  ```json
  { "organizations": [ <组织对象>, ... ] }
  ```

  每个组织的 `metadata` 做 `?? {}` 归一，`projects` 过滤 `deleted_at IS NULL`（无 `orderBy`）。
- 数据库：单次 `organization.findMany`（select `id,name,createdAt,metadata` + `projects` 子查询 select `id,name,metadata,createdAt,updatedAt`、`where deletedAt null`）。只读。
- 副作用：无审计、无写、无缓存/外部调用。
- 文案：无用户可改文案；错误仅在守卫层产生。

### B.2 getOrganization

- 用途：按 id 取单个组织（`GET /api/admin/organizations/{id}`，实例管理员）。
- 行为：按 id `findUnique`，select 同 §B.1（含 live 项目）。
  - 不存在 → **404** `{"error": "Organization not found"}`
  - 存在 → **200**，body 为单个**组织对象**（把 §B.1 的字段直接摊平在顶层，`metadata` 做 `?? {}`）。
- 数据库：一次 `organization.findUnique`（`where {id}`），只读，无排序/分页。
- 副作用：无。

### B.3 createOrganization

- 用途：新建组织（`POST /api/admin/organizations`，实例管理员）。
- 校验/行为顺序：
  1. `organizationNameSchema.safeParse(req.body)`（zod）。失败 → **400** `{"error": "Invalid request body", "details": <zod error.format() 对象>}`。
     - 校验规则：`name` 必填、必须是字符串、长度为 3..60、且**不含 HTML 标签**（匹配 `<[^>]*>` 即失败）；未知字段被忽略（非 strict）。
  2. 读取可选 `metadata`：
     - 缺失（`undefined`）→ 通过，值为 `undefined`；
     - 字符串 → `JSON.parse`；解析失败 → **400** `{"error": "Invalid metadata. Should be a valid JSON object: <解析异常文本>"}`；
     - 解析/原始值必须是**非 null、非数组的 object**，否则 → **400** `{"error": "Invalid metadata. Should be a valid JSON object."}`；
     - 通过 → 作为 JSON 值写库。
  3. 写库、审计、日志、响应。
- 数据库写：`organizations` 插入一行（`id` 由 DB 生成 `cuid`，`name`，`metadata`（`undefined` 时落库为 `NULL`））；`created_at`/`updated_at` 自动。**无**默认成员、角色、score config 或其他伴随行。
- 副作用：
  - 审计行：`type=API_KEY`、`apiKeyId="admin-api"`、`orgId = 新组织 id`、`projectId=NULL`、`resourceType="organization"`、`resourceId = 新组织 id`、`action="create"`、`after = JSON.stringify(<select 后的组织对象，含空的 projects 数组>)`。写入失败会让整个请求失败（异常冒泡到路由 → 500）。
  - 日志一条（措辞自由）。
- 响应 **201**：单个组织对象；`projects` 必为 `[]`。
- 文案：无 i18n；错误串见上，逐字符固定。

### B.4 updateOrganization

- 用途：整体更新组织的 `name` 与可选 `metadata`（`PUT /api/admin/organizations/{id}`，实例管理员）。
- 校验/行为顺序（顺序即用户可见结果）：
  1. `organizationNameSchema.safeParse(req.body)` 失败 → **400** `{"error": "Invalid request body", "details": <zod format>}`（规则同 §B.3）。
  2. `metadata` 处理与 §B.3 完全相同的三条规则与两条错误串。
  3. `organization.findUnique({where:{id}})` 不存在 → **404** `{"error": "Organization not found"}`。
     - 注意：存在性检查在两步校验**之后**，所以对不存在的组织发无效 body 得到 400 而非 404。
  4. `organization.update({where:{id}, data:{name, metadata}})`。
- 数据库写：更新 `name`；`metadata` 在 `undefined` 时**不修改**（Prisma 语义：`undefined` 跳过该列），在给出合法对象时整体替换。无法通过本接口把 `metadata` 清成 `NULL`（`null` 会被第 2 步拒绝为 400）。`updated_at` 自动刷新。写入不存在的行不会发生（已提前 404）。
- 副作用：**不写审计日志**（与 create/delete 不同；这是现状，见 §J）。仅有日志一条。
- 响应 **200**：单个组织对象（`projects` 为该组织当前 live 项目）。

### B.5 deleteOrganization

- 用途：硬删除组织（`DELETE /api/admin/organizations/{id}`，实例管理员）。
- 行为顺序：
  1. `organization.findUnique({where:{id}})` 不存在 → **404** `{"error": "Organization not found"}`。
  2. 并行统计：live 项目数（`org_id = id AND deleted_at IS NULL`）与全部项目数（`org_id = id`）。
     - `liveProjectCount > 0` → **400**
       `{"error": "Organization cannot be deleted while it still has projects", "message": "Please delete or transfer all projects before deleting the organization."}`
     - 否则若 `projectCount > 0`（只剩软删除/异步删除中的项目）→ **400**
       `{"error": "Organization cannot be deleted while it still has projects", "message": "Deletion of your projects is still being processed, please try deleting the organization later"}`
  3. 取消计费订阅：`cancelSubscriptionImmediatelyForOrganization(id)`。若 `STRIPE_SECRET_KEY` 未配置，直接返回；否则读取该组织 `cloudConfig.stripe.activeSubscriptionId`，存在则调用 Stripe 立即取消。**Stripe 抛错会中止删除**（异常冒泡 → 路由 500，组织保留）。
  4. `organization.delete({where:{id}})` — **硬删除**。`projects` / `api_keys` 等通过 `onDelete: Cascade` 级联删除（`Project.organization` 是 `onDelete: Cascade`）。此刻组织已无任何项目（含软删除的），所以级联通常无对象。
  5. `new ApiAuthService(prisma, redis).invalidateCachedOrgApiKeys(id)` — 清除 Redis 中该组织的 API key 缓存。
  6. 审计行：`type=API_KEY`、`apiKeyId="admin-api"`、`orgId = 被删组织 id`（此时行已不存在；`audit_logs` 无外键，写入成功）、`resourceType="organization"`、`resourceId = 被删 id`、`action="delete"`、`before = JSON.stringify(<delete 返回的完整组织行>)`。
  7. 日志一条。
- 响应 **200** `{"success": true}`。
- 幂等性：非幂等。第二次 DELETE 因第 1 步得到 404。
- 文案：三条错误串逐字符固定（两个 400 共用同一 `error`，靠 `message` 区分原因）。

---

## C. 项目模块

签名（**必须原样保留**）：

```ts
listProjects(req: NextApiRequest, res: NextApiResponse, orgId: string): Promise<...>
createProject(req: NextApiRequest, res: NextApiResponse, scope: ApiAccessScope): Promise<...>
updateProject(req: NextApiRequest, res: NextApiResponse, projectId: string, scope: ApiAccessScope): Promise<...>
deleteProject(req: NextApiRequest, res: NextApiResponse, projectId: string, scope: ApiAccessScope): Promise<...>
```

`ApiAccessScope` = `{ projectId: string | null; accessLevel: "organization" | "project" | "scores"; orgId: string; plan: Plan; rateLimitOverrides; apiKeyId: string; publicKey: string; isIngestionSuspended }`。本批次只使用 `scope.orgId`、`scope.plan`、`scope.apiKeyId`。

### C.1 listProjects

- 用途：列出某组织的 live 项目（`GET /api/public/organizations/projects`，组织管理员键）。
- 行为：`project.findMany({ where: { orgId, deletedAt: null }, select: {id,name,metadata,createdAt,updatedAt} })`；无排序、无分页、无 limit。
- 响应 **200**：`{"projects": [{"id","name","metadata","createdAt","updatedAt"}, ...]}`。
  `metadata` **原样**返回，DB 为 `null` 时响应也是 `null`（**不**归一成 `{}`，与组织的 `metadata` 处理不同）。
- 副作用：无。

### C.2 createProject

- 用途：新建项目（`POST /api/public/projects`，组织管理员键）。
- 整个函数体包在 `try/catch` 中：**任何未在下面显式处理而抛出的异常** → `logger.error` + **500** `{"message": "Internal server error"}`。
- 校验/行为顺序：
  1. 从 body 取 `name`、`retention`、`metadata`。
  2. `projectNameSchema.safeParse({name})` 失败 → **400** `{"message": "Invalid project name. Use 3 to 60 characters."}`
     （规则：字符串、3..60、不含 HTML 标签。非字符串/缺失同样落到此 400。）
  3. `metadata` 归一（`undefined` → 视为缺失）：
     - 字符串 → `JSON.parse`；失败 → **400** `{"message": "Metadata is not decodable JSON: <异常文本>"}`
     - 解析后/原始值必须是**非 null、非数组的 object**，否则 → **400** `{"message": "Metadata must be a JSON object."}`
     - 缺失 → 不写该列（落库 `NULL`）；对象 → 原样写库（含 `{}`）。
  4. 仅当 `retention !== undefined`：
     - `projectRetentionSchema.safeParse({retention})`：把值 `coerce` 成 number、必须是整数、且 `=== 0 || >= 7`（`RETENTION_FLOOR_DAYS = 7`）。失败 → **400** `{"message": "Invalid retention value. Must be 0 or at least 7 days."}`
     - 若**原始** `retention > 0` 且 `scope.plan` 不含 `data-retention` 权益 → **403** `{"message": "A retention period above zero requires the data-retention entitlement."}`
     - 落库写的是**原始** `retention` 值（不是 coerce 后的值），见 §J。
  5. 重名检查：`project.findFirst({ where: { orgId: scope.orgId, name, deletedAt: null }, select: {id} })`。命中 → **409** `{"message": "Your organization already has a project with this name."}`
     - 软删除项目不参与，因此同名（已软删）可再次创建。
  6. 事务写入（单事务）：
     - `projects` 插入一行：`name`、`org_id = scope.orgId`、`retention_days = <原始 retention，缺失则 NULL>`、`metadata`。
     - `score_configs` 批量插入 **5 行默认配置**（`getDefaultScoreConfigsForProject(project.id)`）：`is_correct`（BOOLEAN，categories `[{label:"True",value:1},{label:"False",value:0}]`，description `"Whether the output is correct."`）、`accuracy`（NUMERIC，min 0 max 1，`"Accuracy score from 0 to 1."`）、`relevance`（NUMERIC 0..1，`"Relevance score from 0 to 1."`）、`helpfulness`（NUMERIC 0..1，`"Helpfulness score from 0 to 1."`）、`toxicity`（NUMERIC 0..1，`"Toxicity score from 0 to 1."`）；每行 `project_id = 新项目 id`。
  7. 事务提交后调用 `provisionSplitForNewProject(project.id)`（Doris 分表）：
     - 该函数先 `doris_project_table_split` **upsert** 控制行（`project_id`，`split=false`，`note=null`）；这一步失败会抛错。
     - 失败时实现会 `project.delete({where:{id}})`（错误被吞掉）后再抛出 → 外层 catch → **500**。即“分表登记失败 ⇒ 项目被回滚删除，调用方不会拿到没有分表的项目”。
     - 控制行写成功后的内联 DDL/超时回退（Redis 缓存失效广播、worker 队列入队）是**尽力而为**，不抛错；成功内联开工会把控制行更新为 `split=true, schema_version=<当前版本>`，超时或 Doris 异常则改为入队 worker 任务（幂等，`jobId = projectId`）。
- 响应 **201**：

  ```json
  { "id": "...", "name": "...", "metadata": <对象或 {}>, "retentionDays": <仅当真值时出现> }
  ```

  `metadata` 做 `?? {}` 归一；`retentionDays` 为 `0`/`null` 时**整个键缺失**。
- 副作用汇总：项目行、5 条 score config、1 条 Doris 控制行、可能的 Redis 失效广播与 Doris 队列任务。**没有审计日志**，**没有**创建者成员关系/角色，**没有**项目级 API key。
- 幂等性：非幂等（重名 409，但无 DB 唯一约束，见 §J）。

### C.3 updateProject

- 用途：更新项目的 `name`、可选 `metadata`、可选 `retention`（`PUT /api/public/projects/{id}`，组织管理员键）。
- 同样整函数 `try/catch`：未处理异常 → 日志 + **500** `{"message": "Internal server error"}`。
- 校验顺序与错误串和 §C.2 第 2–4 步**完全一致**（name → metadata → retention 合法性 → retention 权益）。
- 写入：`project.update({ where: { id: projectId, orgId: scope.orgId }, data: patch, select: {id,name,retentionDays,metadata} })`。
  - `patch` 总是包含 `name`；`retentionDays` 仅在 `retention !== undefined` 时包含（写原始值）；`metadata` 仅在给出合法对象时包含。
  - **未提供的字段保持原值**；`metadata` 无法被清空（`null` 会 400）；`retention: null` 会以 `null` 覆盖（见 §J）。
  - `where` 同时锁定 id 与 orgId：别的组织的项目匹配不到。此调用在“行不存在”时抛错 → 500；但路由包装器（§D.5）已先做过 404，因此正常 HTTP 路径不会走到这个 500。
- 副作用：
  - 仅当 `retention !== undefined` 时：`enqueueDorisSplitTableProvisioning(projectId)` 以重算分表 TTL（幂等，`jobId = projectId`）；**任何失败被吞掉并记日志**，不影响 200。控制行不存在时该调用是 no-op（worker 侧按 `Project.retentionDays` 读取）。
  - **不写审计日志**。
- 响应 **200**：

  ```json
  { "id": "...", "name": "...", "metadata": <对象或 {}>, "retentionDays": <仅当真值时出现> }
  ```

### C.4 deleteProject

- 用途：软删除项目并把数据清除交给 worker（`DELETE /api/public/projects/{id}`，组织管理员键）。
- 同样整函数 `try/catch`：未处理异常 → 日志 + **500** `{"message": "Internal server error"}`。
- 行为顺序（顺序有语义）：
  1. `new ApiAuthService(prisma, redis).invalidateCachedProjectApiKeys(projectId)` — 先清 Redis，否则旧项目键会继续可用。
  2. `apiKey.deleteMany({ where: { projectId, scope: "PROJECT" } })` — 只删项目级键；组织级键不动。
  3. `project.update({ where: { id: projectId, orgId: scope.orgId }, data: { deletedAt: new Date() } })` — **软删除**，`where` 锁 id+orgId。行不存在 → 抛错 → 500（正常路径下路由已 404）。
  4. 审计行：`type=API_KEY`、`apiKeyId = scope.apiKeyId`（即调用方那把组织键的 id）、`orgId = scope.orgId`、`projectId = projectId`、`resourceType="project"`、`resourceId = projectId`、`action="delete"`、`before = JSON.stringify(<update 返回的完整项目行>)`。
  5. `ProjectDeleteQueue.getInstance()`：
     - `null`（Redis 不可用）→ 记日志 `"Project delete queue is unavailable"` 并 **500** `{"message": "Internal server error"}`。**此时项目已软删、项目键已删、审计已写**（见 §J）。
     - 非 null → 入队 `QueueJobs.ProjectDelete`，job `{ timestamp: new Date(), id: randomUUID(), payload: { projectId, orgId: scope.orgId }, name: QueueJobs.ProjectDelete }`。
- 响应 **202**：`{"success": true, "message": "The project is queued for deletion and will be removed in the background."}`
- 幂等性：非幂等；重复 DELETE 因路由 404 而中止。若首次已软删，`deletedAt` 不再变化。

---

## D. 路由包装器

所有包装器把主体包在 `try/catch`；未捕获异常 → 记日志 + 500（body 见下）。`organizationId`/`projectId`/`apiKeyId` 来自 `req.query`，必须 `typeof === "string"` 才继续。

### D.1 `web/src/pages/api/admin/organizations/index.ts`

- 导出 `default async function handler(req, res)`。
- 顺序：`requireInstanceAdmin` →（通过后）`routeByMethod(req, res, { GET: listOrganizations, POST: createOrganization })`。
- 未鉴权时**先** 401/403（因此匿名 `PATCH` 返回 401，而非 405）。
- 方法不在 `{GET, POST}` → **405** `{"error": "Method not allowed. Allowed methods: GET, POST"}`。
- 包装器 catch → **500** `{"error": "Internal server error"}`。

### D.2 `web/src/pages/api/admin/organizations/[organizationId]/index.ts`

- 顺序：
  1. `req.query.organizationId` 非 string → **400** `{"error": "Invalid organization ID"}`（在鉴权**之前**）；
  2. `requireInstanceAdmin`；
  3. `routeByMethod(req, res, { GET: getOrganization, PUT: updateOrganization, DELETE: deleteOrganization })`。
- 405 允许列表为 `GET, PUT, DELETE`（插入顺序）。
- catch → **500** `{"error": "Internal server error"}`。

### D.3 `web/src/pages/api/admin/organizations/[organizationId]/apiKeys/index.ts`

- 顺序：参数 string 检查（400 `{"error": "Invalid organization ID"}`）→ `requireInstanceAdmin` → **组织存在性** `organization.findUnique({where:{id}, select:{id}})` 不存在 → **404** `{"error": "Organization not found"}` → `routeByMethod(req, res, { GET: listOrgApiKeys, POST: (req,res)=>createOrgApiKey(req,res,organizationId,"admin-api") })`。
  - 存在性检查在方法派发**之前**，所以不存在组织的 `PATCH` 得到 404 而非 405。
- 405：`{"error": "Method not allowed. Allowed methods: GET, POST"}`。
- catch → **500** `{"error": "Internal server error"}`。
- 被调用的 `listOrgApiKeys` / `createOrgApiKey`（`web/src/features/enterprise/apiKeys/**`，ANNEX A，**不在本批次清单**）契约见 §F.3；本批次只要求包装器以相同参数、相同顺序调用它们。

### D.4 `web/src/pages/api/admin/organizations/[organizationId]/apiKeys/[apiKeyId].ts`

- 顺序：`organizationId` 与 `apiKeyId` 均为 string，否则 **400** `{"error": "Invalid organization ID or API key ID"}` → `requireInstanceAdmin` → 组织存在性（**404** `{"error": "Organization not found"}`）→ `routeByMethod(req, res, { DELETE: (req,res)=>deleteOrgApiKey(req,res,organizationId,apiKeyId,"admin-api") })`。
- 其他方法（含 `GET`）→ **405** `{"error": "Method not allowed. Allowed methods: DELETE"}`。
- catch → **500** `{"error": "Internal server error"}`。

### D.5 `web/src/pages/api/public/projects/[projectId]/index.ts`

- 顺序（**必须一致**）：
  1. `await runMiddleware(req, res, cors)` — 标准 CORS 中间件（`origin: true`）；`OPTIONS` 由 cors 直接以 204 结束，不进后续分支。
  2. `req.query.projectId` 非 string → **400** `{"message": "Invalid project ID"}`。
  3. `allowMethods(req, res, ["PUT", "DELETE"])` — 否则 **405** `{"error": "Method not allowed. Allowed methods: PUT, DELETE"}`（**在鉴权之前**，因此未鉴权的 `GET`/`POST` 也得到 405）。
  4. `requireAdminApi(req, res)` → `null` 时 401/403（§A.4）。
  5. 项目存在/归属检查：`project.findFirst({ where: { id: projectId, orgId: scope.orgId, deletedAt: null } })`；未命中 → **404** `{"message": "Project not found or you don't have access to it"}`。
  6. `routeByMethod(req, res, { PUT: updateProject, DELETE: deleteProject })`（此时 `PUT`/`DELETE` 必定命中）。
- 包装器 catch → **500** `{"message": "Internal server error"}`。

---

## E. 社区边界（参照，**禁止修改**）

### E.1 `web/src/pages/api/public/projects/index.ts`（MIT，ANNEX B）

该文件**必须保持现状**，且是“社区路由到达企业实现”的唯一范例：

- `await runMiddleware(req, res, cors)`。
- 方法白名单**内联**：非 `GET`/`POST` → **405** `{"message": "Method not allowed"}`（注意键是 `message`，且**不含**允许列表——与 §A.2 不同）。
- `POST` 分支：先 `requireAdminApiScope(req, res)`（§E.2，MIT 守卫）；失败即返回（401/403），**不加载任何企业模块**；成功后才 `await import("@/src/features/enterprise/projects/createProject")` 并调用 `createProject(req, res, scope)`。
- `GET` 分支（社区 `auth_check`）：`ApiAuthService.verifyAuthHeaderAndReturnScope` → 无效键 **401** `{"message": <authCheck.error>}`；非项目级键 **403** `{"message": "Invalid API key. Are you using an organization key?"}`；成功则按 `scope.projectId` + `deletedAt: null` 查项目，响应 **200** `{"data": [{id, name, organization:{id,name}, metadata: metadata ?? {}, retentionDays?}]}`（`retentionDays` 仅在非 0/非 null 时出现）；异常 → **500** `{"message": "Internal server error"}`。
- 要点：`POST` 的鉴权/权益检查（401/403）**必须先于**动态 import 执行，这样未授权/无权益的请求不会加载 ANNEX A 代码。

### E.2 `web/src/features/public-api/server/adminApiGuard.ts`（MIT，ANNEX B）

`requireAdminApiScope(req, res): Promise<ApiAccessScope | null>`：401（`auth.error`）→ 403（`"Invalid API key. Organization-scoped API key required for this operation."`）→ 403（`"This feature is not available on your current plan."`），成功返回 `scope`。**不得修改**；EE 的 `requireAdminApi` 只是转发到它。

### E.3 与 `admin-api-key-auth.servertest.ts` 的关系

该测试文件覆盖的是 `createAuthedProjectAPIRoute.ts` 的 `verifyAuth(req, allowAdminApiKeyAuth)`，即另一套历史 admin 认证（`Bearer` + `x-langfuse-admin-api-key` + `x-langfuse-project-id` 头），**不是** `requireInstanceAdmin`（本规格的实例管理员守卫）。两者不可互相替代：`requireInstanceAdmin` 只接受单一 `Authorization: Bearer <ADMIN_API_KEY>`，不使用 `x-langfuse-*` 头。该测试文件对本批次的映射仅限“同类鉴权行为的旁证”（见 §H 的覆盖说明）。

---

## F. 本批次之外的依赖（签名固定，禁止在实现中改动其行为）

### F.1 校验 schema（MIT）

- `organizationNameSchema`（`web/src/features/organizations/utils/organizationNameSchema.ts`）：`z.object({ name: StringNoHTML.min(3).max(60) })`；`StringNoHTML` 拒绝含 `<...>` 的字符串。
- `projectNameSchema`（`web/src/features/auth/lib/projectNameSchema.ts`）：同上，作用于 `name`。
- `projectRetentionSchema`（`web/src/features/auth/lib/projectRetentionSchema.ts`）：`{ retention: z.coerce.number().int().refine(v => v === 0 || v >= RETENTION_FLOOR_DAYS) }`；`RETENTION_FLOOR_DAYS = 7`。
- `hasEntitlementBasedOnPlan({plan, entitlement})`：`plan` 为 `null` 或不含该权益 → `false`。

### F.2 服务器依赖

- `prisma`（`@langfuse/shared/src/db`）、`logger`、`redis`、`ApiAuthService`（`web/src/features/public-api/server/apiAuth.ts`，提供 `invalidateCachedOrgApiKeys` / `invalidateCachedProjectApiKeys` / `deleteApiKey`）。
- `cancelSubscriptionImmediatelyForOrganization(orgId)`（`web/src/features/billing/server/billingService.ts`）。
- `provisionSplitForNewProject(projectId)` / `enqueueDorisSplitTableProvisioning(projectId)`（`@langfuse/shared/src/server`）。
- `getDefaultScoreConfigsForProject(projectId)`、`RETENTION_FLOOR_DAYS`（`@langfuse/shared`）。
- `ProjectDeleteQueue`、`QueueJobs.ProjectDelete`（`@langfuse/shared/src/server`）。

### F.3 组织 API key 业务函数（ANNEX A，非本批次；仅作为被调方契约）

- `listOrgApiKeys(req, res, orgId)` → **200** `{"apiKeys": [...]}`，`api_keys` 中 `org_id = orgId AND scope = "ORGANIZATION"`，select `id, createdAt, expiresAt, lastUsedAt, note, publicKey, displaySecretKey`，`orderBy createdAt asc`。
- `createOrgApiKey(req, res, orgId, actorId)` → body 校验 `{note?: string}`，失败 **400** `{"error": "Invalid request body", "details": <zod format>}`；否则创建组织级键（响应为 `{id, createdAt, note, publicKey, secretKey, displaySecretKey}`）→ **201**；并写审计行（`apiKeyId=actorId`，`orgId`，`resourceType="apiKey"`，`resourceId=<新键 id>`，`action="create"`）。
- `deleteOrgApiKey(req, res, orgId, apiKeyId, actorId)`：查 `apiKey.findUnique({where:{id, orgId, scope:"ORGANIZATION"}})`，未命中 → **404** `{"error": "API key not found"}`；否则 `ApiAuthService.deleteApiKey`（含缓存失效），返回 `false` → **500** `{"error": "The API key could not be removed."}`；成功 → **200** `{"success": true}`，并写审计行（`action="delete"`，`resourceId=apiKeyId`）。
- 若本批次实现者被同时指派这些文件，须另行取得其规格；本批次只需保证调用参数与顺序不变。

---

## G. 文案与 i18n

- 本批次**没有**用户界面文案；所有可见字符串都是 HTTP 响应体（§B–§E 已逐条固定），**不是** i18n key。
- 因此：**不得**修改 `web/src/features/i18n/locales/en.json` 与 `web/src/features/i18n/locales/zh-CN.json`；**不得**把这些字符串包进 `t(...)`（服务端无 i18n 运行时）。
- `logger.*` 的措辞不属于契约，可自行拟定；但“日志中出现错误”这一事实应保留（便于排障）。

---

## H. 特征化测试计划

**形态**：全部为黑盒断言——HTTP 调用（`makeAPICall` / `makeZodVerifiedAPICall`，默认 Basic `pk-lf-1234567890:sk-lf-1234567890`，无 auth 时可显式传 `Bearer <ADMIN_API_KEY>`）、Prisma 直读 DB、以及（必要时）Redis/队列检查。测试将**先写并跑通在当前实现上**，再用于验收干净实现。

**既有测试与运行前提**（摘自测试文件头注释，验收时必须满足）：
- `organizations-api.servertest.ts` 的 “Admin Organizations API”：`ADMIN_API_KEY` 需同时存在于服务器进程与测试进程环境，且服务器需带 `LITEFUSE_EE_LICENSE_KEY=litefuse_ee_...`。
- 两个文件里的 organization 夹具用 `cloudConfig.plan = "Pro"`（云 region → `cloud:pro`；自托管+license → `self-hosted:enterprise`），两者都含 `admin-api` 与 `data-retention` 权益。
- `projects-api.servertest.ts` 的 POST 用例会在 `afterEach` 清理 `doris_project_table_split` 与新建项目。

### H.1 组织（§B）

| # | Given / When / Then | 覆盖 |
| --- | --- | --- |
| 1 | 存在含 `metadata={tier:"testing",users:5}` 的组织；GET `/api/admin/organizations`（Bearer admin）→ 200，`organizations` 非空且包含该组织，其 `metadata` 深等于该对象，且每项都有 `projects` 数组 | `organizations-api.servertest.ts` › `should get all organizations with valid admin authentication` |
| 2 | GET `/api/admin/organizations` 且某组织 `metadata=NULL` → 该项 `metadata` 为 `{}` | new |
| 3 | GET `/api/admin/organizations` 且组织有 1 个 live + 1 个软删项目 → 该项 `projects` 只含 live 项目 | new |
| 4 | 组织无项目；GET `/api/admin/organizations` → 该项 `projects` 为 `[]` | new |
| 5 | 不带 admin 头 GET `/api/admin/organizations` → 401 且 `body.error` 含 `"Unauthorized"` | `organizations-api.servertest.ts` › `should return 401 when no authorization header is provided` |
| 6 | `Bearer invalid-admin-key` GET `/api/admin/organizations` → 401 | new（POST 版本已覆盖） |
| 7 | PATCH `/api/admin/organizations`（Bearer admin）→ 405 且 `body.error` 含 `"Method not allowed"` | `organizations-api.servertest.ts` › `should return 405 for non-supported methods` |
| 8 | 存在带项目与 `metadata` 的组织；GET `/api/admin/organizations/{id}` → 200，`id` 相等、`metadata` 深等、`projects` 含该项目的 `{id,name,metadata,createdAt,updatedAt}` | `organizations-api.servertest.ts` › `should get a specific organization by ID` + `should return projects when organization has projects` |
| 9 | 组织只有软删项目；GET `/api/admin/organizations/{id}` → 200 且 `projects` 为 `[]` | `organizations-api.servertest.ts` › `should not return soft-deleted projects` |
| 10 | 随机 UUID；GET `/api/admin/organizations/{id}`（Bearer admin）→ 404 且 `body.error` 含 `"Organization not found"` | `organizations-api.servertest.ts` › `should return 404 when getting a non-existent organization` |
| 11 | 组织 `metadata=NULL`；GET `/api/admin/organizations/{id}` → `metadata` 为 `{}` | new |
| 12 | POST `/api/admin/organizations`，body `{name:<唯一>, metadata:{tier:"testing",users:5}}` → 201，body `{id,name,createdAt,metadata,projects:[]}`，DB `organizations` 行存在且 `metadata` 深等 | `organizations-api.servertest.ts` › `should create a new organization with valid admin authentication` |
| 13 | 同上传 `{name}`（无 metadata）→ 201 且 `metadata` 为 `{}`，DB `metadata` 为 `NULL` | `organizations-api.servertest.ts` › `should create a new organization without metadata` |
| 14 | POST `{name:"A"}` → 400 且 `body.error` 含 `"Invalid request body"`、`body.details` 存在 | `organizations-api.servertest.ts` › `should return 400 when organization name is too short` |
| 15 | POST `{name:"A".repeat(61)}` → 400 同上 | `organizations-api.servertest.ts` › `should return 400 when organization name is too long` |
| 16 | POST `{name:"<b>x</b>ab"}`（含 HTML、长度≥3）→ 400 | new |
| 17 | POST 无 admin 头 → 401 且 `body.error` 含 `"Unauthorized"` | `organizations-api.servertest.ts` › `should return 401 when no authorization header is provided` |
| 18 | POST `Bearer invalid-admin-key` → 401 同上 | `organizations-api.servertest.ts` › `should return 401 when invalid admin API key is provided` |
| 19 | POST `{name, metadata:"{\"a\":1}"}`（JSON 字符串）→ 201，DB `metadata` 深等 `{a:1}` | new |
| 20 | POST `{name, metadata:"{not json"}` → 400 且 `body.error` 以 `"Invalid metadata. Should be a valid JSON object:"` 开头 | new |
| 21 | POST `{name, metadata:[1]}`、`{name, metadata:null}`、`{name, metadata:5}` 三种 → 均 400 且 `body.error` === `"Invalid metadata. Should be a valid JSON object."` | new |
| 22 | POST 成功 → `audit_logs` 新增一行：`type="API_KEY"`、`api_key_id="admin-api"`、`org_id=<新 id>`、`resource_type="organization"`、`resource_id=<新 id>`、`action="create"`、`after` 为可 JSON.parse 的对象且 `id` 匹配 | new |
| 23 | POST 成功 → 该组织没有 `organization_memberships`、`project_memberships`、`score_configs` 等伴随行 | new |
| 24 | POST 成功 → PUT 成功更新 `name` 与 `metadata`，200 且 body `{id,name,metadata}` 匹配，DB 行已更新 | `organizations-api.servertest.ts` › `should update an organization with valid admin authentication` |
| 25 | PUT `/api/admin/organizations/{randomUUID}` body `{name:"New Name"}` → 404 且 `body.error` 含 `"Organization not found"` | `organizations-api.servertest.ts` › `should return 404 when updating a non-existent organization` |
| 26 | PUT 已存在组织 body `{name:"A"}` → 400 且 `body.error` 含 `"Invalid request body"` | `organizations-api.servertest.ts` › `should return 400 when updating with invalid name` |
| 27 | PUT 无 admin 头 → 401 且 `body.error` 含 `"Unauthorized"` | `organizations-api.servertest.ts` › `should return 401 when no authorization header is provided` |
| 28 | PUT `/api/admin/organizations/{randomUUID}` body `{name:"A"}` → 400（校验先于存在性） | new |
| 29 | 组织原 `metadata={a:1}`；PUT `{name:"..."}`（省略 metadata）→ 200，DB `metadata` 仍为 `{a:1}`，响应 `metadata` 为 `{a:1}` | new |
| 30 | 组织原 `metadata={a:1}`；PUT `{name:"...", metadata:"{\"b\":2}"}` → DB `metadata` 为 `{b:2}` | new |
| 31 | PUT 成功 → `audit_logs` 无新增行 | new（characterise 现状） |
| 32 | 空组织（无任何项目）；DELETE `/api/admin/organizations/{id}`（Bearer admin）→ 200 `{success:true}`，DB 中该组织为 `null` | `organizations-api.servertest.ts` › `should delete an organization with valid admin authentication` |
| 33 | DELETE `/api/admin/organizations/{randomUUID}` → 404 且 `body.error` 含 `"Organization not found"` | `organizations-api.servertest.ts` › `should return 404 when deleting a non-existent organization` |
| 34 | 组织含 1 个 live 项目；DELETE → 400，`body.error` 含 `"Organization cannot be deleted while it still has projects"` 且 `body.message` 含 `"Please delete or transfer all projects"` | `organizations-api.servertest.ts` › `should return 400 when organization has projects` |
| 35 | 组织只含 1 个 `deletedAt` 非空的项目；DELETE → 400，`body.error` 同上，`body.message` 含 `"still being processed"` | new |
| 36 | DELETE 无 admin 头 → 401 且 `body.error` 含 `"Unauthorized"` | `organizations-api.servertest.ts` › `should return 401 when no authorization header is provided` |
| 37 | 删除成功 → `audit_logs` 新增 `action="delete"`、`resource_type="organization"`、`resource_id=<id>`、`org_id=<id>`、`before` 可解析且 `id` 匹配 | new |
| 38 | 组织有组织级 API key（Redis 缓存已热）；DELETE 成功后再用该 key 调 admin API → 401 | new（需 Redis） |
| 39 | 组织有 `cloudConfig.stripe.activeSubscriptionId` 且 Stripe 取消调用抛错；DELETE → 500（或按实现冒泡的状态）且组织仍存在；Stripe 取消被调用一次 | new（需 Stripe 桩） |

### H.2 项目（§C）

| # | Given / When / Then | 覆盖 |
| --- | --- | --- |
| 40 | 组织（plan=Pro）含 2 个 live 项目 + 1 个软删；GET `/api/public/organizations/projects`（Basic 组织键）→ 200，`projects` 含两个 live 项目及其 `{id,name,metadata,createdAt,updatedAt}` | `organizations-api.servertest.ts` › `should get all organization projects with valid API key` |
| 41 | 同上加软删项目 → 响应不含它 | `organizations-api.servertest.ts` › `should not return soft-deleted projects` |
| 42 | 用项目级键 GET → 403 且 `body.error` 含 `"Organization-scoped API key required"` | `organizations-api.servertest.ts` › `should return 403 when using a project-scoped API key` |
| 43 | 无效键 GET → 401 | `organizations-api.servertest.ts` › `should return 401 when using invalid API key` |
| 44 | POST `/api/public/organizations/projects`（有效组织键）→ 405 且 `body.error` 含 `"Method not allowed"` | `organizations-api.servertest.ts` › `should return 405 for non-GET methods` |
| 45 | 另一组织有项目；GET 本组织 → 不含它 | `organizations-api.servertest.ts` › `should only return projects belonging to the organization` |
| 46 | 空组织 + 其组织键；GET → 200 `{projects: []}` | `organizations-api.servertest.ts` › `should handle organization with no projects` |
| 47 | 组织有一个 `metadata=NULL` 的项目；GET → 该项目 `metadata` 为 `null`（不是 `{}`） | `organizations-api.servertest.ts` › `should handle projects with null metadata` |
| 48 | GET 返回全部项目、无分页（项目数 > 默认页大小仍全返回） | new |
| 49 | POST `/api/public/projects` `{name:<唯一>, metadata:{plan:"pro",features:["all"]}}`（组织键）→ 201，body `{id,name,metadata}` 匹配；DB 项目行存在且 `org_id` 正确；`score_configs` 有 5 行（名字集合 `{is_correct,accuracy,relevance,helpfulness,toxicity}`）；`doris_project_table_split` 存在该 `project_id` 的行 | `projects-api.servertest.ts` › `should create a new project with valid organization API key`（score configs 部分为 new） |
| 50 | POST `{name}`（无 metadata）→ 201，`metadata` 为 `{}`、`retentionDays` 键缺失；DB `metadata` 为 `NULL` | `projects-api.servertest.ts` › `should create a new project without metadata and return empty object` |
| 51 | POST `{name, retention:0}` → 201，响应无 `retentionDays`，DB `retention_days = 0` | `projects-api.servertest.ts` › `should create a new project with retention days` |
| 52 | POST `{name, retention:30}` → 201，`retentionDays === 30`，DB `retention_days = 30` | `projects-api.servertest.ts` › `should create a new project with non-zero retention days (data-retention entitlement)` |
| 53 | POST `{name, retention:2}` 与 `{name, retention:6}` → 均 400 且 `body.message` 含 `"Invalid retention value"` | `projects-api.servertest.ts` › `should validate retention days` |
| 54 | POST 用项目级键 → 403 且 `body.error` 含 `"Organization-scoped API key required"` | `projects-api.servertest.ts` › `should return 403 when using project API key instead of organization API key` |
| 55 | POST 无效键 → 401 且 `body.error` 含 `"Invalid credentials"` | `projects-api.servertest.ts` › `should return 401 when invalid API keys are provided` |
| 56 | POST `{name:"AB"}` 与 `{name:"A".repeat(61)}` → 均 400 且 `body.message` 含 `"Invalid project name"` | `projects-api.servertest.ts` › `should return 400 when project name is invalid` |
| 57 | 先 POST `{name:X}`（201），再 POST 同名 → 409 且 `body.message` 含 `"already has a project"` | `projects-api.servertest.ts` › `should return 409 when project name already exists in the organization` |
| 58 | 组织内存在同名但 `deletedAt` 非空的项目；POST 同名 → 201 | new |
| 59 | POST `{name, metadata:"{\"a\":1}"}` → 201，DB `metadata` 深等 `{a:1}` | new |
| 60 | POST `{name, metadata:"{bad"}` → 400 且 `body.message` 以 `"Metadata is not decodable JSON:"` 开头 | new |
| 61 | POST `{name, metadata:[]}` / `{name, metadata:null}` / `{name, metadata:1}` → 均 400 且 `body.message` === `"Metadata must be a JSON object."` | new |
| 62 | POST 成功 → `audit_logs` 无新增行 | new（characterise 现状） |
| 63 | POST `{name, retention:"30"}`（数字字符串）→ 校验通过但写库失败 → 500 `{"message":"Internal server error"}`，且**没有**新项目行 | new（characterise §J 的 bug） |
| 64 | POST `{name, retention:null}` → 201，响应无 `retentionDays`，DB `retention_days` 为 `NULL` | new |
| 65 | 令 Doris 控制行写入失败（桩）；POST → 500 且刚创建的项目已被删除（DB 无该项目行） | new（需故障注入） |
| 66 | 存在项目；PUT `{name:"Updated Project Name", retention:7}` → 200 且 `retentionDays===7`，DB 同步 | `projects-api.servertest.ts` › `should update project retention days with valid organization API key` |
| 67 | PUT `{name, retention:2}` → 400 且 `body.message` 含 `"Invalid retention value"` | `projects-api.servertest.ts` › `should validate retention days on update` |
| 68 | PUT `{name, retention:7}` 边界 → 200 `retentionDays===7` | `projects-api.servertest.ts` › `should allow setting retention to the 7-day minimum` |
| 69 | PUT `{name, retention:0}` → 200，响应无 `retentionDays` | `projects-api.servertest.ts` › `should allow setting retention to 0` |
| 70 | 项目原 `metadata={plan:"free",features:["basic"]}`；PUT `{name, metadata:{plan:"enterprise",features:["all","custom"]}}` → 200 且响应/DB 均为新对象 | `projects-api.servertest.ts` › `should update project metadata` |
| 71 | PUT `{name}`（省略 metadata）→ 200 且响应 `metadata` 保持原值 | `projects-api.servertest.ts` › `should keep existing metadata when metadata is omitted` |
| 72 | PUT `{name:"AB"}` → 400 且 `body.message` 含 `"Invalid project name"` | `projects-api.servertest.ts` › `should return 400 when project name is invalid` |
| 73 | PUT 用项目级键 → 403 且 `body.error` 含 `"Organization-scoped API key required"` | `projects-api.servertest.ts` › `should return 403 when using project API key instead of organization API key` |
| 74 | PUT `/api/public/projects/{randomUUID}`（有效组织键）→ 404 且 `body.message` 含 `"Project not found"` | `projects-api.servertest.ts` › `should return 404 when project does not exist` |
| 75 | 另一组织的项目；PUT 本组织键 → 404 且该项目 `name` 未被修改 | `projects-api.servertest.ts` › `should return 404 when project belongs to another organization` |
| 76 | PUT 带 `retention` 成功 → Doris TTL 重算已入队（`jobId = projectId`；可用队列/Redis 断言），且该副作用失败不影响 200 | new |
| 77 | PUT `{name, metadata:[]}` → 400 `{"message":"Metadata must be a JSON object."}` | new |
| 78 | PUT 成功 → `audit_logs` 无新增行 | new（characterise 现状） |
| 79 | 存在带项目级键的项目；DELETE `/api/public/projects/{id}`（组织键）→ 202，`success===true` 且 `message` 含 `"queued for deletion"`；DB 项目 `deletedAt` 非空（行仍在）；项目级键已在 DB 中不存在；组织级键仍存在 | `projects-api.servertest.ts` › `should delete a project with valid organization API key` |
| 80 | DELETE 用项目级键 → 403 且 `body.error` 含 `"Organization-scoped API key required"` | `projects-api.servertest.ts` › `should return 403 when using project API key instead of organization API key` |
| 81 | DELETE 无效键 → 401 | `projects-api.servertest.ts` › `should return 401 when invalid API keys are provided` |
| 82 | DELETE `/api/public/projects/{randomUUID}` → 404 且 `body.message` 含 `"Project not found"` | `projects-api.servertest.ts` › `should return 404 when project does not exist` |
| 83 | 删除成功 → `audit_logs` 新增 `action="delete"`、`resource_type="project"`、`resource_id=<id>`、`api_key_id=<调用所用组织键 id>`、`project_id=<id>`、`before` 可解析 | new |
| 84 | 删除成功 → `ProjectDeleteQueue` 收到一个 `QueueJobs.ProjectDelete` 任务，payload `{projectId, orgId}` | new |
| 85 | 令 `ProjectDeleteQueue.getInstance()` 返回 `null`；DELETE → 500 `{"message":"Internal server error"}`，但项目已软删、项目键已删、审计已写 | new（characterise 顺序缺陷） |
| 86 | PATCH `/api/public/projects/{id}`（有效组织键，方法不在允许集）→ 405 且 `body.error` 含 `"Method not allowed"`；PUT/DELETE 之外含 `GET`、`POST` 亦然 | `projects-api.servertest.ts` › `should return 405 for unallowed methods`（GET/POST 为 new） |
| 87 | 405 body 的允许列表字符串恰为 `"Method not allowed. Allowed methods: PUT, DELETE"` | new |
| 88 | 无鉴权的 GET `/api/public/projects/{id}` → 405（方法检查先于鉴权） | new |

### H.3 路由包装器（§D）

| # | Given / When / Then | 覆盖 |
| --- | --- | --- |
| 89 | GET `/api/admin/organizations/{orgId}/apiKeys`（Bearer admin，组织有 2 把组织级键）→ 200，`apiKeys` 长度 2，首个 `note` 匹配，字段集为 `{id,createdAt,expiresAt,lastUsedAt,note,publicKey,displaySecretKey}`（**无** `secretKey`/`hashedSecretKey`） | `organizations-api.servertest.ts` › `should get all API keys for an organization with valid admin authentication` |
| 90 | GET 不存在组织的 apiKeys → 404 且 `body.error` 含 `"Organization not found"` | `organizations-api.servertest.ts` › `should return 404 when getting API keys for a non-existent organization` |
| 91 | POST `/api/admin/organizations/{id}/apiKeys` `{note:"Test API Key"}` → 201，`publicKey` 以 `pk-lf-` 开头、`secretKey` 以 `sk-lf-` 开头、`note` 匹配；DB 行的 `orgId`/`scope="ORGANIZATION"` 正确 | `organizations-api.servertest.ts` › `should create a new API key for an organization with valid admin authentication` |
| 92 | 同上成功 → `audit_logs` 新增 `action="create"`、`resource_type="apiKey"`、`resource_id=<新键 id>`、`api_key_id="admin-api"` | new |
| 93 | POST 不存在组织的 apiKeys → 404 | `organizations-api.servertest.ts` › `should return 404 when creating an API key for a non-existent organization` |
| 94 | POST 无 admin 头 → 401 且 `body.error` 含 `"Unauthorized"` | `organizations-api.servertest.ts` › `should return 401 when no authorization header is provided` |
| 95 | DELETE `/api/admin/organizations/{id}/apiKeys/{keyId}` → 200 `{success:true}`，DB 该键为 `null` | `organizations-api.servertest.ts` › `should delete an API key with valid admin authentication` |
| 96 | DELETE 不存在键 → 404 且 `body.error` 含 `"API key not found"` | `organizations-api.servertest.ts` › `should return 404 when deleting a non-existent API key` |
| 97 | DELETE 不存在组织 → 404 且 `body.error` 含 `"Organization not found"`（组织检查先于键检查） | `organizations-api.servertest.ts` › `should return 404 when deleting an API key for a non-existent organization` |
| 98 | DELETE 无 admin 头 → 401 | `organizations-api.servertest.ts` › `should return 401 when no authorization header is provided` |
| 99 | 对 `/api/admin/organizations/{id}/apiKeys` 发 PATCH（admin 有效）→ 405 且 `body.error` 含 `"Method not allowed"` | new |
| 100 | 对 `/api/admin/organizations/{id}/apiKeys/{keyId}` 发 GET（admin 有效）→ 405 且允许列表为 `"DELETE"` | new |
| 101 | `organizationId`/`apiKeyId` 非字符串（例如重复 query 参数造成数组）→ 400，错误串分别为 `"Invalid organization ID"` / `"Invalid organization ID or API key ID"` | new |
| 102 | 实例无 admin-api 权益（无 license 或非 EE 部署）+ Bearer `ADMIN_API_KEY` → 403 `{"error":"This feature is not available on your current plan."}`，且组织未被创建 | new（需以不同 license 启动服务器） |
| 103 | 云 region 且非 DEV（`NEXT_PUBLIC_LITEFUSE_CLOUD_REGION=prod-us`）→ 403 `{"error":"Not accessible on Litefuse Cloud"}` | new（需以该 env 启动服务器） |
| 104 | `ADMIN_API_KEY` 未配置 → 403 `{"error":"ADMIN_API_KEY is not set"}` | new |
| 105 | `Authorization: Bearer <错值>`（格式正确但值不匹配）→ 401 `{"error":"Unauthorized: Invalid token"}`（与 §H.1 第 18/27 的 `"Unauthorized"` 包含断言一致） | new |
| 106 | `Authorization` 为 Basic 而非 Bearer → 401 | `organizations-api.servertest.ts` 的“无头”用例实际发送 Basic 回退头，已覆盖该形态 |

### H.4 社区边界（§E，回归保护；**不改动被测文件**）

| # | Given / When / Then | 覆盖 |
| --- | --- | --- |
| 107 | POST `/api/public/projects` 无效 Basic 键 → 401 且 `body.error` 含 `"Invalid credentials"` | `projects-api.servertest.ts` › `should return 401 when invalid API keys are provided` |
| 108 | POST 用项目级键 → 403 且 `body.error` 含 `"Organization-scoped API key required"` | `projects-api.servertest.ts` › `should return 403 when using project API key instead of organization API key` |
| 109 | PUT `/api/public/projects` → 405 且 `body.message` 含 `"Method not allowed"` | `projects-api.servertest.ts` › `should return 405 for non-GET methods` |
| 110 | GET `/api/public/projects` 用项目级键 → 200 `{data:[{id,name,organization,metadata}]}`（无 retention 时缺 `retentionDays`） | `projects-api.servertest.ts` › `should return project data with valid project API key authentication` |
| 111 | GET `/api/public/projects` 用组织键 → 403 且 `body.message` 含 `"organization key"` | `projects-api.servertest.ts` › `should return 403 when using an organization API key` |
| 112 | 未授权 POST → 不得加载/执行企业实现（断言 401/403 且组织未被创建） | new（可用未授权请求 + DB 负断言近似表达） |

**覆盖统计**：以上 112 条中，映射到既有测试的共 67 条（H.1 组织 20 条、H.2 项目 32 条、H.3 路由 10 条、H.4 社区边界 5 条），其余 45 条标注 `new`。注意 H.2 中的第 40–47 条（`GET /api/public/organizations/projects`，即 `listProjects`）的既有覆盖在 `organizations-api.servertest.ts` 的 “Public Organizations API” 段内，不在 `projects-api.servertest.ts`；H.2 第 49–86 条与 H.4 的既有覆盖在 `projects-api.servertest.ts`。`admin-api-key-auth.servertest.ts` 的 14 条**不直接覆盖**本批次文件（见 §E.3），仅作为同类 admin 鉴权行为的旁证；因此不单独计入上表。

---

## I. 实现独立性纪律（净室）

- 本规格只约束**行为与对外契约**。私有函数、类型别名、条件写法、`try/catch` 组织、日志措辞、注释**由实现者自行决定**。
- **不得**打开、读取、diff 或 grep 本批次 14 个目标文件的原实现，也不得查看包含它们的 git 历史/提交 diff。
- **不得**对包含目标文件的目录做全仓 grep；需要项目内约定时，直接打开规格中列出的具体路径。
- **不得修改** `web/src/pages/api/public/projects/index.ts` 与 `web/src/features/public-api/server/adminApiGuard.ts`（ANNEX B，MIT）。
- 实现产物写到**新的临时路径**（例如 `*.impl.ts`），由主控会话审查后再原位替换；`record.md` 由主控会话补充。
- 依赖模块（§F）按其现有签名调用即可，不要在本批次中重写它们。

---

## J. Open questions

1. **`enterprise/http.ts`、`enterprise/auth/requireInstanceAdmin.ts`、`enterprise/auth/requireAdminApi.ts` 不在本批次文件清单内**，但被目标路由包装器直接 import（ANNEX A）。本规格按现有行为固定了它们的可观察语义（§A.2–A.4）。若它们由另一批次重写，需保证本规格描述的顺序/状态码/错误串一致；若由本批次一并实现，请主控会话明确。
2. **`updateOrganization` 不写审计日志**（create/delete 写），`createProject`/`updateProject` 也**不写审计日志**（deleteProject 写）。这是现状，按“保持现状”原则已固化；是否为遗漏由产品决定。
3. **`createProject` / `updateProject` 落库的是原始 `retention` 值，而校验用的是 coerce 后的值**。因此 `retention: "30"` 会通过校验、随后因 Prisma 类型不匹配而 500（§H.2 第 63 条固化）。`retention: null` 会被当作合法的 `0` 校验通过，并以 `null` 覆盖现有值；`retention: false`/`""` 同理走到 Prisma 错误。未在规格中“修正”，仅记录。
4. **`createProject` / `updateProject` 的 data-retention 403 分支在可经 HTTP 到达的 plan 中不可达**：`admin-api` 权益只在 `cloud:pro` 与 `self-hosted:enterprise` 中存在，而这两个 plan 都含 `data-retention`。因此第 4 步的 403 只能通过直接调用函数（不经守卫）触发；测试计划未包含其 HTTP 用例。
5. **项目重名检查是“先查后写”，且 `projects` 表没有 `(org_id, name)` 唯一约束**（只有 `@@index([orgId])`）。并发下可创建同名项目。按现状固化；如需真正唯一需另行决策与迁移。
6. **`deleteProject` 的副作用顺序**：先删键、软删、写审计，最后才检查队列；队列不可用会返回 500，但项目已经软删且审计已写（§H.2 第 85 条固化）。
7. **`deleteOrganization` 在硬删组织后才写审计行**（`audit_logs.org_id` 无外键，所以能写；该行会留下悬空的 `org_id`）。若将来给 `audit_logs.org_id` 加外键，此顺序会失败。
8. **`listOrganizations` / `listProjects` 没有 `orderBy` 与分页**；响应顺序取决于数据库返回顺序，未定义。测试计划据此只断言集合成员，不断言顺序（`apiKeys` 除外，它有显式 `createdAt asc`）。
9. **`listProjects` 的 `metadata` 原样返回（可为 `null`），而组织侧的 `metadata` 归一为 `{}`**；这是现状差异，已分别固化。
10. **`organizationId`/`projectId`/`apiKeyId` 的 `typeof !== "string"` 分支在正常 Next.js 路由下难以触发**（单元动态段通常给 string，除非同名 query 参数重复）。该分支的状态码/错误串已固化，但测试计划中标注为 `new` 的这两条可能难以在纯 HTTP 层构造。
11. **非 JSON 请求体**（`req.body` 为字符串/`undefined`）的行为未定义：`organizationNameSchema` 会 400，而项目函数解构 `req.body` 可能抛错并走到 500。规格未固化，验收测试也不覆盖。
12. **Stripe 取消失败时 `deleteOrganization` 的响应**：异常冒泡到路由包装器的 catch，返回 500 `{"error":"Internal server error"}`。这一点由包装器语义推出，但未在测试中直接验证；第 39 条按此预期编写，若实际行为不同以测试跑出的现状为准。
13. **`organizations-api.servertest.ts` 中 “无授权头” 用例实际发送的是 `Basic pk-lf-1234567890:sk-lf-1234567890`**（`makeAPICall` 的默认回退），并非真正缺失 `Authorization` 头。真正缺失头时的错误串 `"Unauthorized: authorization header is missing"`（§A.3）未由既有测试直接断言。
