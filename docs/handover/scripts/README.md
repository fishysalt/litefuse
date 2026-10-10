# 辅助脚本归档（handover / scripts）

这里是迁移期间在**仓库外**（Windows 主机 `D:\SelectDB\litefuse-master\`）临时写的一批探测/验收脚本，
现在原样收进仓库，好随 git 一起带到 macOS 新机器上继续用。

收进来时做过统一清洗：

- **路径**：所有写死的 Windows 绝对路径（`D:\SelectDB\litefuse-master\...`）已去掉。仓库根目录改为
  `process.env.LF_REPO ?? path.resolve(__dirname, "..", "..", "..")`（脚本位于 `<仓库>/docs/handover/scripts/`，
  往上三级正好是仓库根），临时目录改用 `os.tmpdir()`。macOS / Linux 上直接可用，无需再改代码。
- **凭据**：所有硬编码的密码一律删除，改从环境变量读取，**缺失时直接报错退出**（不会静默用一个默认口令跑起来）。
  Jev / TypeSafe 的 key 从来不落盘，只从 `JEV_KEY` 读。
- **注释头**：每个脚本顶部加了一段 6 行注释（用途 / 用法 / 是否计费 / 依赖），其中会触发真实 LLM 调用的
  脚本明确标注了「**消耗真实额度**」。

> ⚠️ 计费纪律：标「是」的脚本会真的花钱。跑之前先看清楚再用 `--max-calls` 之类的参数限制规模。
>
> 相关：Doris 在本机是靠一个仓库外的 docker compose override 从 4.0.4 顶到 4.0.6 才跑起来的，
> 那个文件已归档在 `../overrides/`（用法与成因见 `../overrides/README.md`）。

---

## 一、脚本一览

| 文件名 | 用途 | 是否计费 | 依赖 | 用法 |
|---|---|---|---|---|
| `_lf_session.cjs` | **共享库**（不是可直接跑的探测脚本）：NextAuth 凭据登录 + 极简 tRPC 调用器；也导出 `probeCredentials()` 统一读账号密码。 | 否 | web 服务在跑 | 被其它脚本 `require("./_lf_session.cjs")`；不单独运行 |
| `_doris_be_proxy.cjs` | 正向代理：把 Doris FE 的 307 重定向里那个**连不上的 BE 容器地址**重写成本机能连的地址，让 stream load / 写入类操作可用；同时支持 CONNECT 隧道，worker 可借它出网。 | 否 | 本机 Doris BE 的 HTTP 端口（默认 8040）在跑 | `node _doris_be_proxy.cjs`（默认监听 `127.0.0.1:8899`） |
| `probe-doris-sql.cjs` | 用 MySQL 协议直连 Doris 跑任意 SQL，验证 trace / score 是否真的落库（HTTP `/api/query/<db>` 在这个 Doris 版本上返回 405，会造成误判）。 | 否 | Doris FE 查询端口（默认 9030） | `node probe-doris-sql.cjs "select count(*) from traces_scalar_jevdemoproject01"` |
| `probe-listcursor-error.cjs` | 复现评估器样本选择器的 `events.listCursor` 报错并打印**原始 tRPC 错误体**（页面会把错误吞成空表格，只能这样看真因）。 | 否 | web 服务在跑 | `LF_PROBE_PASSWORD=... node probe-listcursor-error.cjs` |
| `probe-listcursor-experiment.cjs` | 用 Experiments 示例过滤器（`isExperimentItemRootSpan = true`）再打一次 `listCursor`，对比状态码与行数，判断布尔过滤器是否被静默丢弃。 | 否 | web 服务在跑 | `LF_PROBE_PASSWORD=... node probe-listcursor-experiment.cjs [列名\|none]` |
| `probe-apikey-create-500.cjs` | 复现 `llmApiKey.create` 的 500：先用假 key 跑一次 OpenAI 连接（看错误是否被正常处理），可选再用真 key 跑 TypeSafe 连接。 | 默认**否**；加 `REPRO_JEV=1` 时**是**（1 次真实 Jev 调用，**消耗真实额度**） | web 服务在跑 | `LF_PROBE_PASSWORD=... node probe-apikey-create-500.cjs` |
| `probe-jev-connect.cjs` | 走应用自己的路径做 Jev/TypeSafe 连通性探测：创建 decision-model 连接，让 web 服务执行一次 `testDecisionModelConnection`。 | **是** —— 恰好 1 次真实 Jev API 调用，**消耗真实额度**（`--delete` 模式不调用） | web 服务在跑 + `JEV_KEY` | `JEV_KEY=... LF_PROBE_PASSWORD=... node probe-jev-connect.cjs`；清理：`... node probe-jev-connect.cjs --delete` |
| `probe-v2-live-eval.cjs` | 端到端评估验收：OTLP 写入 → trace 落 Doris → `eval-create` → worker 执行 → **LLM judge 调用** → score 落 Doris，并逐步打印可见性。 | **是** —— judge 会发真实 `deepseek-flash` 请求，**消耗真实额度** | web(3000) + worker + Doris(9030) + Postgres(docker exec) 全在跑 | `LF_PROBE_PASSWORD=... node probe-v2-live-eval.cjs` |
| `seed-jev-demo-data.cjs` | 给 Jev demo 项目灌一批真实客服 trace（走 OTLP），让真实评估器跑起来并汇报 score / verdict。幂等：按名字复用 evaluator/rule，只追加新 trace。 | **是** —— 每条 trace 触发多次真实 judge 调用（默认 12 条场景约 36 次以上），**消耗真实额度**；自带 `--max-calls` 预算保护，超预算拒绝灌数据 | web(3000) + worker + Doris(9030) + Postgres(docker exec) 全在跑 | `LF_PROBE_PASSWORD=... node seed-jev-demo-data.cjs [--pilot] [--count=N] [--batch=N] [--max-calls=N]` |
| `ui-text.cjs` | 迁移后评估器 v2 页面的**文本级验收**：登录后 dump 可见文字 / 表格行 / 按钮，并检查该出现的控件与列是否都在（含 `MISSING` 清单）。 | 否 | web(3000) + 本机 Google Chrome + 仓库 `web/` 里已装 `@playwright/test` | `LF_PROBE_PASSWORD=... node ui-text.cjs [路径 ...]`（默认 `/evals/v2`、`/evals/v2/rules`） |
| `ui-nav-check.cjs` | 验收侧边栏入口：必须显示 "Evaluators"（不是 "LLM-as-a-Judge"）且点进去落在 `/evals/v2`。只看文本与 URL，不截图。 | 否 | 同上 | `LF_PROBE_PASSWORD=... node ui-nav-check.cjs` |
| `ui-row-open-check.cjs` | 检查评估器列表里点一行是否真的打开该评估器（URL 变成 `/evals/<id>`），并打印行内链接，用来区分「这行不是链接」和「导航坏了」。 | 否 | 同上 | `LF_PROBE_PASSWORD=... node ui-row-open-check.cjs` |
| `ui-peek-check.cjs` | 验证 peek（侧边预览）移植上游改动后仍可用：点行加 `peek=<id>`、关闭移除 `peek=`、且无 console/page 报错。 | 否 | 同上 | `LF_PROBE_PASSWORD=... node ui-peek-check.cjs [路径]`（默认 `/traces`） |
| `ui-sample-query.cjs` | 抓「新建评估器」页面实际向 `listCursor` / `filterOptions` 发的请求与收到的响应，用来区分「时间范围内真没数据」和「过滤器被丢了」。 | 否 | 同上 | `LF_PROBE_PASSWORD=... node ui-sample-query.cjs` |
| `ui-stuck-check.cjs` | 诊断「卡在 Loading...」：打印可见文字、每个 tRPC 响应的状态与短响应体、所有 console / page / requestfailed 错误。 | 否 | 同上 | `LF_PROBE_PASSWORD=... node ui-stuck-check.cjs [/evals/v2/rules]` |
| `upstream-reconcile.cjs` | 把本仓库改过的几个文件，与上游 langfuse `main` 的最新版逐文件 diff，打印精简差异，回答「上游多了什么、我们要不要跟」。 | 否（只下载源码文本） | 本地一份上游 clone + `curl` + 能访问 `raw.githubusercontent.com` | `LF_UPSTREAM_CLONE=/path/to/langfuse-latest node upstream-reconcile.cjs` |
| `probe-doris-redirect.cjs` | 探测 Doris 写入路径的两个环境事实：FE 对 stream-load PUT 返回的 `Location` 是什么、那个 `Location` 从本机是否可达（决定你要不要用下面的代理/垫片）。PUT 不带 body，**不写入任何行**。 | 否 | Doris FE HTTP 端口在跑（默认 `127.0.0.1:8030`） | `node probe-doris-redirect.cjs` |
| `_doris_redirect_shim.cjs` | 挡在 Doris FE 前面的本地开发垫片：只把 307 重定向里的 `Location` 主机改写成本机发布出来的 BE 端口，让 stream load 的第二跳从宿主机打通。把应用指到它即可（`DORIS_FE_HTTP_URL=http://127.0.0.1:8031`）。 | 否 | 上游 Doris FE HTTP（默认 8030）与 BE HTTP（默认 8040）都在跑 | `node _doris_redirect_shim.cjs`（默认监听 `127.0.0.1:8031`） |
| `probe-vpn-socks.cjs` | 对本机 SOCKS5 代理做握手，逐目标域名打印 RFC1928 返回码，判断「出网失败」是代理没起、被规则拒绝、还是目标不可达。只握手不请求，**不消耗任何额度**。 | 否 | 本机一个 SOCKS5 代理在监听（默认 `127.0.0.1:12450`） | `node probe-vpn-socks.cjs`（`VPN_SOCKS_HOST` / `VPN_PORT` 可覆盖） |

---

## 二、macOS 上的运行前提

### 1. Node 版本与运行环境

- **Node 24**（仓库 `.nvmrc` 是 `v24.6.0`，`package.json` 的 `engines.node` 是 `24`）。本归档的 19 个脚本已在
  Node `v24.19.0` 上全部通过 `node --check`。
- 最低要求 Node ≥ 20：脚本用了全局 `fetch`、`Headers.getSetCookie()`、`BigInt` 字面量。
- 依赖已装好：脚本会从仓库里直接 `require` 两个东西 ——
  `packages/shared/node_modules/mysql2/promise` 和 `web/node_modules/@playwright/test`。
  所以在 macOS 上先 `pnpm install`（仓库根），否则用到这两个的脚本会 `MODULE_NOT_FOUND`。

### 2. 需要哪些端口在监听

| 端口 | 是什么 | 哪些脚本需要 |
|---|---|---|
| `3000` | Litefuse **web**（Next.js，UI + tRPC + OTLP 入口） | 除 `_doris_be_proxy.cjs` / `_doris_redirect_shim.cjs` / `probe-doris-sql.cjs` / `probe-doris-redirect.cjs` / `probe-vpn-socks.cjs` / `upstream-reconcile.cjs` 外全部 |
| `9030` | **Doris FE** 的 MySQL 查询端口 | `probe-doris-sql.cjs`、`probe-v2-live-eval.cjs`、`seed-jev-demo-data.cjs` |
| `8030` | **Doris FE** 的 HTTP 端口（Web UI / stream-load 入口） | `probe-doris-redirect.cjs`（默认打它）、`_doris_redirect_shim.cjs`（把它作为上游） |
| `8040` | **Doris BE** 的 HTTP 端口（stream load 的第二跳目标） | `_doris_be_proxy.cjs` 与 `_doris_redirect_shim.cjs` 都要它可达 |
| `8899` | `_doris_be_proxy.cjs` **自己监听**的端口 | 只有 `_doris_be_proxy.cjs`（运行它时占用） |
| `8031` | `_doris_redirect_shim.cjs` **自己监听**的端口 | 只有 `_doris_redirect_shim.cjs`（运行它时占用），并把应用指到它 |
| `12450` | 本机 **SOCKS5 代理**端口（VPN 客户端的本地端口） | 只有 `probe-vpn-socks.cjs`（默认值，可用 `VPN_PORT` 覆盖） |

另外还需要：

- **worker** 在跑 —— 否则 `probe-v2-live-eval.cjs` / `seed-jev-demo-data.cjs` 会一直等不到 score（脚本会等到
  `MAX_WAIT_MS` / `--wait-ms` 超时才结束，并报 `NO SCORE`）。
- **Postgres**：`probe-v2-live-eval.cjs` 和 `seed-jev-demo-data.cjs` 会 `docker exec <容器> psql ...` 直接查
  `job_executions`，所以要 **Docker Desktop 在跑**且容器名对得上（默认 `litefuse-postgres`）。
- **Google Chrome**：5 个 `ui-*.cjs` 用 `chromium.launch({ channel: "chrome" })`，必须装本机 Chrome；
  没装的话用 `npx playwright install chrome` 补。

### 3. 需要哪些环境变量

登录类脚本**必须**先设 `LF_PROBE_PASSWORD`（仓库是公开的，口令不落盘；缺失时脚本会直接报错退出）：

```sh
export LF_PROBE_PASSWORD='<demo 账号口令>'
```

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LF_PROBE_PASSWORD` | **无（必填）** | 所有登录类脚本的账号口令。缺失即报错退出。 |
| `LF_PROBE_EMAIL` | `jev-demo@litefuse.local`（`ui-text.cjs` 为 `demo@litefuse.ai`） | 登录邮箱，可按项目覆盖。 |
| `LF_BASE` | `http://localhost:3000` | web 服务地址。 |
| `LF_REPO` | 脚本上三级目录（即仓库根） | 只有仓库不在标准位置、或把脚本拷到别处时才需要设。 |
| `LF_PROJECT` | 各脚本自带（`jevdemoproject01` 或 seed 项目 UUID） | 目标项目 id。 |
| `DORIS_MYSQL_HOST` / `DORIS_QUERY_PORT` / `DORIS_USER` / `DORIS_PASSWORD` / `DORIS_DB` | `127.0.0.1` / `9030` / `root` / 空 / `litefuse` | Doris MySQL 连接参数。 |
| `LF_PG_CONTAINER` / `LF_PG_USER` | `litefuse-postgres` / `postgres` | `docker exec ... psql` 用的容器名与用户。 |
| `JEV_KEY` | 无 | Jev / TypeSafe 的 key，仅 `probe-jev-connect.cjs`、`probe-apikey-create-500.cjs`（`REPRO_JEV=1`）需要。 |
| `JEV_BASE_URL` / `JEV_UPSTREAM` | `null`（直连）/ `typesafe` | Jev 连接的 base URL 与上游选择。 |
| `REPRO_JEV` | 未设 | 设为 `1` 才会跑 `probe-apikey-create-500.cjs` 里的真实 Jev 调用（**会消耗真实额度**）。 |
| `PROXY_PORT` / `DORIS_BE_HTTP_PORT` / `DORIS_BE_REACHABLE_HOST` | `8899` / `8040` / `127.0.0.1` | `_doris_be_proxy.cjs` 的监听端口、BE 端口、以及重写后的可达地址。 |
| `SHIM_PORT` / `SHIM_UPSTREAM_HOST` / `SHIM_UPSTREAM_PORT` / `SHIM_BE_TARGET` | `8031` / `127.0.0.1` / `8030` / `127.0.0.1:8040` | `_doris_redirect_shim.cjs` 的监听端口、上游 FE、以及重写后的 BE 目标。 |
| `DORIS_FE_HTTP_URL` | `http://localhost:8030`（shim 场景下指 `:8031`） | `probe-doris-redirect.cjs` 打的目标；也是应用 stream-load 的入口。 |
| `VPN_SOCKS_HOST` / `VPN_PORT` | `127.0.0.1` / `12450` | `probe-vpn-socks.cjs` 要握手的本地 SOCKS5 代理端点。 |
| `LF_UPSTREAM_CLONE` / `LF_TMP_DIR` | 仓库同级 `langfuse-latest` / `os.tmpdir()` | 上游 clone 路径与临时目录。 |
| `LF_JUDGE_MODEL` | `deepseek-flash` | `seed-jev-demo-data.cjs` 的 judge 模型。 |
| `MAX_WAIT_MS` / `RUN_TAG` | `240000` / 时间戳后 6 位 | `probe-v2-live-eval.cjs` 的等待上限与本次运行标签。 |

### 4. 代理：`HTTP_PROXY` 与 `HTTPS_PROXY` 不是一回事（重要，容易踩）

Doris 写入相关的问题，和 TypeSafe/Jev 出网的问题，**是两条独立的路，读的也不是同一个环境变量**。
下面这段都是对着仓库代码核过的结论，不要按直觉混用：

| | Doris 的 HTTP / stream load 路径 | TypeSafe（Jev）决策模型 + LLM judge 路径 |
|---|---|---|
| 代码位置 | `packages/shared/src/server/doris/client.ts`，用的是 **axios** | `.../llm/typesafe/typeSafeDecisionModelClient.ts`、`.../llm/fetchLLMCompletion.ts`，用的是 **fetch + undici** |
| 怎么选代理 | axios 没设 `config.proxy`，于是走 `proxy-from-env` 的 `getProxyForUrl()`，按 URL 协议读 `HTTP_PROXY` / `HTTPS_PROXY` | 只读 `env.HTTPS_PROXY`（`env.ts` 里声明的就是这一个），然后 `new ProxyAgent(proxyUrl)` 交给 fetch 当 dispatcher |
| 会不会看 `NO_PROXY` | **会**（`proxy-from-env` 支持 `NO_PROXY`/`no_proxy`） | **不会**（undici 的 `ProxyAgent` 不实现 `NO_PROXY`） |
| 支不支持 SOCKS5 | 取决于 axios/Node，不在此列 | **不支持** —— 仓库注释里写明了 `ProxyAgent` 只讲 HTTP(S) 代理，SOCKS5-only 的代理需要另搭桥或换支持 SOCKS 的 agent |

具体到本归档的两个"改写型"代理：

- `_doris_be_proxy.cjs` / `_doris_redirect_shim.cjs` 解决的是**「FE 返回的 `Location` 指向 Docker 容器内网 IP，
  宿主机连不上」**这个问题，是本地重写代理，不是出网代理。它们服务的是 **Doris 写入**。
- 如果你的 Doris 写入还需要应用经代理出去，那么设的是（axios 路径）：

  ```sh
  export HTTP_PROXY=http://127.0.0.1:8899
  ```

  并且注意 `NO_PROXY`：因为 axios 这条路径**会**尊重 `NO_PROXY`，所以要把本机/内网地址排除掉，
  否则连 `localhost:8040`、`127.0.0.1:9030` 这类请求也会被塞进代理。

- **这条设置对 TypeSafe 的 451 完全没用。** 原因有两层：
  1. TypeSafe / LLM judge 路径**只读 `HTTPS_PROXY`**，`HTTP_PROXY` 设了它也不看；
  2. 就算把 `HTTPS_PROXY` 指到本地的改写代理，也解决不了 451 —— 451 是**对端按地区/合规拒绝**（区域限制），
     需要的是**一个真正能把流量送出去、且落在允许地区的出网代理**，而不是本地做地址重写的代理。
- 所以要给 TypeSafe 配出网代理时，用（注意是 `HTTPS_PROXY`，且它会忽略 `NO_PROXY`）：

  ```sh
  export HTTPS_PROXY=http://<允许地区的出网代理>:<port>
  ```

  并且这个代理**必须是 HTTP(S) 代理** —— undici `ProxyAgent` 不支持 SOCKS5；如果手上只有 SOCKS5
  （比如 VPN 客户端只给本地 SOCKS5 端口），需要再加一层 HTTP→SOCKS 桥，或者改用支持 SOCKS 的 agent。
  诊断这类"到底是代理没起 / 被规则拒 / 目标不可达"的问题，用 `probe-vpn-socks.cjs`。

### 5. Windows → macOS 的差异小结

- PowerShell 的 `$env:JEV_KEY = "..."` 换成 `export JEV_KEY='...'`；`%TEMP%` 相关逻辑已改成 `os.tmpdir()`。
- `D:\...\` 反斜杠路径已全部改为 `path.resolve/path.join`，`/` 与 `\` 都能正确解析。
- `docker exec` 在 macOS 上要 Docker Desktop 已启动；`curl` 系统自带。
- 5 个 `ui-*.cjs` 需要先在 macOS 上装 Chrome（`npx playwright install chrome`）。
