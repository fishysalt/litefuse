# 行为规格：SCIM 2.0（批次 3，10 个文件）

- 状态：待实现
- 批次：3
- **角色（净室命名约定见 `../README.md`）**：本规格由 **Select DB** 撰写（该方已阅目标实现，负责规格、测试与门禁）；实现方为 **Zhang Mo**（未接触目标实现，仅依据本规格与验收测试编码）
- 目标文件（3 个 helper 模块 + 7 个路由处理器）：
  - `web/src/features/public-api/server/scimAccess.ts`
  - `web/src/features/public-api/server/scimDiscovery.ts`
  - `web/src/features/public-api/server/scimUser.ts`
  - `web/src/pages/api/public/scim/ServiceProviderConfig.ts`
  - `web/src/pages/api/public/scim/ResourceTypes.ts`
  - `web/src/pages/api/public/scim/ResourceTypes/[id].ts`
  - `web/src/pages/api/public/scim/Schemas.ts`
  - `web/src/pages/api/public/scim/Schemas/[id].ts`
  - `web/src/pages/api/public/scim/Users/index.ts`
  - `web/src/pages/api/public/scim/Users/[id].ts`
- 相关既有测试（已存在，本轮**不得修改**；作为 L1 特征测试的既有部分）：
  - `web/src/__tests__/server/scim-api.servertest.ts`（8 个 `describe`，31 条 `it`，当前 31/31 绿）
  - `web/src/__tests__/server/unit/scim-entitlement.servertest.ts`（5 条 `it`，其中 2 条为 `it.each` 展开）
- 只读参照（MIT，**不得修改、不得改许可**，本批次只按契约调用）：
  - `web/src/features/public-api/server/adminApiGuard.ts`
  - `web/src/features/entitlements/server/hasEntitlement.ts`
  - `web/src/features/entitlements/server/resolveSelfHostedPlan.ts`
  - `web/src/features/public-api/server/apiAuth.ts`（`ApiAuthService.verifyAuthHeaderAndReturnScope`）
  - `web/src/features/public-api/server/cors.ts`
  - `web/src/features/auth-credentials/lib/credentialsServerUtils.ts`
  - `web/src/features/audit-logs/auditLog.ts`
  - `packages/shared/prisma/schema.prisma`（`users` / `organization_memberships` / `project_memberships` / `audit_logs` / `Role`）

---

## 0. 契约边界

本批次全部是**服务端**代码（Next.js Pages API handler 与三个纯函数/常量模块），没有 React 组件，没有任何用户可见 UI。

| 冻结（必须完全一致） | 自由（可自行拟定） |
| --- | --- |
| 导出符号名与函数签名、常量名与**值**；HTTP 方法与状态码；响应 JSON 的字段名、嵌套与字段集；**所有错误/成功文本**（含模板拼接处的 JSON 回显格式）；校验顺序（CORS → 方法 → 认证 → 组织级 key → 权益 → 用户存在性 → 请求体 → 写库）；数据库表/列、过滤条件、`select` 投影、排序的有无、事务边界与级联语义；审计日志字段；角色取值与"取最低权限"规则；PATCH 逐操作语义与多操作原子性 | 内部函数命名、辅助函数拆分、注释、`logger.*` 文案、`import` 分组、错误对象构造方式、语句组织、是否用 `switch`/查表 |

### 0.1 文案与 i18n（明确结论）

本批次**不涉及任何 i18n key**：

- 10 个目标文件都不 import `t`；所有字符串都是 SCIM 协议/HTTP 响应体内容（`detail`、`status`、`schemas` URN、字段名、`documentationUri`），由 SCIM 客户端（Okta、Azure AD、Entra 等）读取，**不是**用户界面文案。
- 已逐条核对：这些字符串**不在** `web/src/features/i18n/locales/en.json` 或 `zh-CN.json` 中。特别地，locale 里存在一条形近但不同的键 `"This feature is not available in your current plan."`（介词是 **in**），与 SCIM 权益拒绝文案 `"This feature is not available on your current plan."`（介词是 **on**）**不是同一个字符串**；不得把两者合并，也不得为 SCIM 文案新增 locale key。
- 因此本批次验收**不新增/不修改** locale 文件；只需保证既有 `pnpm run i18n:check` 仍然通过（目标文件不进 i18n 收集体）。
- 规格中凡是写出引号的字符串都是**必须逐字保留**的协议串，不得改写、翻译、加前后缀或改变大小写。

### 0.2 净室纪律

见 §10（纪律专节）。摘要：不得打开、读取、diff 或 grep 上述 10 个目标文件；不得对包含目标文件的目录做全仓检索；实现产物先写到临时路径（`*.impl.ts`），由主控审查后换入。

---

## 1. 外部依赖与横切约定

### 1.1 CORS 中间件

10 个处理器（含 discovery）的**第一步**都是 `await runMiddleware(req, res, cors)`，`cors` 来自 `@/src/features/public-api/server/cors`，取该模块的默认配置。它在认证之前执行，直接应答 `OPTIONS` 预检，并回显 `Origin`。本批次不修改它，只要求"第一行调用"。

### 1.2 SCIM 错误体（唯一形态）

除 discovery 路由的 405 之外，所有 SCIM 错误响应都使用同一形状（由 `scimErrorBody` 或内联字面量生成，二者**逐字节等价**）：

```
{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": <字符串>,
  "status": <数字，等于 HTTP 状态码> }
```

- 只有这三个键；没有 `Errors`、没有 `scimType`、没有 `resourceType`。
- `detail` 是唯一可变的成员；`schemas` 恒为该错误 URN 的单元素数组；`status` 恒为数值型状态码。
- discovery 路由的 `405` 也使用同一形状，`detail` 恒为 `"Method not allowed"`（**不带**允许方法列表）。

### 1.3 认证：`ApiAuthService.verifyAuthHeaderAndReturnScope(headers.authorization)`

- 10 个处理器都用 `new ApiAuthService(prisma, redis).verifyAuthHeaderAndReturnScope(req.headers.authorization)` 取 `{ validKey, scope }`。
- 返回结构：`{ validKey: true, scope: ApiAccessScope }` 或 `{ validKey: false, error: string }`。
- `scope` 关键字段：`accessLevel: "organization" | "project" | "scores"`、`orgId: string`、`plan: Plan`、`apiKeyId: string`、`projectId: string | null`。组织级 key 的 `accessLevel === "organization"`。
- `validKey === false` → SCIM 路由写 `401 scimErrorBody(401, authCheck.error)`；`detail` **就是** `authCheck.error`，常见值：
  - `"No authorization header"`
  - `"Invalid credentials. Confirm that you've configured the correct host."`（`Invalid credentials` + 固定后缀）
  - `"Invalid authorization header"`
- 只支持 `Basic <publicKey>:<secretKey>`（Bearer 会得到 `accessLevel === "scores"`，随后被组织级检查拒绝为 403）。

### 1.4 组织级 key 检查

认证通过后，10 个处理器都做同一检查：

```
authCheck.scope.accessLevel !== "organization" || !authCheck.scope.orgId
```

命中 → `403 scimErrorBody(403, "Invalid API key. Organization-scoped API key required for this operation.")`。项目级 key、Bearer key 都落到这里。

### 1.5 权益（plan）判定与解析

- 仅 **`Users` 两个端点**在组织级检查之后再做一次 plan 门控；5 个 discovery 端点**不做**（详见 §5、§6、§7）。
- 权益名：`admin-api`。判定：`hasEntitlementBasedOnPlan({ plan, entitlement: "admin-api" })`；`plan === null` → `false`。
- `entitlementAccess` 中 `admin-api` **只在** `cloud:pro` 与 `self-hosted:enterprise` 上存在；`oss`、`cloud:developer` 没有。
- `plan` 从 `authCheck.scope.plan` 取，来自认证阶段对 key 所属组织解析的结果：
  - 设了 `NEXT_PUBLIC_LITEFUSE_CLOUD_REGION`（本 worktree 的 `.env` 为 `"DEV"`，非空即算设了）时走 cloud 分支：`organization.cloudConfig.plan === "Pro"` → `cloud:pro`；`"Developer"` → `cloud:developer`；否则`cloudConfig.stripe.activeSubscriptionId && cloudConfig.stripe.resolvedPlan` → `cloud:pro`；再否则 `cloud:developer`。
  - 未设 region 时走自托管分支：`LITEFUSE_EE_LICENSE_KEY` 以 `litefuse_ee_` 开头 → `self-hosted:enterprise`，否则 `oss`。
- 失败 → `403 scimErrorBody(403, "This feature is not available on your current plan.")`，并且先 `logger.warn` 一条（日志文案自由）。返回 `true` 表示"已拒绝，调用方必须 `return`"；返回 `false` 表示放行。

### 1.6 密码工具

- `isValidPassword(p) === p.length >= 8`（不检查字符类别、不做 trim）。
- `hashPassword(p)` 为 bcrypt，cost 12，返回哈希串。SCIM 只在 **POST 新建账号**时写 `users.password`，其它端点从不读写密码。

### 1.7 审计日志

- `auditLog(log, prisma?)`：写一行 `audit_logs`；传第二个参数（事务客户端）则与业务写入同事务提交/回滚。
- 本批次只使用 `apiKeyId` 变体：`type = API_KEY`、`apiKeyId = scope.apiKeyId`、`userId = NULL`、`userOrgRole`/`userProjectRole` 为 NULL。
- 本批次写出的 `resourceType` 恒为 `"orgMembership"`（不是 `"membership"`、不是 `"projectMembership"`）；`before`/`after` 非空时被 `JSON.stringify` 后落库；`resourceId` 为成员关系的 `id`（不是 `userId`）。
- **名称更新不写审计**（见 §7.6 `updateUserName`）；成员关系读操作不写审计。

### 1.8 事务与 Prisma 语义

- `PATCH` 与 `PUT` 的全部写入在**一个** `prisma.$transaction(async (tx) => ...)` 内；`auditLog(..., tx)` 传入同一 `tx`。
- `DELETE` **不在**事务内：先删成员关系，再用全局 `prisma` 写审计（两次独立提交）。
- `POST` **不在**事务内：建账号、建成员关系、写审计是三步独立提交。
- `organization_memberships` 有 `@@unique([orgId, userId])`；`project_memberships` 主键为 `@@id([projectId, userId])`，外键 `orgMembershipId → organization_memberships.id` 且 `onDelete: Cascade`；`users.email` 为 `String? @unique`（可空、唯一）。
- 删除 `organization_memberships` 一行会由数据库级联删掉其下所有 `project_memberships` 行；删除 `users` 行本批次从不发生。

---

## 2. `web/src/features/public-api/server/scimAccess.ts`

**用途**：SCIM 的 plan 权益门控（供 `Users` 两个端点调用）。

### 2.1 导出符号

| 导出 | 签名 / 值 |
| --- | --- |
| `SCIM_REQUIRED_ENTITLEMENT` | `"admin-api"`（字符串字面量） |
| `SCIM_PLAN_REQUIRED_DETAIL` | `"This feature is not available on your current plan."` |
| `scimAllowedForPlan` | `(plan: Plan \| null) => boolean` |
| `rejectUnlessScimIsEntitled` | `({ res, plan, route }: { res: NextApiResponse; plan: Plan \| null; route: string }) => boolean` |

### 2.2 行为

1. `scimAllowedForPlan(plan)` 就是 `hasEntitlementBasedOnPlan({ plan, entitlement: "admin-api" })`：`null` → `false`；`cloud:pro` / `self-hosted:enterprise` → `true`；`oss` / `cloud:developer` → `false`。
2. `rejectUnlessScimIsEntitled`：
   - 放行 → 返回 `false`，**不写响应**。
   - 拒绝 → 先 `logger.warn`（文案自由，含 `route` 与 `plan ?? "unknown"`），再 `res.status(403).json(scimErrorBody(403, SCIM_PLAN_REQUIRED_DETAIL))`，返回 `true`。
3. 返回**布尔而非响应对象**是刻意的：`NextApiResponse.json()` 返回 `void`，若返回"响应或 null"，调用方 `if (!x) return` 会把 `undefined` 当拒绝后又继续写库。实现必须保持"返回 true 表示已拒绝"的语义。

### 2.3 i18n

`SCIM_PLAN_REQUIRED_DETAIL` 是协议串，不是 i18n key（见 §0.1）。

---

## 3. `web/src/features/public-api/server/scimDiscovery.ts`

**用途**：discovery 声明（资源类型与 User schema）与其 404 错误体；供 5 个 discovery 路由共享。

### 3.1 导出符号

| 导出 | 值 / 签名 |
| --- | --- |
| `USER_RESOURCE_TYPE_ID` | `"User"` |
| `USER_SCHEMA_URN` | `"urn:ietf:params:scim:schemas:core:2.0:User"` |
| `RESOURCE_TYPES_PATH` | `"/api/public/scim/ResourceTypes"` |
| `SCHEMAS_PATH` | `"/api/public/scim/Schemas"` |
| `RESOURCE_TYPE_PATH` | `RESOURCE_TYPES_PATH + "/" + USER_RESOURCE_TYPE_ID` → `"/api/public/scim/ResourceTypes/User"` |
| `SCHEMA_PATH` | `SCHEMAS_PATH + "/" + USER_SCHEMA_URN` → `"/api/public/scim/Schemas/urn:ietf:params:scim:schemas:core:2.0:User"` |
| `userResourceType` | `() => <对象，见 3.2>` |
| `userSchemaDeclaration` | `() => <对象，见 3.3>` |
| `writeNotFound` | `(res: NextApiResponse, detail: string) => void` |

### 3.2 `userResourceType()` 的精确内容（每次调用新对象）

```
schemas:          ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"]
id:               "User"
name:             "User"
endpoint:         "/api/public/scim/Users"
description:      "User Account"
schema:           "urn:ietf:params:scim:schemas:core:2.0:User"
schemaExtensions: []
meta:             { resourceType: "ResourceType", location: "/api/public/scim/ResourceTypes/User" }
```

键顺序固定为上述顺序（`JSON.stringify` 可观察）。`schemaExtensions` 是**空数组**（虽然 `ResourceTypes` 列表的既有测试 schema 把它声明为对象数组，空数组满足该 schema）。**没有** `meta.created` / `meta.lastModified`。

### 3.3 `userSchemaDeclaration()` 的精确内容（每次调用新对象）

顶层：

```
id:          "urn:ietf:params:scim:schemas:core:2.0:User"
name:        "User"
description: "User Account"
attributes:  [ <10 条，见下表，顺序固定> ]
meta:        { resourceType: "Schema", location: "/api/public/scim/Schemas/urn:ietf:params:scim:schemas:core:2.0:User" }
```

`attributes` 顺序与每条字段（`multiValued`/`caseExact` 省略即表示该键不存在；所有 `subAttributes` 仅出现在 `name`、`emails`、`meta` 上）：

| # | name | type | multiValued | required | caseExact | mutability | returned | uniqueness | description（逐字） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `id` | `string` | false | **true** | true | `readOnly` | `always` | `server` | `Unique identifier for the User` |
| 2 | `externalId` | `string` | false | false | true | `readWrite` | `default` | `none` | `Identifier of the user in the provisioning client. Litefuse returns its own user id here, so clients can keep their link and address the user by id.` |
| 3 | `userName` | `string` | false | **true** | false | `readWrite` | `always` | `server` | `Unique identifier for the User, and the source of the email address in Litefuse` |
| 4 | `displayName` | `string` | false | false | false | `readWrite` | `default` | `none` | `The name of the user, suitable for display to end-users. Maps to the same value as name.formatted.` |
| 5 | `name` | `complex` | false | false | — | `readWrite` | `default` | `none` | `The components of the user's name` |
| 6 | `emails` | `complex` | **true** | false | — | `readWrite` | `default` | `none` | `Email addresses for the user` |
| 7 | `password` | `string` | false | false | false | `writeOnly` | `never` | `none` | `The user's password` |
| 8 | `active` | `boolean` | false | false | — | `readWrite` | `default` | `none` | `Whether the user is an active member of the organization. Setting it to false removes the organization membership (deprovisions the user), setting it to true re-provisions them.` |
| 9 | `roles` | `string` | **true** | false | true | `readWrite` | `default` | `none` | `Organization role of the user, as an array of strings (["ADMIN"]). Requests also accept the complex form ([{"value":"ADMIN"}]) and the path form with a single value.` |
| 10 | `meta` | `complex` | false | false | — | `readOnly` | `default` | `none` | `Resource metadata` |

子属性（同样顺序固定）：

- `name.subAttributes`：
  - `formatted` — `string`, multiValued false, required false, caseExact false, `readWrite`/`default`/`none`, description `The user's full name`
  - `givenName` — `string`, false, false, false, `readWrite`/`default`/`none`, description `The first name of the user. Accepted on write; joined with familyName into the stored name.`
  - `familyName` — `string`, false, false, false, `readWrite`/`default`/`none`, description `The last name of the user. Accepted on write; joined with givenName into the stored name.`
- `emails.subAttributes`：
  - `value` — `string`, false, false, false, `readWrite`/`default`/`none`, description `Email address value`
  - `primary` — `boolean`, false, false, 无 caseExact, `readWrite`/`default`/`none`, description `Primary email indicator`
  - `type` — `string`, false, false, false, `readWrite`/`default`/`none`, description `Email type (work, home, other)`
- `meta.subAttributes`：
  - `resourceType` — `string`, false, false, true, `readOnly`/`default`/`none`, description `The resource type`
  - `created` — `dateTime`, false, false, 无 caseExact, `readOnly`/`default`/`none`, description `The resource creation time`
  - `lastModified` — `dateTime`, false, false, 无 caseExact, `readOnly`/`default`/`none`, description `The resource last modification time`

`name`/`emails`/`meta` 父级没有 `caseExact` 键（complex 类型不写该键）。

### 3.4 `writeNotFound(res, detail)`

`res.status(404).json(scimErrorBody(404, detail))` —— 即 §1.2 的错误体，`status` 为数值 `404`。返回 `void`。它是 `/ResourceTypes/{id}` 与 `/Schemas/{id}` 的唯一 404 出口。

---

## 4. `web/src/features/public-api/server/scimUser.ts`

**用途**：SCIM User 的共享 helper——错误体、角色解析、名称解析、User 资源表示。

### 4.1 导出符号与签名

| 导出 | 签名 / 值 |
| --- | --- |
| `SCIM_USER_SCHEMA` | `"urn:ietf:params:scim:schemas:core:2.0:User"` |
| `SCIM_LIST_SCHEMA` | `"urn:ietf:params:scim:api:messages:2.0:ListResponse"` |
| `SCIM_PATCH_SCHEMA` | `"urn:ietf:params:scim:api:messages:2.0:PatchOp"` |
| `scimErrorBody` | `(status: number, detail: string) => { schemas: string[]; detail: string; status: number }` |
| `SCIM_ROLE_VALUES` | `["OWNER", "ADMIN", "MEMBER", "VIEWER", "NONE"] as const` |
| `normalizeRoleList` | `(input: unknown) => string[]` |
| `parseRequestedRole` | `(input: unknown) => Role \| null` |
| `EMPTY_ROLES_DETAIL` | 见 §4.3 |
| `isEmptyRoleValue` | `(input: unknown) => boolean` |
| `parseRequestedName` | `({ displayName, name, subAttribute, currentName }: { displayName?: unknown; name?: unknown; subAttribute?: string; currentName?: string \| null }) => string \| null` |
| `toScimUser` | `({ user, role, active, membershipUpdatedAt }: { user: User; role: Role \| null; active: boolean; membershipUpdatedAt?: Date \| null }) => <对象，见 4.5>` |

类型：`Role`、`User` 来自 `@langfuse/shared/src/db`；`Role` 为 `"OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | "NONE"`。

`SCIM_LIST_SCHEMA`、`SCIM_PATCH_SCHEMA`、`SCIM_ROLE_VALUES` 在本批次内没有其它消费者（路由里 URN 直接写字面量），但它们是**导出契约**，必须保留同名同值导出。

### 4.2 `scimErrorBody(status, detail)`

返回**新**对象 `{ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail, status }`（键顺序 `schemas`、`detail`、`status`）。`status` 原样使用传入的数字。

### 4.3 `normalizeRoleList(input)`

1. `list = Array.isArray(input) ? input : [input]`（标量被包成单元素数组）。
2. 每项映射：字符串 → 自身；否则取 `entry?.value`（对 `null`/数字/布尔/数组等取属性得 `undefined`）。
3. 过滤 `typeof value === "string"`。
4. 不做 trim、不做大小写归一。结果可能含空串（例如 `[""]`、`[{"value":""}]`）。

### 4.4 `parseRequestedRole(input)`

1. `input === undefined || input === null` → `null`。
2. `roleSchema.array().safeParse(normalizeRoleList(input))`，`roleSchema = z.enum(SCIM_ROLE_VALUES)`。
3. 解析失败**或**结果数组长度为 0 → `null`。
4. 否则返回按权限排名**最低**的那一个：`NONE(0) < VIEWER(1) < MEMBER(2) < ADMIN(3) < OWNER(4)`；相等时保留先出现的。

语义要点：

- 一个非法项会让**整串**解析失败（`["ADMIN","SUPER"]` → `null`，不是 `ADMIN`）。
- 数字/布尔/`null` 项被 `normalizeRoleList` 丢弃，**不**导致失败（`["ADMIN", 5]` → `ADMIN`）。
- 空串项**不会**被丢弃，会令数组解析失败（`["ADMIN", ""]` → `null`）。
- 全空对象项被丢弃（`[{"value":"ADMIN"}, {}]` → `ADMIN`）。
- `"ADMIN"`（标量字符串）→ `normalizeRoleList` 包成 `["ADMIN"]` → `ADMIN`。
- 取最低权限是刻意的（多组映射/多余组不会提权）。

### 4.5 `isEmptyRoleValue(input)`

判定"存在但没带任何可用角色"：

1. 单项 `isEmptyEntry`：
   - `undefined` / `null` → 空；
   - 字符串：`trim().length === 0` → 空；
   - 对象：`value` 为 `undefined` / `null` / 空串（trim 后）→ 空；
   - 其它（数字、布尔…）→ **不空**（视为畸形，交给调用方拒绝）。
2. `input === undefined || input === null` → `true`。
3. `list = Array.isArray(input) ? input : [input]`。
4. `list.length === 0 || list.every(isEmptyEntry)`。

因此：`undefined`→true、`null`→true、`""`→true、`[]`→true、`[null]`→true、`[{}]`→true、`[{"value":null}]`→true、`[{"value":""}]`→true、`[""]`→true、`[null, "ADMIN"]`→false、`[{"value":"ADMIN"},{}]`→false、`5`→false、`"ADMIN"`→false。

> 调用方必须**先**判断"属性是否存在"再调用它：`undefined` 在这里返回 `true`，而"属性缺席"在每个端点的含义不同（POST 默认 `NONE`；PATCH/PUT 不改角色）。`EMPTY_ROLES_DETAIL`（逐字）：

```
Invalid roles provided: the value must not be empty. Send one of OWNER, ADMIN, MEMBER, VIEWER or NONE - NONE is a valid role and means a member without permissions.
```

### 4.6 `parseRequestedName({...})`

`clean(v)`：`typeof v === "string" && v.trim().length > 0` → `v.trim()`，否则 `null`。

优先级（严格）：

1. `clean(displayName)` 非空 → 直接返回它（`displayName` 永远最高优先）。
2. `typeof name === "object" && name !== null`：
   - `clean(name.formatted)` 非空 → 返回；
   - 否则 `given = clean(name.givenName)`、`family = clean(name.familyName)`；
   - `given || family` → 返回 `[given, family].filter(Boolean).join(" ")`（缺失的一边不产生多余空格）；
   - 否则返回 `null`（例：`{}`、`{formatted:""}`、数组 `[]`）。
3. `name` 为标量：`scalar = clean(name)`；为空 → `null`。
4. 标量 + `subAttribute`（只有 path 形式会出现）：
   - `subAttribute === "givenName"`：从 `currentName?.trim() ?? ""` 按空白切分，取 `slice(1).join(" ")` 作为 family，返回 `[scalar, family].filter(Boolean).join(" ")`；
   - `subAttribute === "familyName"`：取 `currentName` 的 `split(/\s+/)[0] ?? ""` 作为 given，返回 `[given, scalar].filter(Boolean).join(" ")`；
   - 其它（`formatted`、`displayName`、未知子路径）→ 返回 `scalar`（当作完整姓名）。
5. 全空/不可解析 → `null`。

要点：`parseRequestedName` 在调用方不区分"拒绝"与"无值"，它只返回字符串或 `null`；空值在各端点是**静默跳过**（PATCH），不是 400。

### 4.7 `toScimUser({...})` 的精确表示

```
schemas:     ["urn:ietf:params:scim:schemas:core:2.0:User"]
id:          user.id
externalId:  user.id                       // 恒等于 id，不是客户端传入值
userName:    user.email                    // users.email 可空 → 可能是 null
displayName: user.name ?? undefined        // user.name 为 null/undefined 时该键在 JSON 中缺席
name: {
  formatted:  user.name,                   // 可 null，且**不 trim**
  givenName:  trimmedName?.split(/\s+/)[0] ?? user.email,
  familyName: trimmedName?.split(/\s+/).slice(1).join(" ") || "SCIM",
}
active:      <传入的 boolean>
roles:       active && role ? [role] : []   // 纯字符串数组；active=false 时为 []
role:        active && role ? role : undefined  // 非标准扁平字段；undefined 时键缺席
emails:      [{ primary: true, value: user.email, type: "work" }]
meta: {
  resourceType: "User",
  created:      user.createdAt?.toISOString(),
  lastModified: laterOf(user.updatedAt, membershipUpdatedAt).toISOString(),
}
```

其中 `trimmedName = user.name?.trim()`；`laterOf(a, b) = (b && b > a) ? b : a`。

必须保持的细节：

- `externalId` 恒为内部 `id`（客户端提交的 `externalId` 不会回显，见 §9）。
- `roles` 是**字符串数组**（`["ADMIN"]`），不是 RFC 7643 的 `[{ value }]` 复数形态；这是给 IdP 配置为"字符串型"属性时能读回所做的刻意取舍。
- 额外的扁平 `role` 是**非标准**字段；`active` 为 false 或 `role` 为 `null` 时缺席。
- `emails` 恒为单元素、`primary: true`、`type: "work"`，`value` 可能为 `null`。
- `name.givenName` 在 `user.name` 为空时回退为 `user.email`；`familyName` 在该情况下为字面量 `"SCIM"`（`||` 而非 `??`，所以空白名字的剩余部分为空串时也是 `"SCIM"`）。
- `meta.lastModified` 取"账号 `updatedAt`"与"该组织成员关系 `updatedAt`"的较晚者；两者都缺失时取账号时间。
- 键顺序为 `schemas, id, externalId, userName, displayName, name, active, roles, role, emails, meta`（`undefined` 的键被 `JSON.stringify` 丢弃，但实现应保持插入顺序）。

---

## 5. 五个 discovery 路由

对应文件：`ServiceProviderConfig.ts`、`ResourceTypes.ts`、`ResourceTypes/[id].ts`、`Schemas.ts`、`Schemas/[id].ts`。

### 5.1 共同的检查顺序（五个都相同）

| # | 检查 | 失败响应 |
| --- | --- | --- |
| 1 | `await runMiddleware(req, res, cors)` | — |
| 2 | `req.method !== "GET"` | `405 scimErrorBody(405, "Method not allowed")`（**在认证之前**；因此无认证的 `POST` 得 405 而不是 401） |
| 3 | `verifyAuthHeaderAndReturnScope` 的 `validKey` 为假 | `401 scimErrorBody(401, authCheck.error)`（`detail` 即 error 串，不加工） |
| 4 | `accessLevel !== "organization"` 或 `orgId` 为空 | `403 scimErrorBody(403, "Invalid API key. Organization-scoped API key required for this operation.")` |
| 5 | **没有** plan/权益检查 | discovery 在无 `admin-api` 的 plan 上仍然可用（这是刻意保留的，便于客户端知道为什么被拒） |

`405` 的 `detail` 恒为 `"Method not allowed"`，**不**列出允许方法。每个处理器在 405 前 `logger.error` 一条含方法与路由的日志（文案自由）。

### 5.2 `GET /api/public/scim/ServiceProviderConfig`

`200`，body 逐字段（键顺序固定）：

```
schemas:            ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"]
documentationUri:   "https://docs.litefuse.ai/scim"
patch:              { supported: true }
bulk:               { supported: false, maxOperations: 0, maxPayloadSize: 0 }
filter:             { supported: true, maxResults: 100 }
changePassword:     { supported: false }
sort:               { supported: false }
etag:               { supported: false }
authenticationSchemes: [
  { name: "Basic Authentication",
    description: "Authentication via HTTP Basic Auth",
    specUri: "https://tools.ietf.org/html/rfc2617",
    type: "httpbasic",
    primary: true }
]
meta:               { resourceType: "ServiceProviderConfig",
                      location: "/api/public/scim/ServiceProviderConfig" }
```

- `patch.supported` **必须为 `true`**：User 端点确实实现了 PATCH（`active`/`roles`/`name`，`emails` 为接受的 no-op），Okta 等客户端读这个标志决定能否用 PATCH 做取消配置与属性更新；声明为 false 会让客户端回退到 PUT/DELETE 或直接报错。
- `filter.supported: true` 与 `maxResults: 100` 反映的是列表端点支持一个**受限的** filter 语法与默认 `count=100`；`maxResults` 不作为硬上限强制执行（见 §9）。
- `bulk`/`changePassword`/`sort`/`etag` 恒为不支持；`sort.supported: false` 但列表端点会静默忽略 `sortBy`/`sortOrder`（不报错，见 §6.2）。

### 5.3 `GET /api/public/scim/ResourceTypes`

`200`：

```
schemas:      ["urn:ietf:params:scim:api:messages:2.0:ListResponse"]
totalResults: 1
Resources:    [ userResourceType() ]
```

**没有** `startIndex`、**没有** `itemsPerPage`（与 Users 列表不同）。

### 5.4 `GET /api/public/scim/ResourceTypes/{id}`

在 §5.1 的四步之后：

1. `id = typeof req.query.id === "string" ? req.query.id : ""`。
2. `id.toLowerCase() !== "user"` → `logger.warn` 后 `writeNotFound(res, "ResourceType " + id + " not found")`（`detail` 用**原始** `id`，可能为空串）。
3. 否则 `200` + `userResourceType()`（**裸对象**，不是 ListResponse 信封）。

即大小写不敏感：`/ResourceTypes/User`、`/ResourceTypes/user`、`/ResourceTypes/USER` 都返回同一声明。

### 5.5 `GET /api/public/scim/Schemas`

`200`：

```
schemas:      ["urn:ietf:params:scim:api:messages:2.0:ListResponse"]
totalResults: 1
Resources:    [ userSchemaDeclaration() ]
```

同样无 `startIndex`/`itemsPerPage`。

### 5.6 `GET /api/public/scim/Schemas/{id}`

1. `id = typeof req.query.id === "string" ? req.query.id : ""`。
2. `id !== "urn:ietf:params:scim:schemas:core:2.0:User"`（**逐字、大小写敏感**）→ `logger.warn` 后 `writeNotFound(res, "Schema " + id + " not found")`。
3. 否则 `200` + `userSchemaDeclaration()`（裸对象）。

URN 的大小写敏感是刻意的（URN 的 NSS 大小写敏感）；`/Schemas/urn:...:user` 是 404。Next 会把路径段里的百分号编码解码后交给 `req.query.id`，因此编码与未编码两种写法都能命中。

---

## 6. `web/src/pages/api/public/scim/Users/index.ts`（集合：GET / POST）

### 6.1 检查顺序（GET 与 POST 共用）

| # | 检查 | 失败响应 |
| --- | --- | --- |
| 1 | CORS | — |
| 2 | `req.method` 既不是 `"GET"` 也不是 `"POST"` | `405 scimErrorBody(405, "Method not allowed")`（认证**之前**） |
| 3 | 认证失败 | `401 scimErrorBody(401, authCheck.error)` |
| 4 | 非组织级 key | `403 scimErrorBody(403, "Invalid API key. Organization-scoped API key required for this operation.")` |
| 5 | plan 无 `admin-api` | `403 scimErrorBody(403, "This feature is not available on your current plan.")`（由 `rejectUnlessScimIsEntitled` 写响应，返回 true 后 `return`） |
| 6 | `logger.info` 一条请求日志 | — |
| 7 | 按 `req.method` 进入 GET / POST 分支 | — |

注意：`PUT`/`PATCH`/`DELETE` 到该路由 → 405（不管有没有认证）。

### 6.2 GET：列出本组织的用户

查询参数（`req.query`）：`filter`、`startIndex`、`count`。

1. 解析分页（用 `parseInt(x, 10)`，再按 SCIM 边界夹紧）：
   - `requestedStartIndex = parseInt(startIndex ?? 1, 10)`；`NaN` → `1`；否则 `Math.max(1, 值)`。
   - `requestedCount = parseInt(count ?? 100, 10)`；`NaN` → `100`；否则 `Math.max(0, 值)`。
   - 后果：负数 `startIndex` 夹到 1（不会产生负 `skip`）；负数 `count` 夹到 0（不会退化成 Prisma 的"从尾部取"）；`count=0` 返回空 `Resources` 但 `totalResults` 仍为真实总数；非数字回退默认 `1`/`100`。
2. filter 仅识别三种子串（都是**不区分大小写**的正则，**不锚定**，只用首个命中）：
   - `externalId eq "<值>"` → `where.user.id = <值>`（**优先**）；
   - `\bid eq "<值>"` → `where.user.id = <值>`；
   - `userName eq "<值>"` → `where.user.email = <值>.toLowerCase()`。
   - 三者用 `else if` 串联：一个 filter 里出现多个时，按 `externalId` > `id` > `userName` 取第一个。
   - 正则捕获 `[^"]+`（不含引号）；不支持 `and`/`or`/`ne`/`co`/`sw` 等，不支持转义。无法识别的 filter（或 `filter` 不是字符串）→ **不过滤**，返回全量（不报 400）。
   - `id`/`externalId` 的匹配值**不做**大小写或 trim 处理；`userName` 会 `toLowerCase()`。
3. `totalResults = organization_memberships.count({ where: { user: <whereClause>, orgId } })`。
4. `Resources` 来源：`organization_memberships.findMany({ where: { user: <whereClause>, orgId }, skip: <startIndex-1>, take: <count>, select: { id, role, updatedAt, user: true } })`。
   - **没有 `orderBy`**：返回顺序由数据库决定，规格与测试都不得依赖它；分页在无稳定序下跨页可能重复/漏项。
   - `select` **必须**是这四项；`user: true` 取 `users` 全列（含 `password`、`password` 哈希），但响应只通过 `toScimUser` 投影，绝不把 `users` 原始行返回。
5. 每个成员关系映射：`toScimUser({ user: row.user, role: row.role, active: true, membershipUpdatedAt: row.updatedAt })`。
   - 列表里的每个用户**恒为 `active: true`**（能列出来就是本组织成员）。
6. `200`：

```
schemas:      ["urn:ietf:params:scim:api:messages:2.0:ListResponse"]
totalResults: <count 查询结果>
startIndex:   <夹紧后的 startIndex>
itemsPerPage: <Resources.length>
Resources:    [ <toScimUser 结果…> ]
```

- 没有 `filter` 回显，没有 `sortBy`/`sortOrder` 处理，`attributes`/`excludedAttributes` 被忽略。
- 组织隔离：`where.orgId` 恒为调用方 `scope.orgId`；只返回本组织的 `organization_memberships`，因此也只暴露本组织可见的账号。
- 该分支所有异常被**本分支的** `try/catch` 捕获 → `500 scimErrorBody(500, "Internal server error")`（POST 分支同理；注意 handler 外层的 catch 不覆盖异步分支，见 §9）。

### 6.3 POST：按 `userName` 创建/复用账号并加入本组织

请求体先做：若 `typeof body === "string"`，`JSON.parse`；解析失败 → `400 scimErrorBody(400, "Invalid JSON body")`。

**按以下严格顺序**（每步失败即返回，不继续）：

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | `!userName \|\| typeof userName !== "string"` | `400 scimErrorBody(400, "userName is required")` |
| 2 | `normalizedUserName = userName.toLowerCase()`（**不 trim**） | — |
| 3 | `roles !== undefined && isEmptyRoleValue(roles)` | `400 scimErrorBody(400, EMPTY_ROLES_DETAIL)` |
| 4 | `roles` 为真值、是数组且 `length > 0`，但 `parseRequestedRole(roles)` 为 `null` | `400 scimErrorBody(400, "Invalid roles provided: " + JSON.stringify(roles) + ", must be one of OWNER, ADMIN, MEMBER, VIEWER, NONE")` |
| 5 | 第 4 步解析成功 | `role = <解析结果>`（否则保持默认 `"NONE"`） |
| 6 | `password` 非 `undefined`/`null`/`""`，且（不是字符串或 `!isValidPassword`） | `400 scimErrorBody(400, "Invalid password: must be a string of at least 8 characters")` |
| 7 | `password` 合法 | 记为待写入的明文（稍后 bcrypt cost 12） |
| 8 | `typeof externalId === "string" && externalId.trim().length > 0` → `users.findUnique({ id: externalId.trim() })` | 记为 `userByExternalId`（否则 `null`） |
| 9 | `users.findUnique({ email: normalizedUserName })` | 记为 `userByUserName`（可能 `null`） |
| 10 | 两者都非空且 `id` 不同 | `409 scimErrorBody(409, "externalId and userName refer to different users")`，**不写任何库** |
| 11 | `existingUser = userByExternalId ?? userByUserName`；`requestedName = parseRequestedName({ displayName, name })` | — |
| 12 | `existingUser` 非空，且 `organization_memberships.findUnique({ orgId_userId: { orgId, userId: existingUser.id } })` 命中 | `409 scimErrorBody(409, "User with this userName already exists")`，**不写任何库**（重复判定先于任何写入） |
| 13 | `existingUser` 非空且 `existingUser.email !== normalizedUserName` | 仅 `logger.warn`（邮箱不改，见下） |
| 14a | `existingUser` 非空且 `requestedName` 非空且 `!== existingUser.name` | `users.update({ id, data: { name: requestedName } })` |
| 14b | `existingUser` 非空且无需改名 | 直接复用该行（不 update） |
| 14c | `existingUser` 为空 | `users.create({ email: normalizedUserName, name: requestedName ?? undefined, password: passwordToStore ? <bcrypt> : undefined })` |
| 15 | 恒执行 | `organization_memberships.create({ userId: user.id, orgId, role })` |
| 16 | 恒执行 | `auditLog({ apiKeyId: scope.apiKeyId, orgId, resourceType: "orgMembership", resourceId: membership.id, action: "create", after: <membership 行> })`（**不在事务内**） |
| 17 | 成功 | `201` + `toScimUser({ user, role, active: true, membershipUpdatedAt: membership.updatedAt })` |

必须在规格中保留的语义与边界：

- **POST 完全忽略 `active`**：请求体里的 `active` 从不被读取；`active: false` 也会创建成员关系。POST 的语义是"确保账号存在并成为本组织成员"。
- **`userName` 是全局账号键**：`users.email` 在实例内唯一。同名用户若已存在（哪怕属于别的组织）会被**复用**：不改邮箱、不改密码、不改 SSO 绑定，只在本组织建成员关系（并可能改 `users.name`）。
- "重复"的定义是"该账号**已是本组织成员**"，不是"邮箱已存在"。因此同邮箱跨组织重复 POST 不会 409。
- 第 12 步的重复判定**先于**任何写入（含改名），且 `resourceId`/幂等性都由它兜住；角色变更属于 PATCH/PUT（last-OWNER 保护在那里），POST 永远不可能绕过它。
- 第 10 步的冲突判定**先于**第 12 步：`externalId` 指向 A、`userName` 指向 B 时是 409 "different users"，而不是 "already exists"。
- `externalId` 只用于**定位**已有账号（它被当作内部 `id`），**不会**被存储或回显；响应里的 `externalId` 恒为 `user.id`。
- `roles` 为标量（如 `"ADMIN"`）时：`isEmptyRoleValue` 为 false、`Array.isArray` 为 false → 第 4/5 步都跳过 → **静默落为 `NONE`**（不报错）。这是与 PATCH/PUT 的不一致（见 §9）。
- `roles: [{"value":"ADMIN"}]` 等复杂形态可用；多项取最低权限。
- `password` 只在**新建账号**时写；复用已有账号时即使带密码也不改密码（第 14a/14b 不含 password）。
- `password: ""` 视为未提供；`password: 123` → 400；`password: "1234567"` → 400。
- 用户名只做小写化，不做 trim、不做邮箱格式校验：`"  a@b.com "` 会被当成不同邮箱。
- 该分支的全部异常（含 `users.create` 的唯一约束失败、`JSON.stringify` 之外的任何 throw）由本分支 `try/catch` 捕获 → `500 scimErrorBody(500, "Internal server error")`。请求体为 `null` 时解构抛错也走这里 → SCIM 500 JSON（与 PATCH/PUT 不同，见 §9）。

---

## 7. `web/src/pages/api/public/scim/Users/[id].ts`（单项：GET / PATCH / PUT / DELETE）

### 7.1 检查顺序（四种方法共用）

| # | 检查 | 失败响应 |
| --- | --- | --- |
| 1 | CORS | — |
| 2 | `req.method` 不在 `["GET","DELETE","PATCH","PUT"]` | `405 scimErrorBody(405, "Method not allowed")`（认证之前） |
| 3 | 认证失败 | `401 scimErrorBody(401, authCheck.error)` |
| 4 | 非组织级 key | `403 scimErrorBody(403, "Invalid API key. Organization-scoped API key required for this operation.")` |
| 5 | plan 无 `admin-api` | `403 scimErrorBody(403, "This feature is not available on your current plan.")` |
| 6 | `logger.info` | — |
| 7 | `users.findUnique({ where: { id: req.query.id } })` | `null` → `404 scimErrorBody(404, "User not found")`（**先于**任何方法专属的请求体校验） |
| 8 | 按方法分派 | 见 §7.2–§7.5 |

注意：

- 第 7 步是**全局**存在性检查，不检查组织归属；因此 `PATCH/PUT/DELETE` 对"存在但只属于别的组织"的 `id` **不会** 404（只有 GET 有组织内 404）。
- `id` 不是字符串（`req.query.id` 为数组/undefined）时会原样透传给 Prisma，可能抛错 → 未捕获 rejection（见 §9）。
- 分派用 `switch`；理论上不可达的 `default` 仍返回 `405 scimErrorBody(405, "Method not allowed")`。
- 分派外层有一个 `try/catch`，但它 `return` 的是 async 函数的 Promise 而**没有 await**，因此"未预期的 DB 异常 → `500 scimErrorBody(500, "Internal server error")`"这条路径在 PATCH/PUT/GET/DELETE 上**不可达**（实测为 Next 默认 500，见 §9）。

### 7.2 GET：读取

1. `organization_memberships.findFirst({ orgId, userId: user.id })`。
2. `null` → `404 scimErrorBody(404, "User not found in organization")`（与全局 404 的文案不同）。
3. 命中 → 重新 `users.findUnique({ id })`（取写入后的最新行；读失败则回退到第 7 步的行）。
4. `200` + `toScimUser({ user: <最新行>, role: membership.role, active: true, membershipUpdatedAt: membership.updatedAt })`。

要点：GET 的 `active` 恒为 `true`；`role` 来自本组织成员关系；`meta.lastModified` 取账号与成员关系的较晚者。

### 7.3 PATCH：逐操作语义

PATCH 分两阶段：**先把所有操作解析/校验完（不写库）**，再在**一个事务**里按序应用。任何被拒绝的操作都会让整个请求回滚，前面已解析的操作一个也不落库。

#### 7.3.1 请求体整体校验（按序）

1. `typeof body === "string"` → `JSON.parse`，失败 → `400 scimErrorBody(400, "Invalid JSON body")`。
2. `!body.schemas || !Array.isArray(body.schemas) || !body.schemas.includes("urn:ietf:params:scim:api:messages:2.0:PatchOp")` → `400 scimErrorBody(400, "Invalid request body. Must include 'schemas' with 'urn:ietf:params:scim:api:messages:2.0:PatchOp'.")`。
3. `!body.Operations || !Array.isArray(body.Operations)` → `400 scimErrorBody(400, "Invalid request body. Must include 'Operations' array with at least one operation.")`。
   - **空数组 `[]` 通过**（`Array.isArray([])` 为真）：事务里循环 0 次 → `200` 返回当前用户（文案说"at least one"，但不强制，见 §9）。
4. 逐操作解析（见 7.3.2）；解析阶段只做校验与投影，不写库。

#### 7.3.2 单个操作的解析规则

令 `opValue`：

- 若 `op.path` 是非空字符串：按 `.` 或 `[` 切分，`attribute = 第 0 段 trim()`，`subAttribute = 第 1 段 trim()`（例如 `"name.givenName"` → attribute `"name"`、subAttribute `"givenName"`；`'roles[value eq "VIEWER"].value'` → attribute `"roles"`、subAttribute `'value eq "VIEWER"]'`，仅 name 处理会用到 subAttribute）。然后 `opValue = { [attribute]: op.value }`。
- 否则 `opValue = op.value`（path-less 形态）。

校验：

1. `op.op === "replace"`（**逐字小写**）**且** `opValue` 为真值且 `typeof === "object"`。否则 → `400` + `UNSUPPORTED_OPERATION_MESSAGE`。即 `add`/`remove`/`Replace` 全部不支持；`value` 为字符串/数字/布尔/`null` 且无 path 时也不支持。
2. 从 `opValue` 读 `active`、`roles`、`emails`、`name`、`displayName`。
3. `activePresent = value.active !== undefined`；`rolesPresent = value.roles !== undefined`。
4. `rolesPresent && isEmptyRoleValue(value.roles)` → `400` + `EMPTY_ROLES_DETAIL`。`hasRoleValue = rolesPresent`。
5. 名称（**从不因空值而拒绝**）：`value.displayName !== undefined || value.name !== undefined` → `nameRequested = true`；`requestedName = parseRequestedName({ displayName, name, subAttribute, currentName: projectedName })`；若非空则把 `projectedName` 推进为它。
   - `projectedName` 初值为 `user.name`，**按操作顺序**推进；因此 `name.givenName`（标量 path 形态）会用"前序操作已改过的名字"来补另一半。
   - `nameRequested` 为 true 但 `requestedName` 为 `null`（例如 `name: {}`、`name: []`、`displayName: null`）时**不算错误**，应用阶段只记一条 warn 日志、什么都不写。
6. `active` 处理（按序分支）：
   - `typeof value.active === "boolean"`：`membershipChange = value.active`；
     - 若 `value.active === true && hasRoleValue`：`requestedRole = parseRequestedRole(value.roles)`，`null` → `400` + `"Invalid roles provided: " + JSON.stringify(value.roles) + ", must be one of OWNER, ADMIN, MEMBER, VIEWER, NONE"`；
     - 若 `value.active === false`：角色**被忽略**（不解析、不报错，即使 `roles` 非空且非法）；`active` 胜出。
   - 否则若 `activePresent && value.active !== null`：`400` + `"Invalid value for active: " + JSON.stringify(value.active) + ", must be a boolean"`（`"false"`、`0`、`{}` 等；`null` 不走这里）。
   - 否则若 `hasRoleValue`（即 `active` 缺席或为 `null`，且 `roles` 非空）：`membershipChange = true`；`requestedRole = parseRequestedRole(value.roles)`，`null` → 同上的 400 invalid roles。
7. 识别判定：`!nameRequested && !activePresent && !rolesPresent && value.emails === undefined` → `400` + `UNSUPPORTED_OPERATION_MESSAGE`。
   - `emails` 只要存在（任意值）就"被识别"（应用阶段 no-op）。
   - `{op:"replace", path:"active"}`（无 `value`）→ `activePresent` 为 false、其余全 false → 400 unsupported。
   - `{op:"replace", path:"userName", value:"x"}` → 400 unsupported。
8. 解析结果入队：`{ op, nameRequested, requestedName, membershipChange, requestedRole, emailsPresent }`。

#### 7.3.3 应用阶段（单事务，按操作顺序）

对每个已解析操作，顺序恒为 **成员关系 → 名称 → emails**：

1. `membershipChange === true` → 开通（见 7.3.4，`role = requestedRole ?? undefined`）。
2. `membershipChange === false` → 取消配置（见 7.3.5），并记录"删除发生时刻"（用于响应 `meta.lastModified`）。
3. `nameRequested`：`requestedName` 非空 → 改 `users.name`（见 7.3.6）；为空 → warn 日志，不写。
4. `emailsPresent` → `logger.info`，**不写库、不报错**（邮箱是账号键，SCIM 只读）。

事务外层的 `catch`：若抛出的错误是内部的 `ScimWriteRejected`（携带 `status` + `detail`），写 `res.status(status).json(scimErrorBody(status, detail))` 并返回；**其它错误原样重新抛出**（→ 未捕获 rejection，见 §9）。

成功后响应：`respondWithResultingUser`（见 7.4）。

#### 7.3.4 开通（provision）

- 查 `organization_memberships.findUnique({ orgId_userId: { orgId, userId } })`。
- 已存在：
  - `role === undefined` 或 `existing.role === role` → **直接返回**（无写入、无审计）。所以周期性全量同步里"省略 role"不会把成员打回 NONE。
  - 否则先做 last-OWNER 保护（见 7.3.7）；通过后 `update({ role })`，再写一条 `action: "update"` 的审计（`before` 为更新前的成员关系行，`after` 为更新后的行，同一 `tx`）。
- 不存在：`create({ userId, orgId, role: role ?? "NONE" })`，再写一条 `action: "create"` 的审计（`after` 为新行，同一 `tx`）。

#### 7.3.5 取消配置（deprovision）

- 查 `organization_memberships.findUnique({ orgId_userId }, include: { ProjectMemberships: true })`。
- 不存在 → **直接返回**（幂等成功，无审计）。
- 存在 → 先做 last-OWNER 保护（`nextRole = null`）；通过后 `deleteMany({ id: membership.id })`；若 `count === 0` 直接返回；否则写一条 `action: "delete"` 的审计（`before` 为**含 `ProjectMemberships` 数组**的成员关系行，同一 `tx`）。
- 数据库级联：该成员关系行被删 → 其下所有 `project_memberships` 行被 Postgres 级联删除（因此审计的 `before` 保留了"用户原本能访问哪些项目"的信息）。
- **`users` 行不删**：账号、密码、SSO 绑定都保留。

#### 7.3.6 名称更新

- `name === user.name`（全等，含 `null` 比较）→ 不写。
- 否则 `users.update({ id, data: { name } })`，并把内存中的 `user.name` 同步为新值（响应据此报告新名）。
- **不写审计日志**；无唯一约束，因此不会失败。

#### 7.3.7 last-OWNER 保护（PATCH/PUT/DELETE 共用）

`nextRole` 语义：`undefined` → 不改角色（不检查）；`"OWNER"` → 用户保留/获得 OWNER（不检查）；其它角色或 `null`（取消配置）→ 会丢掉 OWNER 角色。

判定：

1. `nextRole === undefined || nextRole === "OWNER"` → 放行。
2. 查 `organization_memberships.findUnique({ orgId_userId })`；`membership?.role !== "OWNER"` → 放行（含"无成员关系"）。
3. `count({ where: { orgId, role: "OWNER" } })`（**包含目标自身**）；`> 1` → 放行。
4. 否则 `logger.warn` 并**抛** `ScimWriteRejected(403, "Cannot remove the last owner of an organization. Assign new owner or delete organization.")`。

它**抛异常而不是直接写响应**，是为了让所在事务回滚（多操作 PATCH 里前序写入不得残留）。DELETE 分支不在事务内，捕获后直接渲染 403。

**同一 PATCH 内按操作顺序逐个重新评估**：一个操作对成员关系的改动对它之后的操作可见（同一事务）。因此 `[{roles:["OWNER"]}（给 B 升 OWNER）, {active:false}（取消唯一原 OWNER A）]` 会成功，而相反顺序会在第一个操作就 403 并让整批回滚。顺序是契约的一部分。

### 7.4 PATCH/PUT 共用的结果响应

`respondWithResultingUser(req, res, user, orgId, membershipRemovedAt?)`：

- `organization_memberships.findFirst({ orgId, userId: user.id })`：
  - **不存在**（本次请求把它取消了）：重新 `users.findUnique({ id })`（失败回退到原行）；`200` + `toScimUser({ user, role: null, active: false, membershipUpdatedAt: membershipRemovedAt })`。即 `active: false`、`roles: []`、无 `role` 键、`meta.lastModified` 为取消发生时刻。**刻意不返回 404**：Okta 等把非 2xx 视为取消配置失败并重试/告警。
  - **存在**：委托给 GET 的处理（再查一次成员关系、重读账号、`200` + `toScimUser`）。因此 PATCH/PUT 成功后的响应体形状与 GET **逐字段一致**。
- `membershipRemovedAt` 是事务里 `new Date()`（不在事务内的 DELETE 不用它）。

### 7.5 PUT：全资源更新

请求体校验（按序，均在写库之前）：

1. `typeof body === "string"` → `JSON.parse`，失败 → `400` + `"Invalid JSON body"`。
2. `!body.schemas || !Array.isArray(body.schemas) || !body.schemas.includes("urn:ietf:params:scim:schemas:core:2.0:User")` → `400` + `"Invalid request body. Must include 'schemas' with 'urn:ietf:params:scim:schemas:core:2.0:User'."`。
3. `body.emails !== undefined` → `logger.info`（忽略，不写库；邮箱只读）。
4. `body.roles !== undefined && isEmptyRoleValue(body.roles)` → `400` + `EMPTY_ROLES_DETAIL`。
5. `requestedName`：`body.displayName !== undefined || body.name !== undefined` → `parseRequestedName({ displayName, name, currentName: user.name })`（**无 subAttribute**，不做 path 处理），否则 `null`。
6. `activeSupplied = typeof body.active === "boolean"`。
7. `activeSupplied && body.active === true && body.roles !== undefined` → `requestedRole = parseRequestedRole(body.roles)`；`null` → `400` + invalid roles（同上模板）。
8. 单事务应用（顺序 **名称 → 成员关系**）：
   - `requestedName` 非空 → 改 `users.name`（见 7.3.6）。
   - `activeSupplied` 且 `body.active === true` → 开通（`role: requestedRole ?? undefined`，见 7.3.4）。
   - `activeSupplied` 且 `body.active === false` → 取消配置（见 7.3.5），记录删除时刻。
   - `activeSupplied === false` → 成员关系**完全不动**。
9. 事务的 `ScimWriteRejected` → `403`（last-OWNER）；其它错误重抛。
10. `respondWithResultingUser`（同 7.4）。

必须保留的语义与边界（与 PATCH 的不对称都在这里）：

- **`roles` 只有在 `active === true` 时才被应用**。`active` 缺席或非布尔时，`roles`（即使合法）被**静默忽略**——全资源更新不得仅因缺少角色就降级成员。这与 PATCH（只有 `roles` 也能改角色）不一致。
- `active` 非布尔（`"false"`、`0`、`null`）→ 不报错、成员关系不动（PATCH 对同类值报 400）。
- `active: false` + 非空 `roles` → 取消配置，角色被忽略；但 `roles: []`/`null`/`""` 仍先触发 400（空值检查无条件执行）。
- `roles` 为标量字符串（`"ADMIN"`）→ `parseRequestedRole` 会包裹成数组并解析（与 POST 不同）。
- 已有成员关系 + `active: true` + 无 `roles` → 角色**不变**；无成员关系 + `active: true` + 无 `roles` → 以 `NONE` 新建。
- 已有成员关系 + `active: true` + 请求角色 = 当前角色 → 无写入、无审计（幂等）。
- `body.userName` 与 `body.id` **从不读取**：不能改邮箱，路径 `id` 才是目标。
- 同一次 PUT 里"先改名、后因 last-OWNER 被拒"→ 改名回滚（事务）。

### 7.6 DELETE：取消配置

1. 调用 7.3.5 的取消配置，但传入**全局 `prisma`**（不在事务内），因此成员关系删除与审计写入是两次独立提交。
2. `ScimWriteRejected` → `403 scimErrorBody(403, LAST_OWNER_MESSAGE)`。
3. 其它错误 → 重抛（未捕获，见 §9）。
4. 成功（无论是真删还是"本来就不存在"）→ **`204` 无响应体**（`res.status(204).end()`）。

必须保留的语义与边界：

- DELETE 删除的是**本组织的成员关系**，不是 `users` 行。账号、密码、SSO 绑定保留；再次 POST 同名 `userName` 会复用账号并重新建成员关系（`role` 默认或请求值）。
- 删除成员关系会级联删除该成员的 `project_memberships` 行。
- 目标在本组织无成员关系（但 `id` 在全实例存在）→ **204**（幂等），不是 404。
- `id` 在全实例不存在 → `404 "User not found"`（第 7.1 步第 7 项），早于任何写。
- 目标不是成员或不是 OWNER → 204；目标是唯一 OWNER → 403（`LAST_OWNER_MESSAGE`），成员关系不动。
- 组织里另有 OWNER 时，删掉其中一个 OWNER → 204。
- 不写"删除用户行"的审计；只在真的删了成员关系时写一条 `action: "delete"`、`resourceType: "orgMembership"`。

---

## 8. 数据库读写与文件/表清单

### 8.1 本批次触及的表

| 表（Prisma 模型） | 操作 |
| --- | --- |
| `users`（`User`） | 按 `id` 读（`externalId` 定位、handler 目标查找、响应重读）、按 `email` 读（`userName` 定位）、`create`（POST 新建账号）、`update`（仅 `name`；POST/PATCH/PUT） |
| `organization_memberships`（`OrganizationMembership`） | 按 `orgId_userId` 唯一键读；按 `orgId` + 关联 `user` 过滤的 `count` 与 `findMany`（`select: { id, role, updatedAt, user }`，无 `orderBy`）；`create` / `update({ role })` / `deleteMany({ id })`；按 `orgId`+`role` 的 `count` |
| `project_memberships`（`ProjectMembership`） | 仅通过 `include` 读取（用于 DELETE 审计的 `before`），以及被数据库级联删除 |
| `audit_logs`（`AuditLog`） | 仅写；`type = API_KEY`、`apiKeyId = scope.apiKeyId`、`orgId`、`projectId = NULL`、`resourceType = "orgMembership"`、`resourceId = 成员关系 id`、`action ∈ {create, update, delete}`、`before`/`after` 视操作而定 |

### 8.2 无读写的端点

- 5 个 discovery 端点：认证会读 `api_keys`（Redis/Postgres，由 `ApiAuthService` 负责，不属本批次）；除此之外不读写业务表。
- `scimAccess` / `scimDiscovery` / `scimUser` 三个模块：纯函数/常量，不读数据库、不做认证。

### 8.3 文件清单（行数）

| 文件 | 行数 |
| --- | --- |
| `web/src/features/public-api/server/scimAccess.ts` | 59 |
| `web/src/features/public-api/server/scimDiscovery.ts` | 290 |
| `web/src/features/public-api/server/scimUser.ts` | 297 |
| `web/src/pages/api/public/scim/ServiceProviderConfig.ts` | 94 |
| `web/src/pages/api/public/scim/ResourceTypes.ts` | 60 |
| `web/src/pages/api/public/scim/ResourceTypes/[id].ts` | 78 |
| `web/src/pages/api/public/scim/Schemas.ts` | 66 |
| `web/src/pages/api/public/scim/Schemas/[id].ts` | 78 |
| `web/src/pages/api/public/scim/Users/index.ts` | 405 |
| `web/src/pages/api/public/scim/Users/[id].ts` | 933 |
| **合计** | **2360** |

---

## 9. 特征测试计划

测试在**换入净室实现之前**先写、先跑、先在当前实现上变绿（L1）。全部尽量黑盒：HTTP 调用（`makeAPICall` / `makeZodVerifiedAPICall`，走 `http://localhost:3000`）+ Prisma 数据库状态断言 + 响应体断言。

### 9.0 环境前提

- Postgres 已迁移；dev server 由**被测 worktree**提供；CI seed 已跑（`seed-org-id`、`user-1` OWNER、`user-2` MEMBER）。
- **必须显式传认证**：`makeAPICall` 不传 auth 时会用 `pk-lf-1234567890/sk-lf-1234567890`（seed 中的**真实项目级** key），因此凡是要测"未认证/无效 key"的用例，都要显式传无效或空头；测组织级用例必须用现造的**组织级** key（照既有套件在 `beforeAll` 里 `createAndAddApiKeysToDb({ entityId: "seed-org-id", scope: "ORGANIZATION" })`）。
- 计划的解析前提：本 worktree 设了 `NEXT_PUBLIC_LITEFUSE_CLOUD_REGION="DEV"`，因此 plan 走 cloud 分支；`seed-org-id` 的 `cloudConfig.stripe.activeSubscriptionId + resolvedPlan` 使其解析为 `cloud:pro`（含 `admin-api`）。若要构造"无 `admin-api`"的组织，需新建/改一个 `cloudConfig.plan = "Developer"` 的组织（→ `cloud:developer`）。
- 用例文件建议新建 `scim-api-cases.servertest.ts`（不改既有文件）。

### 9.1 discovery：共同前置与错误（D1–D10）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| D1 | 5 个 discovery 路由任选 | 无 `Authorization` 头 GET | `401`，`schemas=["...Error"]`、`detail==="No authorization header"`、`status===401` | `scim-api` › ServiceProviderConfig/Schemas/ResourceTypes › "should return 401 when invalid API keys are provided" |
| D2 | 项目级 key（`pk-lf-1234567890`） | GET | `403`，`detail` 含 `Organization-scoped API key required` | 同上三个 describe › "should return 403 when using project API key instead of organization API key" |
| D3 | 组织级 key（**无** `admin-api` 的 plan 也可） | GET | `200`（discovery **不受** plan 门控） | `new` |
| D4 | 组织级 key | 对 discovery 发 `POST` | `405`，`detail==="Method not allowed"`（**无**允许方法列表） | 同上三个 describe › "should return 405 for non-GET methods" |
| D5 | **无**认证 | 对 discovery 发 `POST` | `405`（方法判定先于认证） | `new` |
| D6 | 无效 key | GET | `401`，`detail` 含 `Invalid credentials` | `new`（与 D1 同族） |
| D7 | 无效 Bearer token | GET | `401`，`detail==="Invalid authorization header"` | `new` |
| D8 | 组织级 key + CORS 预检 `OPTIONS`（带 `Origin`） | OPTIONS | 预检成功、带 `Access-Control-Allow-Origin`，**不**要求认证；确切状态码/响应头需实测后固化 | `new`（见 §9.13 第 20 条） |
| D9 | discovery 响应 | 检查 `Content-Type` | `application/json` | `new` |
| D10 | 组织级 key | 对 `/Users` 发 `PUT`（不受支持） | `405`，`detail==="Method not allowed"` | `scim-api` › SCIM Users API › GET /Users › "should return 405 for non-GET/POST methods" |

### 9.2 ServiceProviderConfig（D11–D15）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| D11 | 组织级 key | GET `/ServiceProviderConfig` | `200`；`schemas` 含 `...core:2.0:ServiceProviderConfig`；`patch.supported===true`；`filter.supported===true` | `scim-api` › ServiceProviderConfig › "should return service provider configuration with valid organization API key" |
| D12 | 同上 | 展开整包 | `documentationUri==="https://docs.litefuse.ai/scim"`；`bulk==={supported:false,maxOperations:0,maxPayloadSize:0}`；`filter==={supported:true,maxResults:100}`；`changePassword.supported===false`；`sort.supported===false`；`etag.supported===false` | `new` |
| D13 | 同上 | 检查 `authenticationSchemes` | 恰 1 项，`{name:"Basic Authentication", description:"Authentication via HTTP Basic Auth", specUri:"https://tools.ietf.org/html/rfc2617", type:"httpbasic", primary:true}` | `new` |
| D14 | 同上 | 检查 `meta` | `{resourceType:"ServiceProviderConfig", location:"/api/public/scim/ServiceProviderConfig"}` | `new` |
| D15 | 同上 | 检查无多余键 | 顶层键恰为上列 11 个（`schemas`…`meta`） | `new` |

### 9.3 Schemas / ResourceTypes 集合（D16–D22）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| D16 | 组织级 key | GET `/Schemas` | `200`；`schemas` 含 ListResponse；`Resources.length>=1`；`Resources[0].id` 含 User URN | `scim-api` › Schemas › "should return schemas with valid organization API key" |
| D17 | 同上 | 检查信封 | 只有 `schemas`/`totalResults`/`Resources` 三键；`totalResults===1`；**无** `startIndex`/`itemsPerPage` | `new` |
| D18 | 同上 | 展开 `Resources[0]` | `name==="User"`、`description==="User Account"`、`meta==={resourceType:"Schema", location:"/api/public/scim/Schemas/urn:ietf:params:scim:schemas:core:2.0:User"}`、`attributes.length===10`、属性名顺序为 `id,externalId,userName,displayName,name,emails,password,active,roles,meta` | `new` |
| D19 | 同上 | 检查关键属性元数据 | `id`{mutability:readOnly,returned:always,uniqueness:server,required:true}；`userName`{required:true,uniqueness:server,caseExact:false}；`password`{mutability:writeOnly,returned:never}；`roles`{type:"string",multiValued:true}；`emails`{type:"complex",multiValued:true} | `new` |
| D20 | 组织级 key | GET `/ResourceTypes` | `200`；`schemas` 含 ListResponse；`Resources.length>=1`；`Resources[0].id==="User"`；`endpoint==="/api/public/scim/Users"` | `scim-api` › ResourceTypes › "should return resource types with valid organization API key" |
| D21 | 同上 | 展开条目 | `schemas===["urn:ietf:params:scim:schemas:core:2.0:ResourceType"]`、`name==="User"`、`description==="User Account"`、`schema===User URN`、`schemaExtensions===[]`、`meta==={resourceType:"ResourceType", location:"/api/public/scim/ResourceTypes/User"}` | `new` |
| D22 | 同上 | 检查信封 | `totalResults===1`，无 `startIndex`/`itemsPerPage` | `new` |

### 9.4 单项 discovery（D23–D30）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| D23 | 组织级 key | GET `/ResourceTypes/User` | `200`，body **逐字段等于** `/ResourceTypes` 的 `Resources[0]`（裸对象，非信封） | `new` |
| D24 | 同上 | GET `/ResourceTypes/user`（小写） | `200`，同上（大小写不敏感） | `new` |
| D25 | 同上 | GET `/ResourceTypes/USER` | `200` | `new` |
| D26 | 同上 | GET `/ResourceTypes/Unknown` | `404`，`detail==="ResourceType Unknown not found"`，`status===404` | `new` |
| D27 | 同上 | GET `/Schemas/urn:ietf:params:scim:schemas:core:2.0:User` | `200`，body 逐字段等于 `/Schemas` 的 `Resources[0]`（裸对象） | `new` |
| D28 | 同上 | GET `/Schemas/urn:ietf:params:scim:schemas:core:2.0:user`（末段小写） | `404`，`detail==="Schema urn:ietf:params:scim:schemas:core:2.0:user not found"`（大小写敏感） | `new` |
| D29 | 同上 | GET `/Schemas/bogus` | `404`，`detail==="Schema bogus not found"` | `new` |
| D30 | 组织级 key | GET `/ResourceTypes/User` 与 `/Schemas/<urn>` | 均不受 plan 门控（在无 `admin-api` 组织上仍 `200`） | `new` |

### 9.5 Users 列表 GET（U1–U14）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| U1 | 组织级 key | GET `/Users` | `200`；`schemas` 含 ListResponse；`totalResults>=0`；`startIndex===1`；`itemsPerPage===Resources.length` | `scim-api` › SCIM Users API › GET /Users › "should return users with valid organization API key" |
| U2 | 已 POST 一个唯一邮箱用户 | GET `/Users?filter=userName eq "<邮箱>"` | `200`，`totalResults===1`，`Resources[0].userName===<邮箱>` | 同上 › "should support filtering by userName" |
| U3 | 无效 key | GET `/Users` | `401`，`detail` 存在 | 同上 › "should return 401 when invalid API keys are provided" |
| U4 | 项目级 key | GET `/Users` | `403`，`detail` 含 `Organization-scoped API key required` | 同上 › "should return 403 when using project API key instead of organization API key" |
| U5 | 无 `admin-api` 的 plan（`cloud:developer` 组织 key） | GET `/Users` | `403`，`detail==="This feature is not available on your current plan."` | `new` |
| U6 | 组织 2 个成员 | GET `/Users?count=0` | `200`，`totalResults===2`，`startIndex===1`，`itemsPerPage===0`，`Resources===[]` | `new` |
| U7 | 同上 | `?startIndex=-3` | `startIndex===1`（不产生负 skip，不 500） | `new` |
| U8 | 同上 | `?count=-5` | `itemsPerPage===0`，`Resources===[]`（不退化为"取尾部"） | `new` |
| U9 | 同上 | `?count=abc&startIndex=xyz` | 非数字回退默认：`startIndex===1`，`itemsPerPage===Resources.length`（全量） | `new` |
| U10 | 同上 | `?startIndex=2&count=1`（在 2 个成员上） | `Resources.length===1`，`totalResults===2`，`startIndex===2` | `new` |
| U11 | 用户 `user-1` | `?filter=externalId eq "user-1"`；再 `?filter=id eq "user-1"` | 两次都 `totalResults===1`，`Resources[0].id==="user-1"` | `new` |
| U12 | 同上 | `?filter=externalId eq "user-1" and id eq "user-2"` | `totalResults===1` 且为 `user-1`（`externalId` 优先） | `new` |
| U13 | 同上 | `?filter=displayName eq "x"`（不支持的属性）、`?filter=garbage` | 都 `200` 且**不过滤**（`totalResults` 等于全量） | `new` |
| U14 | 组织 2 个成员 | `?sortBy=userName&sortOrder=descending` | `200`，忽略排序（不得因此报错）；不得对顺序做断言 | `new` |

补充（不单独编号，可并入 U2/U10）：`userName` filter 的查询值必须 `toLowerCase()` 后才与 `users.email` 比较；`filter` 不含引号时不匹配 → 全量。

### 9.6 Users 列表表示（U15–U19）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| U15 | 用户 `user-1`（name `"Demo User"`，email `demo@litefuse.ai`，role OWNER） | GET 列表并取该条 | `schemas===["...core:2.0:User"]`；`id==="user-1"`；`externalId==="user-1"`；`userName==="demo@litefuse.ai"`；`displayName==="Demo User"`；`name==={formatted:"Demo User",givenName:"Demo",familyName:"User"}`；`active===true`；`roles===["OWNER"]`；`role==="OWNER"` | `new` |
| U16 | 同上 | 检查 `emails` | `[{primary:true, value:"demo@litefuse.ai", type:"work"}]` | `new` |
| U17 | 同上 | 检查 `meta` | `resourceType==="User"`；`created`/`lastModified` 为 ISO 字符串；`lastModified >= created` | `new` |
| U18 | 用户 `name` 为 `null` | 表示 | `displayName` 键缺席；`name.formatted===null`；`name.givenName===<email>`；`name.familyName==="SCIM"` | `new` |
| U19 | 列表响应 | 检查泄漏 | 每条**不得**出现 `password`、`hashedSecretKey` 之外的 `users` 原始列（尤其 `password`）；`role` 之外无其它内部字段 | `new` |

### 9.7 POST /Users（U20–U40）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| U20 | 组织级 key | POST `{userName:<唯一邮箱>, name:{formatted:"Test User"}, emails:[…], active:true}` | `201`；`userName===<邮箱>`；`name.formatted==="Test User"`；`emails[0].value===<邮箱>`；`users` 行 email/name 落库正确 | `scim-api` › POST /Users › "should create a new user with valid organization API key" |
| U21 | 同上 | POST 带 `password:"password-xxxx"` | `201`；响应**无** `password`；`users.password` 非空；`verifyPassword(明文, hash)===true` | 同上 › "should create a new user with password" |
| U22 | 同上 | POST 无 `userName` | `400`，`detail` 含 `userName is required` | 同上 › "should return 400 when userName is missing" |
| U23 | 同上 | POST `{userName, name:{formatted}, emails, active:true, roles:["ADMIN"]}` | `201`；`organization_memberships` 恰 1 行；`role==="ADMIN"` | 同上 › "should create a new user with specified role" |
| U24 | 同一 `userName` 已在本组织 | 再 POST 同 `userName` | `409`，`detail` 含 `already exists`；且不产生第二条成员关系、不改动账号 | 同上 › "should return 409 when user with the same userName already exists" |
| U25 | 同上 | POST `{userName:"", …}` | `400`，`detail==="userName is required"`（空串按缺失） | `new` |
| U26 | 组织级 key | POST `{userName, roles:[]}` | `400`，`detail===EMPTY_ROLES_DETAIL`（逐字） | `new` |
| U27 | 同上 | POST `{userName, roles:[null]}`、`roles:[{}]`、`roles:[""]` | 都 `400` + `EMPTY_ROLES_DETAIL` | `new` |
| U28 | 同上 | POST `{userName, roles:["SUPERUSER"]}` | `400`，`detail==="Invalid roles provided: [\"SUPERUSER\"], must be one of OWNER, ADMIN, MEMBER, VIEWER, NONE"` | `new` |
| U29 | 同上 | POST `{userName, roles:[{"value":"ADMIN"}]}` | `201`，库中 `role==="ADMIN"`（Okta 复杂形态） | `new` |
| U30 | 同上 | POST `{userName, roles:["OWNER","VIEWER"]}` | `201`，库中 `role==="VIEWER"`（取最低权限） | `new` |
| U31 | 同上 | POST `{userName, roles:"ADMIN"}`（标量） | `201`，库中 `role==="NONE"`（标量被静默忽略） | `new` |
| U32 | 同上 | POST `{userName, roles:["ADMIN", 5]}` | `201`，库中 `role==="ADMIN"`（数字项被丢弃） | `new` |
| U33 | 同上 | POST `{userName, roles:["ADMIN", ""]}` | `400` + invalid roles（空串项令整串失败） | `new` |
| U34 | 同上 | POST `{userName, password:"short"}`；再 `{userName2, password:12345}` | 都 `400`，`detail==="Invalid password: must be a string of at least 8 characters"` | `new` |
| U35 | 已存在账号 A（`id=A`，属于另一组织）与账号 B（`email=userNameB`） | POST `{userName:userNameB, externalId:A}` | `409`，`detail==="externalId and userName refer to different users"`，不写库 | `new` |
| U36 | 账号 A 存在但**不属于**本组织，邮箱 `a@x.com` | POST `{userName:"a@x.com"}` | `201`；账号被复用（`users.id===A`、email 不变）；本组织新增成员关系；密码/SSO 不变 | `new` |
| U37 | 账号 A 已是**别的组织**成员 | 用本组织 key POST 同 `userName` | `201`（不 409），A 同时成为本组织成员 | `new` |
| U38 | 账号 A 已在本组织 | POST `{externalId:A, userName:<任意新邮箱>}` | `409` "already exists"（重复判定按解析出的账号，不按邮箱是否已用） | `new` |
| U39 | 新账号 | POST `{userName, name:{givenName:"Alice", familyName:"Riddler"}}` | `201`，`users.name==="Alice Riddler"`；`name.formatted==="Alice Riddler"` | `new` |
| U40 | 新账号 | POST `{userName, displayName:"D", name:{formatted:"F"}}` | `201`，`users.name==="D"`（`displayName` 优先） | `new` |

补充（可并入上述）：`userName` 大小写 → 落库为小写（POST `"Alice@X.com"` → `users.email==="alice@x.com"`，响应 `userName` 同步小写）；POST 带 `active:false` 仍创建成员关系（`active` 被忽略）；POST 成功写一条 `audit_logs`（`resourceType==="orgMembership"`、`action==="create"`、`resourceId===membership.id`、`apiKeyId===` 调用方 key id、`type==="API_KEY"`、`before === NULL`）；POST 请求体为 `null` → `500` **SCIM JSON**（`detail==="Internal server error"`）。

### 9.8 GET /Users/{id}（U41–U46）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| U41 | `user-1`（本组织 OWNER） | GET `/Users/user-1` | `200`；`id==="user-1"`；`name.formatted==="Demo User"` | `scim-api` › GET /Users/{id} › "should return a specific user with valid organization API key" |
| U42 | 随机不存在的 id | GET | `404`，`detail` 含 `User not found` | 同上 › "should return 404 when user does not exist" |
| U43 | 全实例存在但**不属于**本组织的用户 | 用本组织 key GET | `404`，`detail==="User not found in organization"` | `new` |
| U44 | 本组织成员 | GET | `active===true`；`roles===[<role>]`；`role===<role>`；`externalId===id` | `new` |
| U45 | 本组织成员，某次 PATCH 改过 role | GET | `meta.lastModified >= membership.updatedAt`（成员关系变更反映在 `lastModified`） | `new` |
| U46 | 无效 key / 项目级 key | GET `/Users/user-1` | `401` / `403`（顺序同 §7.1） | `new` |

### 9.9 PATCH /Users/{id}（U47–U72）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| U47 | 组织级 key，本组织成员 | PATCH `{"schemas":[PatchOp],"Operations":[{"op":"replace","value":{"active":false}}]}` | `200`；`active===false`；`roles===[]`；`role` 键缺席；成员关系行消失 | `new` |
| U48 | 同上 | PATCH 同上但 **path 形态** `{"op":"replace","path":"active","value":false}` | 与 U47 等价 | `new` |
| U49 | 本组织成员 role NONE | PATCH `Operations:[{op:"replace", value:{roles:["ADMIN"]}}]`（无 active） | `200`；`roles===["ADMIN"]`；库中 role 变 ADMIN | `new` |
| U50 | 无成员关系的全局用户 | PATCH `{op:"replace", value:{roles:["MEMBER"]}}` | `200`；新建成员关系 role MEMBER；`active===true` | `new` |
| U51 | 本组织成员 NONE | PATCH `{op:"replace", value:{active:true, roles:["ADMIN"]}}` | `200`；role 直接变为 ADMIN（一次写入） | `new` |
| U52 | 本组织成员 ADMIN | PATCH `{op:"replace", value:{active:false, roles:["OWNER"]}}` | `200`；`active===false`；成员关系消失（`active` 胜出，角色被忽略，不 400） | `new` |
| U53 | 本组织成员 NONE | PATCH `{op:"replace", value:{roles:["SUPER"]}}` | `400`，`detail` 含 `Invalid roles provided: ["SUPER"]` | `new` |
| U54 | 同上 | PATCH `{op:"replace", value:{active:"false"}}` | `400`，`detail==="Invalid value for active: \"false\", must be a boolean"` | `new` |
| U55 | 同上 | PATCH `{op:"replace", value:{active:null}}` | `200`，成员关系/role 均不变（`null` 视为无值） | `new` |
| U56 | 同上 | PATCH `{op:"replace", value:{active:null, roles:["VIEWER"]}}` | `200`；role 变 VIEWER（`null` active + 有 role → 开通） | `new` |
| U57 | 同上 | PATCH `{op:"replace", value:{emails:[{value:"x@y.z"}]}}` | `200`；`userName` 不变；`users.email` 不变（emails 只读 no-op） | `new` |
| U58 | 本组织成员 name `"Old Name"` | PATCH `{op:"replace", path:"name.givenName", value:"New"}` | `200`；`users.name==="New Name"`（family 部分保留） | `new` |
| U59 | 同上 | PATCH `{op:"replace", path:"name.familyName", value:"Person"}` | `200`；`users.name==="Old Person"`（given 部分保留） | `new` |
| U60 | 同上 | PATCH `{op:"replace", value:{displayName:"Brand New"}}` | `200`；`displayName==="Brand New"`；`name.formatted==="Brand New"` | `new` |
| U61 | 同上 | PATCH `{op:"replace", value:{name:{}}}` | `200`（空 name 不报错），`users.name` 不变 | `new` |
| U62 | 本组织成员 name `"Old"` | PATCH `Operations:[{op:"replace",value:{displayName:"First"}},{op:"replace",value:{active:"nope"}}]` | `400`；**`users.name` 仍为 `"Old"`**（多操作原子性：全部回滚） | `new` |
| U63 | 唯一 OWNER `user-1` | PATCH `{op:"replace", value:{active:false}}` | `403`，`detail==="Cannot remove the last owner of an organization. Assign new owner or delete organization."`；成员关系仍在、role 仍 OWNER | `new` |
| U64 | 唯一 OWNER `user-1` | PATCH `[{value:{displayName:"X"}},{value:{roles:["MEMBER"]}}]` | `403`；**`users.name` 未改**（last-OWNER 回滚同请求的名称写入） | `new` |
| U65 | 组织有 2 个 OWNER | PATCH 把其中一个降为 MEMBER | `200`，role 变更成功 | `new` |
| U66 | 本组织成员 | PATCH `{op:"add", value:{active:true}}` | `400`，`detail===UNSUPPORTED_OPERATION_MESSAGE`（逐字） | `new` |
| U67 | 同上 | PATCH `{op:"replace", path:"userName", value:"x"}` | `400` + `UNSUPPORTED_OPERATION_MESSAGE` | `new` |
| U68 | 同上 | PATCH `{schemas:[PatchOp]}`（无 `Operations`） | `400`，`detail==="Invalid request body. Must include 'Operations' array with at least one operation."` | `new` |
| U69 | 同上 | PATCH `{Operations:[…]}`（无 `schemas`） | `400`，`detail==="Invalid request body. Must include 'schemas' with 'urn:ietf:params:scim:api:messages:2.0:PatchOp'."` | `new` |
| U70 | 同上 | PATCH `{schemas:[PatchOp], Operations:[]}` | `200`（空数组被接受），用户表示不变 | `new` |
| U71 | 同上 | PATCH body 为字符串 `"{invalid json"` | `400`，`detail==="Invalid JSON body"` | `new` |
| U72 | 随机不存在的 id | PATCH 带任何（哪怕非法）body | `404`，`detail==="User not found"`（存在性先于 body 校验） | `new` |

补充（可并入上述）：PATCH 空 `roles`（`[]`/`null`/`""`/`[null]`）→ `400` + `EMPTY_ROLES_DETAIL`；PATCH 成功后写审计（role 变更 `action==="update"` 带 `before`/`after`；新开通 `action==="create"`）；同一 payload 重复 PATCH = 幂等（无第二条审计、无多余成员关系）；PATCH body 为 `null` → Next 默认 **纯文本 500**（非 SCIM JSON，见 §9.13）。

### 9.10 PUT /Users/{id}（U73–U88）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| U73 | 本组织成员 | PUT `{schemas:[User], id, userName, active:false}` | `200`；`id` 正确；成员关系消失 | `scim-api` › PUT /Users/{id} › "should deactivate a user when active is false" |
| U74 | 已取消配置的账号 | PUT `{schemas:[User], id, userName, active:true}` | `200`；成员关系重建，`role==="NONE"` | 同上 › "should reactivate a user when active is true" |
| U75 | 同上 | PUT `{schemas:[User], id, userName, active:true, roles:["MEMBER"]}` | `200`；成员关系重建，`role==="MEMBER"` | 同上 › "should reactivate a user with specified role" |
| U76 | 本组织成员 | PUT 无 `schemas` | `400`，`detail` 含 `schemas` | 同上 › "should return 400 when SCIM schema is missing" |
| U77 | 随机不存在的 id | PUT 合法 body | `404`，`detail` 含 `User not found` | 同上 › "should return 404 when user does not exist" |
| U78 | 本组织成员 role MEMBER | PUT `{schemas:[User], roles:["ADMIN"]}`（**无 active**） | `200`；库中 role **仍为 MEMBER**（roles 被忽略） | `new` |
| U79 | 本组织成员 | PUT `{schemas:[User], active:"false"}`（非布尔） | `200`；成员关系不变（非布尔 active 被静默忽略，不 400） | `new` |
| U80 | 同上 | PUT `{schemas:[User], roles:[]}` | `400` + `EMPTY_ROLES_DETAIL`（空值检查无条件） | `new` |
| U81 | 同上 | PUT `{schemas:[User], active:true, roles:["SUPER"]}` | `400`，`detail` 含 `Invalid roles provided: ["SUPER"]` | `new` |
| U82 | 本组织成员 name `"Old"` | PUT `{schemas:[User], displayName:"New"}` | `200`；`users.name==="New"`；成员关系/role 不变 | `new` |
| U83 | 同上 | PUT `{schemas:[User], emails:[{value:"other@x.com"}]}` | `200`；`userName`/`users.email` 不变 | `new` |
| U84 | 同上 | PUT `{schemas:[User], userName:"renamed@x.com", id:"someone-else"}` | `200`；`users.email` 与目标 id **都不变**（`userName`/body `id` 从不读取） | `new` |
| U85 | 唯一 OWNER | PUT `{schemas:[User], active:false}` | `403` + last-OWNER 文案；成员关系仍在 | `new` |
| U86 | 唯一 OWNER name `"Old"` | PUT `{schemas:[User], displayName:"New", active:false}` | `403`；`users.name` 仍 `"Old"`（事务回滚名称写入） | `new` |
| U87 | 本组织成员 role ADMIN | PUT `{schemas:[User], active:true, roles:"ADMIN"}`（标量） | `200`；role 仍 ADMIN（标量可解析；与 POST 不同） | `new` |
| U88 | 无成员关系的全局用户 | PUT `{schemas:[User], displayName:"N"}`（无 active） | `200`；`users.name==="N"`；**不**创建成员关系；响应 `active===false` | `new` |

补充（可并入上述）：PUT 成功后响应形状与 GET 逐字段一致；`active:false` 后响应为 `active:false`（**200，不是 404**）；PUT body 为 `null` → Next 默认纯文本 500（见 §9.13）。

### 9.11 DELETE /Users/{id}（U89–U99）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| U89 | 本组织成员 | DELETE `/Users/{id}` 组织级 key | `204`（无 body）；`organization_memberships` 中该 `(orgId,userId)` 行消失；`users` 行**仍在** | `scim-api` › DELETE /Users/{id} › "should delete a user with valid organization API key"（现有断言用 `{id: userId}` 过滤成员关系，实际恒为空，属弱断言；见 §9.13） |
| U90 | 随机不存在的 id | DELETE | `404`，`detail` 含 `User not found` | 同上 › "should return 404 when user does not exist" |
| U91 | 成员有 `project_memberships` 行 | DELETE | `204`；成员关系消失，其 `project_memberships` 因级联消失 | `new` |
| U92 | 一次成功的 DELETE | 检查 `audit_logs` | 新增一行 `type==="API_KEY"`、`apiKeyId===` 调用方 key id、`resourceType==="orgMembership"`、`resourceId===membership.id`、`action==="delete"`、`before` 为 JSON 字符串（含 `ProjectMemberships` 数组）、`after===NULL` | `new` |
| U93 | 唯一 OWNER | DELETE | `403`，`detail===LAST_OWNER_MESSAGE`；成员关系仍在 | `new` |
| U94 | 组织有 2 个 OWNER | DELETE 其中一个 | `204` | `new` |
| U95 | 全局存在但非本组织成员 | DELETE | `204`（幂等 no-op）；不写审计 | `new` |
| U96 | 已成功 DELETE 一次 | 再 DELETE 同一 id | `204`（幂等） | `new` |
| U97 | 项目级 key / 无效 key | DELETE | `403` / `401` | `new` |
| U98 | 无 `admin-api` 的 plan | DELETE | `403` plan 文案 | `new` |
| U99 | 本组织普通成员 | DELETE | `users` 行保留；随后 POST 同名 `userName` → `201` 且复用同一 `users.id` | `new` |

### 9.12 权益与 helper 纯函数（U100–U110）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| U100 | — | `SCIM_REQUIRED_ENTITLEMENT` | `==="admin-api"` | `scim-entitlement` › "requires the admin-api entitlement" |
| U101 | plan `oss` / `cloud:developer` | `scimAllowedForPlan` | `false` | 同上 › `it.each(["oss","cloud:developer"])` "is unavailable on the %s plan" |
| U102 | plan `self-hosted:enterprise` / `cloud:pro` | `scimAllowedForPlan` | `true` | 同上 › `it.each(["self-hosted:enterprise","cloud:pro"])` "is available on the %s plan" |
| U103 | plan `null` | `scimAllowedForPlan` | `false` | 同上 › "is unavailable when the organization has no plan at all" |
| U104 | — | `SCIM_PLAN_REQUIRED_DETAIL` | `==="This feature is not available on your current plan."` | 同上 › "answers a blocked request with the plan message the admin API uses" |
| U105 | `normalizeRoleList` | 各种输入 | `["ADMIN"]`→`["ADMIN"]`；`"ADMIN"`→`["ADMIN"]`；`[{"value":"X"},{}]`→`["X"]`；`[5,null,true]`→`[]` | `new` |
| U106 | `parseRequestedRole` | 各种输入 | `["OWNER","NONE"]`→`"NONE"`；`["ADMIN","SUPER"]`→`null`；`[]`→`null`；`"ADMIN"`→`"ADMIN"`；`undefined`→`null` | `new` |
| U107 | `isEmptyRoleValue` | 各种输入 | `undefined/null/""/[]/[null]/[{}]/[{"value":null}]`→`true`；`5/"ADMIN"/[{"value":"ADMIN"},{}]`→`false` | `new` |
| U108 | `parseRequestedName` | 优先级 | `displayName` > `name.formatted` > `given+family`；`name` 为标量且 `subAttribute==="givenName"`/`"familyName"` 时与 `currentName` 合并；空值→`null` | `new` |
| U109 | `toScimUser` | 形状 | 键集恒为 `schemas,id,externalId,userName,displayName,name,active,roles,role,emails,meta`（`undefined` 键缺席）；`active=false` → `roles===[]` 且无 `role`；`externalId===id`；`familyName` 空时回退 `"SCIM"` | `new` |
| U110 | `scimErrorBody(400,"x")` | — | `{schemas:["urn:ietf:params:scim:api:messages:2.0:Error"], detail:"x", status:400}` | `new` |

补充：`userResourceType()` / `userSchemaDeclaration()` 每次调用返回**新对象**（连续两次调用互不共享引用，改一个不影响另一个）。

### 9.13 统计与既有测试映射

| 组 | 用例数 | 其中**带既有测试映射**的用例 | 映射到的既有用例 |
| --- | --- | --- | --- |
| 9.1 discovery 前置/错误 | 10 | 4（D1、D2、D4、D10） | `scim-api` 的 SPC/Schemas/ResourceTypes 三个 describe 的 401/403/405 共 9 条 + `SCIM Users API` 的 405 1 条 |
| 9.2 ServiceProviderConfig | 5 | 1（D11） | SPC › "should return service provider configuration with valid organization API key" |
| 9.3 Schemas/ResourceTypes 集合 | 7 | 2（D16、D20） | Schemas/ResourceTypes 各自的 200 用例 |
| 9.4 单项 discovery | 8 | 0 | — |
| 9.5–9.6 Users 列表 | 19 | 4（U1–U4） | `GET /Users` 的 200/filter/401/403 用例 |
| 9.7 POST | 21 | 5（U20–U24） | `POST /Users` 的 5 条 |
| 9.8 GET [id] | 6 | 2（U41、U42） | `GET /Users/{id}` 的 2 条 |
| 9.9 PATCH | 26 | 0 | — |
| 9.10 PUT | 16 | 5（U73–U77） | `PUT /Users/{id}` 的 5 条 |
| 9.11 DELETE | 11 | 2（U89、U90） | `DELETE /Users/{id}` 的 2 条 |
| 9.12 权益/helper | 11 | 5（U100–U104） | `scim-entitlement.servertest.ts` 的 5 个 `it` 块 |
| **合计** | **140** | **30** | 覆盖面见下 |

- 既有 `scim-api.servertest.ts` 的 **31 条 `it` 全部被映射**（4+4+4+5+5+2+5+2）；既有 `scim-entitlement.servertest.ts` 的 **5 个 `it` 块全部被映射**（其中 2 个是 `it.each`，展开后为 7 个 jest 用例）。
- 因此本计划共 **140 条特征用例**，其中 **30 条**带既有测试映射、**110 条为 `new`**；`new` 用例用于补齐 PATCH 全族、单项 discovery、plan 门控、审计、last-OWNER、多操作原子性、分页边界与表示细节。
- 各表"补充（可并入…）"的断言计入其所属用例，不另编号。

### 9.14 变异检查（证明测试有牙齿，实施时执行）

至少覆盖以下变异，每种只应让对应用例失败：

| # | 变异 | 预期失败用例 |
| --- | --- | --- |
| M1 | discovery 的方法判定移到认证之后（未认证 `POST` 变 401） | D5、D4 |
| M2 | discovery 也加上 plan 门控 | D3、D30 |
| M3 | `Users` 两个端点去掉 plan 门控 | U5、U98 |
| M4 | `ResourceTypes/{id}` 改回大小写敏感比较 | D24、D25 |
| M5 | `Schemas/{id}` 改成大小写不敏感 | D28 |
| M6 | `userResourceType().meta.location` 或 `endpoint` 改错 | D20、D21 |
| M7 | `ServiceProviderConfig.patch.supported` 改 `false` | D11 |
| M8 | `filter` 解析去掉 `externalId` 分支 | U11 |
| M9 | `filter` 优先级改为 `userName` 优先 | U12 |
| M10 | 列表分页去掉 `Math.max(1, …)`（负 `startIndex` → 500） | U7 |
| M11 | 列表分页去掉 `Math.max(0, …)`（负 `count` → 取尾部） | U8 |
| M12 | 列表响应去掉 `startIndex`/`itemsPerPage` | U1（既有 schema 直接失败） |
| M13 | 列表 `select` 改成 `include`（泄漏 `users.password`） | U19 |
| M14 | `parseRequestedRole` 改为取**最高**权限 | U30 |
| M15 | `isEmptyRoleValue` 对 `[]` 返回 false（空角色被静默忽略） | U26、U27、U80 |
| M16 | POST 重复判定（第 12 步）去掉 | U24、U38 |
| M17 | POST 的 `externalId`/`userName` 冲突判定去掉 | U35 |
| M18 | POST 让标量 `roles` 也走解析（`"ADMIN"` → ADMIN） | U31 |
| M19 | POST 读取并应用 `active` | U20 系列补充断言（`active:false` 仍建成员关系） |
| M20 | PUT 在 `active` 缺席时也应用 `roles` | U78 |
| M21 | PUT 对非布尔 `active` 报 400 | U79 |
| M22 | PATCH 去掉多操作"先全量校验后应用"（逐操作边校验边写） | U62 |
| M23 | PATCH 去掉 `prisma.$transaction`（部分写入不回滚） | U62、U64 |
| M24 | `rejectIfLastOwner` 的 `owners > 1` 改成 `>= 1` / 去掉 | U63、U64、U85、U86、U93 |
| M25 | `rejectIfLastOwner` 在 `nextRole === "OWNER"` 时也检查 | U65、U94（不应失败的反向断言） |
| M26 | DELETE 改删 `users` 行（而非成员关系） | U89（`users` 行仍在）、U99 |
| M27 | DELETE 去掉级联依赖（先删 `project_memberships` 外的做法）或改删别处 | U91 |
| M28 | 审计 `resourceType` 改成 `"membership"` | U92、9.7 补充断言 |
| M29 | PATCH/PUT 的 `respondWithResultingUser` 在无成员关系时返回 404 | U47、U73（既有 PUT 用例断言 200） |
| M30 | `toScimUser.externalId` 改为回显客户端 `externalId` | U15 |
| M31 | `toScimUser.familyName` 去掉 `"SCIM"` 回退 | U18 |
| M32 | `parseRequestedName` 把 `displayName` 降到 `name.formatted` 之后 | U40、U60 |
| M33 | 用户存在性检查（§7.1 第 7 项）移到 body 校验之后 | U72 |
| M34 | 组织级 key 检查放宽为任意 `accessLevel` | U4、D2 |

**无法检测的变异（不要作为"有牙齿"的变异）**：见 §9.12 第 2 条——外层 handler 的 `500 Internal server error` catch 对 PATCH/PUT/GET/DELETE 不可达，去掉它不会让任何用例失败。

---

## 10. 实现独立性纪律（净室）

- 本规格只约束**行为与对外契约**（导出名/签名、常量值、状态码、响应字段与嵌套、逐字错误串、校验顺序、表/列/过滤/事务/级联、审计字段、角色取值与最低权限规则、PATCH/PUT 逐操作语义）。内部函数命名、辅助函数拆分、注释、`logger.*` 文案、`import` 组织、控制流写法由实现者自行决定。
- **不得**打开、读取、`diff` 或 `grep` 上述 10 个目标文件的实现，也不得查看包含它们的 git 历史/提交 diff。
- 不得对包含目标文件的目录做**全仓 grep**；需要项目内约定时，直接打开本规格列出的具体路径（§1 只读参照与 `packages/shared/prisma/schema.prisma`）。
- 实现产物先写到**新的临时路径**（`*.impl.ts`），由主控审查后再换入原位。
- 完成后由主控补 `record.md`（实现者、输入清单、第一人称声明、任何意外暴露、实际检索命令）。
- 不得改动本批次的既有测试（`scim-api.servertest.ts`、`scim-entitlement.servertest.ts`），也不得改动 §1 的只读参照文件与 locale 文件。
- 提交前自查：10 个目标文件全部存在且导出符号齐全；5 个 discovery 端点无 plan 门控；两个 Users 端点有 plan 门控；所有 §2–§7 的逐字字符串未被改写。

---

## 11. 待解问题（Open questions）

以下行为按"现状即契约"保留；实现者必须复现，但项目组应知悉其可疑之处。凡经实测确认的，标注"已实测"；凡无法从可读代码确定的，明确标注"未确定"。

### 11.1 安全 / 数据丢失风险（优先）

1. **跨组织的全局账号写入。** `PATCH`/`PUT` 第 7.1 步只按 `id` 做**全实例**存在性检查，不校验该用户是否属于调用方组织；`updateUserName` 直接写 `users.name`（全局列）。因此持有 A 组织组织级 key 的一方，可以对"仅属于 B 组织的用户名下的账号"改显示名，或用 `active:true`/`roles` 把它拉进 A 组织。SCIM 的开通语义需要"按 userName 找到账号并加入本组织"，但"顺带改全局显示名"与"仅凭 id 探测/操作他组织账号"是超出开通必要范围的能力。是否应限制为"账号必须已属于本组织或由本组织创建"需要产品决策——**本规格要求先原样复现**。
2. **DELETE 的存在性探测。** 对全实例存在、但非本组织成员的 id，DELETE 返回 `204`；对不存在的 id 返回 `404`。因此能用 204/404 差异枚举实例内任意用户 id（GET 有组织内 404 兜住，PATCH/PUT 也不 404）。是否存在利用价值取决于 id 是否可猜（cuid，实际较难）。
3. **`users.email` 大小写：重复账号与"不可达账号"。** 代码在 POST/`filter` 里一律把 `userName` `toLowerCase()` 后与 `users.email` 比较，但 `users.email` 的唯一索引是**大小写敏感**的普通唯一索引（`CREATE UNIQUE INDEX "users_email_key" ON "users"("email")`，没有 `citext`/`lower()` 索引）。因此若库里已有一条 `"Alice@X.com"`（例如 SSO/历史数据写入的非小写邮箱）：
   - 用 `userName:"alice@x.com"` POST 时 `findUnique({ email: "alice@x.com" })` 查不到 → **新建第二个账号**（不会 500，因为两条 email 在唯一索引下不相等），实例里同时存在两个只差大小写的账号；
   - 该混合大小写账号用任何 `?filter=userName eq "…"` 都查不到（查询值总被小写化），只能靠 `id`/`externalId`（二者相同）访问；
   - 对小写化的那一份做重复/冲突判定时，混合大小写账号既不会被判为重复，也不会被当作冲突的 `userName` 一方。
   结论：**不会**出现 500，但会出现重复账号与"userName 查不到的账号"。**未确定**实际数据中是否存在非小写 email（seed 全小写）；属数据完整性风险。
4. **无稳定排序 + 分页。** GET `/Users` 的 `findMany` 没有 `orderBy`。IdP 常按页全量同步；在并发写入或数据库返回顺序变化时，跨页会重复或漏掉成员。`totalResults` 与 `Resources` 也可能因两次独立查询而在并发下不一致（count 与 findMany 之间没有事务）。
5. **last-OWNER 检查不是原子的。** 检查（`findUnique` + `count`）与写入在同一事务内，但默认隔离级别下没有行锁/SERIALIZABLE；两个并发"降级唯一 OWNER"的请求可能都读到 `owners===1` 之前的中间态并都通过，最终组织失去最后一个 OWNER。与批次 2 §9.18 同类。DELETE 分支的检查与 `deleteMany` 之间甚至**不在同一事务**（DELETE 用全局 client，两步独立）。
6. **`count` 无上限。** `count` 只做下界夹紧（`>= 0`），没有上界，也没有按 discovery 声明的 `filter.maxResults: 100` 截断；`?count=10000000` 会一次性把本组织全部成员读入内存并序列化。
7. **名称更新无审计。** `updateUserName` 只写 `users.name` 与一条 `logger.info`，不写 `audit_logs`；通过 SCIM 改显示名在审计面上不可见。是否应补审计是产品决策。

### 11.2 协议一致性 / 实现怪癖

8. **`externalId` 不落库。** 入参 `externalId` 只被当作内部 `id` 用来定位账号；响应里的 `externalId` 恒为 `user.id`。客户端提交一个自有 id（典型 SCIM 用法）后，既不会存下来也不会回显；后续 `filter=externalId eq "<自有 id>"` 查不到。`POST` 时若 `externalId` 不匹配任何账号，则被**静默忽略**（不报错、不存储）。
9. **POST 忽略 `active`。** SCIM 的 `active:false` 在创建语义上通常表示"建一个禁用账号"，这里完全被忽略（照样建成员关系）。**已实测**：代码路径中 `active` 从不被读取。
10. **POST 标量 `roles` 静默变 NONE。** `roles:"ADMIN"` 不报错也不生效（第 4/5 步要求数组），而 PATCH/PUT 对同一输入会解析出 ADMIN。三者不一致。
11. **PUT 在 `active` 缺席时忽略 `roles`。** 只有 `roles` 的 PUT 是静默 no-op；PATCH 同样的 payload 会改角色。`active` 非布尔时也不报错（PATCH 对同类值报 400）。
12. **`emails` 是"接受但忽略"的只读属性。** PATCH/PUT 都返回 200 并对 `emails` 只记日志；客户端以为改了邮箱，实际 `users.email`（也是 `userName`）不变。SCIM `userName` 变更在两端都被忽略。
13. **空 `Operations: []` 被接受。** 错误文案说 "at least one operation"，但空数组通过校验并返回 200 no-op。**已实测**。
14. **角色空值语义。** `roles: [{}]`/`[{"value":null}]` 判为"空"→ 400；`[{"value":"ADMIN"},{}]` 却不是空 → 解析出 ADMIN（空项被丢弃）；`["ADMIN",""]` 因空串项令整串失败 → 400；数字项被丢弃 → 成功。这些边界来自 `isEmptyRoleValue` 与 `normalizeRoleList` 的组合，是否都为有意无法确定。
15. **`roles` 输出形态。** 响应把 `roles` 输出为字符串数组（并额外给一个非标准扁平 `role`），而非 RFC 7643 的复数对象形态；discovery 声明也写成 `type:"string", multiValued:true`。对按标准形状配置的客户端可能不兼容——是刻意取舍（见 §4.7），需产品确认。
16. **过滤语法不是 SCIM。** 只识别三个正则子串，且只取第一个命中；`and`/`or`/括号/其它运算符被忽略。`externalId eq "a" and userName eq "b"` 这类合法 filter 只会应用前半段。已实测：无法识别的 filter 返回全量而不是 400。
17. **`sort.supported:false` 与静默忽略。** 列表接受并忽略 `sortBy`/`sortOrder`（不报 400）。声明与行为一致（都"不支持"），但"静默成功"会掩盖客户端配置错误。
18. **discovery 与 Users 的门控不对称。** discovery 无 plan 门控（刻意，便于客户端得到可诊断的 403）；Users 有。这是规格要求，不是缺陷。

### 11.3 未确定 / 依赖运行环境

19. **Next.js 对未捕获 rejection 的响应。** PATCH/PUT/GET/DELETE 分支里，非 `ScimWriteRejected` 的异常会被重新抛出，而 handler 的 `try { return handleX(...) } catch { 500 SCIM }` 因未 `await` 而**兜不住**：**已实测** PUT/PATCH body 为 `null` 时返回 Next 默认的 `500`、`Content-Type: text/plain`、body `Internal Server Error`（不是 SCIM JSON）；POST 分支因自带 `try/catch` 包裹 body 访问，同为 `null` 时返回 `500 {detail:"Internal server error"}`（SCIM JSON）。因此"DB 异常 → SCIM 500"只在 POST 分支成立。实现必须保留这种"分支内 catch / 外层 catch 不可达"的结构（或至少保持可观察结果一致）。Next 的默认 500 响应体在 dev/prod 或不同版本下**未确定**，测试不要对其逐字断言。
20. **CORS 预检的确切响应。** `cors` 中间件直接应答 `OPTIONS`，但状态码与响应头集合未在本批次冻结；需实测后固化（沿用批次 2 §9.16 的口径）。本规格只要求"预检在认证之前、不返回 401/403"。
21. **`req.query.id` 非字符串时**（重复动态段、数组）会被原样传给 Prisma `where.id`，可能抛 `P2023` 之类异常 → 走第 19 条的未捕获路径。实际路由下动态段恒为字符串，**未确定**是否可达。
22. **`users.createdAt`/`updatedAt` 可空性。** `toScimUser` 用 `user.createdAt?.toISOString()`（可空保护）但 schema 中两列非空；`created` 理论上恒存在。若历史数据为 NULL，`meta.created` 键会缺席，而 discovery 未把 `created` 标为 required。
23. **`users.email` 为 NULL 的账号。** `userName` 与 `emails[0].value` 会序列化为 `null`，违反既有测试 schema（`z.string()`）与 discovery 的 `userName required:true`。本批次没有任何端点能产生无邮箱账号，但 SSO/历史数据可能存在；行为**未确定**（返回 `null` 是可读代码的必然结果）。
24. **`documentationUri: "https://docs.litefuse.ai/scim"`。** 仓库内没有对应文档页（已检索 `*.md`/`*.mdx`），该 URL 是否真实可达未确定；若不可达，客户端会拿到死链。它不参与任何测试。
25. **`SCIM_LIST_SCHEMA` / `SCIM_PATCH_SCHEMA` / `SCIM_ROLE_VALUES` / `SCIM_USER_SCHEMA` 是"仅导出未见使用"的常量**（路由里直接写字面量 URN）。作为契约必须保留同名同值导出，但内部可自由决定是否引用。
26. **`filter.maxResults: 100` 与默认 `count=100` 的关系。** discovery 声明 `maxResults:100`，实现只把 100 当默认值，不当作上限；是否应强制截断未确定。

---

## 12. 既有测试的已知薄弱点（不改测试，仅在规格中登记）

- `DELETE /Users/{id}` 的既有用例用 `prisma.organizationMembership.findMany({ where: { id: testUserId } })` 断言删除结果，但 `testUserId` 是 **`users.id`**，而成员关系行的 `id` 是独立 cuid；该查询恒为空集，因此这条断言**不能证明**删除发生（它只证明了测试没崩）。`new` 用例 U89/U91/U99 必须按 `{ orgId, userId }`（并检查 `users` 行仍在）重新断言。
- 既有 `ScimUserSchema` 未断言 `externalId`、`active`、`roles`、`role`、`displayName`、`meta.lastModified`；这些需要 `new` 用例补齐（U15–U19）。
- 既有用例没有覆盖任何 PATCH（26 条 `new`）、单项 discovery（8 条 `new`）、plan 门控（U5/U98）、审计日志、last-OWNER（U63/U85/U93）、多操作原子性（U62/U64）。
- 既有 `makeAPICall` 在 DELETE 204 时返回 `{ body: {}, status: 204 }`，因此 204 可断言；但对 500 的**纯文本**响应体，`makeAPICall` 会因 JSON 解析失败而 **throw**（而非返回 `{status:500}`）——涉及第 11.3 节第 19 条的 `new` 用例应直接使用 `fetch` 或捕获该异常，不要依赖 `makeAPICall` 的返回体。

---

## K. 规格修订与主控决策（2026-10-15，测试阶段之前）

### K.1 已修复（独立提交 `ed9d88b`）：列表 `count` 按发现文档封顶

`GET /api/public/scim/Users` 现在把 `count` 限制在 **100**（即 `ServiceProviderConfig` 自己声明的 `filter.maxResults: 100`），超出部分不再交给数据库；负数/非数字的既有行为不变。
实测（该组织 101 个成员）：`count=1000` → `itemsPerPage=100`、`Resources.length=100`、`totalResults=101`；`count=50` → 50。日志见提交 `ed9d88b`。

### K.2 跨组织写：逻辑已确认（**待主控决策，尚未修复**）

`Users/[id].ts` 的分发器按**全局 user id** 取用户（第 365 行 `prisma.user.findUnique({where:{id}})`），**不校验该用户属于调用方组织**，随后把 `user` 交给各方法。四个方法的实测结果：

| 方法 | 是否有组织校验 | 用 org-A 的 key 操作"只属于 org-B 的用户"的实测结果 |
| --- | --- | --- |
| GET | ✅ 有（`handleGet` 返回 404 `"User not found in organization"`） | 404（安全） |
| **PATCH** | ❌ 无 | **200**，全局 `users.name` 被改成 `PWNED-BY-ORG-A`；再来一次 `active:true` 可把该用户**加进 org-A** |
| **PUT** | ❌ 无 | **200**，全局 `users.name` 被改成 `PUT-BY-A` |
| **DELETE** | ❌ 无 | **204**，但**没有真正删数据**（org-B 的成员关系与用户行都还在）→ 属"存在性探测"：真实存在但非本组织成员返回 204，未知 id 返回 404 |

修复方向（待批准）：在第 365 行取到用户之后、进入分发之前，要求存在 `organizationMembership(orgId, user.id)`，否则返回与 GET 一致的 404 SCIM 错误体。这样四个方法一致、且不改变"本组织成员"的正常路径。

### K.3 其余发现的决策

| 发现 | 决策 |
| --- | --- |
| 列表无稳定 `orderBy` / count 与 findMany 非事务 | 产品决策：**本批次不管** |
| SCIM 改名不写审计行 | 产品决策：**本批次不管** |
| `users.email` 大小写（见 §K.4） | 待主控决定（已补充说明） |
| 最后 owner 保护非原子 | 主控要求**给出修复方案**（见 §K.5），本批次不实现 |
| 发现文档 405-before-401、filter 优先序、PATCH 语义等 | 一律**保留现状**并写入验收测试 |

### K.4 `users.email` 大小写的实际后果（回答"Alice@x.com 会不会查不到"）

- 数据库约束是**区分大小写**的：`CREATE UNIQUE INDEX users_email_key ON users (email)`（无 `lower()`）。
- 而所有**应用侧查询都转小写**：SCIM 的 filter 路径 `userNameMatch[1].toLowerCase()`、建号/查重路径 `normalizedUserName = userName.toLowerCase()`；登录/注册/成员管理等写入路径也都 `.toLowerCase()`（`credentialsServerUtils`、`signupApiHandler`、`membersRouter`、`createProjectMembershipsOnSignup`、`server/auth.ts`）。
- **所以**：如果库里存在一行 `Alice@X.com`（可能来自历史数据、导入/迁移，或将来某条忘记规范化的写入路径），那么
  1. 任何按 `userName`/email 的 SCIM 查询**都找不到它**（查询被小写化，存量行没有）；
  2. 用 `alice@x.com` 走 SCIM POST **不会**撞唯一约束 → **为同一个人多建一个账号**；
  3. 该账号在依赖小写化的其它路径（如登录）也可能对不上。
- 需要澄清的一点：仓库内**现有**写入路径都做了小写化，因此这不是"日常操作必然触发"，而是"约束层面没有兜底 + 存量/未来遗漏就会静默出问题"。彻底修法是把约束变成 `UNIQUE (lower(email))` 并配套迁移（存量先小写化、处理碰撞），属独立的安全/数据批次。

### K.5 最后 owner 保护的原子性：修复方案（本批次不实现）

- **现状**：`rejectIfLastOwner` 先 `findUnique` + `count`，再由调用方执行 update/delete；PATCH/PUT 无锁，DELETE 的检查与删除甚至不在同一事务里。两个并发请求可以都通过检查 → 组织失去所有 OWNER。
- **方案（保持对外行为不变）**：
  1. 把"检查 + 写入"放进**同一个 `prisma.$transaction`**；
  2. 在该事务内先对 `organizations` 行取锁（`SELECT ... FOR UPDATE`）或使用 `isolationLevel: "Serializable"` 并在 `P2034` 序列化失败时重试一次 —— 同一组织的并发写被串行化；
  3. 保持 **403 的原文案**与响应结构不变（IdP 侧零感知），并发场景下最坏变成"重试/500"，而不是"组织没有 owner"；
  4. SCIM 侧与 tRPC 侧各自都有一份 last-OWNER 逻辑，应抽成同一个守卫，避免两边行为漂移；
  5. 配一条并发回归测试：同时发两个降级请求，断言**恰好一个成功**且该组织仍有 ≥1 个 OWNER。
