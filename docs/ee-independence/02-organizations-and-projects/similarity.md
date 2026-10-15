# 相似度报告：organizations-and-projects（批次 2b）

方法：`~/SelectDB/litefuse-local/bin/ee-similarity-report.mjs`
上游基准：`~/SelectDB/langfuse-latest`（EE 文件 132 个 / MIT 核心 5462 个 / EE 独有实质行 2996 条）
我方：`/Users/zhang/SelectDB/litefuse-license`（分支 `ee-independence`，14 个文件由 Zhang Mo 净室重写）

**度量定义**

1. **EE-only 共享实质行**：该行（≥40 字符、非 import/注释）出现在上游 `ee/` 树中、**不在**上游 MIT 核心、且出现在 ≤4 个 EE 文件里，而我方当前文件里仍有同一行。目标 0；非 0 时须逐条给出理由。
2. **token 5-gram Jaccard**：与"上游 EE 中**同名**对应文件"的整体词元相似度。仅作参考。
3. 残余项**不被隐藏**：下列每条都写明"为什么它可以留下"。

## 结果

| 文件 | 行数 | 实质行 | **EE-only 共享行** | token 5-gram Jaccard | 上游 EE 对应物 |
| --- | --- | --- | --- | --- | --- |
| `organizations/createOrganization.ts` | 96 | 13 | **0** | —（无同名对应物） | — |
| `organizations/deleteOrganization.ts` | 67 | 15 | **2** | — | — |
| `organizations/getOrganization.ts` | 38 | 2 | **0** | — | — |
| `organizations/listOrganizations.ts` | 34 | 3 | **1** | — | — |
| `organizations/updateOrganization.ts` | 96 | 15 | **0** | — | — |
| `projects/createProject.ts` | 151 | 28 | **3** | **0.278** | `web/src/ee/features/admin-api/server/projects/createProject.ts` |
| `projects/deleteProject.ts` | 67 | 11 | **2** | — | — |
| `projects/listProjects.ts` | 22 | 2 | **0** | — | — |
| `projects/updateProject.ts` | 141 | 27 | **3** | — | — |
| `admin/organizations/[organizationId]/apiKeys/[apiKeyId].ts` | 46 | 9 | **0** | — | — |
| 4 个路由包装器（`index.ts`） | 24–48 | 3–12 | **0** | 0.000（对比物无意义，见下） | `ee/src/ee-license-check/index.ts` |
| **合计** | | | **11** | | |

> 参照：批次 2a（19 文件）9 行 / 块 0；批次 1（3 文件）9 行 / 块 0；批次 0（33 行单文件）2 行。

## 残余项逐条理由（白名单）

**≥2 连续行共享块 = 0**（核验方式见下节）。共享的 11 行分三类：

| # | 文件 | 行 | 内容 | 为什么可以留下 |
| --- | --- | --- | --- | --- |
| 1 | deleteOrganization | 50 | `const deletedOrganization = await prisma.organization.delete({` | Prisma 客户端 API + 规格固定的删除对象；调用行只能这么写 |
| 2 | deleteOrganization | 65 | `return res.status(200).json({ success: true });` | 成功响应体由契约固定 |
| 3 | listOrganizations | 8 | `const organizations = await prisma.organization.findMany({` | Prisma 客户端 API + 规格固定的查询 |
| 4 | createProject | 79 | `const { name, retention, metadata } = req.body;` | 请求体字段名由契约固定；解构是最短自然写法 |
| 5 | createProject | 101 | `const existingProject = await prisma.project.findFirst({` | Prisma 客户端 API + 规格固定的重名检查查询 |
| 6 | createProject | 147 | `logger.error("Failed to create project", error);` | **日志文本在规格里属"自由"列**（不算契约）→ 这是独立收敛：创建失败最自然的英文就是这句 |
| 7 | deleteProject | 29 | `const project = await prisma.project.update({` | 软删除（update）由规格固定 |
| 8 | deleteProject | 63 | `logger.error("Failed to delete project", error);` | 同 #6 |
| 9 | updateProject | 79 | `const { name, retention, metadata } = req.body;` | 同 #4 |
| 10 | updateProject | 109 | `const project = await prisma.project.update({` | 同 #7 |
| 11 | updateProject | 137 | `logger.error("Failed to update project", error);` | 同 #6 |

**为什么 #6/#8/#11 值得单独说明**：规格明确把"日志文本"归入可自由拟定的部分，所以这三行**不是**接口强制项，而是"最自然的英文写法"与上游撞车 —— 与批次 0（居中方式）、批次 2a（把具名常量内联后与上游一致）是同一现象：

> **行级相似度不能作为独立性的证据**，只能用来发现"残留的拷贝块"。为把数字压到 0 而刻意改写日志文案/绕开 Prisma 调用形式，正是要避免的"为差异而差异"。

## 关于 Jaccard 列的两点诚实说明

1. **`createProject.ts` 有真实同名对应物**（上游 `web/src/ee/features/admin-api/server/projects/createProject.ts`），Jaccard **0.278**。该数字对 151 行文件中仅 3 条共享实质行的文件而言偏高，原因是 5-gram 集合被**接口强制标识符**（`prisma`、`req.body`、`retention`、`metadata`、字段名、错误串）与公共控制流词汇抬高；更能说明问题的是"共享实质行 3 / 28、共享块 0"。
2. 4 个路由包装器的同名文件恰好都叫 `index.ts`，脚本按 basename 匹配到了 `ee/src/ee-license-check/index.ts` —— **这是另一个文件**（授权检查，与组织/项目路由无关），因此 0.000 没有解释力，仅作"未发现重合"的旁证。
3. 其余 9 个文件上游 EE 里没有同名对应物（该批服务端模块在上游不以这些文件名存在），该列不可算。

## 结论

- **EE-only 共享块（≥2 连续行）= 0**；共享的 11 行全部为 Prisma 调用形式、契约固定的字段名/响应体，或"最自然的日志文案"，已逐条给理由；
- 未发现任何"从上游 EE 拷贝的代码段"；
- 文本层面无实质残留，**独立创作的主张依据是 `record.md` 的过程留痕**（实现者的可见输入、禁令、声明与检索命令），不是本报告的数字。
