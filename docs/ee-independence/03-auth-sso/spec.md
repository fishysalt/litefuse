# 行为规格：auth / SSO（批次 3 之一，10 个文件）

- 状态：待实现
- 批次：3（第一批：auth + SSO；SCIM 三件套与 `web/src/pages/api/public/scim/**` 不在本文件范围）
- **角色（净室命名约定见 `../README.md`）**：本规格由 **Select DB** 撰写（该方已阅原实现，负责规格、测试与门禁）；实现方为 **Zhang Mo**（未接触原实现，仅依据本规格与验收测试编码）
- 目标文件（10 个）：
  - `web/src/features/enterprise/auth/requireAdminApi.ts`
  - `web/src/features/enterprise/auth/requireInstanceAdmin.ts`
  - `web/src/server/adminApiAuth.ts`
  - `web/src/features/enterprise/sso/ssoProviders.ts`
  - `web/src/features/enterprise/sso/ssoConfigSchema.ts`
  - `web/src/features/enterprise/sso/createSsoConfig.ts`
  - `web/src/pages/api/auth/add-sso-config.ts`
  - `web/src/pages/api/auth/check-sso.ts`
  - `web/src/pages/auth/enterprise-sso-required.tsx`
  - `web/src/pages/auth/sso-initiate.tsx`
- 只读参考（**MIT，本批次不得修改、不得重新许可**，但必须原样交互；见 §1）：
  - `web/src/features/auth/sso/enterpriseSso.ts`（懒加载网关：许可门 + 动态 import；加载失败 **fail closed**）
  - `web/src/features/auth/sso/isMultiTenantSsoAvailable.ts`
  - `web/src/features/public-api/server/adminApiGuard.ts`
  - `web/src/features/entitlements/server/resolveSelfHostedPlan.ts`
  - `web/src/features/entitlements/server/hasEntitlement.ts`
  - （另有两份只读事实来源：`packages/shared/src/encryption/encryption.ts`、`packages/shared/prisma/schema.prisma` 的 `SsoConfig` 模型）
- 相关既有测试（**已存在，本轮不得修改**）：
  - `web/src/__tests__/server/admin-api-key-auth.servertest.ts`（14 条，绿；**不经过本批次任何文件**，见 §12.12 与 §16.14）
  - `web/src/features/auth/sso/enterpriseSso.clienttest.ts`（3 条，绿；测的是 MIT 网关，不是本批次文件，但钉住了本批次必须满足的导出契约）
  - `web/src/__tests__/server/organizations-api.servertest.ts`（其中 `/api/admin/organizations*` 的 401/200 用例经由 `requireInstanceAdmin` → `AdminApiAuthService`）
  - `web/src/__tests__/server/organizations-and-projects-api.servertest.ts`（其中 H5、H6/H105、H106 断言了 `AdminApiAuthService` 的**精确错误串**）
  - 其余批次 2/2b 的 servertest 经由 `requireAdminApi`（本批次文件是薄转发层）

---

## 0. 契约边界

### 0.1 冻结 / 自由

| 冻结（必须完全一致） | 自由（可自行拟定） |
| --- | --- |
| 导出符号名与签名（尤其是 `ssoProviders.ts` 的 4 个导出，MIT 网关按名动态调用）；HTTP 方法与状态码；响应 JSON 的**键名**（`error` 还是 `message`）与**逐字错误串**；检查顺序与"哪个失败先赢"；`ssoProviderSchema` 的 provider 集合、字段名、类型、必填/可选、默认值、逐字校验消息、判别联合的成员顺序；`sso_configs` 的表/列、写入投影、加密算法与存储格式；`adminApiAuth` 的常量时间比较与 401/403 判定规则；`ssoProviders` 的缓存 TTL/失败重试/事务参数；SSO 提供商构造时传给 NextAuth 的选项集合 | 内部函数命名与拆分、注释、日志文案（`logger.*` 的字符串）、`import` 分组、错误对象构造方式、两个页面组件的 DOM 结构/类名/布局；`t(...)` 之外的用户可见文案措辞（但见 §0.2 的硬约束） |

### 0.2 文案与 i18n（`keySeparator: false`：英文串即 key）

**产出用户可见文案的文件只有两个**：`web/src/pages/auth/enterprise-sso-required.tsx`、`web/src/pages/auth/sso-initiate.tsx`。
**其余 8 个文件不产出任何 i18n key**：它们里的字符串全部是 HTTP 响应体或 `logger` 文案，由 API 消费方/运维读取，**不是** key。

- 两个页面用到的 `t()` key（共 15 个，已核对 **`en.json` 与 `zh-CN.json` 各存在 1 份**，因此本批次**可以不改 locale 文件**）：
  - `enterprise-sso-required.tsx`：`Enterprise SSO Required | Litefuse`、`Use your Enterprise SSO`、`This domain requires your company's custom Enterprise SSO.`、`You tried signing in with {{provider}}, but this domain requires your company's custom Enterprise SSO.`、`Enter your company email so we can send you to the correct identity provider.`、`Email`、`Invalid email address`、`Continue with Enterprise SSO`、`Contact <0>support@litefuse.ai</0> if this keeps happening.`（经 `<Trans i18nKey=...>`，**不是** `t()`）、`Back to other sign-in options`、`Need help? Contact`
  - `sso-initiate.tsx`：`Sign-in Error | Litefuse`、`SSO Sign-in Failed`、`Signing in | Litefuse`、`Redirecting to your identity provider...`
- **硬约束**：若实现者改写任何 `t(...)`/`<Trans i18nKey=...>` 的英文串，就必须在同一次提交里把新串加入 `web/src/features/i18n/locales/en.json` **和** `zh-CN.json`（zh 给中文译文）。验收命令 `pnpm run i18n:check`（`i18next-cli extract --ci && i18next-cli status`）：`extract --ci` 会在"提取结果与现有 locale 不一致"时失败，因此**多写**未使用的 key 同样会红。
- 两个页面里**有意不走 i18n** 的字符串（用户可见但是普通字面量，**不要**把它们加进 locale）：
  - `enterprise-sso-required.tsx`：`jsdoe@example.com`（占位符，各语言相同）、`support@litefuse.ai`（支持邮箱）、以及三条 `setError(...)` 文案（404 文案、非 404 的 fallback、catch 文案），逐字见 §9.3 第 3 条。
  - `sso-initiate.tsx`：`No SSO provider specified. Please contact your administrator.`、`Failed to initiate SSO sign-in. Please try again or contact support.`
- 若实现者保持这 15 个 key 与上述字面量**不变**，则本批次**不需要**改动 `en.json`/`zh-CN.json`。

### 0.3 净室纪律（摘要，完整版见 §14）

- 不得打开、读取、diff、grep 上述 10 个目标文件的**当前内容**，也不得查看包含它们的 git 历史/提交 diff。
- 不得对包含目标文件的目录做全仓 grep（需要项目内约定时，只打开本规格 §1 列出的具体路径、既有测试、locale、Prisma schema）。
- 实现产物先写到新的临时路径（`*.impl.ts` / `*.impl.tsx`），由 Select DB 审查后换入原位。

---

## 1. 只读依赖的精确契约（不得修改，只按此调用）

### 1.1 `web/src/features/public-api/server/adminApiGuard.ts`（MIT）

导出 `requireAdminApiScope(req: NextApiRequest, res: NextApiResponse): Promise<ApiAccessScope | null>`。三次检查，**严格按序**，任一失败即写响应并返回 `null`：

| # | 检查 | 失败响应 |
| --- | --- | --- |
| 1 | 解析并校验 `Basic` 头中的 API key（`ApiAuthService.verifyAuthHeaderAndReturnScope`） | `401 { "error": <auth.error> }`，典型 `"No authorization header"`、`"Invalid credentials"` |
| 2 | `auth.scope.accessLevel === "organization"` 且 `orgId` 非空 | `403 { "error": "Invalid API key. Organization-scoped API key required for this operation." }` |
| 3 | 该 key 所属组织的 `plan` 含 `admin-api` 权益 | `403 { "error": "This feature is not available on your current plan." }` |

成功时返回 `auth.scope`，**不写响应**。它必须留在 MIT：社区路由要能在不加载任何许可模块的前提下拒绝不可用操作。

### 1.2 权益与许可（MIT）

- `hasEntitlementBasedOnPlan({ plan, entitlement }: { plan: Plan | null; entitlement: Entitlement }) => boolean`：`plan` 为 `null` 时返回 `false`；否则查 `entitlementAccess[plan].entitlements` 是否包含该权益。
- `resolveSelfHostedPlan(licenseKey?: string): Plan | null`：`licenseKey` 为空 → `null`；以 `"litefuse_ee_"` 开头 → `"self-hosted:enterprise"`；否则 `null`。
- `entitlementAccess` 事实：`"admin-api"` 属于 `cloud:pro` 与 `self-hosted:enterprise`，**不属于** `oss` 与 `cloud:developer`；`"cloud-multi-tenant-sso"` 同属 `cloud:pro` 与 `self-hosted:enterprise`。

### 1.3 `web/src/features/auth/sso/isMultiTenantSsoAvailable.ts`（MIT）

导出常量 `isMultiTenantSsoAvailable: boolean`，在**模块求值时**一次性计算：
`Boolean(env.NEXT_PUBLIC_LITEFUSE_CLOUD_REGION || resolveSelfHostedPlan(env.LITEFUSE_EE_LICENSE_KEY))`。
即：只要设置了 Cloud region（`US | EU | STAGING | DEV | HIPAA | JP` 之一）即为 `true`；自托管则必须有 `litefuse_ee_` 前缀的许可。它被本批次文件**按值导入**（求值后不再变化）。

### 1.4 `web/src/features/auth/sso/enterpriseSso.ts`（MIT，网关；本批次的"调用方"）

- 对社区代码暴露 4 个异步函数，名字与签名**必须**与 §6 的 `ssoProviders.ts` 完全一致：`buildSsoProviders(): Promise<Provider[]>`、`hasSsoConfig(): Promise<boolean>`、`resolveSsoProviderIdForDomain(domain: string): Promise<string | null>`、`resolveMultiTenantSsoConfig({ providerId }: { providerId: string }): Promise<{ isMultiTenantSsoProvider: true; domain: string } | { isMultiTenantSsoProvider: false; domain: null }>`。
- `isMultiTenantSsoAvailable === false` → 不 import、直接返回 `[]` / `false` / `null` / `{false,null}`。
- `true` → `import("@/src/features/enterprise/sso/ssoProviders")`（**动态**，进程内成功结果缓存一次；**失败不缓存**，清空后重抛）。
- **FAIL CLOSED**：许可实例若加载不到实现（缺 chunk、模块初始化失败），4 个函数一律抛 `EnterpriseSsoUnavailableError`（`name === "EnterpriseSsoUnavailableError"`，`message` 含子串 `could not be loaded`），**绝不**返回 `null`/`[]`/`false`。`server/auth.ts` 的密码 `authorize` 回调与 `signIn` 回调把 rejection 当作登录失败，因此"域强制 SSO"不会在实现不可加载时静默退回密码登录。
- 本批次**不得**修改该网关；只能保证它动态 import 的模块导出符合契约。

### 1.5 加密（`@langfuse/shared/encryption`）

- `encrypt(plainText: string): string`：AES-256-GCM，密钥来自环境变量 `ENCRYPTION_KEY`（64 位十六进制 = 32 字节）；返回 `"<ivHex>:<cipherHex>:<authTagHex>"`（`iv` 12 字节随机，每次调用都不同）。`ENCRYPTION_KEY` 缺失时抛错，消息为 `` Error("Missing environment variable: `ENCRYPTION_KEY`") ``（逐字含反引号）。
- `decrypt(text: string): string`：逆运算；`ENCRYPTION_KEY` 缺失时抛同类错误；格式不是三段时抛 `Error("Invalid or corrupted cipher format")`；`authTag` 校验失败时抛 GCM 错误。
- 本批次只**调用**它，不修改它。

### 1.6 数据表 `sso_configs`（Prisma 模型 `SsoConfig`）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `domain` | `TEXT`，**主键** | 小写域名，如 `"google.com"` |
| `created_at` | `TIMESTAMP(3)`，默认 `CURRENT_TIMESTAMP` | — |
| `updated_at` | `TIMESTAMP(3)`，`@updatedAt` | — |
| `auth_provider` | `TEXT` | 判别标签，取值见 §5 |
| `auth_config` | `JSONB`，**可空** | `authConfig` 对象；**`clientSecret` 列在应用层加密**；`NULL` 表示"回退到全局社交登录凭据" |

无外键、无二级索引、无唯一约束（除主键）；无级联。

### 1.7 类型（`@langfuse/shared/src/server`）

`ApiAccessScope` 字段：`{ projectId: string | null; accessLevel: "organization" | "project" | "scores"; orgId: string; plan: Plan; rateLimitOverrides: ...; apiKeyId: string; publicKey: string; isIngestionSuspended: boolean | null | undefined }`。组织级 key 的 `projectId` 为 `null`、`accessLevel === "organization"`。

`Plan` 取值（`packages/shared/src/features/entitlements/plans.ts`，`planLabels` 的键）：`"oss" | "cloud:developer" | "cloud:pro" | "self-hosted:enterprise"`。仅此四值。

---

## 2. `web/src/server/adminApiAuth.ts`（实例 admin 凭据）

- 用途：实例管理接口的 `ADMIN_API_KEY` 认证与鉴权原语；既被本批次的 `requireInstanceAdmin`/`createSsoConfig` 使用，也被 MIT 的运维路由（`/api/admin/api-keys`、`/api/admin/bullmq`、`/api/admin/evals`、`/api/admin/ingestion-replay`）与 tRPC `adminProcedure` 使用。**注意：本文件当前不在 `LICENSE-EE` ANNEX A/B 的任何一侧**，见 §16.15。
- 导出：
  - `interface AdminAuthResult { isAuthorized: boolean; error?: string }`
  - `interface AdminAuthOptions { isAllowedOnLangfuseCloud?: boolean }`
  - `class AdminApiAuthService`
    - `static verifyAdminAuthFromAuthString(authString: string, options?: AdminAuthOptions): AdminAuthResult`（同步，**不写响应、不抛异常**）
    - `public static handleAdminAuth(req: NextApiRequest, res: NextApiResponse, options?: AdminAuthOptions): boolean`（同步；失败时自己写响应）

非导出常量（**必须保留同一文本**）：

| 名称 | 值 |
| --- | --- |
| 用于区分 401/403 的前缀 | `"Unauthorized"` |
| 无头时的错误 | `"Unauthorized: authorization header is missing"` |

### 2.1 `verifyAdminAuthFromAuthString` 的分支（**顺序即契约**）

设 `allowOnLitefuseCloud = options.isAllowedOnLangfuseCloud ?? false`，`cloudRegion = env.NEXT_PUBLIC_LITEFUSE_CLOUD_REGION`。

| # | 条件 | 返回 |
| --- | --- | --- |
| 1 | `!allowOnLitefuseCloud && cloudRegion && cloudRegion !== "DEV"` | `{ isAuthorized: false, error: "Not accessible on Litefuse Cloud" }`（**不检查 key、不检查 token**；`"DEV"` 视为本地/CI，放行到下一步） |
| 2 | `!env.ADMIN_API_KEY` | `logger.error("Rejected admin API request: no ADMIN_API_KEY configured")`（文案自由），然后 `{ isAuthorized: false, error: "ADMIN_API_KEY is not set" }` |
| 3 | `authString.split(" ")` 后 `scheme !== "Bearer"` **或** `!token` **或** token 与 `ADMIN_API_KEY` 的常量时间比较不相等 | `{ isAuthorized: false, error: "Unauthorized: Invalid token" }` |
| 4 | 其余 | `{ isAuthorized: true }`（**不带 `error` 键**，或值为 `undefined`） |

细节（必须复现）：

- `authString.split(" ")`：`scheme = parts[0]`、`token = parts[1]`；**只比较第二段**。因此 `"Bearer <正确key> extra1 extra2"` **认证通过**（尾部冗余被忽略）；`"bearer <正确key>"`、`"Basic <key>"`、`"Bearer"`（无第二段）全部落到第 3 步。
- 常量时间比较：先把两串 `Buffer.from(...)`；**长度不等直接返回 `false`**（`timingSafeEqual` 长度不等会抛，故必须先判长度）；长度相等才 `timingSafeEqual`。长度检查本身泄露 key 长度，属可接受现状。
- `verifyAdminAuthFromAuthString` 在任何分支都**不抛异常**。

### 2.2 `handleAdminAuth` 的分支

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | `req.headers.authorization` 为假值（缺失/空串） | `401`，响应体 `{ "error": "Unauthorized: authorization header is missing" }`，返回 `false`（**不调用** `verifyAdminAuthFromAuthString`） |
| 2 | `verifyAdminAuthFromAuthString(authorization, options).isAuthorized === true` | 返回 `true`，**不写任何响应** |
| 3 | 返回 `isAuthorized === false` | `status = outcome.error?.startsWith("Unauthorized") ? 401 : 403`；`res.status(status).json({ "error": outcome.error })`；返回 `false` |

要点：

- 401/403 由**错误串前缀**推导，而不是由分支位置决定：`"Unauthorized: Invalid token"` 与（无头时的）`"Unauthorized: authorization header is missing"` → 401；`"Not accessible on Litefuse Cloud"`、`"ADMIN_API_KEY is not set"` → 403。
- 响应键恒为 `error`；**从不用 `message`，也不带 `details`**。
- 成功时 `res` 完全不被触碰（测试可断言 `res.status`/`res.json` 未被调用）。
- 默认 `options` 为 `{}`：不传参数时 Cloud 上返回 403，这是 tRPC `adminProcedure`（MIT）的现状。
- `ADMIN_API_KEY` 未配置时的 403 **不是** 500，且此时不泄露 key 是否存在。§7.1 的 `createSsoConfig` 对同一配置错误给出 500（前置检查层），而 MIT 的 `createAuthedProjectAPIRoute.verifyAdminApiKeyAuth` 给出 500 `"Admin API key is not configured on this instance"`——三处行为不同，各自保留（见 §16.8）。

### 2.3 副作用

只有 `logger.error`（第 2 步）一种；无 DB、无 Redis、无 audit log、无缓存。

---

## 3. `web/src/features/enterprise/auth/requireInstanceAdmin.ts`

- 用途：实例管理路由（`web/src/pages/api/admin/organizations/**`，4 个路由文件，各 1 处 import + 1 处调用）的同步中间件；与 `requireAdminApi`（组织级 admin API）是两套彼此独立的机制。
- 导出：`requireInstanceAdmin(req: NextApiRequest, res: NextApiResponse): boolean`。
- 两次检查，**严格按序**；失败即写响应并返回 `false`：

| # | 条件 | 失败响应 |
| --- | --- | --- |
| 1 | `AdminApiAuthService.handleAdminAuth(req, res)` 返回 `false`（**不传 options** ⇒ Cloud 上会被 `verifyAdminAuthFromAuthString` 的 Cloud 拦截，§2.1 第 1 条） | 401/403，见 §2.2 |
| 2 | `hasEntitlementBasedOnPlan({ plan: resolveSelfHostedPlan(process.env.LITEFUSE_EE_LICENSE_KEY), entitlement: "admin-api" })` 为 `false` | `403 { "error": "This feature is not available on your current plan." }`，返回 `false` |

- 成功返回 `true`，**不写响应、不返回 scope**；调用方写法是 `if (!requireInstanceAdmin(req, res)) return;`。
- 许可读取用 **`process.env.LITEFUSE_EE_LICENSE_KEY`**（直接读进程环境，**不是** `env.`），每次调用都重新解析（测试可在运行时改 `process.env` 后直接调用本函数）。
- 推论（必须复现）：自托管但**无** `litefuse_ee_` 许可时，即便 `ADMIN_API_KEY` 正确，实例管理接口也一律 403；Cloud 上则更早地被 `"Not accessible on Litefuse Cloud"` 拦下。
- 顺序要点：**凭据先于许可**——既无头又无许可时是 401。
- 副作用：仅上述两处失败路径的日志/响应；无 DB、无 audit log。

---

## 4. `web/src/features/enterprise/auth/requireAdminApi.ts`

- 用途：组织级 admin API 守卫在**企业树里的入口**，把 `requireAdminApiScope` 重新导出为 `requireAdminApi`，使 ANNEX A 路由继续从企业树导入。
- 导出：`requireAdminApi(req: NextApiRequest, res: NextApiResponse): Promise<ApiAccessScope | null>`。
- 行为：**唯一一条语句** `return requireAdminApiScope(req, res);`。不得缓存、不得包装、不得改写返回值；401/403 的三种文案与顺序完全由 §1.1 决定（见 §11 的顺序表）。
- 消费者（7 个 ANNEX A 路由文件）：`/api/public/organizations/{apiKeys,memberships,projects}/index.ts`、`/api/public/projects/[projectId]/{index,apiKeys/index,apiKeys/[apiKeyId],memberships/index}.ts`。
- 无自身副作用；不读 DB、不读 env。

---

## 5. `web/src/features/enterprise/sso/ssoConfigSchema.ts`

- 用途：多租户 SSO 配置的 zod 校验模式集合。**provider id、字段名与协议事实**（NextAuth / IdP 共用）固定；只有校验代码是本项目自有。
- 依赖：`zod/v4`。
- 导出符号（**13 个具名 schema + 1 个判别联合 + 1 个类型**）：

| 导出 | 形态 |
| --- | --- |
| `googleSsoConfig` | `defineProvider("google", oidcFields)` |
| `githubSsoConfig` | `defineProvider("github", oidcFields)` |
| `githubEnterpriseSsoConfig` | `defineProvider("github-enterprise", { ...oidcFields, enterprise: z.object({ baseUrl: z.string().url() }) })` |
| `gitlabSsoConfig` | `defineProvider("gitlab", { ...oidcFields, issuer: z.string().optional() })` |
| `auth0SsoConfig` | `defineProvider("auth0", { ...oidcFields, issuer: z.string() })` |
| `oktaSsoConfig` | `defineProvider("okta", { ...oidcFields, issuer: z.string().startsWith("https://", { message: "Okta issuer must start with https://" }) })` |
| `authentikSsoConfig` | `defineProvider("authentik", { ...oidcFields, issuer: z.string().regex(/^https:\/\/.+\/application\/o\/[^/]+$/, { message: "Authentik issuer must look like https://<domain>/application/o/<slug> with no trailing slash" }) })` |
| `oneloginSsoConfig` | `defineProvider("onelogin", { ...oidcFields, issuer: z.string() })` |
| `azureAdSsoConfig` | `defineProvider("azure-ad", { ...oidcFields, tenantId: z.string() })` |
| `cognitoSsoConfig` | `defineProvider("cognito", { ...oidcFields, issuer: z.string() })` |
| `keycloakSsoConfig` | `defineProvider("keycloak", { ...oidcFields, name: z.string().optional(), issuer: z.string() })` |
| `jumpcloudSsoConfig` | `defineProvider("jumpcloud", { ...oidcFields, issuer: z.url(), scope: z.string().nullish() })` |
| `customSsoConfig` | `defineProvider("custom", { ...oidcFields, name: z.string(), issuer: z.string(), scope: z.string().nullish(), idToken: z.boolean().optional().default(false) })` |
| `ssoProviderSchema` | `z.discriminatedUnion("authProvider", providerVariants)` |
| `type SsoProviderConfig` | `z.infer<typeof ssoProviderSchema>` |

- 每个变体的顶层形状恒为：`{ domain, authProvider: z.literal(<tag>), authConfig: z.object(<字段>).nullish() }`。
- `domain`：`z.string().refine(值 === 值.toLowerCase(), { message: "Domains must be written in lowercase" })`（**只校验小写，不做 trim，不校验是否含点**）。
- `oidcFields`（所有 13 个变体共有）：
  - `clientId: z.string()`（必填）
  - `clientSecret: z.string()`（必填；**明文入参**，存储前加密由 §7.1 负责）
  - `allowDangerousEmailAccountLinking: z.boolean().optional().default(false)`
  - `tokenEndpointAuthMethod: z.enum(["client_secret_basic","client_secret_post","client_secret_jwt","private_key_jwt","tls_client_auth","self_signed_tls_client_auth","none"]).optional()`
- `providerVariants` 的**成员顺序**（决定判别联合报错的 issue 顺序，必须保持）：
  `google, github, github-enterprise, gitlab, auth0, okta, authentik, onelogin, azure-ad, cognito, keycloak, jumpcloud, custom`
  （注意 `custom` **在 `jumpcloud` 之后**，尽管源文本里 `custom` 的定义写在 `jumpcloud` 前面。）

### 5.1 解析语义（必须复现）

- 对象为**非 strict**：未知顶层键被**静默丢弃**（不报错、不进入输出）。
- `authConfig` 用 `.nullish()`：`undefined`（键缺失）与 `null` 都通过校验；输出中 `authConfig` **键缺失**（`undefined`）或保持 `null`。两者最终都落库为 `NULL`（见 §7.1）。
- `authConfig` 为对象时，`.default()` 生效：`allowDangerousEmailAccountLinking` 未给 → 输出 `false`；`custom.authConfig.idToken` 未给 → 输出 `false`。
- 判别失败（`authProvider` 缺失或不在 13 个取值内）→ 单条 issue：`code: "invalid_union"`、`path: ["authProvider"]`、`note: "No matching discriminator"`、`message: "Invalid input"`。
- `validate` 失败时**不抛**，由调用方用 `safeParse`（§7.1）。

---

## 6. `web/src/features/enterprise/sso/ssoProviders.ts`

- 用途：多租户 SSO 配置的 DB 读取、进程内缓存、按域解析 providerId、以及把配置转换成 NextAuth `Provider` 实例（含 `clientSecret` 解密）。**只能经 §1.4 的网关被社区代码触达**。
- 导出（**4 个函数，名字与签名是硬契约**，MIT 网关按名动态调用）：

| 导出 | 签名 |
| --- | --- |
| `buildSsoProviders` | `() => Promise<Provider[]>` |
| `hasSsoConfig` | `() => Promise<boolean>` |
| `resolveSsoProviderIdForDomain` | `(domain: string) => Promise<string | null>` |
| `resolveMultiTenantSsoConfig` | `({ providerId }: { providerId: string }) => Promise<{ isMultiTenantSsoProvider: true; domain: string } \| { isMultiTenantSsoProvider: false; domain: null }>` |

非导出（内部）常量与类型，值必须一致：

| 名称 | 值 |
| --- | --- |
| `CACHE_TTL` | `3_600_000`（1 小时） |
| `FAILED_RETRY_AFTER` | `60_000`（1 分钟） |
| `DB_MAX_WAIT` | `5_000` |
| `DB_TIMEOUT` | `5_000` |
| 模块级缓存 | `let ssoConfigCache: { data: SsoProviderConfig[]; failedToFetch: boolean; timestamp: number }`，初值 `{ data: [], failedToFetch: false, timestamp: 0 }` |
| `TokenEndpointAuthMethod` | 与 §5 `tokenEndpointAuthMethod` 的 7 个取值相同的字符串联合 |
| `ProviderAuthConfig` | `NonNullable<SsoProviderConfig["authConfig"]>` |
| `ClientConfig` | `{ client: { token_endpoint_auth_method: TokenEndpointAuthMethod } } \| Record<string, never>` |

### 6.1 `loadSsoConfigs`（内部，被上述 4 个导出共用）

1. `isMultiTenantSsoAvailable === false` → **立即返回 `[]`**，不读缓存、不读 DB、不改缓存。
2. 计算 `retryAfter = ssoConfigCache.failedToFetch ? FAILED_RETRY_AFTER : CACHE_TTL`；`cacheIsStale = Date.now() - ssoConfigCache.timestamp > retryAfter`（严格大于；初值 `timestamp = 0` 必然 stale）。
3. `cacheIsStale === false` → 直接返回 `ssoConfigCache.data`（**不查库、不重新解析**）。
4. stale → 用**一个事务**读取全部行：`prisma.$transaction(async (tx) => tx.ssoConfig.findMany(), { maxWait: DB_MAX_WAIT, timeout: DB_TIMEOUT })`。`ssoConfig.findMany()` **没有 `where`、没有 `select`、没有 `orderBy`**：读取全部列（含 `auth_config` 里加密的 `clientSecret`）与全部行、全部租户；顺序由数据库决定。
5. 读失败（事务异常）→ `logger.error("Unable to read the SSO configs from the database", e)`、`traceException(e)`，`dbConfigs` 保持 `[]`，`failedToFetch = true`（**错误被吞掉**，调用方看不到异常）。
6. 对每行独立 `ssoProviderSchema.parse(row)`：`row` 的 `createdAt`/`updatedAt` 因非 strict 而被丢弃；解析失败的行 → `logger.error` 记 `` Skipping SSO config of domain ${row.domain}: invalid schema ``，并 `traceException(e)`，该行返回 `null`，其余行不受影响；最后过滤掉 `null`。
7. **无条件**写回缓存：`{ data: parsed, timestamp: Date.now(), failedToFetch }`，并返回该 `data`。
8. 返回的是缓存数组本身（同一引用，不做拷贝）。

关键语义（安全相关，必须原样保留，见 §16.1/§16.2）：读库失败 ⇒ 缓存 `data: []` 并把后续 60 秒的查询都回答成"没有配置"；单行 schema 失效 ⇒ 该域静默失去 SSO 强制。也就是说**企业实现在"读库失败/单行失效"时是 fail-OPEN 的**，与 §1.4 网关"模块加载失败 fail-CLOSED"是两回事。

### 6.2 各导出函数的分支

| 函数 | 分支与结果 |
| --- | --- |
| `buildSsoProviders` | `isMultiTenantSsoAvailable === false` → `[]`；否则 `configs = loadSsoConfigs()`，逐个 `toNextAuthProvider`，过滤 `null` 后返回 |
| `hasSsoConfig` | `isMultiTenantSsoAvailable === false` → `false`；否则 `(await loadSsoConfigs()).length > 0`。**注意**：`authConfig` 为 `NULL` 的行也算一条配置，因此 `hasSsoConfig() === true` 可能与 `buildSsoProviders() === []` 同时成立（见 §16.5） |
| `resolveSsoProviderIdForDomain` | `isMultiTenantSsoAvailable === false` → `null`；否则在 `loadSsoConfigs()` 里找 `candidate.domain === domain.toLowerCase()` 的**第一条**（`find`，DB 顺序）；未命中 → `null`；命中 → `buildAuthProviderId(config)`。**不要求 `authConfig` 存在**：无 `authConfig` 时返回**裸 provider id**（回退到全局社交登录），有则返回 `domain.authProvider` |
| `resolveMultiTenantSsoConfig` | `configs = await loadSsoConfigs()`；先 `filter(Boolean(config.authConfig))` **再** `find(buildAuthProviderId(config) === providerId)`；命中 → `{ isMultiTenantSsoProvider: true, domain: matched.domain }`；未命中 → `{ isMultiTenantSsoProvider: false, domain: null }`。**没有** `isMultiTenantSsoAvailable` 早退（靠 `loadSsoConfigs` 返回 `[]` 达到同样效果） |

`buildAuthProviderId(config)`：`config.authConfig` 为假值 → `config.authProvider`；否则 `` `${config.domain}.${config.authProvider}` ``。
`toClientConfig(authConfig)`：`authConfig.tokenEndpointAuthMethod` 缺失 → `{}`；存在 → `{ client: { token_endpoint_auth_method: <值> } }`。

### 6.3 `toNextAuthProvider(config)`（内部）

- `config.authConfig` 为假值 → 返回 `null`（**不构造 provider**）。
- 否则：`providerId = buildAuthProviderId(config)`；`clientConfig = toClientConfig(config.authConfig)`；`clientSecret = decrypt(config.authConfig.clientSecret)`（**解密失败会抛，向上传播**）。
- 按 `config.authProvider` 分派，构造参数统一为 `{ id: providerId, ...config.authConfig, clientSecret, ...clientConfig }` 再加该 provider 的专属项：

| `authProvider` | 构造函数（来源） | 专属项（覆盖 spread 之后） |
| --- | --- | --- |
| `google` | `GoogleProvider`（`next-auth/providers/google`） | — |
| `github` | `GitHubProvider`（`next-auth/providers/github`） | — |
| `gitlab` | `GitLabProvider`（`next-auth/providers/gitlab`） | — |
| `auth0` | `Auth0Provider`（`next-auth/providers/auth0`） | — |
| `okta` | `OktaProvider`（`next-auth/providers/okta`） | — |
| `authentik` | `AuthentikProvider`（`next-auth/providers/authentik`） | — |
| `onelogin` | `OneLoginProvider`（`next-auth/providers/onelogin`） | — |
| `azure-ad` | `AzureADProvider`（`next-auth/providers/azure-ad`） | — |
| `cognito` | `CognitoProvider`（`next-auth/providers/cognito`） | — |
| `keycloak` | `KeycloakProvider`（`next-auth/providers/keycloak`） | — |
| `custom` | `CustomSSOProvider`（`@langfuse/shared/src/server`） | `authorization: { params: { scope: config.authConfig.scope ?? "openid email profile" } }` |
| `github-enterprise` | `GitHubEnterpriseProvider`（`@langfuse/shared/src/server`） | `enterprise: { baseUrl: config.authConfig.enterprise.baseUrl }` |
| `jumpcloud` | `JumpCloudProvider`（`@langfuse/shared/src/server`） | `authorization: { params: { scope: config.authConfig.scope ?? "openid email profile" } }` |
| 其他（类型上不可达） | — | 记 `logger.error` 与 `traceException`（`Unrecognized SSO provider for domain <domain>`，文案自由），返回 `null` |

- 因为 `...config.authConfig` 先展开、`clientSecret` 后覆盖，所以传给 NextAuth 的是**解密后的明文**，而 `authConfig` 中的其他字段（`clientId`、`issuer`、`scope`、`tokenEndpointAuthMethod`、`allowDangerousEmailAccountLinking`、`idToken`、`enterprise`、`tenantId`、`name`）原样透传；`tokenEndpointAuthMethod` 同时以顶层键和 `client.token_endpoint_auth_method` 两种形式传入（顶层那个 NextAuth 不识别，属现状）。
- 该 `switch` 的 `default` 分支在类型上被收窄为 `never`，运行期不可达（能到分派的 `authProvider` 必在判别联合内，早已通过 §6.1 第 6 步的 schema 过滤），见 §16.9。

### 6.4 秘密与副作用

- `clientSecret`：**只以密文形式落库**（`auth_config.clientSecret` = `encrypt(明文)`），仅在内存中解密后交给 NextAuth；本批次任何 HTTP 响应都**不**返回它（`check-sso` 只返回 `providerId`；`add-sso-config` 只返回 `message`）。
- 缓存里保存的是**未解密**的配置（密文仍在 `authConfig` 内），解密在每次 `buildSsoProviders()` 时按需进行。
- 无 Redis、无 audit log、无 DB 写；只有 `logger.error`/`logger.info` 与 `traceException`。

---

## 7. `createSsoConfig.ts` + `add-sso-config.ts`

### 7.1 `web/src/features/enterprise/sso/createSsoConfig.ts`

- 用途：创建多租户 SSO 配置（`POST /api/auth/add-sso-config` 的实现体）。
- 导出：`createSsoConfig(req: NextApiRequest, res: NextApiResponse)`（无显式返回类型；各分支只调用 `res.status(...).json(...)` 并 `return;`，成功分支同样不 `return` 响应对象，因此实际返回 `Promise<void>`；**不抛**——所有异常在内部被 `try/catch` 兜住）。
- 整体包在 `try { ... } catch (e) { logger.error("Could not store the new SSO configuration", e); res.status(500).json({ error: "Internal Server Error" }); }` 中。
- 分支（**顺序即契约**）：

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | `!isMultiTenantSsoAvailable` | `403 { "error": "Multi-tenant SSO is not enabled on this instance" }`，返回 |
| 2 | `req.method !== "POST"` | `405 { "error": "Method Not Allowed" }`（注意大小写与 §8 的 `"Method not allowed"` **不同**），返回 |
| 3 | `!env.ADMIN_API_KEY` | `500 { "error": "ADMIN_API_KEY is not set" }`，返回（**在认证之前**） |
| 4 | `!env.ENCRYPTION_KEY` | `500 { "error": "ENCRYPTION_KEY environment variable is missing" }`，返回（**在认证之前**） |
| 5 | `AdminApiAuthService.handleAdminAuth(req, res, { isAllowedOnLangfuseCloud: true })` 为 `false` | 401（无头 `"Unauthorized: authorization header is missing"` / 错 token `"Unauthorized: Invalid token"`）或 403（`"ADMIN_API_KEY is not set"`，实际被第 3 步挡住不可达），返回 |
| 6 | `ssoProviderSchema.safeParse(req.body).success === false` | `400 { "error": <ZodError 的 JSON 序列化> }`，返回 |
| 7 | `prisma.ssoConfig.findUnique({ where: { domain } })` 非空 | `logger.info("Rejected a duplicate SSO configuration", { domain })`，`409 { "error": `` Domain ${domain} already has an SSO configuration `` }`，返回 |
| 8 | 通过 | 组装待写数据并 `prisma.ssoConfig.create({ data: { domain, authProvider, authConfig } })` |
| 9 | 成功 | `201 { "message": "SSO configuration created successfully" }` |
| 10 | 第 8/9 步任何异常（含并发 P2002、FK 不可达、加密封装异常） | 落到 catch → `500 { "error": "Internal Server Error" }` |

细节：

- **第 6 步的 `error` 不是 `details`，也不是 issue 数组**：`ZodError` 在该 zod 版本上没有 `toJSON`，`res.json` 走 `JSON.stringify`，因此响应体形如
  `{"error":{"name":"ZodError","message":"[\n  {\n    \"code\": \"invalid_union\",\n ... ]"}}`
  ——`error` 是一个对象，键恰为 `name` 与 `message`，`message` 是 issue 数组的 JSON 文本（缩进 2 空格）。已实测三种输入（`{"domain":"Ok.com", ...}` → `code:"custom"`/`path:["domain"]`/`"Domains must be written in lowercase"`；未知或缺失 `authProvider` → `invalid_union`/`path:["authProvider"]`/`"No matching discriminator"`）。这与批次 2b 的 `{ error: "Invalid request body", details }` 约定**不同**。
- 落库投影：`domain`（小写）、`authProvider`、`authConfig`。
  - `authConfig` 存在时：`{ ...ssoConfig.authConfig, clientSecret: encrypt(ssoConfig.authConfig.clientSecret) }`——即 **`clientSecret` 用 §1.5 的 AES-256-GCM 加密后存入 JSON**，其余字段（含 `.default()` 补出的 `allowDangerousEmailAccountLinking: false`，以及 custom 的 `idToken: false`）**明文**存入。
  - `authConfig` 缺失或为 `null` → 传 `undefined` → Prisma 省略该列 → 落库 `NULL`（两者不可区分）。
- 唯一性：`domain` 是主键；第 6 步预检与第 8 步写入**不在同一事务**，并发下可能两个请求都通过预检，后到者以 `P2002` 落进 catch → `500 "Internal Server Error"`（而不是 409）。见 §16.4。
- 无审计日志、无缓存失效：**第 9 步不会清空 §6.1 的 `ssoConfigCache`**，新配置最长 1 小时后才被同进程看见（多进程/多实例部署各自计时）。见 §16.3。
- 不返回 `id`/`createdAt`，不返回任何密钥。
- 第 3、4 步分别使 `handleAdminAuth` 的 `"ADMIN_API_KEY is not set"` 与 catch 分支中的加密异常成为**实际不可达**（见 §16.8）。

### 7.2 `web/src/pages/api/auth/add-sso-config.ts`

- 用途：`POST /api/auth/add-sso-config` 的 Next.js 路由外壳。
- 导出：`export default async function handler(req: NextApiRequest, res: NextApiResponse)`。
- 行为：**唯一一条语句** `await createSsoConfig(req, res);`。无自己的 CORS、无 CORS 预检处理、无方法判断、无认证、无校验、无 `try/catch`、不写响应。
- 因此该路由对外可观察到的全部分支就是 §7.1 的分支表（已实测：`GET` → 405 `{"error":"Method Not Allowed"}`；`POST` 无头 → 401 `{"error":"Unauthorized: authorization header is missing"}`；`POST` 错 Bearer → 401 `{"error":"Unauthorized: Invalid token"}`）。
- 若被 `await` 的 `createSsoConfig` 抛异常（当前实现不会），由 Next.js 兜底，状态码/响应体形状不可静态确定（见 §16.12）。

---

## 8. `web/src/pages/api/auth/check-sso.ts`

- 用途：给定域名，回答该域是否配置了自定义 SSO，以及应当使用哪个 providerId。**未认证、无权益门控、无限流**。
- 导出：`export default async function handler(req: NextApiRequest, res: NextApiResponse)`。
- 请求体 schema：`z.object({ domain: z.string().min(1) })`（非 strict；未知键被丢弃；`domain` 不做 trim/小写化）。
- 分支（**顺序即契约**：方法 → 校验 → 查询）：

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | `req.method !== "POST"` | `405 { "message": "Method not allowed" }`（**键是 `message`**） |
| 2 | `safeParse(req.body)` 失败（无 body、非对象、`domain` 缺失/空串/非字符串） | `400 { "message": "Invalid request body" }`（不返回 issue 明细） |
| 3 | `resolveSsoProviderIdForDomain(domain)` 返回假值（`null`） | `404 { "message": "No SSO provider configured" }` |
| 4 | 返回非空字符串 | `200 { "providerId": <providerId> }` |

- 本路由**不调用** `isMultiTenantSsoAvailable`：未授权实例上，企业实现自身返回 `null` → **404**（而不是 403）；已配置域在无 `authConfig` 时返回**裸 provider id**（如 `"okta"`），有则返回 `"<domain>.<authProvider>"`。
- 域名匹配在 §6.2 内做 `toLowerCase()`，故 `{"domain":"ACME.COM"}` 能命中 DB 里的小写行；但**不会** trim，`"acme.com "` 命中不了。
- 无副作用、无日志、无 DB 写；响应键恒为 `message`。
- 若企业实现加载失败（许可实例但模块不可用），`resolveSsoProviderIdForDomain` 抛错 → 本 handler 无捕获 → 未处理 rejection，最终状态码/响应体由 Next.js 决定（**不可静态确定**，见 §16.12）；这正是 fail-closed 语义在 HTTP 层的投射（绝不能变成 200/404）。

---

## 9. `web/src/pages/auth/enterprise-sso-required.tsx`

- 用途：当某个域被强制走企业 SSO 时，让用户输入公司邮箱、查出 providerId 并跳转 IdP 的页面（`/auth/enterprise-sso-required`）。
- 导出：`export default function EnterpriseSsoRequiredPage()`（无 props）。
- 非导出常量：`EXAMPLE_EMAIL = "jsdoe@example.com"`（占位符）、`SUPPORT_EMAIL = "support@litefuse.ai"`、`enterpriseSsoFormSchema = z.object({ email: z.string().email() })`、`PROVIDER_LABELS`。

### 9.1 输入（URL query，全部经 `router.query` 读取）

| 参数 | 类型处理 | 用途 |
| --- | --- | --- |
| `email` | 仅当是 `string`，否则 `""` | 表单初值 |
| `attemptedProvider` | 仅当是 `string`，否则 `undefined` | 生成友好 provider 名 |
| `callbackUrl` | 仅当是 `string`，否则 `""` | 登录后跳转目标 |
| `reason` | **未被读取**（`server/auth.ts` 会带 `reason=sso_enforced_domain`，此页忽略） | — |

### 9.2 派生值

- `callbackUrl` 白名单：`rawCallbackUrl.startsWith("/") && !rawCallbackUrl.startsWith("//") ? rawCallbackUrl : "/"`。即只接受站内绝对路径；协议相对 `//evil.com` 与外部 URL 一律退化为 `"/"`（应用首页）。注释里说明这是为了不把空 `callbackUrl` 变成"当前页"而造成回环。
- `friendlyProviderName`：`attemptedProvider` 存在时取 `PROVIDER_LABELS[attemptedProvider] ?? attemptedProvider.replace(/-/g, " ")`；否则 `undefined`。
  `PROVIDER_LABELS` 恰好 14 项：`google→Google`、`github→GitHub`、`github-enterprise→GitHub Enterprise`、`gitlab→GitLab`、`azure-ad→Azure AD`、`okta→Okta`、`authentik→Authentik`、`onelogin→OneLogin`、`auth0→Auth0`、`cognito→Cognito`、`keycloak→Keycloak`、`workos→WorkOS`、`wordpress→WordPress`、`custom→Custom OAuth`（`workos`/`wordpress` 在 §5 的 schema 里不存在；`jumpcloud` 不在表里）。

### 9.3 行为

1. 表单用 `react-hook-form` + `zodResolver(enterpriseSsoFormSchema)`，`defaultValues.email = emailFromQuery`；`emailFromQuery` 变化时 `form.setValue("email", ...)`。
2. `sessionStatus === "authenticated"` 时：`useEffect` 里 `router.replace(callbackUrl)`，且**渲染 `null`**（避免闪现表单）。
3. `onSubmit(values)`：
   1. `setError(null)`、`setLoading(true)`；
   2. `domain = values.email.split("@")[1]?.toLowerCase()`；`!domain` → `form.setError("email", { message: t("Invalid email address") })`、`setLoading(false)`、返回（**因 email 已通过 `z.string().email()`，此分支实际不可达**，见 §16.10）；
   3. `POST ${env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth/check-sso`，`Content-Type: application/json`，body `{"domain": domain}`；
   4. `response.ok` → 取 `{ providerId }`，`await signIn(providerId, { callbackUrl })`，返回（由 NextAuth 接管跳转）；
   5. `status === 404` → `setError("We couldn't find a custom Enterprise SSO configuration for this domain. Double-check your company email or contact your administrator.")`（**逐字、不过 `t()`**）；
   6. 其他状态码 → 尽力解析 JSON，`setError(data?.message ?? "Unable to start the Enterprise SSO sign-in flow. Please try again.")`；
   7. 抛异常（网络/解析）→ `captureException(err)`（`@sentry/nextjs`）+ `setError("Something went wrong while checking your Enterprise SSO configuration. Please try again.")`；
   8. `finally` → `setLoading(false)`。
4. 渲染：`<Head><title>{t("Enterprise SSO Required | Litefuse")}</title></Head>`；标题 `t("Use your Enterprise SSO")`；描述按 `friendlyProviderName` 二选一（key 见 §0.2）；表单一个 `email` 字段（`FormLabel` 用 `t("Email")`，`Input` 占位符 `EXAMPLE_EMAIL`、`allowPasswordManager`、`autoComplete="email"`）；提交按钮文案 `t("Continue with Enterprise SSO")`，`loading` 时禁用；有 `error` 时渲染错误段落 + `<Trans i18nKey="Contact <0>support@litefuse.ai</0> if this keeps happening.">` 的 mailto 链接；页脚 `t("Back to other sign-in options")` 链接到 `/auth/sign-in`，以及 `t("Need help? Contact")` + `SUPPORT_EMAIL`。
5. 无数据获取（`getServerSideProps` 不存在）、无额外副作用。

---

## 10. `web/src/pages/auth/sso-initiate.tsx`

- 用途：`/auth/sso-initiate?provider=<providerId>` —— 立刻用给定 provider 触发 `signIn`，成功即跳转，失败显示错误页。
- 导出：`export default function SSOInitiate()`（无 props）。
- 行为：
  1. `useEffect`，依赖 `[router.isReady, router.query.provider]`；
  2. `!router.isReady` → 什么都不做（继续渲染 Spinner）；
  3. `const provider = router.query.provider as string | undefined`（**只是类型断言**：重复 query 参数时运行时会是数组，见 §16.11）；
  4. `!provider || provider === ""` → `setError("No SSO provider specified. Please contact your administrator.")`（**逐字、不过 `t()`**），返回；
  5. 否则 `signIn(provider)`（**不传 `callbackUrl`**，NextAuth 默认回当前页）；`then` 空实现（成功由 NextAuth 自动跳转）；`catch` → `console.error("SSO initiation error:", error)` 后 `setError(error instanceof Error ? error.message : "Failed to initiate SSO sign-in. Please try again or contact support.")`。
- 渲染：`error` 非空 → `<Head><title>{t("Sign-in Error | Litefuse")}</title></Head>` + `<ErrorPageWithSentry title={t("SSO Sign-in Failed")} message={error} />`；否则 `<Head><title>{t("Signing in | Litefuse")}</title></Head>` + `<Spinner message={t("Redirecting to your identity provider...")} />`。
- 可达性：仓库内**没有任何链接指向本页**（只有 `pathClassification.ts` 把 `/auth/sso-initiate` 列为无需认证路径），只能直接输入 URL 访问；见 §16.11。

---

## 11. 检查顺序总表（"哪个失败先赢"）

| 入口 | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| `AdminApiAuthService.handleAdminAuth` | 头缺失（401） | Cloud 区域拦截（403，除非 `isAllowedOnLangfuseCloud`） | `ADMIN_API_KEY` 缺失（403） | scheme/token 校验（401） | — | — |
| `requireInstanceAdmin` | 凭据（§2.2，401/403） | 实例许可 `admin-api` 权益（403 `This feature is not available on your current plan.`） | — | — | — | — |
| `requireAdminApi` / `requireAdminApiScope` | 认证（401） | 组织级 key（403） | 组织 plan 的 `admin-api`（403） | — | — | — |
| `createSsoConfig`（`POST /api/auth/add-sso-config`） | 实例可用性（403） | 方法（405） | `ADMIN_API_KEY` 存在性（500） | `ENCRYPTION_KEY` 存在性（500） | 认证（401/403） | 请求体 schema（400）→ 重复域（409）→ 写库（201/500） |
| `check-sso` | 方法（405） | 请求体 schema（400） | 域查询（404/200） | — | — | — |
| `enterprise-sso-required`（客户端） | 已认证则 `router.replace(callbackUrl)` | 表单 email 校验 | `check-sso` | 404 → 文案；其他 → `message`/fallback；抛错 → catch 文案 | `signIn(providerId, { callbackUrl })` | — |
| `server/auth.ts` 密码 `authorize`（MIT，交互约束） | `AUTH_DISABLE_USERNAME_PASSWORD` | `getSSOBlockedDomains()` | `resolveSsoProviderIdForDomain(domain)` → 非空则**抛 SSO 强制错误**（fail-closed） | 用户查询/口令校验 | — | — |
| `server/auth.ts` `signIn` 回调（MIT，交互约束） | email 合法性 | `resolveSsoProviderIdForDomain` → providerId 不匹配则重定向 `/auth/enterprise-sso-required?...` | `resolveMultiTenantSsoConfig` → provider 与域不匹配则抛 `This domain is not associated with this SSO provider.` | — | — | — |

> `handleAdminAuth` 的顺序要点：完全无头的请求**先**得到 401 `Unauthorized: authorization header is missing`，此时 Cloud 拦截尚未执行；只有"带了 `Authorization` 头但 Cloud 区域被禁"才得到 403 `Not accessible on Litefuse Cloud`。Cloud 拦截发生在 `verifyAdminAuthFromAuthString` 内部的最前面，先于 `ADMIN_API_KEY` 存在性检查与 token 比较。

---

## 12. 特征测试计划

写测试时**先在当前（未替换的）实现上跑绿**。全部尽量黑盒：HTTP（`makeAPICall`/`makeZodVerifiedAPICall`，`http://localhost:3000`）、Prisma 状态、模块级直接调用（仅当 HTTP 层不可达或需要改 env 时）、以及 `@testing-library/react` + `jest.mock("next-auth/react")` 的 clienttest。**不得**断言私有函数或内部结构。

- 建议新增：`web/src/__tests__/server/auth-sso-api.servertest.ts`（服务端，node 环境）与 `web/src/pages/auth/enterprise-sso.clienttest.tsx`（两个页面）。
- L2 门禁当前按套件名筛选（`pnpm run test -- organizations-api memberships-api projects-api admin-api-key-auth scim-api organizations-api-key-trpc keys-and-memberships-api organizations-and-projects-api`），**新套件名需由 Select DB 加进门禁清单**（实现者不改门禁脚本）。

### 12.0 环境前提

- Postgres 已迁移；dev server 在 `:3000` 且由被测 worktree 提供；`ADMIN_API_KEY` 已设置；`.env` 里有 `LITEFUSE_EE_LICENSE_KEY`（`litefuse_ee_` 前缀）与合法 `ENCRYPTION_KEY`（64 位十六进制）。
- 需要"未授权实例"或"Cloud 区域"或"`ADMIN_API_KEY` 未设"的用例：**不要在 HTTP 层做**（需要重启服务），改为**直接调用模块**，并用 `jest.mock` 把 `env` 换成可写副本（写法照 `admin-api-key-auth.servertest.ts`：`jest.requireActual` 后展开；注意该套件用的是**相对路径** `"../../env.mjs"`，因为 `jest.doMock` 不认 `@/` 别名）、用 `jest.mock` 覆盖 `isMultiTenantSsoAvailable`、以及运行时改 `process.env.LITEFUSE_EE_LICENSE_KEY` 来构造环境；`sso_configs` 行用 `prisma.ssoConfig.create` 直接造，用例结束删除。

### 12.1 `adminApiAuth.ts`（A1–A13）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| A1 | 无 `Authorization` 头 | `handleAdminAuth`（或经 `/api/admin/organizations`） | `401`，`body.error === "Unauthorized: authorization header is missing"` | 既有：`organizations-and-projects-api` H5（精确串） |
| A2 | `Bearer invalid-admin-key` | 同上 | `401`，`body.error === "Unauthorized: Invalid token"` | 既有：同上 H6/H105 |
| A3 | `Basic <base64>` | 同上 | `401`，`body.error === "Unauthorized: Invalid token"` | 既有：同上 H106 |
| A4 | `Authorization: "Bearer <正确key> extra"` | `handleAdminAuth` | 返回 `true`（只比较第二段） | new |
| A5 | `"bearer <正确key>"`（方案小写） | 同上 | `401 Invalid token` | new |
| A6 | `"Bearer"`（无第二段） | 同上 | `401 Invalid token` | new |
| A7 | `ADMIN_API_KEY` 未设 + `Bearer x` | 同上 | `403 { error: "ADMIN_API_KEY is not set" }`，且 `logger.error` 被调用 | new（模块级） |
| A8 | `NEXT_PUBLIC_LITEFUSE_CLOUD_REGION="US"`，options 缺省 | 同上（带**正确** key） | `403 { error: "Not accessible on Litefuse Cloud" }`（token 未被检查） | new（模块级） |
| A9 | 同 A8 但 `{ isAllowedOnLangfuseCloud: true }` | 同上 | 返回 `true` | new（模块级） |
| A10 | `NEXT_PUBLIC_LITEFUSE_CLOUD_REGION="DEV"` | 同上 | 按 token 正常判定 | new（模块级） |
| A11 | 正确 `Bearer <ADMIN_API_KEY>` | `handleAdminAuth` | 返回 `true` 且**未触碰** `res.status`/`res.json` | 既有（间接）：`organizations-api` 各成功用例（`GET /api/admin/organizations` 等 200） |
| A12 | 任一失败 | 同上 | 响应体键**恰为** `error`（无 `message`、无 `details`） | 既有（间接）：`organizations-api` 断言的 `body.error` 用例 |
| A13 | 与 `ADMIN_API_KEY` **长度不同**的 token | `verifyAdminAuthFromAuthString` | 返回 `{isAuthorized:false, error:"Unauthorized: Invalid token"}`，**不抛** | new |

### 12.2 `requireInstanceAdmin.ts`（B1–B5）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| B1 | `ADMIN_API_KEY` + `litefuse_ee_` 许可 | `requireInstanceAdmin` | 返回 `true`，未写响应 | 既有（间接）：`organizations-api` 管理路由 200 |
| B2 | 无头 / 错 token | 同上 | 返回 `false`，401（文案同 A1/A2） | 既有（间接）：`organizations-api` 的 6 条 no-header 401 + 1 条 invalid key 401 |
| B3 | 正确 Bearer + `process.env.LITEFUSE_EE_LICENSE_KEY` 未设 | 同上 | `403 { error: "This feature is not available on your current plan." }` | new（模块级） |
| B4 | `NEXT_PUBLIC_LITEFUSE_CLOUD_REGION="US"` + 正确 Bearer | 同上 | `403 { error: "Not accessible on Litefuse Cloud" }`（许可检查未被评估） | new（模块级） |
| B5 | 无头 + `LITEFUSE_EE_LICENSE_KEY` 未设 | 同上 | `401`（认证先赢），非 403 | new（模块级） |

### 12.3 `requireAdminApi.ts`（C1–C4）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| C1 | 组织级 key + 含 `admin-api` 的 plan | `await requireAdminApi(req,res)` | 返回**同一个** `scope` 对象（字段与 `requireAdminApiScope` 直调一致），未写响应 | 既有（间接）：`keys-and-memberships-api` 各成功用例 |
| C2 | 无头 | 同上 | `401`，`error` 为 `auth.error` | 既有（间接）：批次 2 用例 |
| C3 | 项目级 key | 同上 | `403 { error: "Invalid API key. Organization-scoped API key required for this operation." }` | 既有（间接） |
| C4 | plan 不含 `admin-api` | 同上 | `403 { error: "This feature is not available on your current plan." }` | 既有（间接）：`keys-and-memberships` C95 类 |

### 12.4 `ssoConfigSchema.ts`（D1–D14；纯模块级，无需 server）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| D1 | 13 个 provider 各自的合法最小配置 | `ssoProviderSchema.safeParse` | 全部 `success === true`，`authProvider` 原样 | new |
| D2 | `domain: "Ok.com"` | 同上 | 失败，issue `{ code:"custom", path:["domain"], message:"Domains must be written in lowercase" }` | new |
| D3 | `authConfig` 缺失 / 为 `null` | 同上 | 都成功；输出分别**无 `authConfig` 键** / `authConfig === null` | new |
| D4 | `authConfig` 为对象但未给默认值字段 | 同上 | 输出补出 `allowDangerousEmailAccountLinking: false`（custom 另补 `idToken: false`） | new |
| D5 | 顶层多一个未知键 | 同上 | 成功且未知键不出现在输出 | new |
| D6 | `okta` 且 `issuer: "http://x"` | 同上 | 失败，消息恰为 `Okta issuer must start with https://` | new |
| D7 | `authentik` 且 `issuer` 带尾斜杠 | 同上 | 失败，消息恰为 `Authentik issuer must look like https://<domain>/application/o/<slug> with no trailing slash` | new |
| D8 | `github-enterprise` 且 `enterprise.baseUrl` 非 URL | 同上 | 失败 | new |
| D9 | `azure-ad` 缺 `tenantId` | 同上 | 失败 | new |
| D10 | `custom` 缺 `name`/`issuer`；`jumpcloud.issuer` 非 URL | 同上 | 失败 | new |
| D11 | `tokenEndpointAuthMethod: "bogus"` | 同上 | 失败；7 个合法值逐个通过 | new |
| D12 | `authProvider: "nope"` 或缺失 | 同上 | 失败，单条 issue `code:"invalid_union"`、`path:["authProvider"]`、`note:"No matching discriminator"` | new |
| D13 | `gitlab` 无 `issuer`；`keycloak` 无 `name`；`custom.scope: null` | 同上 | 都成功 | new |
| D14 | 缺 `clientId` 或 `clientSecret` | 同上 | 失败（两者必填） | new |

### 12.5 `ssoProviders.ts`（G1–G18）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| G1 | 未授权实例（mock `isMultiTenantSsoAvailable=false`） | 4 个导出各调一次 | `[]` / `false` / `null` / `{false,null}`，且 `prisma.$transaction` **未被调用** | new（模块级） |
| G2 | 授权实例但 `sso_configs` 为空 | 4 个导出 | `[]` / `false` / `null` / `{false,null}` | new |
| G3 | 一条 `authConfig` 齐全的行（`domain:"acme.test"`、`authProvider:"okta"`，`clientSecret` 用 `encrypt` 加密后写库） | `buildSsoProviders()` | 恰 1 个 provider，`id === "acme.test.okta"`，其 `clientSecret` 等于加密前的明文 | new |
| G4 | 一条 `authConfig` 为 `NULL` 的行 | 4 个导出 | `buildSsoProviders()` → `[]`；`hasSsoConfig()` → `true`；`resolveSsoProviderIdForDomain("acme.test")` → `"okta"`（裸 id） | new |
| G5 | 一有效行 + 一无效行（如 `authProvider:"nope"`） | `buildSsoProviders()` | 仍返回有效那一个；`logger.error` 被调用一次，且不抛 | new |
| G6 | 行域为 `acme.test` | `resolveSsoProviderIdForDomain("ACME.TEST")` / `("other.test")` | 前者命中，后者 `null` | new |
| G7 | 有/无 `authConfig` 两行 | `resolveSsoProviderIdForDomain` | 分别返回 `"<domain>.<provider>"` / `"<provider>"` | new |
| G8 | 先调一次 `hasSsoConfig()`，再插一行 | 再调 `resolveSsoProviderIdForDomain(新域)` | 未命中（TTL 内不重读库） | new |
| G9 | 注入读库失败（mock `$transaction` 抛错） | 连续两次 `hasSsoConfig()` | 都 `false`；`$transaction` 只被调用一次（失败结果被缓存）；若等待 `>60s` 则重试（可用长超时用例或标注为手工） | new |
| G10 | 行含 / 不含 `tokenEndpointAuthMethod` | `buildSsoProviders()` | 前者 provider 上有 `client.token_endpoint_auth_method`，后者无 `client` 键 | new |
| G11 | 裸 id 的 `providerId` 对应一条无 `authConfig` 的行 | `resolveMultiTenantSsoConfig({providerId:"okta"})` | `{false,null}`（该行被 `filter(Boolean(authConfig))` 排除） | new |
| G12 | 有 `authConfig` 的行 | `resolveMultiTenantSsoConfig({providerId:"acme.test.okta"})` | `{true, domain:"acme.test"}`；未知 providerId → `{false,null}` | new |
| G13 | `custom`/`jumpcloud` 行，`scope` 给与不给 | `buildSsoProviders()` | `scope` 分别为所给值 / `"openid email profile"` | new |
| G14 | `github-enterprise` 行 `enterprise.baseUrl` | `buildSsoProviders()` | authorization URL 以该 baseUrl 开头 | new |
| G15 | 行里 `clientSecret` 是坏密文 | `buildSsoProviders()` / `resolveSsoProviderIdForDomain` | 前者抛错；后者**仍返回 providerId**（不对称，见 §16.6） | new |
| G16 | 任意行 | `buildSsoProviders()` | 返回对象不含 `createdAt`/`updatedAt`（schema 已丢弃） | new |
| G17 | 授权实例、缓存冷 | 首次调用 | `prisma.$transaction` 被调用且 `findMany` 无 `where`/`select`/`orderBy`，事务参数 `maxWait=5000`、`timeout=5000` | new（可用 prisma spy / mock） |
| G18 | 未授权实例 | 反复调用 4 个导出 | 从不触发 DB 与解密（边界属性） | new |

### 12.6 `createSsoConfig.ts`（E1–E15）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| E1 | `isMultiTenantSsoAvailable=false` | 直接调 `createSsoConfig`（POST） | `403 { error: "Multi-tenant SSO is not enabled on this instance" }` | new（模块级） |
| E2 | 授权实例 + `GET` | 直接调 / 真实 HTTP | `405 { error: "Method Not Allowed" }` | new（已实测 HTTP） |
| E3 | `isMultiTenantSsoAvailable=false` + `GET` | 直接调 | `403`（可用性先于方法） | new（模块级） |
| E4 | 授权实例 + `ADMIN_API_KEY` 未设 + `POST` | 直接调 | `500 { error: "ADMIN_API_KEY is not set" }` | new（模块级） |
| E5 | 授权实例 + `ADMIN_API_KEY` 未设 + `GET` | 直接调 | `405`（方法先于环境变量检查） | new（模块级） |
| E6 | 授权实例 + `POST` + 无头 | 真实 HTTP | `401 { error: "Unauthorized: authorization header is missing" }` | new（已实测） |
| E7 | 授权实例 + `POST` + 错 Bearer | 真实 HTTP | `401 { error: "Unauthorized: Invalid token" }` | new（已实测） |
| E8 | `ENCRYPTION_KEY` 未设 + 正确 Bearer + 合法 body | 直接调 | `500 { error: "ENCRYPTION_KEY environment variable is missing" }` | new（模块级） |
| E9 | 正确 Bearer + body 为 `{"domain":"Ok.com",...}` / 未知 `authProvider` | 真实 HTTP | `400`，`body.error.name === "ZodError"`，`body.error.message` 是含 `"Domains must be written in lowercase"` / `"No matching discriminator"` 的 JSON 文本；**不含** `details` | new（已实测） |
| E10 | 正确 Bearer + 合法 body | 真实 HTTP | `201 { message: "SSO configuration created successfully" }`，`sso_configs` 新增一行且 `domain`/`auth_provider` 与请求一致 | new |
| E11 | 同 E10 | 检查库中 `auth_config.clientSecret` | ≠ 请求明文；形如 `hex:hex:hex`（三段）；用 `decrypt()` 能还原明文；其余字段（`clientId` 等）为明文 | new |
| E12 | 已有同域行 | 再 POST | `409 { error: "Domain <d> already has an SSO configuration" }`，行数仍为 1，`logger.info` 被调用 | new |
| E13 | body 的 `authConfig` 缺失 / 为 `null` | 创建成功后查库 | `auth_config` 为 `NULL` | new |
| E14 | body 的 `authConfig` 未给 `allowDangerousEmailAccountLinking` | 创建成功后查库 | 该键为 `false`（默认值被持久化） | new |
| E15 | Cloud 区域构建 + 正确 Bearer | 直接调 | 不出现 `"Not accessible on Litefuse Cloud"`（`isAllowedOnLangfuseCloud: true` 生效） | new（模块级） |

### 12.7 `add-sso-config.ts`（R1–R2）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| R1 | 授权实例 | `GET /api/auth/add-sso-config` | `405 { error: "Method Not Allowed" }` | new（已实测） |
| R2 | 授权实例 + 正确 Bearer + 合法 body | 经 HTTP 与直接调 `createSsoConfig` 各一次（不同域） | 状态码、响应体键与值完全一致（外壳零逻辑） | new |

### 12.8 `check-sso.ts`（F1–F8）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| F1 | — | `GET /api/auth/check-sso` | `405 { message: "Method not allowed" }` | new（已实测） |
| F2 | — | `POST` body `{}` | `400 { message: "Invalid request body" }` | new（已实测） |
| F3 | — | `POST` body `{"domain":""}` | `400` 同上 | new（已实测） |
| F4 | 无该域配置 | `POST {"domain":"example.com"}` | `404 { message: "No SSO provider configured" }` | new（已实测） |
| F5 | 库中有 `acme.test` + 完整 `authConfig` | `POST {"domain":"ACME.TEST"}` | `200 { providerId: "acme.test.okta" }` | new |
| F6 | 库中有 `acme.test` 但 `auth_config` 为 `NULL` | `POST {"domain":"acme.test"}` | `200 { providerId: "okta" }`（裸 id） | new |
| F7 | 未授权实例（mock） | `POST {"domain":"acme.test"}` | `404`（不是 403） | new（模块级） |
| F8 | 授权实例 + 企业实现加载失败（mock 动态 import 抛错） | `resolveSsoProviderIdForDomain` 经网关 | **rejects**（`EnterpriseSsoUnavailableError`），绝不 `null`；`check-sso` 本身不写 200/404 | 既有（网关层）：`enterpriseSso.clienttest.ts` 的第 1 个用例 |

### 12.9 `enterprise-sso-required.tsx`（H1–H8，clienttest）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| H1 | `?email=a@b.com` | 渲染 | email 输入框初值为 `a@b.com`；占位符 `jsdoe@example.com` | new |
| H2 | `?callbackUrl=https://evil.com` / `//evil.com` / `/project/x` / 缺失 | 提交合法 email 并让 `check-sso` 返回 200 | `signIn` 收到的 `callbackUrl` 分别为 `"/"` / `"/"` / `"/project/x"` / `"/"` | new |
| H3 | `?attemptedProvider=azure-ad` / `okta-something` | 渲染 | 描述文本分别插入 `Azure AD` / `okta something`（连字符转空格） | new |
| H4 | session 状态为 `authenticated` | 渲染 | 渲染 `null`，且 `router.replace` 被调用一次、参数为白名单后的 `callbackUrl` | new |
| H5 | 提交 `a@b.com` | 观察 fetch | `POST <basePath>/api/auth/check-sso`，body `{"domain":"b.com"}`（**小写**），`Content-Type: application/json` | new |
| H6 | `check-sso` 返回 404 | 同上 | 渲染的文案恰为 `We couldn't find a custom Enterprise SSO configuration for this domain. Double-check your company email or contact your administrator.` | new |
| H7 | `check-sso` 返回 500 `{message:"x"}` / 返回 500 非 JSON | 同上 | 分别渲染 `x` / fallback `Unable to start the Enterprise SSO sign-in flow. Please try again.` | new |
| H8 | `fetch` 抛异常 | 同上 | `captureException` 被调用；渲染 `Something went wrong while checking your Enterprise SSO configuration. Please try again.` | new |

### 12.10 `sso-initiate.tsx`（I1–I6，clienttest）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| I1 | 无 `provider` query | 渲染完成 | 显示错误页，message 恰为 `No SSO provider specified. Please contact your administrator.`，且 `signIn` **未被调用** | new |
| I2 | `?provider=acme.test.okta` | 渲染完成 | `signIn` 被调用一次，参数为 `"acme.test.okta"`，**无第二参数** | new |
| I3 | `signIn` 返回 rejected `Error("boom")` | 同上 | 错误页 message 为 `"boom"` | new |
| I4 | `signIn` 返回 rejected 非 Error（如字符串） | 同上 | message 为 `Failed to initiate SSO sign-in. Please try again or contact support.` | new |
| I5 | `signIn` 永不 settle | 同上 | 渲染 Spinner 与 `Redirecting to your identity provider...` | new |
| I6 | `?provider=a&provider=b`（数组） | 同上 | 行为未定义/未测；**不写断言**（§16.11） | new（不可断言） |

### 12.11 网关互操作（X1–X4）

| # | 给定 | 当 | 则 | 映射 |
| --- | --- | --- | --- | --- |
| X1 | MIT 网关与 3 条客户端用例 | 跑 `enterpriseSso.clienttest.ts` | 3/3 绿（本批次不得改这些文件） | 既有 |
| X2 | 换入后的 `ssoProviders.ts` | 直接 `import` 真模块并断言 4 个导出都是函数，且 `buildSsoProviders`/`hasSsoConfig`/`resolveSsoProviderIdForDomain`/`resolveMultiTenantSsoConfig` 可调用 | 签名匹配（AST/类型层面），无 `undefined` | new（**必须有**：网关客户端用例 mock 掉了企业模块，不会因导出改名而红） |
| X3 | 授权实例 + `acme.test` 有 `authConfig` | 用 `@a@acme.test` 走密码 `authorize` | 抛出企业 SSO 强制错误（`ENTERPRISE_SSO_REQUIRED_MESSAGE`），不放行 | new（e2e/L3） |
| X4 | 授权实例 + 企业模块加载失败 | 走密码 `authorize` / `signIn` | 登录**失败**（不因 `null` 而退回密码/其他 provider） | 既有（网关层 clienttest 第 1、2 条） |

**统计**：97 条（A13 + B5 + C4 + D14 + G18 + E15 + R2 + F8 + H8 + I6 + X4）。其中映射到既有测试/既有行为的 **14 条**（A1、A2、A3、A11、A12、B1、B2、C1–C4、F8、X1、X4），其余 **83 条为 `new`**；I6 为**不可断言**（仅登记）。`admin-api-key-auth.servertest.ts` 的 14 条**未映射任何用例**（原因见 §12.12/§16.14）。

### 12.12 为什么 `admin-api-key-auth.servertest.ts` 一条也映射不上

该套件的 14 条测的是 `@/src/features/public-api/server/createAuthedProjectAPIRoute.verifyAuth(req, isAdminApiKeyAuthAllowed)` 这条**平行的** admin-key 机制：它要求 `Authorization: Bearer <ADMIN_API_KEY>` **加** `x-langfuse-admin-api-key: <ADMIN_API_KEY>`，以及 `x-langfuse-project-id`，返回 `Admin API key auth is not available on Litefuse Cloud`（403）、`Admin API key is not configured on this instance`（500）、`Invalid admin API key`（401）等**另一套文案**。本批次的 `AdminApiAuthService` 只看 `Authorization`，文案是 `Not accessible on Litefuse Cloud` / `ADMIN_API_KEY is not set` / `Unauthorized: Invalid token`。二者不共享代码路径，改动 `adminApiAuth.ts` 不会让该套件变红。**不要把两套文案互相抄写。** 本批次对该文件的关系只是"概念同族"，可作为 401/403 分档的参照，不作为验收证据；真正有牙齿的既有映射是 §12.1/§12.2 引用的 `organizations-api.servertest.ts` 与 `organizations-and-projects-api.servertest.ts`。

---

## 13. 变异检查（证明测试有牙齿；实施时由 Select DB 执行）

每种变异只应让对应用例失败、其余仍绿。下文"不可检测"小节列出的变异不要当作有牙齿的变异。

| # | 变异 | 预期失败用例 |
| --- | --- | --- |
| 1 | 改无头时的错误文本（`MISSING_AUTHORIZATION_ERROR`） | A1、B2、E6，以及既有 `organizations-and-projects-api` H5（精确串） |
| 2 | 改 `"Unauthorized: Invalid token"` 的文本 | A2、A3、E7 |
| 3 | 把 401/403 的判定从"前缀"改成恒定 403（或恒定 401） | A2（期望 401）或 A7/A8（期望 403）之一必红 |
| 4 | 把 Cloud 拦截挪到 token 校验之后 | A8（Cloud + 正确 token 应 403，变异后返回 true） |
| 5 | `isAllowedOnLangfuseCloud` 默认值翻成 `true` | A8 |
| 6 | 去掉 `timingSafeEqual` 前的长度判断 | A13（长度不等会抛） |
| 7 | `requireInstanceAdmin` 跳过许可检查 | B3（应 403 却返回 true） |
| 8 | `requireInstanceAdmin` 把许可检查挪到认证之前 | B5（应 401 却 403） |
| 9 | `requireAdminApi` 改成 `return requireAdminApiScope(req,res) ? ... : ...` 之类的改写，或返回 `null`/布尔 | C1 + 批次 2 的 7 个路由用例（scope 变 `null`/`true` → 后续 500 或行为异常） |
| 10 | `createSsoConfig` 去掉 `isMultiTenantSsoAvailable` 早退 | E1、E3 |
| 11 | `createSsoConfig` 把方法检查挪到可用性检查之前 | E3（应 403 却 405） |
| 12 | `createSsoConfig` 不加密直接存 `clientSecret` | E11（并会破坏 E10 之后的解密用例） |
| 13 | `createSsoConfig` 去掉重复域预检 | E12（会变成 500 或写出第二行） |
| 14 | `createSsoConfig` 成功返回 200 而非 201 | E10 |
| 15 | `createSsoConfig` 把 400 响应的 `error` 换成 `details`/issue 数组 | E9 |
| 16 | `check-sso` 允许 `GET` | F1 |
| 17 | `check-sso` 把"无配置"从 404 改成 200/`{message}` | F4 |
| 18 | `check-sso` 把 `message` 键改成 `error` | F1–F4 |
| 19 | `ssoProviders.loadSsoConfigs` 去掉 `isMultiTenantSsoAvailable` 早退 | G1、G18 |
| 20 | `ssoProviders` 把"逐行 parse + 跳过"改成"整体 parse" | G5 |
| 21 | `resolveSsoProviderIdForDomain` 加上"必须有 `authConfig`"的条件 | G4 |
| 22 | `buildSsoProviders` 不再过滤 `null` provider | G4 |
| 23 | 去掉缓存（每次重读库） | G8、G9 |
| 24 | 把失败缓存 `failedToFetch` 也设成 TTL 1 小时 | G9（60s 后应重试） |
| 25 | `resolveSsoProviderIdForDomain` 用 `domain === candidate.domain`（不小写化） | G6 |
| 26 | `ssoConfigSchema` 去掉小写 refine | D2、E9（大写域用例） |
| 27 | 把 okta / authentik 的校验消息对调或改写 | D6、D7 |
| 28 | 去掉 `allowDangerousEmailAccountLinking`（或 custom 的 `idToken`）的 `.default(false)` | D4、E14 |
| 29 | 把 `custom` 从 `providerVariants` 移除 / 调换 `jumpcloud` 与 `custom` 的顺序 | D1、D12（issue 顺序/成员集合） |
| 30 | `enterprise-sso-required` 直接把 `rawCallbackUrl` 传给 `signIn` | H2 |
| 31 | `enterprise-sso-required` 在已认证时仍渲染表单 | H4 |
| 32 | `sso-initiate` 在 `provider` 缺失时仍调 `signIn` | I1 |
| 33 | `sso-initiate` 把 `signIn` 的 rejection 吞掉 | I3、I4 |
| 34 | 网关 `enterpriseSso.ts` 改成失败时返回空值（**不得真的改 MIT 文件**；仅作为对照实验，事后还原） | X4 / `enterpriseSso.clienttest.ts` 的第 1 个用例 |

**不可检测的变异**（不要用来"证明测试有牙齿"）：

- 把常量时间比较换成 `===`：无可观察差异（时间不可断言）。
- 调换 §6.3 中 provider 构造的 spread 顺序但结果相同的情形。
- §6.3 的 `default`（`never`）分支行为：类型上不可达，运行期被 schema 过滤，任何变异都不会让用例失败。
- `createSsoConfig` 的第 5 步 `"ADMIN_API_KEY is not set"` 分支与 catch 里的加密异常分支：被第 3、4 步挡住，不可达。
- `sso-initiate` 的 `provider` 数组情形（I6）：不可断言。

---

## 14. 实现独立性纪律（净室）

### 14.1 实现者可以读

- 本规格（`docs/ee-independence/03-auth-sso/spec.md`）与验收测试文件；
- §1 列出的 MIT 只读参考文件（`enterpriseSso.ts`、`isMultiTenantSsoAvailable.ts`、`adminApiGuard.ts`、`resolveSelfHostedPlan.ts`、`hasEntitlement.ts`）、`packages/shared/src/encryption/encryption.ts`、Prisma schema 的 `SsoConfig` 模型；
- `web/src/features/i18n/locales/en.json` 与 `zh-CN.json`（查 key 是否存在）；
- NextAuth（v4 `next-auth`）与 zod（`zod/v4`）的官方文档，以及 `next-auth/providers/*` 的公开类型；
- 既有测试（可读，**不可改**）。

### 14.2 实现者不可以读

- §"目标文件"里 10 个文件的**当前内容**（它们就是待替换的原实现）、其 git 历史/`git log -p`/`git blame`/diff；
- 对包含目标文件的目录做全仓 grep（曾有批次因全仓 grep 意外看到原实现两行）；需要项目约定时直接打开 §14.1 列出的具体路径；
- 上游 Langfuse 商业版对应源码，以及 `LICENSE-EE-PROVENANCE.md` 里指向上游路径的对照表（本规格已给出全部所需行为，不需要它）。

### 14.3 交付方式

- 产物写到**新的临时路径**（`*.impl.ts` / `*.impl.tsx`），由 Select DB 审查后换入原位；不得直接改写目标文件；
- 交回**第一人称声明**与**实际用过的检索命令**（写入该批次 `record.md`），并披露任何意外暴露；
- 不得修改：§1 的 MIT 参考文件、既有测试、`web/src/features/i18n/locales/*`（除非 §0.2 要求新增 key）、lockfile、以及其他 docs；
- 除本规格冻结的公开符号名、类型名、provider id、字段名、zod 消息、HTTP 文案外，命名与结构自定；
- `ssoProviders.ts` 的 4 个导出名是**跨目录硬契约**（MIT 网关按名动态调用），改名即破坏 fail-closed 语义，`pnpm run typecheck` 不会发现（动态 import 无静态类型检查），只有 X2 能发现。

### 14.4 边界不变式（换入后必须仍成立）

- 没有任何 MIT 文件在**模块作用域**静态 import `web/src/features/enterprise/**` 或本批次其他 ANNEX A 路径；`web/src/features/auth/sso/enterpriseSso.ts` 仍是对企业 SSO 实现的**唯一** MIT 入口，且仍是动态 import。
- 未授权进程里，`enterpriseSso.ts` 不 import 企业模块，`ssoProviders.loadSsoConfigs` 也因 `isMultiTenantSsoAvailable === false` 而不触碰 `sso_configs`（G18）。
- 授权进程里，企业模块加载失败一律 fail closed（X4），绝不把"域强制 SSO"降级为密码登录。
- 组织级 admin API 的认证与权益判定仍发生在 MIT 的 `adminApiGuard.ts`（`requireAdminApi` 只是转发），使社区路由能在不加载许可实现的前提下拒绝不可用操作。

---

## 15. 文件清单（行数）与数据库对象

| 文件 | 行数（当前） |
| --- | --- |
| `web/src/features/enterprise/auth/requireAdminApi.ts` | 21 |
| `web/src/features/enterprise/auth/requireInstanceAdmin.ts` | 40 |
| `web/src/server/adminApiAuth.ts` | 117 |
| `web/src/features/enterprise/sso/ssoConfigSchema.ts` | 144 |
| `web/src/features/enterprise/sso/ssoProviders.ts` | 312 |
| `web/src/features/enterprise/sso/createSsoConfig.ts` | 96 |
| `web/src/pages/api/auth/add-sso-config.ts` | 12 |
| `web/src/pages/api/auth/check-sso.ts` | 32 |
| `web/src/pages/auth/enterprise-sso-required.tsx` | 259 |
| `web/src/pages/auth/sso-initiate.tsx` | 65 |
| **合计** | **1098** |

只读参考（**不在本批次替换范围**）：`enterpriseSso.ts` 113 行、`isMultiTenantSsoAvailable.ts` 23 行、`adminApiGuard.ts` 65 行、`resolveSelfHostedPlan.ts` 20 行、`hasEntitlement.ts` 52 行。

数据库对象：

| 表 | 操作 |
| --- | --- |
| `sso_configs`（`SsoConfig`） | 读（`findMany`，无 `where`/`select`/`orderBy`，包在 `$transaction({maxWait:5000,timeout:5000})` 里）；读（`findUnique({where:{domain}})` 重复预检）；写（`create({data:{domain,authProvider,authConfig}})`）。无 `update`/`delete`/`upsert` |

**无其他表访问、无 Redis、无 audit log、无邮件。**

---

## 16. 待解问题（Open questions）

以下行为按"现状即契约"保留，实现者必须复现；但项目组应知悉其可疑之处。凡无法从可读代码/实测确定者已明确标注。

1. **【安全】企业 SSO 在读库失败时是 fail-OPEN 的。** `loadSsoConfigs` 吞掉 `$transaction` 异常、把 `data: []` 写进缓存并保持 60 秒；期间 `resolveSsoProviderIdForDomain` 全部返回 `null`，于是 §11 里 `server/auth.ts` 的密码 `authorize` 与 `signIn` 回调都认为"该域没有强制 SSO"，**密码登录被放行**。MIT 网关只在"模块加载失败"时 fail closed；"配置读不到"没有任何 fail-closed 保护。是否应当区分"读失败"与"确实没有配置"（例如读失败时抛错）需要产品决策——**本规格要求先原样复现**。
2. **【安全】单行 schema 失效同样是 fail-OPEN。** 某行若因字段变更/脏数据无法通过 `ssoProviderSchema.parse`，该行被跳过并记日志，其余行照常；该域因此**静默失去 SSO 强制**。与第 1 条同族，但触发面更广（一次 schema 收紧即可让存量行全部失效）。
3. **新建配置后最长 1 小时才生效（同进程），多实例最长各自 1 小时。** `createSsoConfig` 不失效 §6.1 的模块级缓存；缓存是**每进程**内存态，没有 Redis/事件总线。删除/修改配置（本批次没有这两个接口）同理。是否需要缓存失效、TTL 是否合理，需要决策；现状保留。
4. **重复域预检与写入不是原子的。** 并发两个同域 POST 可以都通过 `findUnique`；后到者以主键冲突（P2002）落进 catch，返回 `500 "Internal Server Error"` 而不是 `409`。是否需要捕获 P2002 并映射 409，需要决策；现状保留。
5. **`hasSsoConfig()` 与 `buildSsoProviders()` 可以不一致。** `hasSsoConfig` 统计所有能通过 schema 的行（含 `auth_config IS NULL`），`buildSsoProviders` 跳过无 `authConfig` 的行。因此登录页会显示"Enterprise SSO"按钮、进入 `enterprise-sso-required` 后 `check-sso` 却能返回裸 provider id（走全局社交登录）；若该全局 provider 未配置，用户会走到一个无法完成的流程。是否为有意降级，无法从代码判定。
6. **`buildSsoProviders` 与 `resolveSsoProviderIdForDomain` 对解密失败的处置不对称。** 坏密文（换过 `ENCRYPTION_KEY`、手工改库）会让 `buildSsoProviders` 抛错——在 `server/auth.ts` 里被 catch 成"没有动态 provider"（登录页少几个按钮），但 `resolveSsoProviderIdForDomain` 不构造 provider、照常返回 id，于是**该域仍被强制 SSO 而 IdP 入口可能根本不存在**。是否需要一致化，需要决策；现状保留。
7. **`adminApiAuth` 只比较第二段 token，且接受尾部冗余。** `"Bearer <正确key> extra"` 会通过认证；方案名只接受精确的 `"Bearer"`；`"Basic <正确key>"` 被拒。这是宽松的解析，建议至少加一条 A4 用例把现状钉住，不要"顺手收紧"。
8. **同一个"`ADMIN_API_KEY` 未配置"错误，三处三种表现**：`AdminApiAuthService.handleAdminAuth` → 403 `"ADMIN_API_KEY is not set"`；`createSsoConfig` 前置检查 → 500 `"ADMIN_API_KEY is not set"`；MIT 的 `createAuthedProjectAPIRoute.verifyAdminApiKeyAuth` → 500 `"Admin API key is not configured on this instance"`。另外 `createSsoConfig` 里由 `handleAdminAuth` 产生的 403 分支与 catch 里的加密失败分支都**不可达**（被第 3、4 步提前拦下）。是否统一，超出本批次范围，现状保留。
9. **`ssoProviders.toNextAuthProvider` 的 `default` 分支运行期不可达。** 它被写成 `const exhaustive: never = config` 的形式；能到达分派的 `authProvider` 一定在判别联合内。保留即可，但不要为它写断言。
10. **`enterprise-sso-required` 的 `!domain` 分支在正常表单流里不可达**（`z.string().email()` 已保证含 `@` 与非空域）。保留即可，不要断言。
11. **`sso-initiate` 只能靠直接输入 URL 访问，且 `signIn` 不带 `callbackUrl`。** 仓库内无任何链接指向它（仅 `pathClassification.ts` 把它列为"未认证可访问"）；不传 `callbackUrl` 时 NextAuth 默认回当前页，理论上可能形成"回到 sso-initiate 再次触发 signIn"的循环（实际由 NextAuth 的 `callbackUrl` cookie 行为决定，未实测）。另外 `router.query.provider as string | undefined` 只是类型断言，`?provider=a&provider=b` 时运行时是数组，`signIn` 会收到数组——未定义行为，不写断言。
12. **Next.js 对"handler 抛出的未处理 rejection"的响应形状无法静态确定。** 两条路径会走到这里：`check-sso` 在企业实现加载失败时（fail-closed 的 HTTP 表现，期望是 5xx 而不是 200/404），以及 `add-sso-config` 若 `createSsoConfig` 抛出（当前不会）。写测试时先在当前实现上实测记录状态码与响应体，再决定是否固化。
13. **`check-sso` 是未认证的域名枚举 oracle。** 任何调用者都能区分 404 与 200，并从 `providerId` 得知该域的 provider（`providerId` 本身包含域名）。本批次没有限流/审计，保留现状；若产品要求，需在网关/反代层处理。
14. **`admin-api-key-auth.servertest.ts` 与本批次无关。** 它测的是 `createAuthedProjectAPIRoute.verifyAuth`（Bearer + `x-langfuse-admin-api-key` + `x-langfuse-project-id`），与本批次 `AdminApiAuthService` 不共享代码路径，文案也不同（见 §12.12）。它在 L2 门禁里存在只是因为它属于 EE 面；**不能**作为 `adminApiAuth.ts` 的验收证据。
15. **`web/src/server/adminApiAuth.ts` 目前既不在 `LICENSE-EE` ANNEX A，也不在 ANNEX B**，但按 `LICENSE-EE-PROVENANCE.md` 它改编自上游 Langfuse 商业版文件，且被 MIT 的 `web/src/server/api/trpc.ts`（`adminProcedure`，tRPC 后台迁移路由在用）与 MIT 的运维路由在模块作用域静态导入；`check-ee-boundary.mjs` 的 ANNEX A 前缀表也因此把它当 MIT。本批次的净室重写会消除"衍生自上游"的问题，但**它的许可归属应当被有意识地登记**（要么进 ANNEX A，要么在 ANNEX B 明确写清"MIT，受保护的运维端点"），否则将来单独看 ANNEX 列表会看不出它已被替换。这是文档/流程问题，不是行为问题。
16. **`ssoProviders` 每次缓存失效都会把全部租户的 SSO 配置（含加密后的 `clientSecret`）一次读进进程内存并保留 1 小时**，没有租户过滤、没有分页、没有 `select` 投影。当前数据模型没有 `orgId` 列，多租户隔离只能靠"域"这一维度；本批次不引入 schema 变更。
17. **`enterprise-sso-required` 忽略 `reason=sso_enforced_domain`**，`server/auth.ts` 生成该参数但页面不用它；页面文案在"被强制"与"用户主动点 SSO 按钮"两种进入方式下完全相同（只有 `attemptedProvider` 会带来差异）。是否为有意，无法判定。
18. **`PROVIDER_LABELS` 含 `workos`、`wordpress`（schema 里没有）且缺 `jumpcloud`**，于是 JumpCloud 的场景会显示成 `jumpcloud`（连字符替换的空操作）。属文案瑕疵，保留现状。
19. **`res.json` 对 `ZodError` 的序列化依赖 zod 的内部实现**（该版本 `ZodError` 没有 `toJSON`，只暴露 `name` 与 `message`）。若 zod 升级到带 `toJSON` 的版本，`createSsoConfig` 的 400 响应体形状会变化。E9 的断言应写成"`body.error` 存在且其 `message` 含目标子串"，或先实测再固化。
20. **本规格未能完全确定的部分**（实现时若要依赖这些点，先实测）：(a) Next.js 对 handler 未处理 rejection 的响应形状（第 12 条）；(b) `req.headers.authorization` 为数组（重复请求头）时 `handleAdminAuth` 的行为——Node 的 HTTP 解析通常只保留/合并，本规格未实测，也不建议为它写断言；(c) `logger.error`/`traceException` 在生产环境失败时的可观测结果；(d) `check-sso` 抛错时 Next.js 是否额外记录日志/指标。除此之外，本规格覆盖了 10 个文件的每一个分支、状态码、响应键与逐字错误串。

---

## K. 规格修订与主控决策（2026-10-15，测试阶段之前）

本批次进入测试阶段前，主控就规格 §16 列出的发现逐条决策。**凡改动过的行为，实现者必须按"修好后的行为"实现**；未改动的仍按"保留现状"。

### K.1 已修复（独立提交 `ed9d88b`）：SSO 配置读取改为 fail-closed

- **改动**：`loadSsoConfigs` 不再吞掉数据库读取错误、**不在失败时写缓存**；某一行 `ssoProviderSchema.parse` 失败时也**不再跳过该行**而是让整次读取失败。错误向上传播，登录被拒绝而不是降级为密码登录。
- **差分证据**（在 `sso_configs` 放一行故意不合法的配置，再 `POST /api/auth/check-sso`）：
  | 场景 | 修复前 | 修复后 |
  | --- | --- | --- |
  | 存在非法配置行 | `404 {"message":"No SSO provider configured"}`（fail-open → 允许密码登录） | `500 Internal Server Error`（fail-closed） |
  | 完全没有 SSO 配置（读取成功、结果为空） | `404` | `404`（**未受影响**） |
  日志 `~/SelectDB/litefuse-local/checks/20261015-171818-batch3-sso-failclosed.log`。
- **因此本规格 §16 的开放问题 1 与 2 已结清**：不再有"读失败/解析失败 → 静默失去强制"的路径。带缓存的成功路径不变（1 小时 TTL）。

### K.2 经核实后**不改**的发现

| 开放问题 | 决策依据 |
| --- | --- |
| 3 `createSsoConfig` 不失效 1 小时缓存 | 产品决策：**本批次不管** |
| 4 重复配置并发写得到 500（P2002）而非 409 | **已核实**：顺序执行时预检会正确返回 **409** `{"error":"Domain X already has an SSO configuration"}`（`createSsoConfig` 第 63-73 行）；只有在**并发同时**写同一域时才会撞唯一约束变成 500 → 按"只在并发时报错就不管"处理 |
| 5 `adminApiAuth` 只取 `split(" ")[1]`，`"Bearer <key> extra"` 也能通过 | 产品决策：**本批次不管**（加固项，留待后续安全批次） |

### K.3 `adminApiAuth.ts` 的许可归属（主控建议，待登记）

- 事实：它被 **MIT 文件静态导入**（`web/src/server/api/trpc.ts` 的 `adminProcedure`，并被 `features/background-migrations/server/background-migrations-router.ts` 使用）；`check-ee-boundary.mjs` 也把它当 MIT。
- 按"**社区版是否需要它才能正常运行**"这一判据：社区功能（后台迁移的重试入口）需要它 → 应登记为 **ANNEX B（MIT）**；其"上游衍生"问题由本批次的净室重写解决。
- 待办：把 `web/src/server/adminApiAuth.ts` 显式写入 `LICENSE-EE` 的 ANNEX B 清单（本批次提交时一并处理）。

### K.1b 决策反转（2026-10-15，主控）：fail-closed 改为**保留 fail-open**

- **新决策**：`loadSsoConfigs` 的 fail-closed 改造**已回退**（提交信息见下），SSO 配置读取失败/单行不合法时**保持原有 fail-open 行为**（吞掉读取错误、把空结果缓存 60s、跳过不合法行）。
- **理由（主控）**：读不到配置时，系统**无法区分**"已登记域的用户"与"未登记域的自由用户"——两者都得不到"该域是否被强制"这一信息。fail-closed 会**误伤自由用户**（数据库抖动期间他们也登不上）。在"可能的策略失效"与"确定的功能误伤"之间，本项目选择**优先避免误伤**。
- **被否掉的替代方案（记录备查）**：保留 last-known-good 快照（读失败时沿用上一次成功的集合）。技术上更精确——**因为"登记一个域"必须写数据库，所以读故障期间不可能出现新登记，上一次的集合在故障期间恰好是正确的**，从而能同时保住"已登记域仍强制"与"自由用户不受影响"；仅在"从未成功读过"的冷启动窗口才需要选择全拒。该方案需额外维护快照（可选放 Redis）并让 `createSsoConfig` 同步更新缓存，本轮不做。
- **残留风险（明确接受，写入已知风险）**：数据库读失败或某行配置不合法期间，被强制 SSO 的域会退化为可用密码登录；该窗口内的强制失效不会被用户感知。运维侧建议对 `Unable to read the SSO configs from the database` 这条日志告警——它是"强制 SSO 静默失效"的唯一信号。
- **对实现者的要求**：按**原有行为**实现（§16 的开放问题 1/2 恢复为"已知且有意保留"），不要自行 fail-closed。
- 相应提交：`ed9d88b` 引入 fail-closed，其后一次提交按本节回退（仅回退 `ssoProviders.ts`；同批次的 SCIM `count` 上限保留）。
