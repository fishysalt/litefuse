# 下一步工作计划（新设备接手后的执行顺序）

> 详细背景见 `04-open-items-and-decisions.md`；这里只给**顺序、验收标准和成本预估**。
> 原则：能用 Doris/Postgres 断言验证的，绝不发起真实 LLM 调用。

## 第 0 步：先让系统活着

1. 按 `02-macos-deploy.md` 起环境；
2. 按 `03-verification-and-ops.md` 过冒烟清单；
3. 跑一次类型检查确认基线干净：
   ```bash
   pnpm --filter @langfuse/shared run build
   (cd web && npx tsgo -p tsconfig.build.json --noEmit --skipLibCheck)
   (cd worker && npx tsc --noEmit)
   ```
   三项都应为 0 错误。任一不为 0，先修基线再谈新功能。

## 第 1 步：把四条待决问题拍板（**必须由用户决定，不要自行选择**）

见 `04-open-items-and-decisions.md`。其中**最紧急的一条**是那条 ACTIVE 且挂决策模型评估器的规则——它在每条新 trace 上都会花一次 Jev 调用。在拍板前，如果你想灌测试数据，**先临时禁用它**，灌完恢复原状（`03` 有成本纪律与操作清单）。

## 第 2 步：P0 —— 功能闭环（做完才算"迁移完成"）

| # | 任务 | 现状 | 验收标准 | 成本 |
|---|---|---|---|---|
| 2.2 | 创建规则时校验 `selectedColumnId`（D3） | 非法列 id 被接受，静默渲染空筛选区 | 用非法 id 调创建接口返回 400 且带可读信息；正常 id 不受影响 | 0（纯接口测试） |
| 2.3 | 5 个仍红的 v2 client test | 3 个是刻意的策略差异、2 个是真缺能力（共享 `CodeMirrorEditor` 缺 Ctrl-F 面板、共享 `FilterBuilderForm` 内嵌 `useRouter`） | 二选一：**修**共享组件使其可测，或**明确标记**为已知差异并在测试里 skip + 注释原因。不允许留着"红着没人管" | 0 |

> **为什么删掉了原 2.1「决策模型 boolean 题型产出 BOOLEAN 分数」**：那条任务的**前提不成立**。上游 Langfuse 4.43.0 的 boolean / `noul` 题型**本来就是产 NUMERIC**，值 = P(true)（0–1）：上游 `packages/shared/src/server/evals/decisionModelEvaluatorExecution.ts:299-304` = `case "boolean": { dataType: ScoreDataTypeEnum.NUMERIC, value: answer.probability }`；上游自己的单测（输入 `:58`、断言 `:161-163`）把 `dataType: "NUMERIC"` + `comment: "P(true)=0.97"` 写成断言；上游 UI 文案 `QuestionTypeSelector.tsx:39` 写 `a numeric score (probability 0–1)`，`DecisionModelResultView.tsx:192` 用 `probability >= 0.5 ? "yes" : "no"` 自行派生 leaning。我们的 `decisionModelEvaluatorExecution.ts:323-328` 与上游**逐字节一致** → 现行为**正确**，Doris 里那条 NUMERIC 不是缺陷。**BOOLEAN 分数属于 LLM-as-a-judge / code evaluator 那条路径**。详见 `04` 的 D2 卡片。

## 第 3 步：P1 —— 同类缺陷与 UI 细节

| # | 任务 | 说明 | 成本 |
|---|---|---|---|
| 3.1 | ~~`getEventsStream` / `getEventsStreamForDataset` 仍读 `FROM events e`~~ → **已修（当前在工作树中，未提交）** | 已改成读 Doris `spans_<projectId>`（三处 FROM：`event-stream.ts:206 / 517 / 712`；root 的 `parent_span_id=''` 归一为 NULL、去掉 `is_deleted`、latency 用 `milliseconds_diff`；worker 全库已无 `FROM events`）。实测 `getEventsStream(rowLimit=1000) rows=241`、`getEventsStreamForDataset rows=241`，与 `spans_jevdemoproject01` 的 241 行 / 94 root 吻合。**剩余未验证项**：未跑真实 BullMQ 端到端导出作业（无 batchExport/batchAction 记录、未上传 S3、未跑 CSV/JSON 转换）、`isExperimentItemRootSpan` 因数据为空无法验证、内容搜索未实测 | 0（补验证用现有数据；若要跑导出端到端，别用 Jev） |
| 3.2 | traces 页过滤报 `Unknown filter column skipped: ruleId/traceName/isRootObservation` | 过滤注册表缺列 | 0 |
| 3.3 | 评估器列表页的标记被行点击覆盖（缺 `stopPropagation`） | 交互缺陷 | 0 |
| 3.4 | `Add alert` 按钮按 M1 结论应隐藏，但仍然可见 | 与成本 UI 同批处理更省事 | 0 |
| 3.5 | 列表页 `Total cost (7d)` 列（显示 `—`） | 与已隐藏的成本预估 UI 同源，等用户拍板 | 0 |
| 3.6 | legacy 书签 `/evals/templates|default-model|configs` 现在 404 | 加 307 重定向壳（与 `/evals/v2/*` 同样做法） | 0 |

## 第 4 步：P2 —— 未接线与上游对齐

1. ~~`supportsDecisionModels` / `isAllowedDecisionModel` 已移植但**未接线**~~ → **已接线（选择器 / 保存校验 / 测试运行三处），并已显式收窄到 TypeSafe**：不再声称 OpenAI 决策模型能力（上游有完整 OpenAI 决策客户端，我们没有；不补齐就对外声称会留下「保存成功、首次运行被 block」的陷阱）。补齐 OpenAI 是独立工作项，详见 04 的 D4。
2. 用 `scripts/upstream-reconcile.cjs` 对上游 `langfuse/langfuse` 4.43.0 逐项复核，产出差异清单（`docs/jev as judge/` 之外的那套"引用清单/差异总览"文档就是干这个的）。
3. 复核完成后按需更新 `AGENTS.md`（仓库维护契约要求：架构/工作流发生实质变化时同 PR 更新）。

## 第 5 步：回归测试（外部 SDK 套件）怎么跑

这是一套**与本仓库分离**的 SDK 端到端回归套件：它自己发 trace、建资源，用来验证我们这边的摄取与 API 兼容性。

**两份拷贝，只有一份能用**：

| 路径 | 状态 |
| --- | --- |
| `C:\Users\92634\Downloads\litefuse_test\litefuse_test` | ❌ **残缺拷贝，跑不起来**：目录里只有 `node_modules` 与 `src`，**没有 `package.json`**，且 `src` 下混着 macOS 的 `._*` AppleDouble 垃圾文件 |
| `D:\SelectDB\litefuse-master\_litefuse_test_win` | ✅ **可用**：有 `package.json` / `tsconfig.json` / `src`，实际装的是 **`@langfuse/* = 5.11.1`**（`package.json` 声明 `^5.3.0`），`node_modules\.bin\tsx.cmd` 存在；它的 `src/scenarios/project-api-key.ts` 比 Downloads 那份更健壮 |

**运行**

```bash
cd <套件目录>              # Windows: D:\SelectDB\litefuse-master\_litefuse_test_win
export LANGFUSE_BASE_URL=http://localhost:3000      # 我们的服务端
export CHROME_PATH=<本机 Chrome 可执行文件路径>       # Windows 必填
export DEEPSEEK_API_KEY=<占位符>                     # 硬必填，但不会真的调用模型
export LANGFUSE_OBSERVATIONS_API=...                 # 可选
npx tsx src/index.ts --scenario sdk                  # 等价于 pnpm test:sdk / pnpm start
```

- **`DEEPSEEK_API_KEY` 硬必填但不花钱**：它只用来**创建** LLM 连接（`src/scenarios/sdk/llm-connections.ts:10,18,49` → `getRequiredEnv("DEEPSEEK_API_KEY")`，baseURL `https://api.deepseek.com/v1`），套件自身不发起模型调用。
- **`CHROME_PATH` 在 Windows 必填**（套件用 CDP 驱动本机 Chrome）；`LANGFUSE_BASE_URL` 指向我们的服务端；`LANGFUSE_OBSERVATIONS_API` 可选。套件源码里读到的其它变量：`CHROME_HEADLESS`、`WEB_AUTH_BASE_URL`、`LANGFUSE_OTEL_FLUSH_AT`、`LANGFUSE_OTEL_FLUSH_INTERVAL_SECONDS`、`LANGFUSE_ANNOTATION_QUEUE_USER_ID`。
- **服务端必须开 `LITEFUSE_ENABLE_EVENTS_TABLE_V2_APIS="true"`** ✅（已核实变量名：`web/src/env.mjs:410,788-789`；本机 `.env:117` 也是 `"true"`）。默认 false 时，SDK 5.11.1 会去打 `/api/public/v2/metrics` 并拿到 **404**。⚠️ 套件自带说明里写的变量名 `LANGFUSE_ENABLE_EVENTS_TABLE_V2_APIS` **是错的**；注意本机两份套件拷贝里都**没有 README/md 文件**，所以那句说明文字**无法就地复核**，一律以仓库代码里的 `LITEFUSE_...` 为准。
- **全程约 12 分钟**，**绝大部分时间花在固定 `sleep` 上**（套件里有 11 处 `sleep(`，集中在 `src/scenarios/project-api-key.ts`），不是在等模型。
- **不做任何真实 LLM 调用** → 不消耗 Jev / DeepSeek 额度。
- ⚠️ **它会新建 user / org / project / API key，而且不清理**（走 `/api/auth/signup` + 建项目流程，见 `src/scenarios/project-api-key.ts:424+`）→ 跑完自己清，别让它污染演示数据。
- ⚠️ **重要坑：在 dev 模式（`next dev`）下跑会被 Next 的内存看门狗打断** —— 服务端日志出现 `⚠ Server is approaching the used memory threshold, restarting...`，套件侧表现为 `_LangfuseAPIError: fetch failed`（服务端重启把连接掐了）。**建议用生产构建跑**：`next build` + `next start`。而这正好撞上 `01` 第 6 节那个已知阻塞 —— **必须先修好那三处测试文件的类型错误，才能用生产构建跑这套回归**（本轮这三个文件已在修、改动未提交，但仍**未用 `next build` 验证过**，属"待复核"）。

## 纪律与惯例（容易忘）

- **共享包改动流程**：改 `packages/shared/**` → `pnpm --filter @langfuse/shared run build` → **重启 web**（web 读 `dist`）；worker 是 tsx watch 会自动热载。
- **提交**：Conventional Commits；本机 husky pre-commit 在 CRLF 下会整体失败，必要时 `git commit --no-verify`（macOS 检出为 LF，通常不再需要）。
- **不要 `git push upstream`**；`origin` 是公开 fork，提交前确认没有密钥/内网地址/客户数据。
- **迁移/存储**：不要改 Doris 存储模式——需要新的取数方式时改"获取"这一层（`tableMappings`、Doris SQL 工厂），展示优先从 `traces_scalar_<projectId>` 取。
- **组件只增不换**：新 UI 放在 `web/src/features/evals/v2/**`，不要为了对齐上游而替换掉既有组件。
