# 验证记录：audit-logs（批次 1）

分支：`ee-independence`（在 license worktree 上，基于 `753d0f6`）
自检工具：`~/SelectDB/litefuse-local/bin/ee-refactor-check.sh`
自检索引：`~/SelectDB/litefuse-local/checks/INDEX.md`

---

## 1. 基线（改动前，`753d0f6`）

日志 `checks/20261015-104235-baseline.log`。基线失败集合已固化为
`checks/baseline-smoke-fails.txt`（smoke，8 项）供后续批次做**集合等价比对**。

基线中已存在、与本批次无关的失败：

- smoke 8 项：2 项 legacy 重定向壳（`/evals/default-model`、`/evals/templates` 返回 200 而非 307）+ 6 项 evaluator-v2 公共 API（本分支不含该功能，返回 404）
- EE servertests：3 红 3 绿（`admin-api-key-auth` / `scim-api` / `organizations-api-key-trpc` 红；`memberships-api` / `organizations-api` / `projects-api` 绿）。成因是**环境问题**（创建组织级 API key 时 `api_keys_organization_id_fkey` 外键冲突），已记为批次 3 的前置修复项

## 2. L1 —— 特征测试（改前先绿，证明锁的是当前行为）

| 阶段 | 结果 |
| --- | --- |
| 表格测试（8 条）在原实现上 | ✅ 8/8 |
| 页面测试（初版含文案断言）在原实现上 | ✅ 8/8 |
| 页面测试**改版为功能导向、文案无关**后在原实现上 | ✅ 10/10 |

> 页面测试中途改版的原因：产品决策允许自由改文案，因此断言不能锁文案。改版后只断言功能 —— 三个状态分别是否渲染表格、表格收到的 props、页面标题存在、两种受限原因文案**互不相同且非空**。

## 3. 变异测试（证明测试有牙齿）

| 变异体 | 改动 | 结果 |
| --- | --- | --- |
| ① | 两个 query 的 `enabled` 都改成 `true` | **恰好 2 条**失败（两个 scope 的启用规则），其余 6 条通过 |
| ② | `pending → isLoading` 映射改坏 + 导出按钮无条件渲染 | **恰好 2 条**对应失败，其余 6 条通过 |

变异体已删除，未进入仓库。

## 4. L1 —— 换入净室实现后

```
Tests: 18 passed, 18 total（3 个套件全绿）
```

## 5. L0 —— 静态（日志 `checks/20261015-113759-l0.log`）

| 项 | 结果 |
| --- | --- |
| prettier（6 个改动文件） | PASS |
| web tsgo / worker tsgo | PASS / PASS |
| EE boundary | PASS（静态 MIT→EE = 0） |
| **i18n check** | **首次 FAIL → 修正后 PASS** |

### 5.1 i18n 失败的真实原因与修正（**本批次抓到的第二个真问题**）

换入新实现后，旧实现使用的 **7 条文案成为无人引用的孤儿 key**（`Organization Audit Logs`、两条旧 Enterprise 提示、两条 `Contact your … administrator …`、两条旧简介）。`i18next-cli extract --ci` 检出 locale 仍含这些 key → 判定 "Some files were updated. This should not happen in CI mode." → FAIL。

修正：按官方工作流运行 `npx i18next-cli extract`（非 CI 模式）删除孤儿 key → 复查 `i18n:check` PASS（**3355 keys，zh-CN 100%**；账目：3353 基线 + 9 新增 − 7 孤儿 = 3355 ✓）。删除项经核对**只有那 7 条**，无其它误删。

**流程更新（已写入 `EE-REFACTOR-PLAN.md` §0.5）**：改文案的批次在换入后必须跑一次 `i18next-cli extract` 清孤儿 key，再复查 `i18n:check`。

### 5.2 额外核对：zh 空值 = 0

`i18n:check` 统计的是**key 覆盖率**，对"空译文"不敏感。因此额外核对 `zh-CN.json` 的空值数量：**0**（基线也是 0）。此项已加入本批次的核对清单。

## 6. 相似度（详见 `similarity.md`）

| 文件 | EE-only 共享行 | token 5-gram Jaccard |
| --- | --- | --- |
| `AuditLogsTable.tsx` | 5 | 0.069 |
| `AuditLogsSettingsPage.tsx` | 2 | 0.200 |
| `OrgAuditLogsSettingsPage.tsx` | 2 | 0.205 |
| 合计 | **9** | — |

- **共享块（≥2 连续行）= 0**；9 条共享行全部是**接口强制项或自然写法**，已逐条给出理由（白名单）；
- 未发现任何"从上游 EE 拷贝的代码段"。

## 7. L2 —— 批次回归（日志 `checks/20261015-113934-l2.log`）

服务由**被测 worktree** 提供（`litefuse-up.sh --build` 以 `LF_REPO=litefuse-license` 重建并重启）。

| 项 | 基线 | 本次 | 判定 |
| --- | --- | --- | --- |
| 构建 | ✓ | **✓ Compiled successfully in 73s** | PASS |
| smoke | PASS=17 FAIL=8 | PASS=17 FAIL=8 | **失败集合逐条一致（8 = 8）** → 无新增失败 |
| EE servertests 套件 | 3 PASS / 3 FAIL | 3 PASS / 3 FAIL | **集合完全一致** |
| EE servertests 用例 | 44 failed / 122 passed / 166 | 44 failed / 122 passed / 166 | **数量一致** |
| 失败用例名 | 36 条 | 36 条 | **逐条一致** |
| SSO clienttest | 3/3 | 3/3 | PASS |
| worker billing units | 10/10 | 10/10 | PASS |

## 8. 本批次发现并修复的**门禁自身缺陷**（两个，都会造成假绿）

| # | 缺陷 | 危害 | 修复 |
| --- | --- | --- | --- |
| a | 杀掉旧 web 后只等 3 秒就重启，端口仍在 `EADDRINUSE` → 新 `next start` 退出；更糟的是：若旧进程存活，`litefuse-up.sh` 会因"端口已监听"**跳过启动**，L2 将测到**旧代码**并假绿 | 结果不可信 | 新增 `free_port()`：轮询直到端口真正释放、超时 `SIGKILL`、仍失败则**判失败**；并新增断言 —— **:3000 上监听进程的 `cwd` 必须在被测 worktree 内**，否则直接 FAIL（本次实测 `cwd=/Users/zhang/SelectDB/litefuse-license/web` ✓） |
| b | smoke 输出带 ANSI 颜色码，而提取逻辑**先去 grep 后去 ANSI** → 一条失败都没解析到 → 白名单循环空转 → **vacuous PASS**（日志里明明有 8 条失败） | 假绿 | 改为**先去 ANSI 再匹配**；判定改为与**基线失败集合的集合等价比对**（比白名单更强、无法被绕过）；并新增守卫 —— 解析出的条数 < smoke 自报 `FAIL=` 数时**直接判失败** |

> 这两个缺陷都是"门禁比被测代码更容易骗过自己"的典型。`a` 正是用户强调的"一步一验证"要防的：**验证本身也可能假绿**。

## 9. 结论

| 判据 | 结果 |
| --- | --- |
| 特征测试改前绿 / 改后绿 | ✅ 18/18 两轮 |
| 变异测试证明测试有牙齿 | ✅ 2 个变异体各自精确命中 |
| L0 静态（含 i18n、边界） | ✅ 全绿（i18n 经修正后通过，并更新了流程） |
| L2 批次回归（集合等价比对） | ✅ 构建/smoke/套件/用例/失败名 全部与基线一致 |
| 相似度（共享块 = 0，残余逐条声明） | ✅ `similarity.md` |
| 留痕三件套 | ✅ `spec.md` / `record.md` / `similarity.md` / 本文件 |
| 门禁自身可靠性 | ✅ 修复 2 处假绿缺陷，并加断言防"测到旧代码" |

**本批次通过。** 唯一残留：3 个 EE servertest 的既有环境失败（批次 3 前置）。
