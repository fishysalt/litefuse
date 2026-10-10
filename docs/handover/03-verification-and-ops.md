# 03 · 验证与日常运维手册

> 配套：`01-state-and-history.md`（现状与历史）、`02-macos-deploy.md`（从零部署）、`04-open-items-and-decisions.md`（待决策项）。
> 适用范围：`evaluator-create` 分支的本地/自托管环境（web 3000、worker 3030、Doris 8030+9030/8040、Postgres 5432、Redis 6379、MinIO 9090/9091）。
> 标注约定：**✅已验证**（有代码/配置级证据）、**⚠️未核实**（旧记录或转述，请复核）、**待在新设备确认**（本机无法验证）。
> **脱敏纪律**：本仓库是公开仓库，文档里只写变量名与 `<占位符>`，不写任何真实密钥/密码/token/内网地址。
> **成本纪律见 §7**——本文档里凡"会花钱"的命令都已显式标注。

`<REPO>` = 你的仓库绝对路径（macOS 上例如 `~/SelectDB/litefuse`）；`<projectId>` = 目标项目 id（开发机的演示项目是 `jevdemoproject01`，seed 项目是 `7a88fb47-b4e2-43b8-a06c-a5ce950dc53a`）。

---

## 1. 类型检查与构建

### 1.1 命令表（照抄即可）

| 目的 | 命令（在 `<REPO>` 下执行） | 实际展开 | 期望 |
| --- | --- | --- | --- |
| 构建共享包（**改 shared 后必做**） | `pnpm --filter @langfuse/shared run build` | `tsc`（在 `packages/shared`，输出到 `packages/shared/dist`） | 退出码 0 |
| 共享包类型检查（不产出） | `pnpm --filter @langfuse/shared run typecheck` | `dotenv -e ../../.env -- tsc --noEmit --incremental --tsBuildInfoFile .tsbuildinfo` | 0 错误 |
| **web 全量类型检查** | `cd web && npx tsgo -p tsconfig.build.json --noEmit --skipLibCheck` | `tsgo` 来自 devDependency `@typescript/native-preview`（极快） | 0 错误 |
| web 类型检查（走包脚本，带 .env 与增量缓存） | `pnpm --filter web run typecheck` | `dotenv -e ../.env -- tsgo -p tsconfig.build.json --noEmit --skipLibCheck --incremental --tsBuildInfoFile .tsbuildinfo` | 0 错误 |
| **worker 类型检查（真 tsc）** | `cd worker && npx tsc --noEmit` | 与 worker 的 `build`（`tsc`）同一套配置 | 0 错误 |
| worker 类型检查（tsgo，快） | `pnpm --filter worker run typecheck` | `dotenv -e ../.env -- tsgo --noEmit --skipLibCheck ...` | 0 错误 |
| 全仓类型检查（turbo 串起来） | `pnpm tc`（= `pnpm run typecheck` = `turbo run typecheck`） | 依次跑各包自己的 `typecheck` | 0 错误 |
| web 构建校验（**不改动正在跑的 dev server**） | `pnpm run build:check` | web 的 `build:check`：`NEXT_DIST_DIR=.next-check INLINE_RUNTIME_CHUNK=false dotenv -e ../.env -- next build` | 构建成功 |
| 全量构建 | `pnpm run build`（= `turbo run build`） | shared `tsc` + worker `tsc` + web `next build` | 构建成功 |

要点 ✅：

- **web 的类型检查面由 `web/tsconfig.build.json` 决定**，它 `exclude` 了：`node_modules`、`sdk`、`src/__tests__/**`、`**/*.clienttest.*`、`**/*.servertest.*`。所以**测试文件里的类型错误不会被 `tsgo -p tsconfig.build.json` 发现** —— 改了测试就单独跑对应测试。
- **`pnpm run build:check` 与 dev server 可以并行**（`next.config.mjs` 的 `distDir: process.env.NEXT_DIST_DIR || ".next"`，build:check 用 `.next-check`）✅。
- **改 `packages/shared` 后的固定流程**：`build` → **重启 web**。webpack 模式下 web 解析 `@langfuse/shared` 的 `exports` → `packages/shared/dist/src/index.js`；worker 是 `tsx watch --include '../packages/shared/dist/*'`，会自动热载。**`tsx watch` 监视 dist 不监视 src**。
- 基线状态：`01-state-and-history.md` 记录三项类型检查均为 0 错误（**⚠️ 由上一轮修复者报告，未独立复跑**）。接手后请先自己跑一遍当基线；**任一项不为 0，先修基线再谈新功能**。

### 1.2 只跑某一处的最小组合

```bash
# 只改了 web/**：
pnpm --filter web run lint && (cd web && npx tsgo -p tsconfig.build.json --noEmit --skipLibCheck)

# 只改了 worker/**：
pnpm --filter worker run lint && (cd worker && npx tsc --noEmit)

# 改了 packages/shared/**（非 prisma/clickhouse/doris 迁移）：
pnpm --filter @langfuse/shared run lint \
  && pnpm --filter @langfuse/shared run build \
  && (cd web && npx tsgo -p tsconfig.build.json --noEmit --skipLibCheck) \
  && (cd worker && npx tsc --noEmit)

# 改了 prisma schema / migrations：
pnpm --filter @langfuse/shared run db:generate   # 重新生成 Prisma Client 与 prisma/generated/types.ts
```

（lint 的"最小验证矩阵"原文在根 `AGENTS.md`；上面是矩阵里对应行的可执行版本。）

---

## 2. 测试运行器的现状与历史坑

### 2.1 jest 配置里"Windows 前导斜杠 `testMatch`"的历史坑 ✅（源码注释为证）

`web/jest.config.mjs` 里有上游原样带来的三个 project：`client` / `server` / `e2e-server`。其中 `client` 的 `testMatch` 上游写的是**带前导斜杠**的形式：

```
/**/*.clienttest.[jt]s?(x)      ← 上游写法
```

**前导斜杠让 micromatch 把 pattern 当绝对路径**：POSIX 上绝对路径以 `/` 开头所以能匹配；**Windows 上绝对路径是 `D:\...`，于是这个 pattern 匹配到 0 个文件，整个 client 测试套件"静默地什么都没跑"**（`--listTests` 打印 0；去掉前导斜杠后打印 115）。仓库里已经改成**不带前导斜杠**：

```js
testMatch: ["**/*.clienttest.[jt]s?(x)"],   // client
testMatch: ["**/server/**/*.servertest.[jt]s?(x)"],   // server
testMatch: ["**/*.servertest.[jt]s?(x)"],   // e2e-server
```

对新设备的意义：

- **macOS 上不要"修复"回带前导斜杠的写法**。现在这版在 POSIX 与 Windows 上都匹配同一批文件，是**跨平台正确**的写法。
- 这个坑本身是 **Windows 特有**的，macOS 上原本也不会踩到；但正因为改成了平台无关形式，**在 macOS 上行为与开发机一致**（这是好事：交接后不会出现"我这边 115 个测试、你那边 0 个"的鬼故事）。
- ⚠️ **待在新设备确认**：`web/jest.config.mjs` 里三个 project 的 `transformIgnorePatterns` 写的是 `/web/node_modules/(?!(${esModules.join("|")})/)` 这种**以 `/web/` 开头**的字符串（不是正则，是 jest 的 pattern）。这类写法在 POSIX 上是否仍能命中，请在 macOS 上实测（见 2.2 的自检命令）。

### 2.2 测试命令与前置条件

| 目标 | 命令 | 前置 |
| --- | --- | --- |
| 列出 server 项目会跑哪些文件 | `cd web && npx jest --listTests --selectProjects server \| wc -l` | 见下 |
| 列出 client 项目 | `cd web && npx jest --listTests --selectProjects client \| wc -l` | 同上 |
| 跑 web server 测试（单文件/名字过滤） | `pnpm --filter web run test -- --testPathPatterns="<pattern>" --testNamePattern="<name>"` | 同上 |
| 跑 web client 测试 | `pnpm --filter web run test-client -- --testPathPatterns="<pattern>"` | 同上 |
| 跑 worker 测试（vitest） | `pnpm --filter worker run test -- <file-or-pattern> -t "<name>"` | `.env` 可用 |
| 跳过会连 LLM 的 worker 测试 | `pnpm --filter worker run test:exclude-llm-connections` | 同上；**这条能省真实 LLM 调用**，默认优先用它 |

⚠️ **`web` 的测试脚本都带 `dotenv -e ../.env.test -e ../.env`，而本仓库根目录只有 `.env.test.example`，没有 `.env.test`** ✅（已核实文件列表）。因此：

```bash
cd <REPO>
cp .env.test.example .env.test      # 需要跑 web 测试时先做这一步
# 注意：.env.test 里若是另一套数据库/Redis，会连到别的地方 —— 想清楚再改内容
```

**待在新设备确认**：`dotenv-cli` 在文件缺失时的具体行为（报错退出还是警告后继续），以及补上 `.env.test` 之后 `--listTests` 的实际数量。开发机 2026-09-21 的记录是"`--listTests --selectProjects server` 返回 0，磁盘上有 96 个 `*.servertest.ts`"（⚠️该记录早于 `testMatch` 修正，接手后请以实测为准）。

> 实用建议（来自本项目的实际做法）：**不要只靠 jest 判断"功能对不对"**。这套环境的可信证据是
> **真实 HTTP 调用（curl/tRPC）+ 直接查库（Postgres psql / Doris 9030）**，见 §3–§6。

---

## 3. 查 Doris（telemetry 的唯一读法）

### 3.1 连接方式 ✅

| 方式 | 说明 |
| --- | --- |
| **MySQL 协议（首选）** `127.0.0.1:9030`，用户 `root`、库 `litefuse` | 所有脚本与业务代码都走这条路 |
| ❌ FE HTTP `/api/query/<db>` | **本 Doris 版本返回 405**，早期探针因此报过假的"trace 不可见 / 没有分数" |
| ❌ Doris FE Web UI `http://localhost:8030` | 只能用来看 FE 状态，不做业务查询 |

最省事的封装（走仓库内的 `mysql2`，不需要装 mysql 客户端）：

```bash
cd <REPO>
node docs/handover/scripts/probe-doris-sql.cjs "<sql>" ["<sql>" ...]
# 环境变量可覆盖：DORIS_MYSQL_HOST / DORIS_QUERY_PORT / DORIS_USER / DORIS_PASSWORD / DORIS_DB / LF_REPO
```

想要交互式 shell（需要宿主机 mysql 客户端）：`mysql -h127.0.0.1 -P9030 -uroot litefuse`。

### 3.2 表模型（先知道有哪些表）✅

| 逻辑 | 物理表名 | 说明 |
| --- | --- | --- |
| Span 事件（**含根 span**） | `spans_<projectId>` | 根 span = trace（`is_root = 1`）；**没有** 物理 `observations` 表，也没有业务读取用的 `events` 表 |
| Trace 标量镜像 | `traces_scalar_<projectId>` | trace 列表/书签/公开状态/标签等标量字段；**展示优先从这里取** |
| Trace 指标聚合 | `trace_metrics_agg_<projectId>` | `spans_<projectId>` 的**同步物化视图**，不是写入目标 |
| 分数 | `scores`（**共享**，不分表） | 所有项目的分数都在这张表里，靠 `project_id` 区分 |
| 迁移台账 | `schema_migrations` | `doris/scripts/up.sh` 的迁移记录 |

- 分表**按项目自动 provision**，触发点是**写入路径**（第一次向该项目灌 OTel 数据时）✅；读取遇到缺表会**降级为空**并记 `langfuse.doris.split_table.read_missing`（这是设计行为，不是 bug）。
- `spans` / `traces_scalar` 的分区键是 **`start_time`**（不是 `created_at`），TTL 走 Doris `dynamic_partition`。
- Doris **保留字要加反引号** ✅（`packages/shared/src/server/repositories/analyticsDateTime.ts` 的 `DORIS_RESERVED`）：`release`、`public`、`user`、`key`、`value`、`index`、`type`。手写 SQL 时写成 `` `release` ``、`` `type` ``；业务代码里统一用 `dq()`。

### 3.3 SQL 例子（可直接复制）

```bash
D="node docs/handover/scripts/probe-doris-sql.cjs"

# ── 库与表 ─────────────────────────────────────────────
$D "show databases"
$D "show tables from litefuse"
$D "show tables from litefuse like 'spans_%'"
$D "show tables from litefuse like 'traces_scalar_%'"
$D "show tables from litefuse like 'trace_metrics_agg_%'"
$D "show create table \`traces_scalar_<projectId>\`"

# ── 单个项目的 trace / span 计数 ────────────────────────
$D "select count(*) as traces from traces_scalar_<projectId>"
$D "select count(*) as spans, sum(is_root) as roots from spans_<projectId>"
$D "select id, name, environment, \`release\`, start_time from traces_scalar_<projectId> order by start_time desc limit 5"
$D "select trace_id, span_id, type, name, parent_span_id, is_root from spans_<projectId> order by start_time desc limit 10"

# ── 分数（共享 scores 表）────────────────────────────────
$D "select count(*) as n from scores where project_id='<projectId>'"
$D "select id, trace_id, name, data_type, value, string_value, source, \`timestamp\` from scores where project_id='<projectId>' order by \`timestamp\` desc limit 10"
# metadata 是 map<text,text>：必须用 to_json() 读，否则内层引号不转义 ⇒ 坏 JSON / 读到 {}
$D "select id, to_json(metadata) as metadata from scores where project_id='<projectId>' limit 3"
# 按 data_type 分布（迁移相关的常见核对项）
$D "select data_type, count(*) as n from scores where project_id='<projectId>' group by data_type order by n desc"
# 某条规则/评估器产出的分数（metadata 里的键是扁平字符串）
$D "select count(*) from scores where project_id='<projectId>' and metadata['evaluation_rule_id']='<ruleId>'"

# ── 保留字必须加反引号 ──────────────────────────────────
$D "select \`release\`, \`type\`, \`value\` from spans_<projectId> limit 1"     # ✅
# $D "select release from spans_<projectId> limit 1"                          # ❌ no viable alternative at input 'release'

# ── 连接/健康 ───────────────────────────────────────────
$D "select count(*) as total, sum(case when command='Sleep' then 1 else 0 end) as sleeping from information_schema.processlist where user='root'"
$D "show backends"            # 期待 BE Alive: true
$D "show frontends"
```

> 期望：查询成功即有输出；**新库 / 新项目返回 0 行是正常的**（此时"表不存在"也算符合预期，见 §3.2 的降级说明）。
> 只有 `ERROR:` 前缀才表示真的失败。

### 3.4 Doris 的"读"与"保留"（排障时会用到）

- 自动保留（TTL）由 **`start_time`** 所在日期的 dynamic partition 决定；改 `created_at` **不会**让行提前过期 ✅。
- 排障 SQL：

  ```sql
  SHOW PARTITIONS FROM `traces_scalar_<projectId>`;
  SHOW CREATE TABLE `spans_<projectId>`;      -- 看 dynamic_partition.enable / .start / 分区键
  ```
- 用户主动删除 trace 时，系统对 `spans_<p>` 按 `project_id + trace_id` 删一次（根+子 span），再删 `traces_scalar_<p>`，并删共享 `scores` 里关联的分数；项目删除是 `DROP TABLE`。**命令提交 ≠ 立刻查不到**（Doris mutation 是异步的）。

---

## 4. 查 Postgres（业务元数据）

```bash
P() { docker exec litefuse-postgres psql -U postgres -d postgres -t -A -F'|' -c "$1"; }

# 项目 / 组织
P "select id, name, retention_days from projects order by created_at desc limit 10;"
P "select id, name from organizations;"

# v2 评估器与版本（表名：evaluators / evaluator_versions）
P "select id, name, type, created_at from evaluators where project_id='<projectId>' order by created_at desc;"
P "select id, evaluator_id, version from evaluator_versions where project_id='<projectId>' order by created_at desc limit 10;"

# v2 规则与「规则↔评估器」绑定
#   注意：物理表是 evaluation_rule_evaluator_assignments；列名是 evaluation_rule_id（不是 rule_id）；
#   没有 evaluation_rule_evaluators 这张表
P "select r.id, r.name, r.status, coalesce(e.name,'(none)') as evaluator, coalesce(e.type::text,'-') as etype
   from evaluation_rules r
   left join evaluation_rule_evaluator_assignments a on a.evaluation_rule_id = r.id
   left join evaluators e on e.id = a.evaluator_id
   where r.project_id='<projectId>' order by r.status, r.name;"

# 一次评估执行的状态分布（worker 到底干了什么）
P "select status, count(*) from job_executions where project_id='<projectId>' group by status order by status;"
P "select id, status, left(coalesce(error,''),300) as err, created_at
   from job_executions where project_id='<projectId>' order by created_at desc limit 10;"

# 历史批量评估的批量动作（进度/失败数）
P "select id, status, action_type, total_count, processed_count, failed_count, created_at, finished_at
   from batch_actions where project_id='<projectId>' order by created_at desc limit 10;"
P "select config from batch_actions where id='<batchActionId>';"

# LLM 连接（只看 provider/adapter，不看密钥）
P "select id, provider, adapter, left(coalesce(base_url,''),40) as base_url, created_at
   from llm_api_keys where project_id='<projectId>' order by created_at;"

# 审计（谁改了规则/谁建的 key —— 交接证据）
P "select to_char(created_at,'MM-DD HH24:MI:SS') as t, action, coalesce(user_id,'?') as uid
   from audit_logs where resource_id='<ruleId>' order by created_at;"
```

> ⚠️ `llm_api_keys` 的**密钥字段是加密/哈希存储的，查了也没用**（API key 的 `sk` 只在创建时明文返回一次）。不要试图从库里"取回"密钥。

---

## 5. 看 worker 日志

### 5.1 日志在哪

| 启动方式 | 日志位置 |
| --- | --- |
| 前台 `pnpm --filter worker run dev` | 直接打在终端（winston 默认输出到 stdout） |
| 后台 | `nohup pnpm --filter worker run dev > /tmp/lf-worker.log 2>&1 &` ⇒ `tail -f /tmp/lf-worker.log` |
| 只关心错误 | `grep -Ei 'error|failed|451|Reach limit|EPIPE|ETIMEDOUT' /tmp/lf-worker.log` |
| web 侧日志（判分入口/连接探测在 web） | `nohup npx dotenv -e ../.env -- next dev > /tmp/lf-web.log 2>&1 &` ⇒ `tail -f /tmp/lf-web.log` |

### 5.2 值得盯的关键词（每条对应该环节的失败）

| 关键词 | 含义 / 下一步 |
| --- | --- |
| `Listening: http://0.0.0.0:3030` | worker 启动成功；**没有这行就说明启动就失败了**（`worker/src/index.ts` 会先 `initializeSplitCache()` 再注册队列消费者） |
| `Doris split-table read target missing` | 某项目的分表还没 provision ⇒ 读接口按设计返回空；灌一条数据或用 provisioning 重试 |
| `Reach limit of connections` | Doris 连接配额被打满（§3.3 查 `information_schema.processlist`） |
| `Doris MySQL pool emitted error event (swallowed)` | 池级别的连接错误被**故意吞掉**（否则会崩进程）；紧跟的记录里能看到真正的原因 |
| `Stream load FE probe PUT ... without a 307 redirect` | FE 那段没拿到 307 ⇒ `DORIS_FE_HTTP_URL` 指错了（应指 8030） |
| `BE body PUT` + `ETIMEDOUT` / `write EPIPE` | 第二段 PUT 打到了不可达的 BE 容器地址 ⇒ Doris 重写代理没生效（见 `02-macos-deploy.md` §7） |
| `TypeSafe decision model request failed (451)` | 地理封锁 / 没挂 `HTTPS_PROXY`（见 `02` §8） |
| `TypeSafe decision model request failed (5xx)` / 超时 | 代理不可用，或 provider 侧异常 ⇒ **按成本纪律：不要自动重试** |
| `Error running background migrations` | `LITEFUSE_ENABLE_BACKGROUND_MIGRATIONS=true` 时的后台迁移出错（默认 `false`） |
| `[TRPC] Creating observation-run-batched-evaluation action` | web 侧创建历史批量评估（在 **web 日志**里，不在 worker 日志） |

### 5.3 结合 Postgres 定位（比读日志更快）

```bash
P "select status, count(*) from job_executions where project_id='<projectId>' group by status order by status;"
P "select id, status, left(coalesce(error,''),500) from job_executions where project_id='<projectId>' order by created_at desc limit 5;"
```

`error` 字段通常直接给出根因（评分落库失败 / trace 未找到 / LLM 报错）。

---

## 6. 跑一次「窄范围历史批量评估」并核对 Doris 分数增量

> **本节会花钱**：每条被选中的 observation 每个评估器 = 一次真实 LLM 调用（挂决策模型评估器就是一次 **Jev** 调用）。
> 所以流程的设计目标是：**先看清、先报预算、能用过滤器就别用它**、**失败不重试**、**跑完恢复原状**。

### 6.0 机制（先明白会发生什么）✅

- 入口：tRPC **`batchAction.runEvaluation.create`**（`web/src/features/batch-actions/server/runEvaluationRouter.ts`），受 `evalJob:CUD` 权限约束。
- 入参（`CreateObservationBatchEvaluationActionSchema`）：`projectId`、`query`（表/过滤器/搜索）、`evaluatorIds[]`（≥1），以及 **可选**的 `sampling`（0–1）、`rowLimit`（正整数）、`evaluatorMappings`、`evalVersion: "v2"`。
- 服务端行为 ✅：
  1. 把选中的 id 解析到 **v2 `evaluators`** 或 **legacy `job_configurations`**；**混选两代会被 400 拒绝**；
  2. 先数一遍匹配的 observation 数，**超过 `LITEFUSE_MAX_HISTORIC_EVAL_CREATION_LIMIT` 直接 400**（提示你收窄过滤器）；
  3. 写一条 `batch_actions` 行（`config` 里持久化 sampling/rowLimit/mappings，便于重放），并往 BullMQ 投 `BatchActionProcessingJob`，`jobId = batchAction.id`；
  4. worker 读 **`spans_<projectId>`**（不是物理 `events` 表）流式执行，按 observation 应用 sampling，并用 `rowLimit` 截流。
- 进度查询：tRPC `batchAction.byId`（返回 `status / totalCount / processedCount / failedCount / log`）。

### 6.1 步骤 0 —— 只读盘点（**不花钱**）

```bash
# ① 现有规则与它们的开关状态（尤其当心"ACTIVE + 决策模型评估器"的规则：每条新 trace 都会花一次 Jev）
P "select r.id, r.name, r.status, coalesce(e.name,'(none)'), coalesce(e.type::text,'-') from evaluation_rules r
   left join evaluation_rule_evaluator_assignments a on a.evaluation_rule_id=r.id
   left join evaluators e on e.id=a.evaluator_id
   where r.project_id='<projectId>' order by r.status, r.name;"

# ② 目标评估器 id 与类型（DECISION_MODEL = 花 Jev；LLM_AS_JUDGE = 花配置的 LLM）
P "select id, name, type from evaluators where project_id='<projectId>' and id='<evaluatorId>';"

# ③ 候选 observation 有多少（先用最窄的过滤器估数）
P "select count(*) from batch_actions where project_id='<projectId>';"        # 历史批量动作开销参考
$D "select count(*) as spans from spans_<projectId> where is_root=1"
```

### 6.2 步骤 1 —— 报预算（写进你的工作记录）

模板：

```
任务：<一句话>
预算：Jev ≤ N 次，DeepSeek/其它 LLM ≤ M 次
预计实际：sampling=<x> × rowLimit=<n> × 评估器数 = <k> 次
失败处理：不重试；失败即停并报告
```

### 6.3 步骤 2 —— 处理"既有 ACTIVE 规则"这个持续花费面

如果项目里存在 **ACTIVE 且挂决策模型（Jev）评估器**的规则，那么**你灌进去的每一条新 trace 都会真花一次 Jev** —— 这是本项目最主要的成本泄漏面 ✅（`04-open-items-and-decisions.md` 决策①记录了当时那条规则）。

操作纪律：

1. **先记录原状**（把 §6.1① 的输出存下来，或者记下每条规则的 id + status）；
2. 灌数据前在 **UI 上临时禁用**（不要直接改库——走 UI 会留 audit 记录，交接可追溯）；
3. **灌完立刻恢复原状**，并把"禁用/恢复"两次操作的时间点记进工作记录；
4. 用 audit 复核：

   ```bash
   P "select to_char(created_at,'MM-DD HH24:MI:SS'), action, coalesce(user_id,'?') from audit_logs where resource_id='<ruleId>' order by created_at;"
   ```

### 6.4 步骤 3 —— 触发（两条路，任选）

**(a) UI（推荐，会自然留痕）**：Traces / Observations 页 → 用过滤器把范围收窄（例如 `name contains 'ZZ'`）→ 勾选少量行 → `Run evaluation` → 选 **一个**评估器 → 在对话框里把 sampling / rowLimit 设到最小可用值 → 提交。
页面跳回列表后可在评估器详情或 Traces 页看到 batch action 状态。

**(b) tRPC（可脚本化，登录方式见 `02-macos-deploy.md` §11）**：

```bash
JAR=/tmp/lf.jar      # 由 02 §11.2 的登录序列写好
PJ='<projectId>'
EV='<evaluatorId>'
docker exec litefuse-postgres psql -U postgres -d postgres -t -A -c \
  "select id, name, status from evaluation_rules where project_id='$PJ';"   # 先看清

curl -sS -b "$JAR" -H 'content-type: application/json' -X POST \
  "http://localhost:3000/api/trpc/batchAction.runEvaluation.create?batch=1" \
  --data "$(cat <<JSON
{"0":{"json":{
  "projectId":"$PJ",
  "query":{"filter":[],"searchQuery":"","searchType":["id"]},
  "evaluatorIds":["$EV"],
  "evalVersion":"v2",
  "sampling":0.1,
  "rowLimit":2
}}}
JSON
)"
# 期望：{"result":{"data":{"json":{"id":"<batchActionId>"}}}}（或 error 里给出 400 的原因）
```

> ⚠️ `query.filter` 的可用列受过滤注册表限制；最保险的做法是从 **UI 上真正的筛选**复制条件，而不是手搓 filter 结构（手搓容易踩到"未知过滤列被静默跳过"）。
> ⚠️ `sampling` 是**每个 observation 按概率决定是否执行**，不是"精确取 N 条"；要控制上限同时用 `rowLimit`。

### 6.5 步骤 4 —— 轮询进度（Postgres 比 UI 更直接）

```bash
P "select status, total_count, processed_count, failed_count, finished_at
   from batch_actions where id='<batchActionId>';"
P "select status, count(*) from job_executions where project_id='<projectId>' group by status order by status;"
# 只有出错时才需要看日志明细：
P "select id, status, left(coalesce(error,''),300) from job_executions where project_id='<projectId>' order by created_at desc limit 5;"
```

期望终态：`batch_actions.status = COMPLETED`，`failed_count = 0`（本机曾核对过一条 `COMPLETED total=2 processed=2 failed=0`）✅。
**若出现 `failed_count > 0`：按成本纪律不自动重试**，先把 `error` 摘出来定位根因，再决定是否重新发起（重新发起 = 再花钱）。

### 6.6 步骤 5 —— 核对 Doris 分数增量（**这是"真的成功"的唯一证据**）

```bash
# ① 跑之前先记基线
$D "select count(*) as before_n from scores where project_id='<projectId>'"
$D "select count(*) as before_rule from scores where project_id='<projectId>' and metadata['evaluation_rule_id']='<ruleId>'"

# ② 跑完再数一次（本机记录：ingest→score 时延约 5–7 秒，批量执行按条数放大）
$D "select count(*) as after_n from scores where project_id='<projectId>'"
$D "select count(*) as after_rule from scores where project_id='<projectId>' and metadata['evaluation_rule_id']='<ruleId>'"

# ③ 看新增的具体行（值/类型/来源/时间/元数据）
$D "select id, trace_id, observation_id, name, data_type, value, string_value, source, \`timestamp\` from scores
    where project_id='<projectId>' order by \`timestamp\` desc limit 10"
$D "select id, name, data_type, value, string_value, to_json(metadata) as metadata from scores
    where project_id='<projectId>' order by \`timestamp\` desc limit 3"
```

判定标准：

- `after_rule - before_rule == 期望的执行条数`（期望值由 §6.2 的预算推出）；
- 新增行的 `data_type` 与评估器题型相符（本机已验证的映射 ✅：`choice → CATEGORICAL`、`score → NUMERIC`、`boolean/noul → NUMERIC（值 = P(true)）`；**boolean 目前不落 BOOLEAN**，属已知缺口，见 `04`）；
- `metadata` 用 `to_json()` 能解析出合法 JSON（键是扁平的 `typesafe.*`）。

### 6.7 步骤 6 —— 收尾（**必做**）

```bash
# 1) 把临时禁用的规则恢复原状（UI 上点回去），并再查一次确认
P "select id, name, status from evaluation_rules where project_id='<projectId>' order by name;"
# 2) 删掉临时创建的 API key（tRPC projectApiKeys.delete，或 UI 上删）
P "select id, public_key, note, created_at from api_keys where project_id='<projectId>' order by created_at desc limit 5;"
# 3) 删掉临时创建的 LLM 连接（LlmApiKeys @@unique([projectId, provider])：留着会影响后续同名 provider 的创建）
P "select id, provider, adapter, note from llm_api_keys where project_id='<projectId>';"
# 4) 把本次实际调用次数记进工作记录（对照 01 文档 §7 的成本记账表）
```

---

## 7. 成本纪律（硬要求）

### 7.1 预算与流程

1. **每个任务开工前先报预算**（例如"≤2 次 Jev / ≤4 次 DeepSeek"），并在收尾时报告实际消耗。
2. **provider 失败不重试** —— 重试就是重复计费。失败即停、先定位。
3. **能用 Doris/Postgres 断言验证的，绝不发起真实 LLM 调用**（这是本项目的默认原则）。
4. **测试用的规则/评估器：跑完必须恢复原状态**（禁用的恢复 ACTIVE、临时的删掉），并留 audit 证据。
5. **临时 API key 一律删除**（`api_keys` 表核对）。
6. **带决策模型（Jev）评估器的规则只要处于 ACTIVE，每条新 trace 就真花一次 Jev** —— 灌任何测试数据前先读 §6.3。

### 7.2 哪些操作会触发**真实计费调用**（**务必先看这张表**）

| 操作 | 花费 | 说明 |
| --- | --- | --- |
| `docs/handover/scripts/probe-jev-connect.cjs` | **1 次 Jev** | 走应用自身路径建连接 ⇒ web 执行一次 `testDecisionModelConnection`。脚本头部已标注计费 |
| `docs/handover/scripts/probe-v2-live-eval.cjs` | **1 次 LLM judge**（脚本内是 `deepseek-flash`） | 端到端：OTLP→trace→eval→worker→LLM→`scores` |
| `docs/handover/scripts/seed-jev-demo-data.cjs` | **按条数线性增长** | 脚本头部说明：默认 12 条场景对"本脚本拥有的两个评估器"产生 **36 次**调用，另有**约 12 次**来自项目里既存的 legacy 规则；支持 `--pilot`（1 条）、`--count=N`、`--max-calls=N`（**超出预算会拒绝执行**） |
| `docs/handover/scripts/probe-apikey-create-500.cjs` | 默认 **0**；`REPRO_JEV=1` 时 **1 次 Jev** | 复现 `llmApiKey.create` 的 500 |
| UI 上「测试连接」（LLM / 决策模型连接） | **1 次**真实 provider 调用 | 决策模型连接测试发的是一道 `noul`（是/否）问卷，不是普通 chat completion |
| UI「Run evaluation」/ `batchAction.runEvaluation.create` | **1 次 × 命中条数 × 评估器数** | 用 `sampling` + `rowLimit` + 窄过滤器把它压到个位数 |
| 任何 **ACTIVE** 且挂决策模型评估器的规则 + 新 trace 摄入 | **1 次 Jev / 条根 span** | 持续泄漏面（§6.3） |
| 评估器详情页的「测试」/ 试跑 | 视题型 1 次以上 | 跑之前先确认用的是哪个评估器 |

### 7.3 哪些操作**不花钱**（可以放心多跑）

| 操作 | 说明 |
| --- | --- |
| 所有 Doris 读（`probe-doris-sql.cjs` / SQL）、Postgres 读、`docker exec psql` | 纯读 |
| 类型检查 / lint / build / `build:check` | 纯本地计算 |
| `docs/handover/scripts/` 里的这些：`_doris_be_proxy.cjs`、`_lf_session.cjs`、`probe-doris-redirect.cjs`（⚠️ 可能尚在仓库外） | 内部转发与诊断 |
| `docs/handover/scripts/ui-text.cjs` 及同目录 `ui-*.cjs`（共 6 个） | 只渲染页面、读文本；**只要不在页面上点"运行/测试"就不会调用 LLM** |
| `docs/handover/scripts/upstream-reconcile.cjs` | 只从 GitHub 拉上游文件做 diff |
| `probe-vpn-socks.cjs`（⚠️ 可能尚在仓库外） | 只做 TCP/SOCKS5 握手 |
| `docs/handover/scripts/probe-listcursor-error.cjs` / `probe-listcursor-experiment.cjs` | 只复现 tRPC 报错，不触发评估 |
| 用 curl 打 `/api/public/health`、`/api/auth/*`、`/api/trpc/*` 的**只读** query | 不触发评估 |

### 7.4 记账

把每次真实调用登记到同一张表里（`01-state-and-history.md` §7 有历史记录：累计真实 Jev 调用、被 451 拒绝的次数、DeepSeek 次数）。**接手后请继续维护这张表**，这是判断"这次任务是否超支"的唯一依据。

---

## 8. 日常运维速查

### 8.1 冷启动顺序（每次开新终端 / 重启机器）

```bash
cd <REPO>

# 1) Docker Desktop 起来后，确认 5 个容器
docker ps --format '{{.Names}}\t{{.Status}}'
#    dev compose 的 doris_fe 没有 restart 策略：Docker 重启后要手动拉起
docker start litefuse-doris-fe litefuse-doris-be 2>/dev/null || true
docker compose -f ./docker-compose.dev.yml -f ~/litefuse-dev/doris-4.0.6.override.yml up -d --wait

# 2) Doris 写入重写代理（必须先起）
nohup node docs/handover/scripts/_doris_be_proxy.cjs > /tmp/doris-be-proxy.log 2>&1 &

# 3) 代理环境变量（**每个**新终端都要重新 export）
export HTTP_PROXY=http://127.0.0.1:8899 http_proxy=http://127.0.0.1:8899
export NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1
export HTTPS_PROXY=http://<VPN_HOST>:<PORT> https_proxy=http://<VPN_HOST>:<PORT>

# 4) worker（tsx watch；会自动热载 packages/shared/dist）
nohup pnpm --filter worker run dev > /tmp/lf-worker.log 2>&1 &

# 5) web（webpack 模式；不要用会带 --turbopack 的根脚本）
cd web && nohup npx dotenv -e ../.env -- next dev > /tmp/lf-web.log 2>&1 &
cd ..

# 6) 冒烟（见 02-macos-deploy.md §12）
curl -s http://localhost:3000/api/public/health
curl -s http://localhost:3030/
```

### 8.2 改代码后的固定动作

| 改了什么 | 必须做什么 |
| --- | --- |
| `packages/shared/**` | `pnpm --filter @langfuse/shared run build` → **重启 web**（worker 自动热载） |
| `packages/shared/prisma/**` | 上一行 + `pnpm --filter @langfuse/shared run db:generate`（必要时 `db:deploy`） |
| `worker/**` | 无（`tsx watch` 自动重启） |
| `web/**` | 无（Next dev 热编译） |
| `.env` | **重启 web 和 worker**（`dotenv -e` 只在进程启动时读一次） |

### 8.3 备份（新设备上请自己定策略）

| 对象 | 建议 |
| --- | --- |
| Postgres | `docker exec litefuse-postgres pg_dump -U postgres -d postgres -Fc > litefuse-pg-$(date +%Y%m%d).dump`；恢复 `pg_restore`。**注意恢复后 `SALT` / `ENCRYPTION_KEY` 必须与源一致** |
| Doris | 卷 `litefuse_doris_be_storage` / `litefuse_doris_fe_meta`（dev compose 的卷名）。参考做法：停容器后 `docker run --rm -v <vol>:/data -v $PWD:/backup alpine tar czf /backup/xxx.tgz -C /data .`。⚠️ Doris 元数据与数据卷必须**成对**备份，否则 FE 起不来 |
| MinIO | 卷 `litefuse_minio_data`（或用 `mc mirror`） |
| ⚠️ 不要 | 用 `docker compose ... down -v` 做"清理"（**连卷一起删**） |

### 8.4 危险命令清单（默认不要碰）

| 命令 | 后果 |
| --- | --- |
| `pnpm run dx` / `dx-f` / `dx:skip-infra` | `infra:dev:prune` = `down -v`（**删卷**）+ 重置库 + 重置 Redis + 重装依赖 |
| `pnpm run nuke` | 删 node_modules / 构建产物 / 容器 + 清库 |
| `pnpm --filter @langfuse/shared run db:reset` | `prisma migrate reset`（**清空 Postgres**） |
| `pnpm --filter @langfuse/shared run doris:drop` / `doris:reset` | 删 Doris 表 |
| `git reset --hard` / `git clean -fdx` | 见根 `AGENTS.md`：除非明确要求，不要做破坏性 git 操作 |

---

## 9. 待在新设备确认的清单（本文件里的"未核实"项汇总）

1. `web/jest.config.mjs` 里 `transformIgnorePatterns: ["/web/node_modules/(?!...)/"]` 在 macOS 上是否仍能命中（用 `--listTests` 实测）。
2. 补上 `.env.test` 后 `jest --listTests --selectProjects server|client` 的实际文件数；以及缺文件时 `dotenv-cli` 的行为。
3. 脚本位置核实：`probe-v2-live-eval.cjs`、`seed-jev-demo-data.cjs`、6 个 `ui-*.cjs`、`upstream-reconcile.cjs`、`probe-apikey-create-500.cjs`、`probe-listcursor-*.cjs` **已经在** `docs/handover/scripts/`（权威清单与用法见同目录 `README.md`）；`probe-doris-redirect.cjs`、`_doris_redirect_shim.cjs`、`probe-vpn-socks.cjs` **尚在仓库外**。用 `ls docs/handover/scripts/` 自行确认最新状态。
4. `probe-doris-sql.cjs` 依赖 `packages/shared/node_modules/mysql2`：新设备必须先 `pnpm install`（否则报找不到模块）。
5. `ui-*.cjs` 依赖本机 **Chrome**（`chromium.launch({ channel: "chrome" })`）与 Playwright 浏览器（`web/node_modules/@playwright/test` + 可能需要的 `npx playwright install`）。
6. `batchAction.runEvaluation.create` 的 `query.filter` 结构：建议从 UI 复制真实筛选条件，不要在脚本里手搓（本文档 §6.4 的手搓示例可能被过滤注册表拒绝）。
7. Doris 备份/恢复的完整流程（本文档 §8.3 只给了方向，未在开发机上做过 Doris 卷恢复演练）。
