# 02 · macOS 从零部署（Litefuse / 分支 `evaluator-create`）

> **这份文件是给一台从没来过开发机的 macOS 设备用的**：照做即可把整套环境跑起来（5 个容器 + web + worker + Doris 写入代理 + 可选的 TypeSafe 代理）。
> 撰写环境：Windows 开发机（本文件由只读勘察产出：**未改动任何源码、未重启任何服务、未发起任何 LLM 调用、未做任何 git 操作**）。
> 标注约定：**✅已验证** = 有文件级/命令级证据（本轮亲自读过代码或配置文件）；**⚠️未核实** = 来自旧记录或别人转述，接手后请自行复核；**待在新设备确认** = 本机无法验证、必须在 macOS 上实测。
>
> **脱敏纪律（硬要求）**：本文档所在的 `origin`（`fishysalt/litefuse`）是**公开仓库**。因此
> 1. 所有密钥/密码/token/cookie **一律写成 `<占位符>`**，绝不写真实值；
> 2. 开发机用的**局域网 VPN 地址一律不写入本文档**，只写 `http://<VPN_HOST>:<PORT>`；
> 3. 新增内容请保持同样纪律。

---

## 0. 事实基线（先看清"从哪来、到哪去"）

### 0.1 本机（Windows 开发机）的形态 ✅已验证

| 项 | 值 |
| --- | --- |
| monorepo 根 | `D:\SelectDB\litefuse-master\litefuse-master\dev_version\litefuse-main\litefuse-main`（注意**两层** `litefuse-master`） |
| 分支 | `evaluator-create` |
| 包管理 | pnpm monorepo（`pnpm-workspace.yaml`：`web` / `worker` / `packages/**`），`packageManager: pnpm@9.5.0` |
| Node | `.nvmrc` = `v24.6.0`；根/`web`/`worker`/`shared` 的 `engines.node` 都是 `24`；本机实测 `v24.19.0` |
| web | Next.js 15 Pages Router，dev 跑在 **3000**（本机以 **webpack** 模式运行，不用 Turbopack，见 §10.2） |
| worker | Express + BullMQ，跑在 **3030**（`worker/src/env.ts` 的 `PORT` 默认 3030） |
| telemetry 存储 | **Apache Doris**（`LITEFUSE_ANALYTICS_BACKEND=doris`），不是 ClickHouse |

### 0.2 五个容器与端口 ✅已验证（来自 `docker-compose.dev.yml`）

| 容器名 | 镜像 | 宿主机端口 | 卷 | 健康检查 |
| --- | --- | --- | --- | --- |
| `litefuse-postgres` | `postgres:17` | `127.0.0.1:5432` | `litefuse_postgres_data:/var/lib/postgresql/data` | `pg_isready -U postgres` |
| `litefuse-redis` | `redis:7.2.4` | `127.0.0.1:6379` | 无（dev compose 里未挂卷） | `redis-cli ping` |
| `litefuse-minio` | `cgr.dev/chainguard/minio` | `127.0.0.1:9090→9000`（API）、`127.0.0.1:9091→9001`（控制台） | `litefuse_minio_data:/data` | `mc ready local` |
| `litefuse-doris-fe` | `apache/doris:fe-4.0.4`（**要换成 4.0.6**，见 §4.2） | `127.0.0.1:8030`（HTTP）、`127.0.0.1:9030`（MySQL 协议）、`127.0.0.1:9010` | `litefuse_doris_fe_meta:/opt/apache-doris/fe/doris-meta`；`./doris-config/fe_custom.conf` 只读挂载 | `curl -sf http://127.0.0.1:8030/api/bootstrap` |
| `litefuse-doris-be` | `apache/doris:be-4.0.4`（**要换成 4.0.6**） | `127.0.0.1:8040`（HTTP，stream load）、`8060`、`9050`、`9060` | `litefuse_doris_be_storage:/opt/apache-doris/be/storage` | `SHOW BACKENDS` 里 `Alive: true` |

Doris 拓扑细节 ✅：FE/BE 在自定义网络 `doris_internal`（subnet `172.29.0.0/24`）里有**静态 IP**：FE=`172.29.0.2`、BE=`172.29.0.3`。**这两个容器内网地址从宿主机不可达**——这是 §7「Doris 写入必须经重写代理」的根本原因。

### 0.3 Windows → macOS 的命令对照

| 用途 | Windows（本机） | macOS（新设备） |
| --- | --- | --- |
| 设环境变量 | `$env:HTTP_PROXY="http://127.0.0.1:8899"` | `export HTTP_PROXY=http://127.0.0.1:8899` |
| 查端口占用 | `Get-NetTCPConnection -LocalPort 3000 -State Listen` | `lsof -nP -iTCP:3000 -sTCP:LISTEN` |
| 文件内容 | `Get-Content x` / `Select-String` | `cat x` / `grep` |
| 复制文件 | `Copy-Item a b` | `cp a b` |
| 临时文件 | `$env:TEMP` | `mktemp` / `$TMPDIR` |
| 时间戳（纳秒） | `[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()*1000000` | `node -e "console.log(BigInt(Date.now())*1000000n)"`（macOS 的 `date` **没有** `%N`） |
| 路径分隔符 | `\` | `/`（仓库内相对路径两端一致） |

---

## 1. 前置软件与版本

| 软件 | 版本要求 | 为什么 / 说明 |
| --- | --- | --- |
| **Docker Desktop for Mac** | 带 `docker compose` v2（`docker compose version` 能看到 v2.x） | 5 个容器全靠它。Doris FE+BE 两个 JVM/C++ 进程吃内存较大，**给 Docker VM 至少 8 GB 内存**，否则 FE 可能起不来或反复 unhealthy（⚠️具体阈值未核实，本机是 Windows 版 Docker Desktop） |
| **Node.js** | **24.x**（`.nvmrc` = `v24.6.0`，四个 `package.json` 的 `engines.node` 都是 `24`；本机实测 `v24.19.0`） | web / worker / 所有脚本都跑在宿主机上 |
| **pnpm** | **9.5.0**（根 `package.json` 的 `packageManager: pnpm@9.5.0`；本机实测 9.5.0） | 根 `preinstall` 有 `npx only-allow pnpm`，用 npm/yarn 装依赖会被拒绝 |
| **git** | 任意近期版本 | Windows 上额外设了 `core.longpaths true`（路径超 260 字符），**macOS 不需要** |
| （可选）**mysql 客户端** | `mysql --version` 可用 | `packages/shared/doris/scripts/up.sh` **硬性检查** `command -v mysql`，没有就 `exit 1`。装法：`brew install mysql-client`，并把它加进 PATH（Homebrew 的 `mysql-client` 是 keg-only） |
| （可选）**Chrome** | 任意近期版本 | `ui-text.cjs` 一类 Playwright 脚本用 `chromium.launch({ channel: "chrome" })`，需要本机 Chrome |
| （可选）**gh / SSH key** | — | 只有要 push 到自己的 fork 时才需要 |

安装（示例，任选其一）：

```bash
# Node：用 nvm 或官方安装包；装完确认
node -v      # 期望 v24.x（本机 v24.19.0）
corepack enable
corepack prepare pnpm@9.5.0 --activate
pnpm -v      # 期望 9.5.0

# 若 corepack 不可用，也可直接 npm i -g pnpm@9.5.0
# mysql 客户端（跑 doris:up 需要）
brew install mysql-client
export PATH="$(brew --prefix mysql-client)/bin:$PATH"   # 建议写进 ~/.zshrc

# Docker Desktop：装好后确认
docker version
docker compose version
```

---

## 2. 取代码与装依赖

### 2.1 clone 与切分支

```bash
mkdir -p ~/SelectDB && cd ~/SelectDB
git clone https://github.com/fishysalt/litefuse.git litefuse
cd litefuse
git checkout evaluator-create
git log --oneline -1      # 交接基线（01 文档记录的最新提交）
```

- `origin` = `https://github.com/fishysalt/litefuse`（**公开**仓库，clone 不需要凭据；**push 需要你自己的 GitHub 凭据**）。
- 交接基线：分支 `evaluator-create`（README 记录为已推到 origin、无未推送提交）。
- ⚠️ 文档站/产品仓库不在本仓库内；本文档不管它们。

> 注意路径：本文件里所有仓库内相对路径（`web/`、`worker/`、`packages/...`、`docs/handover/...`）在你的 macOS clone 里同样成立；下面凡出现 `<REPO>` 就替换成你的绝对路径（例如 `~/SelectDB/litefuse`）。

### 2.2 `pnpm install`（monorepo 注意事项）

```bash
cd <REPO>
pnpm install
```

要点 ✅（来自各 `package.json`）：

1. **必须用 pnpm**：根 `preinstall` = `npx only-allow pnpm`。
2. 根 `prepare` = `husky`，安装时会装 git hooks（`.husky/pre-commit`、`.husky/pre-push`）——macOS 正常。
3. `pnpm-workspace.yaml` 只包含 `web` / `worker` / `packages/**`；`@langfuse/shared` 通过 `workspace:*` 被 web/worker 引用。
4. `.npmrc` 里有两个 `public-hoist-pattern`（`*prisma*`、`@aws-sdk/client-s3`），别删。

**Windows 特有、macOS 不需要的**：

| Windows 特有 | 为什么 Windows 需要 | macOS |
| --- | --- | --- |
| `git config core.longpaths true` | 上游 evaluators-v2 的路径超 260 字符（MAX_PATH） | **不需要**，不用设 |
| `git commit --no-verify` | 本机工作树是 **CRLF**，而 `.husky/pre-commit` 会跑 `pnpm run format:check`（= `prettier --check "**/*.{js,jsx,ts,tsx,css}"`），CRLF 下几乎每个文件都被判为"未格式化"，pre-commit **整体失败** | macOS 检出为 **LF**，`format:check` 通常直接通过。若仍失败，先 `pnpm run format` 再提交；确有需要才 `--no-verify` |
| PowerShell 读写 UTF-8 中文 | `Get-Content -Raw` + `Set-Content -Encoding utf8` 会把中文写成 GBK 乱码 | **不存在**，`cat` / 编辑器都是 UTF-8 |
| `curl.exe` 的 glob | 带 `?a=1&b=2` 的 URL 会被当作 range 解析（`curl: (3) bad range`），要加 `-g` | macOS 的 curl **没有**这个问题（升级到 curl 8 后行为一致，保险起见仍可加 `-g`） |

### 2.3 建 `.env`

```bash
cd <REPO>
cp .env.dev.example .env
${EDITOR:-vi} .env
```

- 仓库根 `.env` 是**唯一**的环境变量来源：`web` 的每个脚本都是 `dotenv -e ../.env -- ...`，`worker` 的脚本是 `dotenv -e ../.env -- ...`，`packages/shared` 的脚本是 `dotenv -e ../../.env -- ...`。**`web/.env` 不需要**。
- `.env` 已被 `.gitignore` 忽略（`.env*`，只白名单 `*.example`），**不会**被提交。

---

## 3. `.env` 需要哪些变量

> 下表**只列变量名与占位符**。变量名来自勘察 `.env.dev.example` 与本机 `.env` 的键名（**没有复制任何真实值**）。"必填"= 不设就无法把系统跑起来。

### 3.1 必须设置（否则跑不起来）

| 变量名 | 用途 | 本机示例值（占位符） | 必填 |
| --- | --- | --- | --- |
| `DATABASE_URL` | Prisma 连接 Postgres | `postgresql://postgres:<PG_PASSWORD>@localhost:5432/postgres` | ✅ |
| `DIRECT_URL` | Prisma 直连（同上） | 同上 | ✅ |
| `NEXTAUTH_URL` | NextAuth 回调基址 | `http://localhost:3000` | ✅ |
| `NEXTAUTH_SECRET` | NextAuth 会话签名；`.env.dev.example` 建议 `openssl rand -base64 32` | `<随机串>` | ✅ |
| `SALT` | API key 哈希盐 | `<随机串>` | ✅ |
| `ENCRYPTION_KEY` | 加密存储的 LLM 连接密钥等；`openssl rand -hex 32` | `<64 位 hex>` | ✅ |
| `LITEFUSE_ANALYTICS_BACKEND` | 分析后端，**必须是 `doris`** | `doris` | ✅ |
| `DORIS_FE_HTTP_URL` | Doris **HTTP** 入口（stream load 走这里）。本机是 `http://localhost:8030`（FE），**不是** 8040 | `http://localhost:8030` | ✅ |
| `DORIS_FE_QUERY_PORT` | Doris MySQL 协议端口（所有读查询） | `9030` | ✅ |
| `DORIS_DB` | Doris 库名 | `litefuse` | ✅ |
| `DORIS_USER` | Doris 用户 | `root` | ✅ |
| `DORIS_PASSWORD` | Doris 密码 | 本机为空串 | ✅（可为空） |
| `DORIS_REPLICATION_NUM` | 建表副本数；**单 BE 必须 1**，否则建表失败 | `1` | ✅ |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_AUTH` | BullMQ 队列与缓存 | `127.0.0.1` / `6379` / `<REDIS_PASSWORD>` | ✅ |
| `NEXT_PUBLIC_LITEFUSE_RUN_NEXT_INIT` | **必须为 `"true"`**，见下方警告 | `"true"` | ✅ |
| `LITEFUSE_S3_*`（三组：`EVENT_UPLOAD` / `MEDIA_UPLOAD` / `BATCH_EXPORT`） | 对象存储；键名：`_BUCKET` `_ACCESS_KEY_ID` `_SECRET_ACCESS_KEY` `_REGION` `_ENDPOINT` `_FORCE_PATH_STYLE` `_PREFIX` | `ENDPOINT=http://localhost:9090`、`BUCKET=litefuse`、凭据 = MinIO 的 root 用户/口令（dev compose 里默认值公开写在 `docker-compose.dev.yml`，照抄即可） | ✅（`BATCH_EXPORT_ENABLED` 本机为 `false`） |

> ⚠️ **`NEXT_PUBLIC_LITEFUSE_RUN_NEXT_INIT` 是这套环境最容易踩的坑** ✅（代码在 `web/src/instrumentation.ts`）：
> `web` 只在它是 `"true"`（或未定义）时才 `import("./observability.config")` 与 `import("./initialize")`，而 `initialize.ts` 第一件事就是 `await initializeSplitCache(); startSplitCacheRefresh();`。
> `.env.dev.example` 里给的是 `"false"`，**照着复制会踩雷**：Doris split-cache 永远为空，`POST /api/public/otel/v1/traces` 会**持续**返回
> `500 otel registration deferred: split-cache not ready`。
> 正确值：`NEXT_PUBLIC_LITEFUSE_RUN_NEXT_INIT="true"`，启动日志里应出现 `Running init scripts...`。

### 3.2 这套环境额外要用到的（本地开发/交接相关）

| 变量名 | 用途 | 本机示例值（占位符） | 必填 |
| --- | --- | --- | --- |
| `HTTP_PROXY` / `http_proxy` | 让 **Doris HTTP 写入**经本机重写代理（§7）。**注意**：这是**进程环境变量**，不是 `.env` 里的项也能生效（web/worker 启动前 `export`） | `http://127.0.0.1:8899` | 本地部署 ✅ |
| `HTTPS_PROXY` | 让 **LLM / TypeSafe(Jev) 出网**走代理（§8）。`packages/shared` 的 `env.ts` 里有 `HTTPS_PROXY: z.string().optional()`，被 undici `ProxyAgent` 使用 | `http://<VPN_HOST>:<PORT>` | 视网络环境 |
| `NO_PROXY` / `no_proxy` | 排除本地地址。**axios（Doris）会读它；undici（LLM/Jev）不会读**，见 §7.3 | `localhost,127.0.0.1,::1` | 建议设 |
| `AUTH_DEMO_SIGN_IN_ENABLED` | 登录页是否显示 demo 登录入口 | `"false"` | 可选 |
| `LITEFUSE_ENABLE_EXPERIMENTAL_FEATURES` | 实验特性总开关 | `"false"` | 可选 |
| `AUTH_SESSION_MAX_AGE` | 会话有效期（分钟） | `10080` | 可选 |
| `ADMIN_API_KEY` | Admin API 的固定 key（**本机是测试值，新设备必须自定**） | `<自定义>` | 可选 |
| `LITEFUSE_EE_LICENSE_KEY` | EE 功能 license（**本机是测试值**） | `<自定义>` | 可选 |
| `AUTH_IGNORE_ACCOUNT_FIELDS` | SSO 账号字段忽略清单 | 本机为 `refresh_expires_in,not-before-policy` | 可选（SSO 用） |
| `LITEFUSE_CUSTOM_SSO_EMAIL_CLAIM` | 自定义 SSO 取邮箱的 claim | 本机为 `sub` | 可选（SSO 用） |
| `LITEFUSE_OTEL_GROUPING_ENABLED` | OTel 分组流水线开关；`.env.dev.example` 默认 `false`。注意 `packages/shared/AGENTS.md` 已声明分组是**无条件**的（该开关语义已变），以代码为准 | `false` | 建议保持默认 |
| `LITEFUSE_MAX_HISTORIC_EVAL_CREATION_LIMIT` | 历史批量评估一次最多允许选多少条 observation（超了 tRPC 直接 400） | 未在 `.env` 中设置（用默认） | 可选 |
| `DORIS_MAX_OPEN_CONNECTIONS` / `DORIS_REQUEST_TIMEOUT_MS` | Doris 连接池上限 / 超时 | 未在 `.env` 中设置（用默认） | 可选 |
| `TELEMETRY_ENABLED` | 是否上报匿名使用统计 | 未在 `.env` 中设置 | 可选 |

> **只在 `.env.dev.example` 里出现、本机 `.env` 里没有的**（供参考，不一定要抄）：`CLICKHOUSE_*`（本部署不用 ClickHouse）、`STRIPE_*`（付费流程）、`SLACK_*`、`LITEFUSE_AI_FEATURES_*`、`AWS_*` / `LITEFUSE_AWS_BEDROCK_*`、`EMAIL_FROM_ADDRESS` / `SMTP_CONNECTION_URL`、`LITEFUSE_S3_BATCH_EXPORT_*` 之外的导出项等。
>
> **`.env.dev.example` 里没有、但代码会读的 Doris 相关变量**（需要时再设，本轮本机都没设）：`DORIS_URL`、`DORIS_MAX_OPEN_CONNECTIONS`、`DORIS_REQUEST_TIMEOUT_MS`、`LITEFUSE_STORAGE_PAGE_SIZE`、`LITEFUSE_DORIS_LOG_QUERIES`、`LITEFUSE_AUTO_DORIS_MIGRATION_DISABLED`（定义见 `packages/shared/src/env.ts`）。

> 🔐 **如果要把开发机的 Postgres 数据 dump 过来**：`SALT` 与 `ENCRYPTION_KEY` **必须与源库一致**，否则 API key 校验会失败、已存的 LLM 连接密钥解不开。全新空库则自己 `openssl rand` 重新生成即可。

---

## 4. 起 5 个容器

### 4.1 方案 A（推荐）：dev compose + 4.0.6 override

`docker-compose.dev.yml`（仓库根）把 Doris 钉在 **4.0.4**，而 4.0.4 **缺 `json_object_flatten`**，Doris 读路径（traces/observations/events）会直接报
`errCode = 2, detailMessage = Can not found function 'json_object_flatten'` ✅（本机实测，见 `26.3-Jev决策模型-本地演示环境与验证手册.md`）。
仓库根的主 `docker-compose.yml` 钉的是 **4.0.6**，所以本机用了一个**仓库外的小 override 文件**只改镜像 tag，`docker-compose.dev.yml` 本身**未改**。

在 macOS 上重建这个 override（**放在仓库外**，避免污染公开仓库的工作树）：

```bash
mkdir -p ~/litefuse-dev
cat > ~/litefuse-dev/doris-4.0.6.override.yml <<'YAML'
# 本地覆盖：把 dev Doris 从 4.0.4 升到 4.0.6（读路径需要 json_object_flatten）
services:
  doris_fe:
    image: apache/doris:fe-4.0.6
  doris_be:
    image: apache/doris:be-4.0.6
YAML
```

起容器（`--wait` 会等到 healthcheck 全绿；Doris FE 的 `start_period` 是 120s、BE 是 150s，**首次启动请耐心等 3–5 分钟**）：

```bash
cd <REPO>
docker compose -f ./docker-compose.dev.yml -f ~/litefuse-dev/doris-4.0.6.override.yml up -d --wait
```

等价于根 `package.json` 的 `pnpm run infra:dev:up`（= `docker compose -f ./docker-compose.dev.yml up -d --wait`），只是多带了一个 `-f`。

确认：

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
# 期望 5 行 Up (healthy)：
# litefuse-postgres / litefuse-redis / litefuse-minio / litefuse-doris-fe / litefuse-doris-be
```

> ⚠️ 这套基础设施里**没有 ClickHouse**。机器上若出现 `langfuse-clickhouse` 容器，那是别的东西留下的，与本部署无关。
>
> ⚠️ `docker-compose.dev.yml` 里 **`doris_fe` 没有 `restart:` 策略**（postgres/redis/minio 是 `always`，`doris_be` 是 `unless-stopped`）✅。所以 **Docker Desktop 重启后 `doris_fe` 不会自己回来**，要手动 `docker start litefuse-doris-fe`（本机文档里也是这么记的）。
>
> ⚠️ dev compose **只挂了 `doris-config/fe_custom.conf`，没有挂 `be_custom.conf`** ✅。主 `docker-compose.yml` 两个都挂。`be_custom.conf` 里的 `max_tablet_version_num = 5000` 是为高频小 stream load 准备的（默认 2000 会在 compaction 落后时触发 E-235 失败）。**待在新设备确认**：是否需要把下面这行加进你的 override：
> ```yaml
>   doris_be:
>     image: apache/doris:be-4.0.6
>     volumes:
>       - ./doris-config/be_custom.conf:/opt/apache-doris/be/conf/be_custom.conf:ro
> ```

**卷**（dev compose 定义，`docker compose ... down -v` 会**连数据一起删**，日常只用 `down`）：

| 卷名 | 内容 |
| --- | --- |
| `litefuse_postgres_data` | Postgres 全部业务数据（项目/用户/评估器/规则/job_executions/audit_logs…） |
| `litefuse_doris_fe_meta` | Doris FE 元数据 |
| `litefuse_doris_be_storage` | Doris BE 数据 |
| `litefuse_minio_data` | 对象存储（bucket 里默认有 `litefuse`，由容器的 `command` 建好） |

### 4.2 方案 B（备选）：直接用主 `docker-compose.yml` 起基础设施子集

主 compose 本来就是 **4.0.6**、两个 custom conf 都挂、端口/容器名与 dev 一致：

```bash
cd <REPO>
docker compose -f ./docker-compose.yml up -d postgres redis minio doris_fe doris_be
```

差异（选它之前先知道）：卷名不同（`doris_fe_meta` / `doris_be_storage` vs dev 的 `litefuse_doris_fe_meta` / `litefuse_doris_be_storage`）、`minio` 的 9090 绑在**所有网卡**（dev 绑 127.0.0.1）、`redis` 用 `redis:7` 而非 `redis:7.2.4`。
⚠️ **待在新设备确认**：方案 B 在本机**没有实测过**（本机走的是方案 A）。

### 4.3 健康检查与常见启动问题

```bash
# Postgres
docker exec litefuse-postgres pg_isready -U postgres
# Redis（注意 dev compose 给 redis 设了密码，口令见 docker-compose.dev.yml 或你的 REDIS_AUTH）
docker exec litefuse-redis redis-cli -a "$REDIS_AUTH" ping        # 期望 PONG
# MinIO 控制台（浏览器）
open http://localhost:9091
# Doris FE Web UI
open http://localhost:8030
# Doris BE 是否注册成功
docker exec litefuse-doris-fe mysql -h127.0.0.1 -P9030 -uroot -e 'SHOW BACKENDS\G'
#   期望看到 Host: 172.29.0.3 且 Alive: true
# 端口占用检查（macOS）
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

⚠️ **待在新设备确认**：`litefuse-doris-fe` 容器里是否自带 `mysql` 客户端（本机没在 FE 里跑过；BE 的健康检查确实用了容器内的 `mysql`，说明 BE 镜像有）。**最稳的只读查询方式是 §7.4 的 `probe-doris-sql.cjs`（走宿主机 node + mysql2），不依赖容器内的 mysql**。

---

## 5. Postgres 迁移与 Prisma

### 5.1 顺序

```bash
cd <REPO>
pnpm install                                              # 若尚未安装
pnpm --filter @langfuse/shared run db:generate            # 生成 Prisma Client（本机 node_modules 里没有预生成的 .prisma/client）
pnpm --filter @langfuse/shared run db:deploy              # = dotenv -e ../../.env npx -- prisma migrate deploy（非交互）
```

- **推荐 `db:deploy`**（`prisma migrate deploy`，非交互、不改 schema、不建 shadow DB），适合"在别人的机器上把库建起来"。
- **`db:migrate`** 的实现在本仓库是 `DISABLE_ERD=false dotenv -e ../../.env -- npx prisma migrate dev`（**交互式**，会尝试创建 shadow database）。`schema.prisma` 的 datasource 声明了 `shadowDatabaseUrl = env("SHADOW_DATABASE_URL")`，而本机 `.env` 里**没有** `SHADOW_DATABASE_URL` 这个键 ✅ ⇒ ⚠️ **待在新设备确认**：`db:migrate` 在这套 `.env` 下能否跑（用 `db:deploy` 就绕开了这个问题）。
- **不要**在新设备上贸然跑 `pnpm run dx` / `dx-f` / `nuke`：它们会 `docker compose ... down -v`（**删卷**）+ 重置库 + 重装依赖 ✅。

### 5.2 本项目特有的两条背景（务必知道，否则会以为迁移"怪怪的"）

#### ① `20261011000000_drop_job_execution_job_configuration_fk` —— 去掉 `job_executions` 的外键

- 文件：`packages/shared/prisma/migrations/20261011000000_drop_job_execution_job_configuration_fk/migration.sql` ✅
- 内容：`ALTER TABLE "job_executions" DROP CONSTRAINT IF EXISTS "job_executions_job_configuration_id_fkey";`（**列仍是 NOT NULL，只去掉约束**）
- 原因（迁移文件里的原话）：上游 Langfuse 4.43 把 evaluators-v2 的**规则 id** 写在 `job_executions.job_configuration_id` 里，而那个 id **不存在于 `job_configurations` 表**，于是每次插入 v2 执行行都失败：
  `Foreign key constraint violated on the constraint: job_executions_job_configuration_id_fkey`
  （现场：`worker/src/features/evaluation/observationEval/createSchedulerDeps.ts`，以及 `evalService.ts` 的 `jobConfigurationId: config.id`）
- 删除动作改由应用代码负责：`web/src/features/evals/v2/server/rules/ruleRepository.ts`（deleteMany）、`worker/src/features/traces/processPostgresTraceDelete.ts`（deleteMany），外加 `job_executions.project_id` 的级联。
- schema 里对应注释：`packages/shared/prisma/schema.prisma` → `model JobExecution` 的 `jobConfigurationId String @map("job_configuration_id") // no fk constraint ...` ✅

#### ② `LlmApiKeys @@unique([projectId, provider])` —— 同一项目同 provider 只能一条

- 位置：`packages/shared/prisma/schema.prisma` → `model LlmApiKeys`，`@@unique([projectId, provider])` ✅
- 影响：**同一个项目里不能建两条同 provider 的连接**（例如两条 `TypeSafe`、两条 `DeepSeek`）。重复创建会被 Prisma 判 `P2002`，web 侧已转成可读的 `TRPCError BAD_REQUEST`（文案大意：`A connection with provider "X" already exists in this project…`）。**这是刻意行为，不是 bug** —— 所以造数/探测脚本会在结束路径里删掉自己建的临时连接（见 `docs/handover/scripts/probe-jev-connect.cjs --delete`）。

### 5.3 验证

```bash
# 迁移是否全部落地
docker exec litefuse-postgres psql -U postgres -d postgres -c \
  "select migration_name, finished_at is not null as done from _prisma_migrations order by started_at desc limit 5;"
# 关键表是否在
docker exec litefuse-postgres psql -U postgres -d postgres -c "\dt" | grep -E 'evaluators|evaluation_rules|job_executions|llm_api_keys'
```

表名提醒 ✅（`04-open-items-and-decisions.md` 已记录）：v2 相关物理表是 `evaluators` / `evaluator_versions` / `evaluation_rules` / `evaluation_rule_evaluator_assignments`；**没有** `evaluation_rule_evaluators`，列名是 `evaluation_rule_id` **不是** `rule_id`。

---

## 6. Doris 迁移（建共享表）

Doris 的 schema 由 `packages/shared/doris/scripts/up.sh` 管理（**用 MySQL 协议连 9030**，逐条执行 `packages/shared/doris/migrations/*.up.sql`，把 `schema_migrations` 当迁移台账，并把每个 `tag.location.default: N` 改写成 `DORIS_REPLICATION_NUM`）✅。

```bash
cd <REPO>/packages/shared
pnpm run doris:up        # = bash doris/scripts/up.sh
```

前置条件 ✅：

1. 宿主机有 `mysql` 客户端（脚本 `exit 1` 如果找不到）；
2. `.env` 里 `DORIS_FE_HTTP_URL`、`DORIS_FE_QUERY_PORT` 已设（脚本从 `../../.env` `source` 读取；**注意它是 POSIX `sh`，`source .env` 对含特殊字符的值不健壮** —— ⚠️ **待在新设备确认**，本机可跑）；
3. `DORIS_REPLICATION_NUM=1`（单 BE；脚本会把它替换进建表语句）。

相关的其它脚本：`doris:down`（`down.sh`）、`doris:drop`（`drop.sh`）、`doris:seed`（`doris/scripts/seed.ts`）、`doris:reset` = drop + up + seed（**会删数据**）。

> **per-project 分表不用手工建**：`spans_<projectId>` / `traces_scalar_<projectId>` / `trace_metrics_agg_<projectId>` 由应用在**第一次向该项目写入 OTel 数据时**自动 provision ✅（`tableRouting.ts` 的 `laneForIngestion` → `ensureProjectSplitDesignated`；只有写入路径会触发）。所以新设备上空库在**灌第一条 trace 之前**是看不到这些表的。
>
> 共享表 `scores`（以及 dataset_run_items / blob log 等）来自 `doris/migrations`，必须靠 `doris:up` 建好。

---

## 7. Doris 写入必须经"重写代理"（**不做这一步，任何写入都会失败**）

### 7.1 为什么 ✅（有代码级证据）

Doris 的 stream load 是**两段式**，代码里的断言是**硬性的**（`packages/shared/src/server/doris/client.ts`）：

1. 先给 FE 发一个 **空 body 的 PUT**（`Content-Length: 0`）→ FE 回 **307**，`Location` 指向它选中的 BE；
2. 客户端再把这个 `Location` 当作真正的目标 PUT 数据体。

代码明确要求第 1 步必须拿到 307：

```ts
if (probe.status !== 307 || !probe.headers?.location) {
  throw new Error(`Stream load FE probe PUT ${feUrl} returned HTTP ${probe.status} without a 307 redirect; ...`);
}
```

而 FE 给的 `Location` 是 **BE 的容器内网地址** —— 本机实测形如 `http://root:@172.29.0.3:8040/api/...`。**宿主机没有到 Docker 容器网段的路由**（BE 的静态 IP 就是 `172.29.0.3`），所以第 2 段直接 `ETIMEDOUT`。

绕行方案：把 `DORIS_FE_HTTP_URL` 保持指向 **FE（8030）**（因为必须拿到 307），然后在中间放一个**重写代理**，把 `*:8040` 的 authority 改写成宿主机**已发布**的 `127.0.0.1:8040`：

- 请求侧：absolute-form 的 `PUT http://172.29.0.3:8040/...` → `http://127.0.0.1:8040/...`
- 响应侧：`location` 头里的 `*:8040` 同样改写（这样"自己跟随重定向"的客户端也落在可达地址上）

> ⚠️ `docker-compose.dev.yml` 顶部注释写的是"把 `DORIS_FE_HTTP_URL` 指向 BE 的 8040"，**这与客户端断言矛盾**：指向 8040 只会拿到 `200 ... without a 307 redirect` 而报错（本机在 4.0.4 / 4.0.6 上都实测 BE 对空 body 探针返回 200）。**以代码与实际行为为准**。

### 7.2 启动代理（macOS）

交接目录里已经放了一份脱敏、无硬编码路径的版本：

```bash
cd <REPO>
node docs/handover/scripts/_doris_be_proxy.cjs
# 输出：doris BE redirect proxy on http://127.0.0.1:8899 (rewrites *:8040 -> 127.0.0.1:8040)
```

可用环境变量（默认值来自脚本）✅：

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `PROXY_PORT` | `8899` | 代理监听端口 |
| `DORIS_BE_HTTP_PORT` | `8040` | 要被改写的端口（只有这个端口会被改写） |
| `DORIS_BE_REACHABLE_HOST` | `127.0.0.1` | 改写后的目标主机 |

它同时是个**普通正向代理**（含 HTTPS `CONNECT` 隧道），所以也能承接 `HTTP_PROXY` 的其它流量；但**它不提供任何翻墙/解锁能力**，替代不了 §8 的 VPN。

> 想后台常驻：
> ```bash
> cd <REPO>
> nohup node docs/handover/scripts/_doris_be_proxy.cjs > /tmp/doris-be-proxy.log 2>&1 &
> tail -f /tmp/doris-be-proxy.log
> ```

### 7.3 让 web / worker 走它（macOS 用 `export`，**不要用 PowerShell 语法**）

```bash
# —— 在启动 web / worker 的同一个终端里先执行 ——
export HTTP_PROXY=http://127.0.0.1:8899
export http_proxy="$HTTP_PROXY"                 # 小写也设，兼容只读小写的库
export NO_PROXY=localhost,127.0.0.1,::1
export no_proxy="$NO_PROXY"
# TypeSafe/Jev 出网代理（见 §8），没有就留空
export HTTPS_PROXY=http://<VPN_HOST>:<PORT>
export https_proxy="$HTTPS_PROXY"
```

**为什么这样分工**（这是本轮勘察最值得记住的一条）✅：

| 代码路径 | HTTP 客户端 | 读哪个变量 | 读 `NO_PROXY` 吗 |
| --- | --- | --- | --- |
| Doris HTTP（stream load / FE 探测） | `axios` 1.12.2（装了 `proxy-from-env`） | `HTTP_PROXY` / `http_proxy`（对 `http://` 目标）与 `HTTPS_PROXY`（对 `https://` 目标） | **读**（`NO_PROXY` 里的主机不走代理） |
| LLM judge / TypeSafe(Jev) | 原生 `fetch` + undici `ProxyAgent`，proxy 取自 `env.HTTPS_PROXY` | **只读 `HTTPS_PROXY`** | **不读**（`ProxyAgent` 不解析 `NO_PROXY`；那是 `EnvHttpProxyAgent` 的行为） |

推论：

- `NO_PROXY=localhost,127.0.0.1,::1` 让 **FE（8030）与 9030 直连**（9030 是 MySQL 协议，本来也不走 HTTP 代理）；
- BE 的容器内网地址 `172.29.0.3` **不在** `NO_PROXY` 里，所以第 2 段 PUT 会被送去 `127.0.0.1:8899`，由代理改写后落到宿主 `127.0.0.1:8040`。**这正是它生效的机制**；
- 反过来，如果你把 `HTTP_PROXY` 指到 VPN 而不是这个重写代理，第 2 段就会失败（VPN 侧连不到容器内网）；
- **`NO_PROXY` 对 Jev/LLM 无效**：那一路只认 `HTTPS_PROXY`，所以你不需要（也无法）用它把某些域名排除出 LLM 代理。

> ⚠️ **`HTTPS_PROXY` 必须是 HTTP/HTTPS 代理**：undici 的 `ProxyAgent` **不支持 SOCKS5**（代码注释里写明了："undici's ProxyAgent speaks HTTP(S) proxies only — a SOCKS5-only proxy needs a bridge or a SOCKS-capable agent"）✅。如果你的 VPN 只给 SOCKS5，需要先在本地起一个 SOCKS→HTTP 的桥再把 `HTTPS_PROXY` 指向那个桥。**待在新设备确认**：你手上的代理端口是 HTTP 还是 SOCKS5（开发机那个端口**既能被 git 当 HTTP 代理用、也能被脚本当 SOCKS5 探测**，属于混合实现，但地址不在本文档给出）。

### 7.4 验证代理生效（最小命令）

**方式 1（不写数据、只读一个 307，最快）** —— 直接看 FE 回的 `Location` 有没有被改写：

```bash
# 直连 FE（不走代理）：Location 会是容器内网地址（宿主不可达）
curl -sS -i -X PUT \
  -H 'Expect: 100-continue' \
  -H 'Authorization: Basic cm9vdDo=' \
  -H 'Content-Type: application/json' \
  -H 'Content-Length: 0' \
  'http://localhost:8030/api/litefuse/scores/_stream_load' | grep -Ei '^(HTTP/|location:)'
# 期望：HTTP/1.1 307 ...  location: http://172.29.0.3:8040/api/litefuse/scores/_stream_load   ← 宿主不可达

# 经重写代理：同一个请求，Location 应被改写成本机可达的 127.0.0.1:8040
curl -sS -i -X PUT --proxy http://127.0.0.1:8899 \
  -H 'Expect: 100-continue' \
  -H 'Authorization: Basic cm9vdDo=' \
  -H 'Content-Type: application/json' \
  -H 'Content-Length: 0' \
  'http://localhost:8030/api/litefuse/scores/_stream_load' | grep -Ei '^(HTTP/|location:)'
# 期望：HTTP/1.1 307 ...  location: http://127.0.0.1:8040/api/litefuse/scores/_stream_load   ← ✅ 代理生效
```

说明：`Basic cm9vdDo=` 就是 `base64("root:")`，**空密码**（本机 `DORIS_PASSWORD=""`）；如果你给 Doris 设了密码，用 `printf 'root:%s' '<你的密码>' | base64` 自己生成。这两个 PUT 都是**空 body**，不会写入任何行。

**方式 2**：看代理进程自己打的日志 —— 命中改写时会打印 `... 307 (location rewritten)` ✅（脚本里 `console.log` 的那行）。

**方式 3（端到端、真正走写入链路）**：按 §9 灌一条 OTel trace，然后按 §12 检查 `spans_<projectId>` 是否出现行。**这也是唯一能证明"web/worker 的写入真的通了"的方式**（前两种只证明代理本身对）。

> 排查写入失败时，worker/web 日志里的关键字：
> `Stream load FE probe PUT ... returned HTTP ... without a 307 redirect`（FE 那段没拿到 307）
> 或 `ETIMEDOUT` / `write EPIPE` 出现在 **`BE body PUT`** 那段（第 2 段没走通 ⇒ 代理没生效 / `HTTP_PROXY` 没设 / 端口不是 8899）✅（代码会把失败的那一段打在错误消息里）。

---

## 8. TypeSafe（决策模型 "Jev"）的地理封锁与代理

### 8.1 现象 ✅

不挂代理直连时，TypeSafe 返回：

```
HTTP 451 {"title":"Typesafe is not available in your region.","status":451}
```

这是**地理封锁**（本机记录：有 **1 次被拒的调用**，未产生有效请求/未被计费）。
相关代码：`packages/shared/src/server/llm/typesafe/typeSafeDecisionModelClient.ts`，默认 `DEFAULT_BASE_URL = "https://api.typesafe.ai/v1"`，实际请求 `POST {baseURL}/systemone`。

### 8.2 开发机的做法（**新设备大概率不适用**）

开发机是通过一个**局域网 VPN** 出去的（出口 IP 经确认为境外、`loc=JP`），该 VPN 以 **HTTP/混合代理端口** 的形式暴露。

> 🚫 **本文档不提供该 VPN 的地址**：它是**内网地址**，本仓库是公开仓库，写进来等于泄露内网拓扑；而且它**绑定在开发机的局域网里**，新设备——尤其是换了网络环境/不在同一局域网时——**大概率连不上**。

因此本文档一律写作 `http://<VPN_HOST>:<PORT>`，请你在新设备上**自备**可用的代理。

### 8.3 macOS 上的替代方案

**(a) 自备 VPN / 代理**，并在启动 web 与 worker 的终端里导出：

```bash
export HTTPS_PROXY=http://<VPN_HOST>:<PORT>
export https_proxy="$HTTPS_PROXY"
export HTTP_PROXY=http://127.0.0.1:8899      # 注意：HTTP_PROXY 留给 Doris 重写代理
export http_proxy="$HTTP_PROXY"
export NO_PROXY=localhost,127.0.0.1,::1
export no_proxy="$NO_PROXY"
```

要点：

1. **web 和 worker 都要设**：连接创建时的连通性探测（`testDecisionModelConnection`）跑在 **web** 进程里；真正执行判分调用的是 **worker** 进程 ✅（`01-state-and-history.md` 记录：`web/src/features/llm-api-key/server/router.ts` 负责探测，评估执行在 worker）。
2. `HTTPS_PROXY` 的值必须是 **HTTP/HTTPS 代理**（undici `ProxyAgent` 不支持 SOCKS5，见 §7.3）。
3. **不要把 `HTTPS_PROXY` 指到 Doris 重写代理（8899）**：那个代理只做端口 8040 的 authority 改写，不提供出海能力。两个代理是**两件不同的事**，一个解决"写不进 Doris"，一个解决"出不了境"。
4. `NO_PROXY` 不会影响 Jev 那一路（undici 不读它），设它只是为了 axios/Doris 与别的工具（curl/git）。
5. 如果你用**系统级** VPN（例如 macOS 的全局路由 / 全局 HTTP 代理），也可以不设 `HTTPS_PROXY`——此时 `env.HTTPS_PROXY` 为空 ⇒ 代码走**裸 `fetch`**（`packages/shared/src/env.ts` 里 `HTTPS_PROXY` 是 optional，为 undefined 时不建 `ProxyAgent`）✅。两条路任选其一，别同时设。

**(b) SOCKS5-only 的情况**：先在本机起一个 SOCKS→HTTP 桥，再 `export HTTPS_PROXY=http://127.0.0.1:<桥端口>`。⚠️ 本仓库**没有**现成的桥脚本，**待在新设备确认**你打算用哪个（例如 `gost` / `privoxy` / 自己写 20 行 node）。

### 8.4 自检（**注意成本**）

| 手段 | 命令 | 是否计费 | 期望 |
| --- | --- | --- | --- |
| 代理"出不出境" | `curl -sS -o /dev/null -w '%{http_code}\n' -x "$HTTPS_PROXY" https://api.typesafe.ai/` | **否**（只有一次普通 HTTPS 请求，未带凭据、未走 `/systemone`） | **不是 451** 即说明出口没被封；具体返回码（401/403/404 等）**待在新设备确认** |
| 对照（直连） | 去掉 `-x "$HTTPS_PROXY"` 再跑一次 | 否 | 若得到 `451`，就是典型的地理封锁 |
| 应用内真实连通性 | `JEV_KEY=<你的 TypeSafe key> LF_PROBE_PASSWORD=<登录密码> node docs/handover/scripts/probe-jev-connect.cjs` | **是 —— 1 次真实 Jev API 调用（计费）** | 打印 `CREATE OK — Jev connectivity probe passed (1 real API call)` |
| 清理探测留下的连接 | `LF_PROBE_PASSWORD=<登录密码> node docs/handover/scripts/probe-jev-connect.cjs --delete` | 否 | 删掉 note 为 `Jev real connection (probe)` 的连接（因为 `LlmApiKeys @@unique([projectId, provider])`，不删会影响后续创建） |

- `probe-jev-connect.cjs` 走的是**应用自己的路径**：用 NextAuth credentials 登录 → 调 tRPC `llmApiKey.create` → 让 **web** 执行一次 `testDecisionModelConnection`。所以它同时验证了"登录 + web 能出海"。✅
- 它与本文档 §5.2② 的 unique 约束直接相关：**同一项目同 provider 只能一条**，探测前后务必清理。
- 另外开发机上还有一个 `probe-vpn-socks.cjs`（裸 SOCKS5 握手探测，看 reply code 判断是什么原因连不上）。它**不在** `docs/handover/scripts/` 里（⚠️ 待确认是否会补进来）；SOCKS5 reply code 对照：`0x00 succeeded / 0x02 not allowed by ruleset / 0x03 network unreachable / 0x04 host unreachable / 0x05 connection refused`。它本身**不计费**，但只在你的代理是 SOCKS5 时才有意义。

---

## 9. 数据摄取：**只有 OTel 一条路** ✅

### 9.1 结论

- trace / observation（span）**只能**通过 **`POST /api/public/otel/v1/traces`** 进来；
- 而且必须让请求"看起来够新"，否则入口直接 400：

  ```
  Master spans ingestion requires Python SDK >= 4.0.0 or JS SDK >= 5.0.0. Please upgrade your client.
  ```

  三种满足方式 ✅（`packages/shared/src/server/otel/directWriteHelpers.ts`）：
  `x-langfuse-ingestion-version: 4`（**手写 curl 用这个**）、或 `x-langfuse-sdk-name: python` + `x-langfuse-sdk-version: >=4.0.0`、或 `x-langfuse-sdk-name: javascript` + `x-langfuse-sdk-version: >=5.0.0`。
  `> 4` 的 ingestion-version 会被入口拒绝（`Maximum supported: "4"`）。

- **`POST /api/public/ingestion` 只接受两种事件类型**：`score-create` 与 `sdk-log`。其余（`trace-create` / `observation-create` / `span-create` / `generation-create` / `*-update` …）会**整批**被 400 拒绝，响应形如：

  ```json
  { "error": "UnsupportedEventTypes",
    "message": "Master fork only accepts score-create / sdk-log events on /api/public/ingestion. Use OTel via /api/public/otel/v1/traces for trace and observation events (Python SDK >= 4.0.0 or JS SDK >= 5.0.0).",
    "rejectedTypes": ["trace-create"] }
  ```

### 9.2 可直接复制的 curl（OTLP/JSON）

准备 payload（`traceId` 必须是 **16 字节 hex**，`spanId` 是 **8 字节 hex**；时间是**纳秒字符串**）：

```bash
PK='pk-lf-<你的项目公钥>'
SK='sk-lf-<你的项目私钥>'

TRACE_ID=$(openssl rand -hex 16)
SPAN_ID=$(openssl rand -hex 8)
START_NS=$(node -e "console.log(BigInt(Date.now())*1000000n)")
END_NS=$(node -e "console.log(BigInt(Date.now())*1000000n)")

cat > /tmp/otel-smoke.json <<JSON
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name",          "value": { "stringValue": "macos-smoke" } },
          { "key": "langfuse.environment",  "value": { "stringValue": "production" } }
        ]
      },
      "scopeSpans": [
        {
          "scope": { "name": "litefuse-smoke", "version": "1.0.0" },
          "spans": [
            {
              "traceId": "$TRACE_ID",
              "spanId": "$SPAN_ID",
              "name": "macos-smoke-span",
              "kind": 1,
              "startTimeUnixNano": "$START_NS",
              "endTimeUnixNano": "$END_NS",
              "attributes": [
                { "key": "langfuse.trace.name",              "value": { "stringValue": "macos smoke" } },
                { "key": "langfuse.trace.input",             "value": { "stringValue": "hello from macos" } },
                { "key": "langfuse.trace.output",            "value": { "stringValue": "world" } },
                { "key": "langfuse.observation.type",        "value": { "stringValue": "span" } },
                { "key": "langfuse.observation.input",       "value": { "stringValue": "hello from macos" } },
                { "key": "langfuse.observation.output",      "value": { "stringValue": "world" } }
              ]
            }
          ]
        }
      ]
    }
  ]
}
JSON

curl -sS -i -X POST 'http://localhost:3000/api/public/otel/v1/traces' \
  -u "$PK:$SK" \
  -H 'Content-Type: application/json' \
  -H 'x-langfuse-ingestion-version: 4' \
  -H 'x-langfuse-sdk-name: litefuse-smoke' \
  -H 'x-langfuse-sdk-version: 5.0.0' \
  --data-binary @/tmp/otel-smoke.json
# 期望：HTTP 200，body 大致为 {}
echo "TRACE_ID=$TRACE_ID"
```

拿到项目 API key 的方式：UI（Project → Settings → API Keys）或 `LITEFUSE_INIT_*` 初始化变量，或临时用 tRPC `projectApiKeys.create` 造一把再删（参考 `seed-jev-demo-data.cjs` 的做法）。

### 9.3 摄取时最容易踩的坑 ✅（本机血泪记录）

| 坑 | 现象 | 正确做法 |
| --- | --- | --- |
| `langfuse.observation.level` 传成**整数** | OTLP `intValue` 能写进 Doris、UI 看起来正常，但 `observationForEvalSchema.parse`（`level: z.string()`）在 `scheduleObservationEvals` 里抛错，**该 span 被静默跳过、永远不被评估**（0 条 job_executions） | 传 **`{"stringValue": "..."}`**（字符串） |
| 项目 id 含 `-` 等非 `[A-Za-z0-9_]` 字符 | 摄入直接 500（因为 projectId 会拼成物理表名 `spans_<projectId>`） | 项目 id 必须匹配 `^[A-Za-z0-9_]+$`（`packages/shared/src/server/doris/tableRouting.ts` 的 `assertValidDorisProjectId`） |
| `NEXT_PUBLIC_LITEFUSE_RUN_NEXT_INIT="false"` | 持续 `500 otel registration deferred: split-cache not ready` | 改回 `"true"`（§3.1） |
| 时间戳用了**毫秒** | 行会落到很奇怪的时间分区 | 必须**纳秒字符串**（`BigInt(Date.now())*1000000n`） |

---

## 10. 启动 web 与 worker

### 10.1 worker

```bash
cd <REPO>
export HTTP_PROXY=http://127.0.0.1:8899 http_proxy=http://127.0.0.1:8899
export NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1
export HTTPS_PROXY=http://<VPN_HOST>:<PORT> https_proxy=http://<VPN_HOST>:<PORT>
pnpm --filter worker run dev
```

- 实际命令 ✅：`dotenv -e ../.env -- tsx watch --clear-screen=false --include '../packages/shared/dist/*' src/index.ts`
- **`--include '../packages/shared/dist/*'` 的含义**：worker 会**热载共享包的构建产物**——所以改 `packages/shared` 后跑一次 build，worker 自己就重启了，**不用手工重启 worker**。但 `tsx watch` 监视的是 **`dist`**，不监视 `src` ⇒ 只改 `packages/shared/src/**` 而不 build，worker 看不到改动。
- 启动日志：`Listening: http://0.0.0.0:3030`（`HOSTNAME`/`PORT` 来自 `worker/src/env.ts`，默认 3030）；`index.ts` 会在 `import("./app.js")` **之前**先 `await initializeSplitCache()`（注册队列消费者必须在 split 路由就绪之后）。
- ⚠️ 若 `HTTPS_PROXY` 没设好，worker 会在 LLM 判分时报 `TypeSafe decision model request failed (451)` 一类错误（§8）。

### 10.2 web

```bash
cd <REPO>/web
export HTTP_PROXY=http://127.0.0.1:8899 http_proxy=http://127.0.0.1:8899
export NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1
export HTTPS_PROXY=http://<VPN_HOST>:<PORT> https_proxy=http://<VPN_HOST>:<PORT>
npx dotenv -e ../.env -- next dev
```

**为什么不用 `pnpm run dev:web`** ✅（本轮勘察结论）：

- `web/package.json` 的 `dev` = `dotenv -e ../.env -- next dev --turbopack`；
- 根 `dev:web` = `turbo run dev --filter=web -- --turbo`（又加一个 turbo 开关），`dev:web-no-turbo` = `turbo run dev --filter=web`（仍然会因为包内脚本带上 `--turbopack`）；
- 也就是说**两个根脚本都落在 Turbopack 上**，而本机实测**只有 webpack 模式能起来**（Turbopack 在这套嵌套目录/Turbopack workspace root 选择上出过问题；`next.config.mjs` 里只有 `turbopack.resolveAlias`，**没有** `turbopack.root` 之类的兜底配置）✅。
- 所以推荐直接跑 `next dev`（不带 `--turbopack`）。⚠️ **待在新设备确认**：macOS 上 Turbopack 是否可用（若可用，注意下面的 dist 差异）。

**改 `packages/shared` 后必须两步（webpack 模式下的硬规则）** ✅：

```bash
# 1) 重新构建共享包
pnpm --filter @langfuse/shared run build
# 2) 重启 web
#    （webpack 下 web 解析的是 @langfuse/shared 的 exports → ./dist/src/index.js，不重启看不到改动）
```

对照：`next.config.mjs` 里的 `turbopack.resolveAlias["@langfuse/shared"] = "./packages/shared/src"` 会在 **Turbopack** 模式下把共享包指向**源码**（那时就不需要 build）。**本机跑的是 webpack，所以 `build` 这一步不能省。** ⚠️ macOS 上如果你确认用的是 Turbopack，这条规则的解释要相应调整。

首次编译约 10–20 秒（本机记录）；编译完成后 `http://localhost:3000` 可访问。

### 10.3 两个进程的后台常驻（可选）

```bash
cd <REPO>
nohup pnpm --filter worker run dev > /tmp/lf-worker.log 2>&1 &
cd web && nohup npx dotenv -e ../.env -- next dev > /tmp/lf-web.log 2>&1 &
```

> ⚠️ Windows 上有"后台任务显示完成但服务其实还在跑（被孤儿化）"的坑，判断服务在不在**看端口**；macOS 同理，用 `lsof -nP -iTCP:3000 -sTCP:LISTEN`。

---

## 11. 登录（NextAuth credentials **必须回显 csrf cookie**）

### 11.1 为什么不能只拿 token ✅

`GET /api/auth/csrf` 会同时返回

- JSON 里的 `csrfToken`，**和**
- `Set-Cookie: next-auth.csrf-token=...`

credentials 登录 POST **必须把那个 cookie 一起回显**。只带 token 不带 cookie 时，端点**仍然返回 200**，但**不下发 session cookie** —— 看起来和"密码错了"一模一样（`docs/handover/scripts/_lf_session.cjs` 的文件头就是为这个坑写的）。

### 11.2 可直接复制的 curl 序列

```bash
BASE=http://localhost:3000
JAR=$(mktemp)          # cookie jar
EMAIL='<你的登录邮箱>'
PASSWORD='<你的登录密码>'

# 1) 拿 csrf（同时把 csrf cookie 存进 jar）
CSRF=$(curl -sS -c "$JAR" "$BASE/api/auth/csrf" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).csrfToken))')
echo "csrfToken=${CSRF:0:12}..."     # 只打印前 12 位，别把整串贴进日志

# 2) credentials 登录（关键：-b "$JAR" 回显 csrf cookie；-c "$JAR" 收下 session cookie）
curl -sS -i -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/callback/credentials" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASSWORD" \
  --data-urlencode "callbackUrl=$BASE/" \
  --data-urlencode "json=true"
# 期望：HTTP 302（Location: $BASE/ ）或 HTTP 200 + body {"url":"$BASE/"}
#       并且 Set-Cookie 里有 next-auth.session-token=...
#       （NEXTAUTH_URL 是 https 时名字会变成 __Secure-next-auth.session-token）

# 3) 验证会话真的拿到了
curl -sS -b "$JAR" "$BASE/api/auth/session"
# 期望：{"user":{"email":"$EMAIL","name":...,"id":...}, "expires":"..."}
#       若 body 是 {} ⇒ 登录没成功（最常见原因：漏了 csrf cookie，或密码不对）

# 4) 用同一个 jar 调 tRPC（示例：列出本项目的 LLM 连接）
#    注意 tRPC 的 batch 包装：query 用 GET + ?batch=1&input=...，mutation 用 POST + {"0":{"json":...}}
curl -sS -b "$JAR" -H 'content-type: application/json' -X POST \
  "$BASE/api/trpc/llmApiKey.all?batch=1" \
  --data '{"0":{"json":{"projectId":"<projectId>","includeDecisionModels":true}}}'
```

macOS 的 `mktemp` 直接可用；`node -e` 用来解析 JSON（避免依赖 `jq`，仓库里也没有 jq 依赖）。

### 11.3 内置账号（密码一律不写入文档）

| 账号 | 来源 | 备注 |
| --- | --- | --- |
| `demo@litefuse.ai` | Postgres seeder（`packages/shared/scripts/seeder/seed-postgres.ts`），密码见仓库 `CLAUDE.md` 的「Login for Development」一节（**公开信息，不是密钥**） | demo 项目 id `7a88fb47-b4e2-43b8-a06c-a5ce950dc53a`（见 `CLAUDE.md`） |
| `jev-demo@litefuse.local` | 开发机在本机库里建的演示账号 | **新设备没有**，密码请自行设定；`probe-jev-connect.cjs` 通过 `LF_PROBE_PASSWORD` 环境变量读它 |
| `LITEFUSE_INIT_USER_EMAIL` + `LITEFUSE_INIT_USER_PASSWORD` | 启动时由 `web/src/initialize.ts` 幂等创建（org/project/user/API key 一起建） | 新设备想"开箱即有账号"就用这组变量；**它是初始化用的凭据，别写进文档** |

> 新设备"从零到能用"的最短路径建议：在 `.env` 里设 `LITEFUSE_INIT_ORG_ID` / `LITEFUSE_INIT_ORG_NAME` / `LITEFUSE_INIT_PROJECT_ID` / `LITEFUSE_INIT_PROJECT_NAME` / `LITEFUSE_INIT_PROJECT_PUBLIC_KEY` / `LITEFUSE_INIT_PROJECT_SECRET_KEY` / `LITEFUSE_INIT_USER_EMAIL` / `LITEFUSE_INIT_USER_PASSWORD`，首次启动 web 时会把这些一次建好 ✅（`initialize.ts` 逻辑已核实；注意它要求 `LITEFUSE_INIT_ORG_ID` 存在，否则其余 `LITEFUSE_INIT_*` 会被忽略并打 warning）。

---

## 12. 冒烟检查清单（每项：命令 + 期望结果）

按顺序做；**第 5 项会产生真实数据**（但**不产生 LLM 调用费用**）。

| # | 检查项 | 命令 | 期望结果 |
| --- | --- | --- | --- |
| 1 | 容器全绿 | `docker ps --format '{{.Names}}\t{{.Status}}'` | 5 行 `Up (healthy)`：`litefuse-postgres` / `litefuse-redis` / `litefuse-minio` / `litefuse-doris-fe` / `litefuse-doris-be` |
| 2 | Postgres 迁移已应用 | `docker exec litefuse-postgres psql -U postgres -d postgres -t -A -c "select count(*) from _prisma_migrations where finished_at is not null;"` | 一个正整数（等于迁移总数） |
| 3 | Doris 共享表在 | `node docs/handover/scripts/probe-doris-sql.cjs "show tables from litefuse"` | 列表里包含 **`scores`**、`schema_migrations`（以及 `dataset_run_items_rmt` 之类） |
| 4 | **web 200** | `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/public/health` | `200`；`curl -s http://localhost:3000/api/public/health` 返回 `{"status":"OK","version":"..."}` ✅（`web/src/pages/api/public/health.ts`） |
| 5 | **worker 起来了** | `curl -s http://localhost:3030/` | `{"message":"Langfuse Worker API 🚀"}` ✅（`worker/src/app.ts`） |
| 6 | Doris 可查（走 MySQL 9030） | `node docs/handover/scripts/probe-doris-sql.cjs "select 1 as ok"` | `[ { "ok": 1 } ]`（**不要**用 FE 的 HTTP `/api/query/<db>`：本 Doris 版本返回 405，会造成"查不到数据"的假象） |
| 7 | 摄入一条 trace（OTel） | §9.2 的 curl | HTTP **200** |
| 8 | **`traces_scalar_<projectId>` / `spans_<projectId>` 表存在** | `node docs/handover/scripts/probe-doris-sql.cjs "show tables from litefuse like 'spans_%'" "show tables from litefuse like 'traces_scalar_%'" "show tables from litefuse like 'trace_metrics_agg_%'"` | 三组各至少一行，后缀正好是你的 projectId（例如 `spans_jevdemoproject01`）。**新库在灌第一条 trace 之前这些表不存在**（写入时才 provision） |
| 9 | trace 行真的落库了 | `node docs/handover/scripts/probe-doris-sql.cjs "select count(*) as n from traces_scalar_<projectId>"` | `n` ≥ 1；本机记录 ingest→可见约 **5–7 秒**，稍等再查 |
| 10 | **scores 可读** | `node docs/handover/scripts/probe-doris-sql.cjs "select id,name,data_type,value,string_value from scores where project_id='<projectId>' order by timestamp desc limit 5"` | 有行（新设备刚建库时为空，此时期望"查询成功但 0 行"，**不是报错**） |
| 11 | scores 的 metadata 能正确解析 | `node docs/handover/scripts/probe-doris-sql.cjs "select to_json(metadata) as metadata from scores where project_id='<projectId>' limit 3"` | 返回**合法 JSON**（嵌套引号被正确转义）。**不要**用 `CAST(metadata AS TEXT)`：Doris 的 `map<text,text>` 转文本时不转义内层引号，会得到坏 JSON |
| 12 | Doris 连接数没爆 | `node docs/handover/scripts/probe-doris-sql.cjs "select count(*) as total, sum(case when command='Sleep' then 1 else 0 end) as sleeping from information_schema.processlist where user='root'"` | 修复后应为**个位数**（修前曾打满 root 的 100 配额） |
| 13 | 登录可用 | §11.2 的 curl 序列 | `/api/auth/session` 回显 `user.email` |
| 14 | 页面能开 | 浏览器打开 `http://localhost:3000`，登录后进 `/project/<projectId>/traces` | 能看到第 7 步灌进去的 trace |

> 一句话版本：**1→2→3→4→5→6 全绿 = 环境可用；7→8→9 = 写入链路（含 Doris 重写代理）通了；10→11 = 读链路通了。**

---

## 13. 常见故障排查表

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| `Reach limit of connections. Total: 1024, User: 100, Current: 100`（页面 500，Scores/评估页空白） | mysql2 只在 **`maxIdle < connectionLimit`** 时才启动空闲连接回收（`mysql2/lib/base/pool.js`）。`doris/client.ts` 曾**没设 `maxIdle`**，每个 25 连接池永不释放；Next dev 多 bundle 各自一个池，把 root 的 100 配额吃干。**已在代码里修**：`maxIdle: min(2, limit-1)` + `idleTimeout: 60000`，并给池挂了 `error` 监听（否则 Doris 拒绝新连接会**让 worker 进程崩**）✅ | 代码已修（提交 `45791b4`）。若症状重现：`node docs/handover/scripts/probe-doris-sql.cjs "select count(*) from information_schema.processlist where user='root'"` 确认，必要时 `KILL` 掉 Sleep 会话；再检查是否有旧代码/旧 dist（**改完 shared 一定要 build + 重启 web**） |
| `errCode = 2, detailMessage = Can not found function 'json_object_flatten'` | Doris 版本 < 4.0.6（dev compose 钉的是 **4.0.4**） | 用 §4.1 的 4.0.6 override 起容器 |
| `errCode = 2, detailMessage = no viable alternative at input 'o.release'` | **Doris 保留字**没加反引号。代码里的保留字集合 ✅：`release` `public` `user` `key` `value` `index` `type`（`packages/shared/src/server/repositories/analyticsDateTime.ts` 的 `DORIS_RESERVED`，`dq()` 负责加反引号） | 自己写 SQL 时对这些列名加反引号：`` `release` ``、`` `type` ``…；业务代码里用 `dq()` |
| `metadata` 读出来是 `{}` 或 JSON.parse 报错 | `metadata` 是 Doris 的 **`map<text,text>`**；`CAST(metadata AS TEXT)` **不转义内层引号**（得到 `{"typesafe":"{"questionId":"q1"}"}` → 解析失败 → **静默变 `{}`**，不抛错） | 一律用 **`to_json(metadata)`**（读侧修复已在 `45791b4`；写侧**不要**预先转义，会污染 `metadata['k']` 与元数据过滤） |
| MinIO 连不上 / S3 报错 | **端口映射是 9090→9000、9091→9001**（不是默认的 9000/9001）✅ | `.env` 里 S3 的 `_ENDPOINT` 用 `http://localhost:9090`（不是 9000）；控制台是 `http://localhost:9091` |
| `Stream load FE probe PUT ... returned HTTP 200 without a 307 redirect` | `DORIS_FE_HTTP_URL` 指到了 **BE 的 8040**（dev compose 顶部注释的建议是错的） | 指回 FE：`DORIS_FE_HTTP_URL="http://localhost:8030"`，并确保重写代理在跑（§7） |
| stream load 报 `ETIMEDOUT` / `write EPIPE`（错误消息里带 `BE body PUT`） | 第 2 段 PUT 打到了不可达的 `172.29.0.3:8040` | `export HTTP_PROXY=http://127.0.0.1:8899`（+ 小写 `http_proxy`），且 `NO_PROXY` **不要**包含 `172.29.0.3`；确认代理进程在听 8899；用 §7.4 的方式 1 验证 Location 被改写 |
| `500 otel registration deferred: split-cache not ready` | `NEXT_PUBLIC_LITEFUSE_RUN_NEXT_INIT` 不是 `"true"` | 改成 `"true"` 并**重启 web**（看日志出现 `Running init scripts...`） |
| OTel 上传返回 400 `Master spans ingestion requires Python SDK >= 4.0.0 ...` | 请求没带够"版本证明" | 加 `-H 'x-langfuse-ingestion-version: 4'`（或正确的 SDK 名+版本） |
| OTel 上传返回 400 `UnsupportedEventTypes` | 你打的是 `/api/public/ingestion` 且带了 trace/observation 类事件 | trace/observation 走 `/api/public/otel/v1/traces`；`/api/public/ingestion` 只收 `score-create` / `sdk-log` |
| 摄入 500 且日志里出现 `Invalid Doris split-table project id` | projectId 含非 `[A-Za-z0-9_]` 字符 | 换一个合法 projectId（它要拼成物理表名） |
| 某条 span 看起来正常但**永远不产生分数/job** | `langfuse.observation.level` 用了 `intValue` ⇒ `observationForEvalSchema.parse` 抛错且**被静默吞掉** | 该属性必须传**字符串**（§9.3） |
| TypeSafe 报 `451 Typesafe is not available in your region.` | 地理封锁 / 没挂代理；**注意**：早期该客户端是裸 `fetch`，**完全忽略代理环境变量**，代理支持是后来补的 ✅ | 设 `HTTPS_PROXY`（必须是 HTTP/HTTPS 代理），web 与 worker 都要设；见 §8 |
| TypeSafe 报连接超时而不是 451 | `HTTPS_PROXY` 指向了 SOCKS5 端口（undici `ProxyAgent` 不支持），或指向了 8899 那个 Doris 重写代理 | 换 HTTP(S) 代理 / 起 SOCKS→HTTP 桥；`HTTPS_PROXY` 别和 Doris 的 `HTTP_PROXY` 混用 |
| worker 起来又退出、日志刷 `Redis error connect ECONNREFUSED 127.0.0.1:6379` | Docker 引擎重启窗口内 Redis 短暂不可达 | 等 `litefuse-redis` healthy 再重启 worker；**不是代码问题** |
| Docker Desktop 重启后 Doris FE 没了 | dev compose 的 `doris_fe` **没有 restart 策略** | `docker start litefuse-doris-fe litefuse-doris-be` |
| `pnpm --filter worker run dev` 起不来/端口冲突 | 3030 被占（或上次的进程没退） | `lsof -nP -iTCP:3030 -sTCP:LISTEN`，`kill <pid>` |
| 改了 `packages/shared` 但 web 没反应 | webpack 下 web 读的是 `packages/shared/dist` | `pnpm --filter @langfuse/shared run build` → **重启 web**（worker 会自动热载） |
| `git commit` 时 pre-commit 因 prettier 全量失败 | Windows CRLF 特有；macOS 通常不出现 | 先 `pnpm run format`；确有必要才 `--no-verify` |
| 页面能开但数据全空 | 分表不存在（新库还没写过数据）→ 读路径按设计**降级为空**并记 `langfuse.doris.split_table.read_missing` 指标与结构化日志 ✅ | 先按 §9.2 灌一条 trace 触发 provision；再查 `spans_<projectId>` |

### 13.1 Windows 专属、在 macOS 上会**自然消失**的问题

| Windows 问题 | 为什么 macOS 不再有 |
| --- | --- |
| 路径超 260 字符（需 `git config core.longpaths true`） | macOS 路径长度上限远大于此 |
| husky pre-commit 因 **CRLF** 全量失败，提交必须 `--no-verify` | macOS 检出为 **LF**，prettier 通过 |
| PowerShell 把 UTF-8 中文写成 GBK 乱码（本项目真实毁过一次 900+ 处文档） | macOS 的 shell/编辑器默认 UTF-8 |
| `curl.exe` 把 URL 里的 `[...]`/`?a=1&b=2` 当 glob（`curl: (3) bad range`） | macOS 的 curl 无此行为（保险起见可加 `-g`） |
| PowerShell 把 `[id].ts` 当通配符，`Get-Content` 报找不到 | macOS 用 `cat`/`grep`，且要记得给 shell 加引号 |
| "后台任务显示已完成但服务仍在跑" | 同名现象在 macOS 也存在，但判断方式换 `lsof`（见 §10.3） |
| WSL/Windows 的 docker 网络行为差异 | macOS 的 Docker Desktop 也用 VM，宿主机一律通过**已发布端口**访问容器 ⇒ §7 的重写代理**仍然必需**（这条**不会**消失） |

---

## 14. 交接脚本（仓库外 → 仓库内）

开发机在仓库外（`D:\SelectDB\litefuse-master\`）临时写过一批探测/验收脚本；它们已经清洗后**收进了 `docs/handover/scripts/`**（去掉 Windows 绝对路径、密码改读环境变量、每个脚本头部标注用途/用法/**是否计费**/依赖）。**权威清单与用法见 `docs/handover/scripts/README.md`**，下面是交接视角的摘要：

| 脚本（`docs/handover/scripts/`） | 用途 | 是否计费 |
| --- | --- | --- |
| `_doris_be_proxy.cjs` | Doris 写入重写代理（§7）。**不启动它，写入必失败** | 否 |
| `_lf_session.cjs` | **共享库**（不单独跑）：NextAuth credentials 登录 + 极简 tRPC 调用器；也导出统一的凭据读取。§11 的 csrf cookie 坑就在这里 | 否 |
| `probe-doris-sql.cjs` | 走 MySQL 9030 只读查 Doris（**首选**读数据方式；HTTP `/api/query` 是 405） | 否 |
| `probe-jev-connect.cjs` | Jev/TypeSafe 连通性探测（走应用自己的 `llmApiKey.create`）；`--delete` 清理 | **是：恰 1 次真实 Jev 调用** |
| `probe-apikey-create-500.cjs` | 复现 `llmApiKey.create` 的 500（先用假 key 看错误处理是否正常） | 默认否；`REPRO_JEV=1` 时 **1 次真实 Jev** |
| `probe-v2-live-eval.cjs` | 端到端：OTLP 摄入 → Doris 落 trace → eval → worker 执行 → LLM judge → `scores` 落分数。临时 API key 在所有退出路径删除 | **是：LLM judge（默认 `deepseek-flash`）** |
| `seed-jev-demo-data.cjs` | 给 `jevdemoproject01` 灌真实客服 trace（OTLP）+ 复用/创建 v2 评估器与规则并汇报分数。幂等；`--pilot` / `--count=N` / `--max-calls=N`（超预算拒绝执行） | **是：每条 trace 多次真实 judge 调用**（默认 12 条约 36+ 次） |
| `ui-text.cjs`、`ui-nav-check.cjs`、`ui-row-open-check.cjs`、`ui-peek-check.cjs`、`ui-sample-query.cjs`、`ui-stuck-check.cjs` | Playwright **文本级** UI 验收（导航名、行点击、peek、卡在 Loading 的诊断…）。需要本机 Chrome + `web/node_modules/@playwright/test` | 否（只渲染/读文本；**别在页面上点"运行/测试"**） |
| `probe-listcursor-error.cjs`、`probe-listcursor-experiment.cjs` | 复现/对比 `events.listCursor` 的 tRPC 报错（页面会把错误吞成空表格） | 否 |
| `upstream-reconcile.cjs` | 把本仓库改过的文件与上游 `langfuse` main 的最新版逐文件 diff | 否（只下载源码文本） |
| `probe-doris-redirect.cjs`（⚠️ 目前**只在仓库外**） | 只读诊断：FE 对空 body PUT 回的 `Location` 是什么、该地址是否可达 —— **§7.4 的 node 版** | 否 |
| `_doris_redirect_shim.cjs`（仓库外） | §7 的**另一种实现**：把 `DORIS_FE_HTTP_URL` 指向本机 8031 的反向 shim，只改写 `Location` 的 authority。本机最终采用的是 8899 正向代理方案 | 否 |
| `probe-vpn-socks.cjs`（仓库外） | 裸 SOCKS5 握手探测（判断"规则不允许 / 网络不可达 / 拒绝"） | 否 |

运行前提（与 `scripts/README.md` §二一致）：

- 先 `pnpm install`：脚本会直接 `require` 仓库里的 `packages/shared/node_modules/mysql2/promise` 与 `web/node_modules/@playwright/test`，否则 `MODULE_NOT_FOUND`；
- 登录类脚本**必须**先设 `LF_PROBE_PASSWORD`（公开仓库不落盘口令，缺了直接报错退出）；常用可覆盖变量：`LF_PROBE_EMAIL`、`LF_BASE`、`LF_PROJECT`、`LF_REPO`、`DORIS_*`、`LF_PG_CONTAINER`、`JEV_KEY`；
- 5 个 `ui-*.cjs` 需要本机 Chrome（`npx playwright install chrome` 可补）；
- 完整变量表与端口依赖见 `docs/handover/scripts/README.md`。

> ⚠️ 与 `scripts/README.md` §三末尾的一条差异，**别混**：那里示范的是 `export HTTPS_PROXY=http://127.0.0.1:8899`（目的是让 **Doris 写入**经本机代理，能跑通）。但这个 8899 代理**不提供出境/解锁能力**，把它当 `HTTPS_PROXY` 用不会解决 TypeSafe 的 451 —— Jev 要的是**真正的出海代理**（§8）。本文档 §7.3 的分工（`HTTP_PROXY`=8899、`HTTPS_PROXY`=<真代理>）是更精确的写法。

---

## 15. 待在新设备确认的清单（本文档里所有"未核实"项汇总）

1. Docker Desktop for Mac 给 Doris 的内存阈值（本机未测）。
2. `litefuse-doris-fe` 容器内是否自带 `mysql` 客户端（若要从容器里查 Doris）。
3. 方案 B（直接用主 `docker-compose.yml` 起基础设施）是否可用。
4. 是否需要在 override 里补挂 `doris-config/be_custom.conf`（`max_tablet_version_num=5000`）。
5. macOS 上 Turbopack 模式（`pnpm run dev:web`）能否跑起来；若能，§10.2 的两条规则解释需相应调整。
6. `db:migrate`（`prisma migrate dev`）在缺 `SHADOW_DATABASE_URL` 的 `.env` 下能否跑（用 `db:deploy` 可绕开）。
7. `packages/shared/doris/scripts/up.sh` 的 `source ../../.env` 对当前 `.env` 内容的健壮性（macOS 的 `sh`/`bash` 与 Windows 的 Git Bash 行为可能有差异）。
8. 你的代理端口是 HTTP 还是 SOCKS5；若是 SOCKS5，选哪个 SOCKS→HTTP 桥。
9. `curl -x "$HTTPS_PROXY" https://api.typesafe.ai/` 在不被封锁时的确切返回码。
10. `docs/handover/scripts/` 会继续增补脚本（本文件写作时已有 16 个 + `README.md`）；开工前 `ls docs/handover/scripts/`，以 `scripts/README.md` 的清单为准。⚠️ `probe-doris-redirect.cjs`（§7.4 的 node 版）、`_doris_redirect_shim.cjs`、`probe-vpn-socks.cjs` 目前**只在开发机仓库外**，尚未收进该目录。
