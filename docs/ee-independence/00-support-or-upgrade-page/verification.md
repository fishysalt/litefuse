# 验证记录：SupportOrUpgradePage（批次 0 试点）

分支：`ee-independence`（在 license worktree 上，基于 `753d0f6`）
仓库：`/Users/zhang/SelectDB/litefuse-license`
自检工具：`~/SelectDB/litefuse-local/bin/ee-refactor-check.sh`
自检索引：`~/SelectDB/litefuse-local/checks/INDEX.md`

---

## 1. 基线冻结（改动前）

命令：`ee-refactor-check.sh baseline`
日志：`checks/20261015-104235-baseline.log`
提交：`753d0f6`

| 项 | 结果 |
| --- | --- |
| web tsgo | PASS |
| worker tsgo | PASS |
| EE boundary（静态 MIT→EE） | PASS |
| 重建 + 重启 EE worktree 栈 | PASS |
| `smoke.sh` | PASS（仅允许"本分支不存在的 evaluator-v2 检查"失败） |
| EE clienttest（SSO） | PASS 3/3 |
| worker billing units | PASS |
| **EE servertests（6 个文件）** | **FAIL：3 红 3 绿（见 §2，属既有环境问题）** |

### 1.1 环境说明（两条，均与代码无关）

1. **web 首次启动失败**：`litefuse-up.sh --build` 启动的 `next start` 进程退出，日志只有非致命告警 `PLAIN_AUTHENTICATION_SECRET is not set`（来源 `features/support-chat/createSupportEmailHash.ts`，该变量为 optional）。手动以同一命令启动即成功（`Ready in 1710ms`），随后 `litefuse-up` 看到端口就绪正常收尾。**结论：启动脚本的时序问题，非代码缺陷**；后续批次 L2 若复现，先手动拉起 web 再让脚本收尾。
2. **绝对路径**：`litefuse-up.sh` 尊重 `LF_REPO`，本次已确认服务由 EE worktree 构建（构建日志路径为 `litefuse-license/web/...`），即"被测代码 = 被服务代码"。

## 2. 基线中已存在的失败（重要）

| 套件 | 基线状态 | 观察到的原因 |
| --- | --- | --- |
| `projects-api` / `organizations-api` / `memberships-api` | **PASS**（122 tests） | — |
| `admin-api-key-auth` | FAIL | `api_keys_organization_id_fkey` 外键冲突：创建组织级 API key 时组织行不存在（`packages/shared/dist/src/server/auth/apiKeys.js:83`） |
| `scim-api` | FAIL（44 个用例连带失败） | 同上 |
| `organizations-api-key-trpc` | FAIL | 同上 |

**定性**：这三套在**未改动的分支上**即失败，与本次重构无关；成因是测试夹具的组织/组织级密钥创建路径在本环境不成立（疑与 `api_keys.organization_id` 外键、测试辅助函数 `createOrgProjectAndApiKey` / `createAndAddApiKeysToDb` 的建组织顺序有关）。

**对门禁的影响（已调整）**：

- 本批次的回归门禁 = **改前绿的 3 套必须保持绿**；
- 改前红的 3 套视为**已知红**：只要不新增失败类型即可（不追溯修复）；
- **前置项**：批次 3 要改 `adminApiAuth.ts`，而它的门禁套件 `admin-api-key-auth` 目前是红的 → **必须先修复该环境问题**，否则该文件的重写缺少有效门禁。

## 3. 本批次的验证结果

### 3.1 L1 —— 特征测试先绿（改动前）

```
cd web && pnpm run test-client -- SupportOrUpgradePage
PASS client src/components/SupportOrUpgradePage.clienttest.tsx
  ✓ states the restriction and who to ask for access
  ✓ offers no action of its own
Tests: 2 passed, 2 total
```
在**未改动**的原实现上通过 → 证明测试锁定的是当前真实行为。

### 3.2 L1 —— 换入净室实现后

```
mv web/src/components/SupportOrUpgradePage.impl.tsx web/src/components/SupportOrUpgradePage.tsx
cd web && pnpm run test-client -- SupportOrUpgradePage
PASS client src/components/SupportOrUpgradePage.clienttest.tsx
Tests: 2 passed, 2 total
```
同一套测试仍然全绿 → 行为未变。

### 3.3 L0 —— 静态

命令：`ee-refactor-check.sh l0 web/src/components/SupportOrUpgradePage.tsx web/src/components/SupportOrUpgradePage.clienttest.tsx`
日志：`checks/20261015-104935-l0.log`

| 项 | 结果 |
| --- | --- |
| prettier --check（两个文件） | PASS |
| web tsgo | PASS |
| worker tsgo | PASS |
| EE boundary | PASS |

### 3.4 L2 —— 批次回归

**未在本次执行**。理由：本批次只影响一个纯展示组件，且该组件不被 `smoke.sh` 或任何 servertest 覆盖（基线已确认无相关断言）；L2 的重建+重启成本（约 10 分钟）留到**功能族批次**（批次 1 起）统一执行。
**待办**：批次 1 结束时执行首次 L2，把"只改 UI 组件"的结论纳入同一批次验证。

## 4. 结论

| 判据 | 结果 |
| --- | --- |
| 特征测试改前绿、改后绿 | ✅ |
| 对外契约（可见文案、无按钮/链接、可翻译）一致 | ✅ |
| L0 静态全绿 | ✅ |
| 表达层差异（导出/居中/间距/注释/导入） | ✅ 见 `record.md` §3 |
| 净室留痕 | ✅ `spec.md` + `record.md` + 本文件（含一次已披露的暴露） |

**本批次通过。** 唯一残留：`admin-api-key-auth` 等 3 套 servertest 的既有环境失败，须在批次 3 前修复。
