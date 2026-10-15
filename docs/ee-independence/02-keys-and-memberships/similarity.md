# 相似度报告：keys-and-memberships（批次 2a）

方法：`~/SelectDB/litefuse-local/bin/ee-similarity-report.mjs`
上游基准：`~/SelectDB/langfuse-latest`（EE 文件 132 个 / MIT 核心 5462 个 / EE 独有实质行 2996 条）
我方：`/Users/zhang/SelectDB/litefuse-license`（分支 `ee-independence`，19 个文件由 Zhang Mo 净室重写）

**度量定义**

1. **EE-only 共享实质行**：该行（≥40 字符、非 import/注释）出现在上游 `ee/` 树中、**不在**上游 MIT 核心、且出现在 ≤4 个 EE 文件里，而我方当前文件里仍有同一行。目标 0；非 0 时须逐条给出理由。
2. **token 5-gram Jaccard**：与"上游 EE 中**同名**对应文件"的整体词元相似度。仅作参考。
3. 残余项**不被隐藏**：下列每条都写明"为什么它可以留下"。

## 结果

| 文件 | 行数 | 实质行 | **EE-only 共享行** | token 5-gram Jaccard | 上游 EE 对应物 |
| --- | --- | --- | --- | --- | --- |
| `apiKeys/createOrgApiKey.ts` | 47 | 4 | **0** | —（无同名对应物） | — |
| `apiKeys/createProjectApiKey.ts` | 104 | 21 | **0** | — | — |
| `apiKeys/deleteOrgApiKey.ts` | 50 | 6 | **3** | — | — |
| `apiKeys/deleteProjectApiKey.ts` | 55 | 7 | **3** | — | — |
| `apiKeys/listOrgApiKeys.ts` | 30 | 2 | **0** | — | — |
| `apiKeys/listProjectApiKeys.ts` | 30 | 3 | **0** | — | — |
| `http.ts` | 48 | 4 | **0** | — | — |
| `memberships/deleteOrgMembership.ts` | 55 | 8 | **0** | — | — |
| `memberships/deleteProjectMembership.ts` | 57 | 9 | **0** | — | — |
| `memberships/listOrgMemberships.ts` | 31 | 3 | **1** | — | — |
| `memberships/listProjectMemberships.ts` | 35 | 3 | **2** | — | — |
| `memberships/upsertOrgMembership.ts` | 73 | 11 | **0** | — | — |
| `memberships/upsertProjectMembership.ts` | 69 | 10 | **0** | — | — |
| 6 个路由包装器（`…/index.ts`、`[apiKeyId].ts`） | 26–64 | 4–12 | **0** | 0.000（对比物无意义，见下） | `ee/src/ee-license-check/index.ts` |
| **合计** | | | **9** | | |

> 参照：批次 1（audit-logs，3 文件）9 行、共享块 0；批次 0（33 行单文件）2 行、Jaccard 0.298。

## 残余项逐条理由（白名单）

残余**全部是接口强制项或"最自然的写法"**，没有一条是"被拷贝的代码块"（**≥2 连续行共享块 = 0**，见下节核验）。

| # | 文件 | 行 | 内容 | 为什么可以留下 |
| --- | --- | --- | --- | --- |
| 1 | deleteOrgApiKey | 23 | `return res.status(404).json({ error: "API key not found" });` | 状态码与错误串由 **API 契约（含既有测试）固定**；最短自然写法即如此 |
| 2 | deleteOrgApiKey | 26 | `const deleted = await new ApiAuthService(prisma, redis).deleteApiKey(` | `ApiAuthService` 是**本仓库外的 MIT 模块**，构造签名与方法名是外部接口，调用行只能这么写 |
| 3 | deleteOrgApiKey | 48 | `return res.status(200).json({ success: true });` | 成功响应体由契约固定 |
| 4 | deleteProjectApiKey | 27 | `return res.status(404).json({ message: "API key not found" });` | 同上（项目级用 `message` 键，是刻意的契约不对称） |
| 5 | deleteProjectApiKey | 30 | `const deleted = await new ApiAuthService(prisma, redis).deleteApiKey(` | 同 #2 |
| 6 | deleteProjectApiKey | 53 | `return res.status(200).json({ success: true });` | 同 #3 |
| 7 | listOrgMemberships | 23 | `memberships: memberships.map((membership) => ({` | 响应键与投影由规格固定；`map` 是唯一自然表达 |
| 8 | listProjectMemberships | 10 | `const memberships = await prisma.projectMembership.findMany({` | Prisma 客户端 API + 规格固定的查询对象 |
| 9 | listProjectMemberships | 27 | `memberships: memberships.map((membership) => ({` | 同 #7 |

**为什么这一批会出现"新代码比原实现更像上游"**：原实现在 `delete*ApiKey` 里把错误串与响应体抽成了具名常量（`API_KEY_NOT_FOUND_ERROR`、`DELETE_SUCCEEDED_BODY`），于是那两行**不**与上游重合、也就不进这份名单；净室实现把字面量**内联**成最短写法，反而与上游的写法一致。这与批次 0 的现象（独立实现把居中写成 `items-center justify-center`，而原实现用 `m-auto`）是同一类：

> **行级相似度不能作为独立性的证据**，只能用来发现"残留的拷贝块"。为把数字压到 0 而刻意改名/绕写，正是要避免的"为差异而差异"。

## 关于 Jaccard 列的两点诚实说明

1. **13 个文件没有同名对应物**（上游商业版里这批服务端模块不叫这些文件名），该列不可算，记为"—"。
2. 6 个路由包装器的同名文件恰好都叫 `index.ts`，脚本按 basename 匹配到了 `ee/src/ee-license-check/index.ts` —— **这是另一个文件**（授权检查，和成员/密钥路由无关），因此 0.000 这个数字**没有解释力**，仅作为"未发现重合"的旁证列出。

## 结论

- **EE-only 共享块（≥2 连续行）= 0**；共享的 9 行全部为接口强制项或最短自然写法，已逐条给理由；
- 未发现任何"从上游 EE 拷贝的代码段"；
- 文本层面无实质残留，**独立创作的主张依据是 `record.md` 的过程留痕**（实现者的可见输入、禁令、声明与检索命令），不是本报告的数字。
