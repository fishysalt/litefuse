# 验证记录：organizations-and-projects（批次 2b）

分支：`ee-independence`（license worktree，基于 `753d0f6`）
自检工具：`~/SelectDB/litefuse-local/bin/ee-refactor-check.sh`（`l0`/`l1`/`l2`）
角色：规格/测试/门禁 = **Select DB**；实现 = **Zhang Mo**（净室，未阅原实现）

---

## 0. 本批次特有的前置：一处缺陷先修后固化

写特征测试时发现规格与实现矛盾：`deleteOrganization` 在**硬删除之后**才失效 API key 缓存，而 helper 靠回查 `api_keys`（已被级联删除）→ **已删除组织的 key 在 300s TTL 内仍可鉴权**。主控裁定：**先修缺陷，再把修复后的行为写成契约**（否则等于把凭据有效性缺陷固化成"规格"）。

| 步骤 | 修复前 | 修复后 |
| --- | --- | --- |
| 预热缓存 `GET /api/public/organizations/projects` | 200 | 200 |
| `DELETE /api/admin/organizations/{id}` | 200 | 200 |
| `api_keys` 行（级联后） | 0 | 0 |
| **同一把 key 再请求** | **200（缺陷）** | **401** |

- 修复提交：**`d6a6567`** `fix(ee): stop a deleted organization's API key from staying valid`（把失效调用移到硬删除之前，与 `deleteProject` 既有顺序一致）
- 证据日志：`checks/20261015-155531-batch2b-orgkey-fix.log`
- 规格同步：`spec.md` §B.5 步骤 4/5、H38、§K.1；验收测试补入 H38（断言"预热 200 → 删除 200 → 同 key 401"，并核对 `apiKey` 行确已级联删除，避免空洞断言）
- 之所以单独成一个提交：本批次契约是"行为等价"，行为变更必须显式、可单独回退

## 1. 基线（改动前）

| 项 | 值 |
| --- | --- |
| 冻结基线日志 | `checks/20261015-104235-baseline.log`（commit `753d0f6`） |
| smoke 失败集合 | 8 项（`checks/baseline-smoke-fails.txt`） |
| EE servertests | 3 红 / 3 绿；红：`admin-api-key-auth`、`scim-api`、`organizations-api-key-trpc`（既有环境问题 `api_keys_organization_id_fkey`） |

> 环境前提：servertest 是**真实 HTTP 打 `localhost:3000`**，且 `:3000` 必须由 license worktree 提供（其 `.env` 才有 EE 许可密钥）。本批次全部门禁均在确认 `:3000` 进程 `cwd` 位于 license worktree 后执行（L2 内置该断言）。

## 2. L1（改前）—— 特征测试先在原实现上跑绿

| 项 | 结果 |
| --- | --- |
| 新文件 `organizations-and-projects-api.servertest.ts`（首版 46 条，在**原实现**上） | ✅ 46/46 |
| 邻近套件 | ✅ `organizations-api` 44 + `projects-api` 49 + `keys-and-memberships-api` 44 |
| 补入 H38 后（在**已修复**的实现上） | ✅ 47/47，4 套件合计 **184 passed** |

覆盖账目（规格 112 条）：映射到既有套件不再重写的 60 余条；本批次新写 47 条；**判定不可断言 6 条**（§K.2，其中 H101 为实测不可达）。`admin-api-key-auth` / `organizations-api-key-trpc` 经核对**不覆盖本批次模块**，不作验收证据。

## 3. 变异测试（证明断言有牙齿）—— 日志 `checks/20261015-160845-batch2b-mutation.log`

三个类型安全变异体一次构建，**命中与预测完全一致、无连带失败**（3 failed / 181 passed / 184 total）：

| 变异体 | 改动 | 被哪条断言抓住 |
| --- | --- | --- |
| ① `updateOrganization` | 存在性检查移到 body 校验**之前** | **H28**（validates the body before the existence check (400, not 404)） |
| ② `createProject` | 默认 score config 由 5 个改为 4 个（`.slice(1)`） | **H49**（creates the project with five default score configs and a Doris control row） |
| ③ `deleteOrganization` | 失效调用挪回硬删除**之后**（即复现原缺陷） | **H38**（预热缓存的组织 key 删除后失效） |

回滚（`git checkout --`）→ 重建重启复跑：**184 passed** 全绿（日志 `checks/20261015-161225-batch2b-mutation-revert.log`），工作区仅剩规格改动与新增测试文件。

> **作废的一轮（诚实记录）**：第一轮变异体 ① 用的是 `metadata: value ?? null`，这在 Prisma 的 JSON 字段上是**类型错误** → `next build` 失败、服务器未启动 → 那一轮的 177 条失败**不构成证据**，已作废（日志 `checks/20261015-160309-batch2b-mutation.log` 内已写明原因）。教训：**变异体自身必须先能编译**，否则得到的是"构建失败"而不是"测试抓住行为变化"。

## 4. L1（改后）—— 换入净室实现

| 项 | 结果 |
| --- | --- |
| 重建（生产构建，服务被测代码） | ✅ exit 0 |
| `:3000` 服务来源断言 | ✅ `cwd=/Users/zhang/SelectDB/litefuse-license/web` |
| 新文件 | ✅ 47/47 |
| 邻近套件 | ✅ 137/137 |
| **合计** | ✅ **184 passed / 184**（4 套件，日志 `checks/20261015-162429-batch2b-l1-l0.log`） |

## 5. L0 —— 静态（日志 `checks/20261015-162530-l0.log`）

| 项 | 结果 |
| --- | --- |
| prettier（14 个源码文件，**CI 口径**） | ✅ PASS |
| web tsgo / worker tsgo | ✅ PASS / PASS |
| i18n check | ✅ PASS |
| EE boundary（静态 MIT→EE） | ✅ PASS |

### 5.1 本批次修掉的**门禁自身缺陷**（第四个）

`l0` 的 prettier 步骤把**传入的所有文件**都交给 prettier。本批次的改动列表里有 `spec.md`（手写对齐的 markdown 表格），prettier 只重排表格空白却能判 FAIL，而这个 FAIL 与"被测代码"无关；CI 的 prettier 步骤本来就只查 `*.js/*.jsx/*.ts/*.tsx/*.css`。

修复：prettier 步骤先把文件列表过滤为 CI 的同口径扩展名，其余给出一条说明性 note。已从 `/tmp` 调用、且改动列表含 `spec.md` 的情况下复验：✅ PASS（14 个源码文件仍全部被检查）。

## 6. 相似度（详见 `similarity.md`）

| 项 | 结果 |
| --- | --- |
| EE-only 共享实质行 | **11**（14 文件；deleteOrganization 2、listOrganizations 1、createProject 3、deleteProject 2、updateProject 3） |
| **≥2 连续行共享块** | **0** |
| 残余理由 | 11 条 = Prisma 调用形式（5）+ 契约固定的字段名/响应体（3）+ **日志文案**（3，规格里本属"自由"列 → 独立收敛） |
| Jaccard | `createProject.ts` 有真实同名对应物，**0.278**（3/28 条共享实质行、0 共享块；该值被接口强制标识符抬高）；4 个路由包装器比到无关文件 `ee/src/ee-license-check/index.ts`（0.000，无解释力） |

**结论同前两批**：行级相似度只是否证工具；为把数字压到 0 而绕写 Prisma 调用或改写日志文案，属"为差异而差异"。

## 7. L2 —— 批次回归（日志 `checks/20261015-162543-l2.log`）

| 项 | 基线 | 本次 | 判定 |
| --- | --- | --- | --- |
| 重建 + 重启（服务由被测 worktree 提供） | ✓ | ✅ PASS（含 `cwd` 断言） | PASS |
| smoke | PASS=17 FAIL=8 | **PASS=17 FAIL=8** | ✅ 失败集合与快照逐条一致 |
| EE servertests 套件 | 3 红 / 3 绿（6 套件） | 3 红 / **5 绿**（8 套件） | ✅ 红套件集合一致；新增两个批次套件全绿 |
| EE servertests 用例 | 44 failed / 122 passed / 166 | 44 failed / **213 passed** / 257 | ✅ 失败数与**失败用例名（去耗时）逐条一致**；多出的 91 passed = 2a 的 44 + 2b 的 47 |
| SSO clienttest | 3/3 | 3/3 | PASS |
| worker billing units | 10/10 | 10/10 | PASS |

> 同 2a：`l2` 把 "EE servertests" 标为 FAIL 只因为该命令整体退出码非 0（3 个既有环境红套件）；判据是**与冻结基线的集合等价**，本项判定为 **PASS（无回归）**。

## 8. 结论

| 判据 | 结果 |
| --- | --- |
| 特征测试改前绿 / 改后绿 | ✅ 46/46 → 47/47（补 H38），4 套件 184/184 两轮 |
| 变异测试证明测试有牙齿 | ✅ 3 个变异体分别精确命中 H28 / H38 / H49，无连带（第一轮因变异体类型错误作废并已记录） |
| L0 静态（prettier CI 口径 / tsgo×2 / i18n / EE 边界） | ✅ 全绿（并修掉门禁的 prettier 作用域缺陷） |
| L2 批次回归（集合等价比对） | ✅ smoke 8=8、红套件集合一致、失败用例名逐条一致 |
| 相似度（共享块 = 0，残余逐条声明） | ✅ `similarity.md` |
| 净室留痕（规格/实现记录/声明与检索命令/披露） | ✅ `spec.md`（含 §K）/ `record.md` |
| 行为变更的可回退性 | ✅ 唯一行为变更（缓存失效顺序）是独立提交 `d6a6567`，可单独回滚 |

**本批次通过。** 唯一残留：3 个 EE servertest 的既有环境失败（下一步专门修，作为批次 3 前置）。
