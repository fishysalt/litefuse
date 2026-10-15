# 验证记录：keys-and-memberships（批次 2a）

分支：`ee-independence`（license worktree，基于 `753d0f6`）
自检工具：`~/SelectDB/litefuse-local/bin/ee-refactor-check.sh`（`l0`/`l1`/`l2`）
自检索引：`~/SelectDB/litefuse-local/checks/INDEX.md`
角色：规格/测试/门禁 = **Select DB**；实现 = **Zhang Mo**（净室，未阅原实现）

---

## 1. 基线（改动前）

| 项 | 值 |
| --- | --- |
| 冻结基线日志 | `checks/20261015-104235-baseline.log`（commit `753d0f6`） |
| smoke 失败集合 | 8 项，已固化在 `checks/baseline-smoke-fails.txt` |
| EE servertests | 3 红 / 3 绿（红：`admin-api-key-auth`、`scim-api`、`organizations-api-key-trpc`；绿：`memberships-api`、`organizations-api`、`projects-api`），成因是**既有环境问题** `api_keys_organization_id_fkey`，与本批次无关 |
| 本批次直接相关的绿套件 | `memberships-api` 18、`organizations-api` 44、`projects-api` 49（共 111） |

> ⚠ 环境前提（本轮踩到并已写入 worklog §17）：servertest 是**真实 HTTP 打 `localhost:3000`**，而 `:3000` 必须由 **license worktree** 提供（只有它的 `.env` 有 EE 许可密钥）。曾因用 evaluator worktree 启动 web，导致 admin 接口按社区版返回 `403 ... not available on your current plan.`，`organizations-api` 由 PASS 变 FAIL——**看着像回归，实为门禁环境错误**。本批次的全部 L0/L1/L2 均在确认 `:3000` 进程 `cwd` 位于 license worktree 后执行（`l2` 内置该断言）。

## 2. L1（改前）—— 特征测试先在原实现上跑绿

| 阶段 | 结果 |
| --- | --- |
| 新文件 `keys-and-memberships-api.servertest.ts` 在**原实现**上 | ✅ 44/44 |
| 三个邻近套件在原实现上 | ✅ 18 + 44 + 49 = 111 |
| 合计 | ✅ **155 passed / 155**（4 套件） |

覆盖账目：规格 97 条用例中，43 条由新文件直接实现（含 C4 与其增强）、51 条映射到既有套件不再重写、3 条经实测判定**不可断言**（C39/C80/C93，见 `spec.md` §7.12）。`admin-api-key-auth` 与 `organizations-api-key-trpc` 经核对**不覆盖本批次任何模块**（前者测 env Bearer 的另一套机制、后者测 MIT 的平行 tRPC router），明确不作为验收证据。

## 3. 变异测试（证明断言有牙齿）—— 日志 `checks/20261015-150647-batch2a-mutation.log`

两个变异体一次构建，**命中与预测完全一致、无连带失败**（3 failed / 108 passed / 111 total）：

| 变异体 | 改动 | 预期 | 实测 |
| --- | --- | --- | --- |
| ① `createProjectApiKey.isDuplicateKeyFailure` 失效 | `P2002` → `P2002_MUTANT`、`/unique constraint/i` → `/unique-constraint-mutant/i` | 新文件 C37 + `projects-api` 重复 publicKey 用例 | ✅ **恰好这 2 条**失败 |
| ② `upsertOrgMembership` last-OWNER 门控失效 | `otherOwners === 0` → `=== -1` | `memberships-api` 降级最后 owner 用例 | ✅ **恰好 1 条**失败；同类的 **delete** last-OWNER 用例**仍绿**（实现在 `deleteOrgMembership.ts`，另一个文件）→ 测试能区分相似行为 |

回滚（`git checkout --` 两文件）→ 重建重启复跑：**155 passed** 全绿（日志 `checks/20261015-151044-batch2a-mutation-revert.log`），工作区无源码残留。变异体未进入仓库。

## 4. L1（改后）—— 换入净室实现

| 项 | 结果 |
| --- | --- |
| 重建（生产构建，服务被测代码） | ✅ `Compiled successfully`，exit 0 |
| `:3000` 服务来源断言 | ✅ `cwd=/Users/zhang/SelectDB/litefuse-license/web` |
| 新文件 | ✅ 44/44 |
| 邻近套件 | ✅ 111/111 |
| **合计** | ✅ **155 passed / 155**（4 套件，日志 `checks/20261015-152512-batch2a-l1.log`） |

## 5. L0 —— 静态（日志 `checks/20261015-153001-l0.log`）

| 项 | 结果 |
| --- | --- |
| prettier（19 个改动文件） | ✅ PASS |
| web tsgo / worker tsgo | ✅ PASS / PASS |
| i18n check | ✅ PASS |
| EE boundary（静态 MIT→EE） | ✅ PASS |

### 5.1 本批次修掉的**门禁自身缺陷**（第三个）

`l0` 的 prettier 步骤直接把传入路径交给 prettier，而**未先 `cd` 到被测仓库根**。主控恰好在仓库外（`~/SelectDB/litefuse-local`）调用，于是 prettier 报 `No files matching the pattern were found` → **FAIL**。这是一个"假红"（方向安全，但会浪费排查时间，且若仓库结构变化有可能变成假绿）。

修复：prettier 步骤改为 `bash -lc "cd '$LF_EE_REPO' && ./node_modules/.bin/prettier --check …"`（相对/绝对路径都成立），并加注释说明原因。已从 `/tmp` 调用复验：✅ PASS。**至此门禁累计修掉 3 个自身缺陷**（批次 1：端口未释放可能测到旧代码、smoke ANSI 导致 vacuous PASS；本批次：prettier CWD）。

## 6. 相似度（详见 `similarity.md`）

| 项 | 结果 |
| --- | --- |
| EE-only 共享实质行 | **9**（19 个文件；其中 `deleteOrgApiKey` 3、`deleteProjectApiKey` 3、`listProjectMemberships` 2、`listOrgMemberships` 1） |
| **≥2 连续行共享块** | **0** |
| 残余理由 | 9 条全部为**接口强制项或最短自然写法**（`ApiAuthService` 调用签名、Prisma 查询、契约固定的状态码/响应体/错误串），已逐条给出理由 |
| Jaccard | 13 个文件无同名对应物；6 个路由包装器按 basename 比到了无关文件 `ee/src/ee-license-check/index.ts`（0.000），已在报告中注明**无解释力** |

**值得记录的观察**：原实现把错误串/响应体抽成具名常量，净室实现内联成最短写法 → 后者**反而与上游写法一致**。这与批次 0"独立实现把居中写成 `items-center justify-center` 而原实现用 `m-auto`"是同一现象：**行级相似度不能作为独立性的证据**，只能用于发现残留拷贝块。

## 7. L2 —— 批次回归（日志 `checks/20261015-153014-l2.log`）

| 项 | 基线 | 本次 | 判定 |
| --- | --- | --- | --- |
| 重建 + 重启（服务由被测 worktree 提供） | ✓ | ✅ PASS（含 `cwd` 断言） | PASS |
| smoke | PASS=17 FAIL=8 | **PASS=17 FAIL=8** | ✅ 失败集合与快照**逐条一致** |
| EE servertests 套件 | 3 红 / 3 绿（6 套件） | 3 红 / **4 绿**（7 套件） | ✅ 红套件集合一致，新增的第 7 套件即本批次新文件（全绿） |
| EE servertests 用例 | 44 failed / 122 passed / 166 | 44 failed / **166 passed** / 210 | ✅ 失败数与**失败用例名（去耗时）逐条一致**；多出的 44 passed 即新套件 |
| SSO clienttest | 3/3 | 3/3 | PASS |
| worker billing units | 10/10 | 10/10 | PASS |

> 注：`l2` 把 "EE servertests" 标为 FAIL，是因为该命令整体退出码非 0（3 个既有环境红套件所致）；按批次 1 的既定判据，**判据是"与冻结基线的集合等价"**，此项判定为 **PASS（无回归）**。

## 8. 结论

| 判据 | 结果 |
| --- | --- |
| 特征测试改前绿 / 改后绿 | ✅ 155/155 两轮 |
| 变异测试证明测试有牙齿 | ✅ 2 个变异体精确命中（3 条失败，无连带） |
| L0 静态（prettier/tsgo×2/i18n/EE 边界） | ✅ 全绿（并修掉门禁的 CWD 缺陷） |
| L2 批次回归（集合等价比对） | ✅ smoke 8=8、红套件集合一致、失败用例名逐条一致 |
| 相似度（共享块 = 0，残余逐条声明） | ✅ `similarity.md` |
| 净室留痕（规格/实现记录/声明与检索命令/披露） | ✅ `spec.md` / `record.md` |
| 门禁自身可靠性 | ✅ 累计修掉 3 个假绿/假红缺陷 |

**本批次通过。** 唯一残留：3 个 EE servertest 的既有环境失败（同上，属批次 3 前置）。
