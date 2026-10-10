# 04 · 待决策项与已知缺口

> 配套文件：`docs/handover/01-state-and-history.md`（现状与历史）。
> 本文件里的每一条都能直接当任务卡片用：**背景 → 影响 → 最短复现/验证步骤 → 建议**。
> 生成时间：2026-10-10；撰写过程**未发起任何 LLM 调用**。凡未经独立核实的一律标注 **⚠️未核实**。
> **修订记录（2026-10-10 第二轮，仅改文档）**：D1 由"未修"改为"**已修 + 剩余未验证项**"；D2 由"缺口"改为"**已核实为非缺口**"（boolean → NUMERIC = P(true) 与上游一致，原前提错误）；决策 ③-2 的措辞同步更正；新增"SDK 回归套件怎么跑"的说明在 `06`。D3~D8 本轮核对后确认**仍在原状**。
> 命令里的 `<projectId>` 在 jev-demo 项目下就是 `jevdemoproject01`；密钥/密码一律用 `<占位符>`，真实值不入文档。

接手后先花 10 分钟确认环境和两条只读事实（不花钱、不写数据）：

```powershell
# 1) 规则与绑定的现状（Postgres）
docker exec litefuse-postgres psql -U postgres -d postgres -t -A -F'|' -c "select r.name, r.status, coalesce(e.name,'(none)'), coalesce(e.type::text,'-') from evaluation_rules r left join evaluation_rule_evaluator_assignments a on a.evaluation_rule_id=r.id left join evaluators e on e.id=a.evaluator_id where r.project_id='jevdemoproject01' order by r.status, r.name;"

# 2) Doris root 连接数（修复后应当是个位数；修复前是 100 打满）
node D:\SelectDB\litefuse-master\probe-doris-sql.cjs "select count(*) as total, sum(case when command='Sleep' then 1 else 0 end) as sleeping from information_schema.processlist where user='root'"
```

> Postgres 里评估器/规则相关的表名是 `evaluators` / `evaluator_versions` / `evaluation_rules` / `evaluation_rule_evaluator_assignments`（**没有** `evaluation_rule_evaluators`，列名是 `evaluation_rule_id` 不是 `rule_id`）。
> macOS 对应：`docker exec` 命令一致；`node D:\...\probe-doris-sql.cjs` 换成你在 macOS 上的等价路径（如 `node ~/SelectDB/probe-doris-sql.cjs`）。

---

## 一、待用户拍板的决策

### 决策 ① 规则 `parentObservationId is null` 正在为每条新 trace 花一次 Jev 调用 —— 禁还是留？

**背景**（✅本轮 DB 级核实）

- 规则名 `parentObservationId is null`，id `cmv1u03870048a2ogx26xnjyp`，状态 **ACTIVE**。
- audit 记录显示由 `jev-demo-user` 在 **10-10 03:25:21 创建**（**不是**本任务代理创建的，所以没有擅自改动）。
- 它绑定了 **DECISION_MODEL** 评估器 `3 different question jev`；另有一条 INACTIVE 规则 `名为supply` 也绑着同一个评估器。
- 该规则到目前为止产出分数 **0 条**（说明创建后没有新 trace 进入，或还没被匹配上）。

**影响**：只要它保持 ACTIVE，**每条新 trace 的根 span 都会真调一次 Jev**（`parentObservationId is null` 在这个模型里命中根 span）。这是当前唯一的持续性 Jev 花费面。

**选项**

| 选项 | 说明 |
| --- | --- |
| A. 立即禁用（**建议**） | 若这条是你手动测 UI 时随手建的，禁用即关闭花费面；需要时再开。 |
| B. 留着但收窄过滤条件 | 例如加 `name contains 'ZZ demo'` 之类的限定，只对造数 trace 生效。 |
| C. 原样保留 | 承认「每条新 trace 一次 Jev」的持续成本，或你本就不打算再让新 trace 进入。 |

**建议**：A 或 B。理由是成本纪律是硬要求，且这条规则目前没有任何产出。

**最短验证/操作步骤**

```powershell
# 看现状（只读）
docker exec litefuse-postgres psql -U postgres -d postgres -t -A -F'|' -c "select id,name,status from evaluation_rules where project_id='jevdemoproject01' and id='cmv1u03870048a2ogx26xnjyp';"

# 看它到底有没有花过钱（Doris 只读，数它名下的分数）
node D:\SelectDB\litefuse-master\probe-doris-sql.cjs "select count(*) from scores where project_id='jevdemoproject01' and metadata['evaluation_rule_id']='cmv1u03870048a2ogx26xnjyp'"

# 看创建者与改动时间线
docker exec litefuse-postgres psql -U postgres -d postgres -t -A -F'|' -c "select to_char(created_at,'MM-DD HH24:MI:SS'), action, coalesce(user_id,'?') from audit_logs where resource_id='cmv1u03870048a2ogx26xnjyp' order by created_at;"
```

**操作方式建议**：**在 UI 上禁用**（规则列表 → 该规则 → 停用），而不是直接改库 —— 走 UI 会留 audit 记录，交接可追溯。

### 决策 ② 列表页 “Total cost (7d)” 列是否隐藏？

**背景**：评估器/规则列表页有一列 `Total cost (7d)`，它走的是**另一条**成本读取路径（不是本轮隐藏的那批估算组件）。当前显示 `—` / `No value`，因为 `evalCostCompat.ts` 的成本函数仍返回 `[]` / `null`。

**影响**：不影响功能，但会让用户以为系统能算成本而实际算不出 —— 与已隐藏的「估算 $0.00/week」是同一类误导。

**选项**：A. 隐藏该列（**建议**，与已做的隐藏保持一致的观感）；B. 保留但加 tooltip 说明「成本估算暂不可用」；C. 原样保留。

**建议**：A。若要藏在服务端做更彻底（或先只在 UI 层隐藏），具体落点需再定位（⚠️本文件作者未定位到该列的确切组件）。

**最短验证步骤**

1. 打开 `http://localhost:3000/project/jevdemoproject01/evals`（评估器列表）与 `/evals/rules`（规则列表）。
2. 在表头找到 `Total cost (7d)`，确认每行显示 `—` / `No value`。
3. 定位方式（只读）：

```powershell
cd D:\SelectDB\litefuse-master\litefuse-master\dev_version\litefuse-main\litefuse-main
Get-ChildItem -Recurse -File -Include *.tsx web\src\features\evals\v2 | Select-String -Pattern 'Total cost' | ForEach-Object { $_.Path + ':' + $_.LineNumber }
# macOS: grep -rn "Total cost" web/src/features/evals/v2
```

### 决策 ③ 文档修正项（4 处，需你确认后我再改上游那 15 份文档）

文档位置：`D:\SelectDB\litefuse-master\litefuse-master\docs\jev as judge\`（**仓库外，不是 git 仓库**，push 不会带走）。macOS 对应：你自己放这 15 份 md 的目录。

| # | 要改什么 | 依据 |
| --- | --- | --- |
| ③-1 | Jev 从「未验证」改为「**已验证**」，并注明**前提是走 VPN 出口**（不走代理会得到 `HTTP 451 Typesafe is not available in your region.`） | ✅Jev 端到端真跑通过（CATEGORICAL 分 + metadata 里 `jev-1.13.0`） |
| ③-2 | 题型→分数类型的表述更正：boolean/`noul` 题**落成 NUMERIC = P(true)**，**不是** BOOLEAN —— 而且这是**与上游一致的正确行为**（上游同为 NUMERIC，见 D2 卡片）；文档里若写成"BOOLEAN"才是错的 | ✅实测 + 上游实现/单测/UI 文案逐条核对（见 D2） |
| ③-3 | 补记 metadata 缺陷：Doris `map<text,text>` 转文本不转义内层引号 → 读侧必须 `to_json`；写侧预转义是错的方向 | ✅SQL 只读证明 + 存量行复读通过 |
| ③-4 | 补记 D3 漏洞：创建规则时传入非法 `selectedColumnId` 会被接受、之后静默渲染空 | ⚠️来自交接前审计记录，未独立复现（见下文缺口 D3） |

**选项**：A. 全部改（**建议**）；B. 只改 ③-1/③-2（最影响判断的两条）；C. 先不改，等 D3 复现确认后一起改。

**最短验证**：打开这些 md 搜 `未验证` / `boolean` （Windows：`Select-String -Path '<docs>\*.md' -Pattern '未验证|boolean'`；macOS：`grep -rn "未验证\|boolean" <docs>`）。

### 决策 ④ 5 个 v2 客户端测试仍红 —— 怎么办？

**背景**（⚠️来自上一轮记录，未独立复跑）：`web/src/features/evals/v2/**/*.clienttest.tsx` 下 5 个测试文件未通过。分两类：

- **3 个是刻意的策略差异**：我们把上游行为按自己的策略改了，测试仍按上游期望断言 → 正确做法是**改测试断言**（记录我们的策略），不要为了过测试回退策略。
- **2 个是我方共享组件真缺能力**（**真缺口**）：
  1. 共享 `CodeMirrorEditor` 缺 **Ctrl-F 搜索面板** → v2 里依赖该能力的地方拿不到；
  2. 共享 `FilterBuilderForm` **内嵌 `useRouter`** → 无法在无 router 上下文（如测试/独立挂载）中使用。

**影响**：不是线上功能故障，但它意味着「对齐上游」这件事在 UI 层还有两处没落地；且这 2 个缺口会在更多 v2 组件里重复咬人。

**选项**

| 选项 | 说明 |
| --- | --- |
| A（**建议**） | 分两步：先把 3 个策略差异的断言改成我们的策略（显式记录），再各开一张卡片修 2 个真缺口（优先 `FilterBuilderForm` 的 `useRouter` 解耦，影响面更大） |
| B. 只改断言，2 个真缺口挂 backlog | 省事，但缺口会继续阻塞别的 v2 组件 |
| C. 一次性全修 | 成本高，且会动共享组件 —— 与「尽量少动底座」原则冲突，需你明确授权 |

**复现步骤**（⚠️命令形式按仓库 AGENTS/CLAUDE 约定，未在本轮复跑）：

```powershell
cd D:\SelectDB\litefuse-master\litefuse-master\dev_version\litefuse-main\litefuse-main
pnpm test-client --testPathPatterns="evals/v2"      # 列出失败的 5 个文件
# 单跑某个：
pnpm test-client --testPathPatterns="<失败文件名>" --testNamePattern="<测试名>"
```

macOS 同命令（`pnpm` 跨平台）；只把工作目录换成你的仓库路径。

**验证修好后**：`pnpm test-client --testPathPatterns="evals/v2"` 全绿，并且**不**出现为了过测试而回退我们策略的 diff。

---

## 二、已知缺口 / 未做项（可直接当任务卡片）

> **本轮（2026-10-10 第二轮）逐条核对结果**：**D1 已修**（改动在工作树中、未提交，含剩余未验证项）；**D2 已核实为非缺口**（原前提错误，已改写）；**D3 / D4 / D5 / D6 / D7 / D8 均仍在原状**——D4 全仓只有 `packages/shared/src/server/llm/types.ts:279,283` 两处定义、无调用点；D5 `Add alert` 仍在 `EvaluatorAlertButton.tsx:349`（另有 `:221`）；D6 `web/src/pages/project/[projectId]/evals/` 顶层仍只有 `index/new/rules/[evaluatorId]/remap`，没有 `templates`/`default-model`/`configs` 壳；D7 `Evaluators/**` 下唯一的 `stopPropagation` 出现在 `EvaluatorSampleObservationSelector.tsx:71`，标记控件处仍无。
>
> ⚠️ **上面这段是第二轮的历史快照，部分已被第三轮推翻**：**D1 的改动已提交**、**D4 已接线并收窄到 TypeSafe**、**D6 的 3 个重定向壳已加（实测 307）**。请以每张卡片当前写的状态为准；D3 / D5 / D7 / D8 经第三轮复核**仍在原状**。

### D1 ✅ **已修**（`getEventsStream` / `getEventsStreamForDataset` 已改读 Doris `spans`）—— 附剩余未验证项

**状态**：**已修，并且已提交**（随 `fix(evals): close the remaining evaluator-v2 gaps and unblock the production build` 落地；`git status` 里 `worker/src/features/database-read-stream/event-stream.ts` 已不再是 modified）。原先本节记为"只在工作树里、尚未 commit"，第三轮已核实为历史描述。

- **背景**：本模型**没有 `events` 表**（per-project `spans_<projectId>` / `traces_scalar_<projectId>`）。历史批量评估路径（`getEventsStreamForEval`，`worker/src/features/database-read-stream/event-stream.ts`）已在 `45791b4` 改成 `FROM ${tableFor(projectId,"spans")} o`。
- **本轮修法**（与 `getEventsStreamForEval` 同构）：复用 `eventsTableUiColumnDefinitionsForDoris` + Doris SQL 工厂 + `dq()` + map 列 `to_json`；**root 的 `parent_span_id=''` 归一为 NULL**；**去掉 `is_deleted` 谓词**（`spans` 没有这一列）；latency 用 `milliseconds_diff` 现算。
- **证据（✅本轮核实）**：
  - 三处 FROM 全部是 `${tableFor(projectId,"spans")} o`：`event-stream.ts:206 / 517 / 712`；`milliseconds_diff` 在 `:198-199`；worker 全库 **grep `FROM events` 无命中**。
  - 真实读取实测：`getEventsStream(rowLimit=1000)` → **rows=241**；`getEventsStreamForDataset` → **rows=241**；`isRootObservation:true` → 94；`hasParentObservation:true` → 147。
  - 数据侧交叉核对（本轮用 `probe-doris-sql.cjs` 复核）：`spans_jevdemoproject01` = **241 行 / 94 条 root（trace）**，与上面数字吻合。
- **仍未验证的部分（接手后要补）**：
  1. **没有跑真实 BullMQ 端到端导出作业** —— 没建 `batchExport` / `batchAction` 记录、没上传 S3、没跑 CSV/JSON 转换；
  2. `isExperimentItemRootSpan` 的语义**因数据为空无法验证**；
  3. 内容搜索（content search）路径**未实测**。
- **复核命令**（只读）：

```powershell
cd D:\SelectDB\litefuse-master\litefuse-master\dev_version\litefuse-main\litefuse-main
Select-String -Path worker\src\features\database-read-stream\event-stream.ts -Pattern 'FROM events|tableFor\(|milliseconds_diff' | ForEach-Object { $_.LineNumber.ToString() + ': ' + $_.Line.Trim() }
Get-ChildItem -Recurse -File worker\src | Select-String -Pattern 'FROM events'   # 应当无输出
# macOS: grep -n "FROM events\|tableFor(\|milliseconds_diff" worker/src/features/database-read-stream/event-stream.ts
```
- **建议**：先把这个改动落进 commit；补端到端导出验证时注意成本纪律（优先 DeepSeek、rowLimit 设 2，别用 Jev）。

### D2 ✅ **已核实的更正：不是缺口** —— 决策模型 boolean 题产出 NUMERIC = P(true) 是上游行为

- **更正**：本卡片原先写的前提（"上游语义是 BOOLEAN，我们应产出 BOOLEAN"）**是错的**。上游 Langfuse 4.43.0 的 boolean / `noul` 题型**本来就产出 NUMERIC**，值为 P(true)（0–1 概率）。
- **依据（✅本轮逐条核实）**：

| 依据 | 位置 | 内容 |
| --- | --- | --- |
| 上游实现 | 只读克隆 `langfuse-latest\packages\shared\src\server\evals\decisionModelEvaluatorExecution.ts:299-304` | `case "boolean": { dataType: ScoreDataTypeEnum.NUMERIC, value: answer.probability }` |
| 上游单测 | 同目录 `decisionModelEvaluatorExecution.test.ts`（输入 `:58`；断言 `:159-171` 区间内的 `:161-163`） | 输入 `refund: { type: "boolean", probability: 0.97 }`；断言 `dataType: "NUMERIC"`、`comment: "P(true)=0.97"` |
| 上游 UI 文案 | 上游 `web/src/.../QuestionTypeSelector.tsx:38-39` | `summary: "Get the probability a statement is true."` / `writes: "a numeric score (probability 0–1)"` |
| 上游 UI 展示 | 上游 `web/src/.../DecisionModelResultView.tsx:192,198` | `const leaning = probability >= 0.5 ? "yes" : "no"`；`P(yes) = {probability.toFixed(2)} → leaning {leaning}` —— **leaning 是 UI 自己派生的，不是分数类型** |
| 我方实现 | `packages/shared/src/server/evals/decisionModelEvaluatorExecution.ts:323-328` | 与上游**逐字节一致** |

- **实测**：一次执行三题型 → choice → CATEGORICAL、score → NUMERIC、boolean/`noul` → **NUMERIC = P(true)** —— 与上游一致，属**正确行为**。
- **注意**：**BOOLEAN** 分数属于 **LLM-as-a-judge / code evaluator** 那条路径（分数类型由评估器的输出 schema 决定），**不是**决策模型路径。需要布尔分就建 LLM-as-a-judge 评估器，而不是改决策模型的类型推导。
- **结论**：**无需改动**（原"改 `worker/src/features/evaluation/v2DecisionModelExecution.ts` + `v2ScorePersistence.ts` 的分数类型推导"的建议**作废**）。若下游要按布尔过滤，应像上游那样在前端按 `value >= 0.5` 派生。

### D3 创建规则时非法 `selectedColumnId` 被接受，之后静默渲染空

- **背景**：⚠️交接前审计记录（**未独立复现**）：创建规则时可提交一个不在注册表里的 `selectedColumnId`，服务端接受，回显时该条过滤条件被丢弃 → 规则看起来「没有过滤条件」，实际过滤语义与用户以为的不同。
- **影响**：**静默**语义偏差 —— 比报错更危险（可能让规则命中远超预期的 trace，直接放大 Jev/LLM 花费）。
- **最短复现**：UI 新建规则 → 过滤器里选择一列后，用 devtools 改请求体里的 `selectedColumnId` 为不存在的值 → 提交 → 重新打开规则详情，观察该条件消失且无任何提示。
- **建议**：在 `web/src/features/evals/v2/server/rules/` 侧把 `filter` 的列 id 做白名单校验（对照 `ruleSearchRegistry.ts` 与 `observationForEval.ts` 的注册表），非法值直接 `BAD_REQUEST`。
- **验证**：提交非法列 id 应当**报错**而不是静默保存。

### D4 决策模型能力门禁：已接线，且**已显式收窄到 TypeSafe**（与上游的差异是决定，不是漏移植）

- **状态**：✅ **已决**。两个判定函数已接到选择器 / 保存校验 / 测试运行三处；同时它们的语义被**有意收窄为「只有 TypeSafe 支持决策模型」**。这不是「上游有、我们没搬」，而是**明确不声称一个我们跑不通的能力**。
- **上游 4.56 的做法**（只读参照 `D:\SelectDB\langfuse-deploy\langfuse`，`packages/shared/src/server/llm/types.ts:272-284`）：`supportsDecisionModels` 对 `LLMAdapter.OpenAI` 也返回 `true`，`isAllowedDecisionModel` 接受 `OPENAI_DECISION_MODEL_IDS`（`gpt-6-luna`）。上游**跑得通**，因为它有完整执行链路：OpenAI 决策模型客户端 `packages/shared/src/server/llm/openai/openAIDecisionModelClient.ts` + 分派器 `packages/shared/src/server/llm/createDecisionModelClient.ts` + `ai@7` / `@ai-sdk/openai` 依赖。
- **我们的现状**：只有 TypeSafe 客户端（`packages/shared/src/server/llm/typesafe/typeSafeDecisionModelClient.ts`，手写 `fetch`），worker 执行链硬编码只建这一个客户端（`worker/src/features/evaluation/v2DecisionModelExecution.ts`），执行闸门是 `isDecisionModelAdapter` / `DECISION_MODEL_ADAPTERS`（只列 TypeSafe）。
- **为什么必须收窄（原本是个陷阱）**：保存校验里的 capability 检查**已经放行 OpenAI**，只有后一层 `isDecisionModelAdapter` 兜底在挡 → OpenAI 连接会「**保存成功、首次真实运行才被 block**」，比直接拒绝更糟；`isOpenAIDecisionModel` 也已是**死代码**（除定义及 `isAllowedDecisionModel` 内部外全仓零引用）。收窄把「对外的声称」和「这个陷阱」一起消灭。
- **做了什么**：
  - `packages/shared/src/server/llm/types.ts`：`supportsDecisionModels` 只认 `LLMAdapter.TypeSafe`；`isAllowedDecisionModel` 只保留 TypeSafe 分支（非空模型名即允许）；**删除** `isOpenAIDecisionModel`（死代码）；`OPENAI_DECISION_MODEL_IDS` **保留**并注明是上游契约、**暂未启用**（加了一段 LITEFUSE NOTE 说明收窄的原因与回退路径）。
  - 下游三处同步一致：`web/src/features/evals/v2/server/evaluators/decisionModelCapability.ts`（删掉已不可达的 OpenAI 分支与其措辞）、`.../DecisionModelSelector/DecisionModelSelector.tsx`（适配器过滤只留执行闸门，不再 AND 两个同义谓词）、同目录 `DecisionModelCapabilityNotice.tsx`（删掉「能服务决策模型，但本部署只用 TypeSafe」这条已不可达的提示分支）。
  - **未改**：worker 执行闸门（`v2DecisionModelExecution.ts`）、两个保存期预检（决策模型 + 判官）的行为。
  - **收窄后的语义**：`supportsDecisionModels` / `isAllowedDecisionModel` / `isDecisionModelAdapter`（= worker 执行闸门）**三层判断完全一致**，都只认 TypeSafe。
- **若要补齐 OpenAI 决策模型（独立工作项，本轮未做）**：
  - 需要新增：OpenAI 决策模型客户端 + worker 侧分派器接线 + `ai@7` / `@ai-sdk/openai` 依赖，并把两个判定函数放宽回上游形态；约 **10 个文件**改动（客户端、分派器、shared 谓词、worker 执行、web 校验、web UI 两处、依赖清单、测试）。
  - **验证前提**：必须有一个**带 Decisions API 权限的 key** 才能端到端验证（`gpt-6-luna` 走 hosted Decisions API）。**没有这样的 key 就不可验证** —— 当前环境没有，所以本轮只做收窄，不做补齐。
- **本轮验证（原始输出见当轮交接记录）**：`pnpm --filter @langfuse/shared run build` 成功；`worker` 的 `npx tsc --noEmit` 与 `web` 的 `npx tsgo -p tsconfig.build.json --noEmit --skipLibCheck` 均为 0；直接调用（零成本、不发任何真实 LLM 请求）打印 `supportsDecisionModels("typesafe")=true`、`("openai")=false`、`("anthropic")=false`，`isAllowedDecisionModel("typesafe","jev-latest")=true`、`("openai","gpt-6-luna")=false`。


### D5 `Add alert` 按钮按 M1 应隐藏，但当前仍可见

- **背景**：✅源码确认按钮仍在：`web/src/features/evals/v2/components/Evaluators/EvaluatorAlertButton/EvaluatorAlertButton.tsx:349` → `{alertCount > 0 ? "Alerts" : "Add alert"}`。交接前审计（M1）要求隐藏该入口。
- **影响**：暴露一个未接通/未完成的功能入口（点击后的行为 ⚠️未核实）。
- **最短验证**：打开 `http://localhost:3000/project/jevdemoproject01/evals/<evaluatorId>`，右上角应能看到 `Add alert`。
- **建议**：按 M1 隐藏（保持组件不删，仅不渲染 —— 符合「组件只增不换」原则）；或明确决定保留并标注为 beta。

### D6 ✅ **已修** legacy 书签 `/evals/templates`、`/evals/default-model`、`/evals/configs` 现在 307 重定向

- **背景**：旧 UI 已整体搬到 `/evals/legacy/**`，实际存在的文件是（✅文件级核实）：

```
evals/legacy/index.tsx        evals/legacy/new.tsx        evals/legacy/[evaluatorId].tsx
evals/legacy/default-model.tsx
evals/legacy/configs/{index,new,[configId]}.tsx
evals/legacy/templates/{index,new,[id]}.tsx
```

→ 当时的顶层地址 `/evals/templates`、`/evals/default-model`、`/evals/configs` 没有对应文件，**旧书签/旧链接会 404**（而且会被动态路由 `/evals/[evaluatorId]` 吞掉，渲染 "evaluator not found"）。

- **修复**（随 `fix(evals): close the remaining evaluator-v2 gaps and unblock the production build` 提交）：加了 3 个**薄重定向壳**（`getServerSideProps` + `redirect: { permanent: false }`，照 `/evals/v2/*` 的写法，保留 query string），文件为 `web/src/pages/project/[projectId]/evals/{templates,configs,default-model}.tsx`。静态路由同时**遮蔽**了动态 `[evaluatorId]`，所以不再被吞。
- **✅ 第三轮实测（2026-10-10，`curl.exe -s -o NUL -w "%{http_code} -> %{redirect_url}"`）**：

| 请求 | 结果 |
| --- | --- |
| `/project/jevdemoproject01/evals/templates` | **307** → `.../evals/legacy/templates` |
| `/project/jevdemoproject01/evals/configs` | **307** → `.../evals/legacy/configs` |
| `/project/jevdemoproject01/evals/default-model` | **307** → `.../evals/legacy/default-model` |

### D7 评估器列表页的标记被行点击覆盖（缺 `stopPropagation`）

- **背景**：⚠️来自交接前手工测试记录：在评估器列表页点击行内的标记/标签控件时，事件冒泡到整行 → 触发行点击（跳转），标记控件自身的动作被吞掉。
- **影响**：列表页的标记操作不可用/时好时坏。
- **最短复现**：打开 `/evals` → 对某行内的标记控件点击 → 观察是否跳到详情页而不是切换标记。
- **建议**：在标记控件的点击处理里加 `e.stopPropagation()`（`web/src/features/evals/v2/components/Evaluators/**` 内定位）。
- **验证**：点击标记不再触发跳转，且标记状态确实改变。

### D8 traces 页过滤报 `Unknown filter column skipped: ruleId / traceName / isRootObservation`

- **背景**：✅定位到告警出处：`web/src/features/filters/hooks/useSidebarFilterState.tsx:70` —— 当 `singleFilter.safeParse(filter)` 失败时会 `console.warn(\`Unknown filter column skipped: ${...column}\`)` 并**丢弃**该条件。也就是说这三个列 id 没通过该页面的 `singleFilter` 校验。
- **根因**：⚠️**未完全定位** —— 后端侧 `observationForEval.ts` 的过滤注册表**已经**包含 `isRootObservation`（前端也有 `ruleSearchRegistry.ts` 的对应项），所以缺的应当是 **traces 页面侧栏过滤列注册表**（`web/src/features/filters/**`）未登记 `ruleId` / `traceName` / `isRootObservation`，或列 id 与枚举不匹配。
- **影响**：用户在 traces 页添加这三个过滤条件时，条件被**静默丢弃** → 看到的是一份没有该过滤的结果（又是静默语义偏差）。
- **最短复现**：打开 traces 页 → 侧栏添加过滤 `isRootObservation = true` → 看浏览器 console 是否出现 `Unknown filter column skipped: isRootObservation`，且结果集没变。
- **定位步骤**：

```powershell
cd D:\SelectDB\litefuse-master\litefuse-master\dev_version\litefuse-main\litefuse-main
Select-String -Path web\src\features\filters\hooks\useSidebarFilterState.tsx -Pattern 'Unknown filter column skipped' -Context 6,6
# macOS: grep -n -A6 -B6 "Unknown filter column skipped" web/src/features/filters/hooks/useSidebarFilterState.tsx
```

- **建议**：把这三个列登记进 traces 页的过滤列定义（并确认后端 `singleFilter` 的白名单包含它们），或者——如果是有意不支持——把告警改成用户可见的提示，**不要静默丢弃**。

---

## 三、UI 陷阱提醒（交接对象必须知道）

| 陷阱 | 说明 | 怎么避开 / 验证 |
| --- | --- | --- |
| **两套 UI 并存** | `/evals`（及其子路由）= **新 UI**；`/evals/legacy/**` = **旧 UI**；`/evals/v2/*` = **307 重定向壳**，不是真页面 | 直接访问 `http://localhost:3000/project/jevdemoproject01/evals` 看新 UI；`.../evals/legacy` 看旧 UI；`.../evals/v2/rules` 应当 307 跳到 `/evals/rules` |
| **`/evals/rules` 曾「永久 Loading…」** | 历史坑：只有当 `[evaluatorId].tsx` 而没有静态 `rules.tsx` 时，`/evals/rules` 会被动态路由当成 `evaluatorId="rules"`，页面卡在 `Loading…` 永不返回 | 当前文件树里静态 `evals/rules.tsx` **存在**（✅核实）。**不要删这些静态路由文件**，否则该坑立刻回归 |
| **dev 首次访问某路由编译慢** | Next dev（webpack）首访路由要现场编译，看起来像卡死 | 等 10–60 秒；再点一次通常就出来。别据此判定 bug |
| **`remap` 在顶层** | `evals/remap.tsx` **没有**进 legacy | 引用路径时不要写成 `/evals/legacy/remap` |
| **shared 改动不会自动生效** | web 读 `packages/shared/dist` | 改 shared 后必须 `pnpm --filter @langfuse/shared run build` **然后重启 web**；worker 由 `tsx watch` 自动重启 |
| **Doris 写入依赖代理** | FE 307 指向 `172.29.0.3:8040`，本机不可直达 | 先起 `node D:\SelectDB\litefuse-master\_doris_be_proxy.cjs`（8899），并让 web/worker 带 `HTTP_PROXY=http://127.0.0.1:8899` |
| **Doris SQL 走 9030** | HTTP query 端点返回 405 | 用 MySQL 协议 9030 或 `probe-doris-sql.cjs` |
| **接入只有 OTel** | `/api/public/ingestion` 只收 score-create / sdk-log | 打 trace 用 `POST /api/public/otel/v1/traces` + 头 `x-langfuse-ingestion-version: 4` |
| **登录要回显 csrf** | NextAuth credentials 登录必须回显 csrf cookie | 用 `_lf_session.cjs` 或照它的做法 |
| **成本会真花钱** | 任何 ACTIVE 规则 + 带 Jev 评估器 = 每条新 trace 一次真实调用 | 造数/测试前先按 01 文档第 7 节禁用再恢复，并留 audit 证据 |

---

## 四、建议的接手顺序（不动手也能先只读完成前三步）

1. **只读核对**：跑本文件开头两条命令 → 确认规则状态与 Doris 连接数。
2. **拍板决策 ①**（唯一在持续花钱的项），顺手决定 ②③④。
3. **按 D8 → D7 → D6 → D3 → D5 → D4 排序**修缺口（先修「静默语义偏差」类，再修「功能入口/重定向」类）。**D1 已修**（改动在工作树中、未提交，剩余未验证项见其卡片）；**D2 已核实为非缺口**（boolean → NUMERIC = P(true) 与上游一致，**不要**再去改分数类型推导）。另有一条新阻塞：**`next build` 被测试文件的类型错误挡住**（详见 `01` 第 6 节），要跑生产构建/SDK 回归套件前必须先清掉。
4. 任何改动后跑 01 文档第 3 节的类型检查三连；涉及 `packages/shared` 先 build 再重启 web。
5. **每一步都记账**：真实 LLM/Jev 调用次数写进交接记录；provider 失败不重试。
