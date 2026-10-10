# Litefuse × Jev 评估器体系 —— 跨设备工作档案

> 这份档案是为"换设备（macOS）继续开发"准备的：目标是在一台没有任何本项目环境的新机器上，把系统跑起来、把当前进度接上、知道下一步做什么。
>
> 换设备前最后状态：分支 `evaluator-create`，最新提交 `45791b4`（已推送 `origin`）。
> 撰写时间：2026-10-10（本机 Windows 环境）。

---

## 0. 一句话背景

把上游 **Langfuse 4.43.0** 的 evaluator 体系（evaluator / version / rule / assignments + 决策模型 **"Jev"**/Typesafe）迁移进 **Litefuse**（自托管、Doris 存储后端）。

工作原则（贯穿全程，接手后请继续遵守）：

1. **尽量不动底层**（存储层、共享查询层能不改就不改）；
2. **能抄就抄**上游，抄不了就用我们自己的底座做等价实现，再做不了就说明原因而不是硬塞；
3. **组件只增不换**（add, never replace）；
4. **UI 优先**，先跑起来能看能点，再逐项与上游对齐；拿不准的硬决策交回用户，不擅自决定。

---

## 1. 五分钟接手路径

```bash
# 1) 取代码
git clone https://github.com/fishysalt/litefuse.git
cd litefuse && git checkout evaluator-create

# 2) 依赖（Node ≥ 22、pnpm 9.x）
pnpm install

# 3) 起基础设施（Doris FE/BE + Postgres + Redis + MinIO），细节见 02
#    容器：litefuse-doris-fe / litefuse-doris-be / litefuse-postgres / litefuse-redis / litefuse-minio

# 4) 配 .env（变量清单见 02，示例见 .env.dev.example）
#    注意：Doris 写入必须经重写代理；TypeSafe 需要代理（见 02）

# 5) 迁移 + 构建共享包 + 起服务
cd packages/shared && npx prisma migrate deploy && pnpm run build && cd ../..
pnpm --filter web run dev      # http://localhost:3000
pnpm --filter worker run dev   # tsx watch，会自动热载 packages/shared/dist
```

冒烟检查项与逐条命令在 **`03-verification-and-ops.md`**。跑不通时先看 `02` 末尾的故障排查表。

---

## 2. 档案结构

| 文件 | 内容 | 什么时候读 |
|---|---|---|
| `01-state-and-history.md` | 任务目标、已完成工作的时间线（按主题）、已验证 / 未验证能力清单、commit 列表、成本记账 | 想快速知道"已经做了什么、什么是真的能用" |
| `02-macos-deploy.md` | macOS 从零部署：容器、`.env`、Doris 写入代理、TypeSafe 代理与地理封锁、OTel 摄取、启动命令、登录、故障排查 | 新设备第一次搭环境 |
| `03-verification-and-ops.md` | 类型检查 / 构建命令、Doris 查询示例、日志位置、窄范围批量评估演练、**成本纪律** | 每次改动后自检、想跑验证 |
| `04-open-items-and-decisions.md` | 待用户拍板的决策、已知缺口（可直接当任务卡片）、UI 陷阱提醒 | 决定下一步做什么之前 |
| `05-reference-docs.md` | 15 篇内部规范文档的清单与去向（**未随本仓库提交**，见下） | 需要读原始规范时 |
| `06-next-steps-plan.md` | 接手后的执行顺序：先拍板什么、P0/P1/P2 任务表、每项验收标准与成本预估 | 环境跑通后决定"先干哪件" |
| `scripts/` | 从开发机带过来的辅助脚本（Doris 代理、会话登录、Doris 查询探针、jeV 连通性探针、UI 文本检查、seed 数据、上游对齐等），已清洗掉硬编码路径与密钥 | 需要复现验证或造数据 |

### 关于 15 篇内部规范文档

原始规范与方案文档（`交接-给新对话.md`、`评估器-v2-迁移总说明.md`、`改造方案-上游架构+litefuse命名+Doris存储.md`、`待决问题登记.md` 等 15 篇）**没有放进本仓库**：`origin`（`fishysalt/litefuse`）是**公开仓库**，内部方案文档不宜公开。

它们当前保存在开发机 `D:\SelectDB\litefuse-master\handover-reference\`，需要**另行**转移到新设备（U 盘 / 网盘 / 私有仓库），清单见 `05-reference-docs.md`。如果你确认可以公开，也可以把它们提交进本目录。

---

## 3. 三条最容易踩的红线

1. **共享包改完必须 rebuild**：`pnpm --filter @langfuse/shared run build`，然后**重启 web**——web 解析的是 `packages/shared/dist`，不重启看不到改动（worker 是 tsx watch，会自动热载）。
2. **Doris 写入必须走重写代理**：Doris FE 会 307 重定向到容器内网 `172.29.0.3:8040`（宿主不可达），而 BE 已发布在宿主 `127.0.0.1:8040`，所以本机用 `scripts/` 里的 BE 代理（8899）在中间改写。macOS 上同理。
3. **TypeSafe（Jev）在地理封锁区会被 `HTTP 451` 拒绝**，必须挂代理；开发机用的是**局域网** VPN（具体地址已按"公开仓库"要求脱敏，见开发机 `.env` / 私人记录；**新设备大概率不可用**），替代方案见 `02`。并且 **Jev 调用是真金白银**：跑任何会触发评估的测试前，先读 `03` 的成本纪律，按预算执行、失败不重试、跑完恢复规则原状。

---

## 4. git 带不走的东西（新设备必须另行准备）

代码、migration、这篇档案都能 `git clone` 带走；**下面这些不行**，请在新设备上重建或另行转移：

| 东西 | 现状 / 影响 | 新设备怎么办 |
|---|---|---|
| **LLM 连接与 API Key** | `jev-demo` 项目里有两条连接：`DeepSeek`(anthropic 适配器，模型 `deepseek-v4-pro`/`deepseek-v4-flash`) 与 `TypeSafe`(typesafe 适配器，`jev-latest`)；密钥只在数据库里，**不在仓库里** | 用你自己的 key 在 `/settings/llm-connections` 重建；`LlmApiKeys` 有 `@@unique([projectId, provider])`，**同一项目同 provider 只能一条**，重复创建会报 400（这是刻意的） |
| **Postgres 数据**（项目、用户、评估器、版本、规则、assignments、job_executions、audit_logs） | 都在本机 docker volume 里 | 要么重新 seed（用 `scripts/seed-jev-demo-data.cjs` 一类脚本造演示数据），要么从本机 dump 出来带过去 |
| **Doris 数据**（`spans_<projectId>` / `traces_scalar_<projectId>` / `scores`） | 同样在 volume 里，本机 `jevdemoproject01` 已有 200+ traces、68 条 scores | 新设备是空库：需要重新灌 trace（OTel 摄取，见 `02`）才能验证 UI；per-project 分表由系统自动 provision，不需要手工建 |
| **`jev-demo` 账号** | `jev-demo@litefuse.local` / 本机本地密码 | 重新注册或 seed，密码自定 |
| **VPN / 代理** | TypeSafe 需要代理，本机用的是**局域网** VPN（地址已脱敏，见开发机 `.env` / 私人记录） | 新设备大概率不可用，自备代理，见 `02` |
| **GitHub 推送权限** | `origin` = `fishysalt/litefuse`（**公开仓库**），克隆不需要凭据，**推送需要你自己的 GitHub 凭据** | 新设备配好 `gh auth login` / SSH key 再推 |
| **15 篇内部规范文档** | 见 `05-reference-docs.md` | 单独转移（U 盘/网盘），或确认可公开后提交进本目录 |

> 注意：`origin` 是**公开**仓库。任何密钥、内网地址、客户数据都不要提交；本档案目录下的文档已经做过脱敏，新增内容请保持同样的纪律。

### 想把本机的演示数据一起带走

本机 `.env` 的关键配置（本机值，新设备按需改）：应用库 `DATABASE_URL=postgresql://postgres:<PWD>@localhost:5432/postgres`、`DORIS_DB=litefuse`、`DORIS_FE_HTTP_URL=http://localhost:8030`、`DORIS_FE_QUERY_PORT=9030`、`NEXTAUTH_URL=http://localhost:3000`。

**Postgres（项目/用户/评估器/规则/连接/批量动作）** —— 容器内有 `pg_dump`：

```bash
# 开发机导出
docker exec litefuse-postgres pg_dump -U postgres -d postgres -Fc -f /tmp/litefuse-pg.dump
docker cp litefuse-postgres:/tmp/litefuse-pg.dump .

# 新设备恢复
docker cp litefuse-pg.dump litefuse-postgres:/tmp/
docker exec litefuse-postgres pg_restore -U postgres -d postgres --clean --if-exists /tmp/litefuse-pg.dump
```

⚠️ 恢复数据库的同时**必须把 `ENCRYPTION_KEY`（以及 `NEXTAUTH_SECRET`、`SALT`）一起带过去**（本机 `.env` 里都设了）：数据库里的 LLM 连接密钥是用 `ENCRYPTION_KEY` 加密的，换一个 key 就解不开了，等于所有连接作废。

**Doris（`spans_<projectId>` / `traces_scalar_<projectId>` / `scores`）** —— 不建议用 `mysqldump`（Doris 的 MySQL 协议兼容层对 dump 支持不完整），一般也不划算：per-project 分表要逐张导，且 `SELECT ... INTO OUTFILE` 需要 BE 开 `enable_outfile_to_local`。**推荐做法是新设备用 OTel 重新灌 trace**（见 `02`），并用 `scripts/seed-jev-demo-data.cjs` 造演示数据——成本为零，几分钟的事。

## 5. 上手后建议的第一件事

读 `04-open-items-and-decisions.md`，把里面「待拍板」的四条过一遍——尤其是那条 **ACTIVE 且挂着决策模型评估器的规则**（每条新 trace 的根 span 都会花一次 Jev 调用）。确认取舍后再动代码。
