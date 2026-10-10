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
| 2.1 | 决策模型 **boolean 题型**产出 BOOLEAN 分数 | 目前落成 `NUMERIC`，值为 P(true)（上游语义是 BOOLEAN） | 一条 boolean 题的执行在 `scores` 里 `data_type='BOOLEAN'`，UI 显示与上游一致 | 需要 1 次真实 Jev 调用（≤1，失败不重试） |
| 2.2 | 创建规则时校验 `selectedColumnId`（D3） | 非法列 id 被接受，静默渲染空筛选区 | 用非法 id 调创建接口返回 400 且带可读信息；正常 id 不受影响 | 0（纯接口测试） |
| 2.3 | 5 个仍红的 v2 client test | 3 个是刻意的策略差异、2 个是真缺能力（共享 `CodeMirrorEditor` 缺 Ctrl-F 面板、共享 `FilterBuilderForm` 内嵌 `useRouter`） | 二选一：**修**共享组件使其可测，或**明确标记**为已知差异并在测试里 skip + 注释原因。不允许留着"红着没人管" | 0 |

## 第 3 步：P1 —— 同类缺陷与 UI 细节

| # | 任务 | 说明 | 成本 |
|---|---|---|---|
| 3.1 | `getEventsStream` / `getEventsStreamForDataset` 仍读 `FROM events e` | 与已修复的 `getEventsStreamForEval`（改成读 Doris `spans_<projectId>`）完全同类。这两条是数据集/导出路径 | 0（可用现有数据断言） |
| 3.2 | traces 页过滤报 `Unknown filter column skipped: ruleId/traceName/isRootObservation` | 过滤注册表缺列 | 0 |
| 3.3 | 评估器列表页的标记被行点击覆盖（缺 `stopPropagation`） | 交互缺陷 | 0 |
| 3.4 | `Add alert` 按钮按 M1 结论应隐藏，但仍然可见 | 与成本 UI 同批处理更省事 | 0 |
| 3.5 | 列表页 `Total cost (7d)` 列（显示 `—`） | 与已隐藏的成本预估 UI 同源，等用户拍板 | 0 |
| 3.6 | legacy 书签 `/evals/templates|default-model|configs` 现在 404 | 加 307 重定向壳（与 `/evals/v2/*` 同样做法） | 0 |

## 第 4 步：P2 —— 未接线与上游对齐

1. `supportsDecisionModels` / `isAllowedDecisionModel` 已移植但**未接线**：目前决策模型的可选性没有走这两道闸门，接上后能防止把决策模型塞进不支持的地方。
2. 用 `scripts/upstream-reconcile.cjs` 对上游 `langfuse/langfuse` 4.43.0 逐项复核，产出差异清单（`docs/jev as judge/` 之外的那套"引用清单/差异总览"文档就是干这个的）。
3. 复核完成后按需更新 `AGENTS.md`（仓库维护契约要求：架构/工作流发生实质变化时同 PR 更新）。

## 纪律与惯例（容易忘）

- **共享包改动流程**：改 `packages/shared/**` → `pnpm --filter @langfuse/shared run build` → **重启 web**（web 读 `dist`）；worker 是 tsx watch 会自动热载。
- **提交**：Conventional Commits；本机 husky pre-commit 在 CRLF 下会整体失败，必要时 `git commit --no-verify`（macOS 检出为 LF，通常不再需要）。
- **不要 `git push upstream`**；`origin` 是公开 fork，提交前确认没有密钥/内网地址/客户数据。
- **迁移/存储**：不要改 Doris 存储模式——需要新的取数方式时改"获取"这一层（`tableMappings`、Doris SQL 工厂），展示优先从 `traces_scalar_<projectId>` 取。
- **组件只增不换**：新 UI 放在 `web/src/features/evals/v2/**`，不要为了对齐上游而替换掉既有组件。
