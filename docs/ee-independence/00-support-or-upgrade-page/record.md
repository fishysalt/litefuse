# 实现记录：SupportOrUpgradePage（净室）

- 批次：0（试点）
- 目标文件：`web/src/components/SupportOrUpgradePage.tsx`
- 实现日期：2026-10-15
- 规格：`./spec.md`（本目录）
- 验收测试：`web/src/components/SupportOrUpgradePage.clienttest.tsx`

## 1. 实现者与可见输入

| 项 | 内容 |
| --- | --- |
| 实现者 | 独立执行上下文（与规格作者不同的会话；主控会话未参与实现） |
| 实现时可见的输入 | ① `spec.md`；② 验收测试 `SupportOrUpgradePage.clienttest.tsx`；③ 项目告警原语 `web/src/components/ui/alert.tsx`（确认导出的组件名）；④ 仓库格式化配置 |
| 禁止输入 | 原实现 `SupportOrUpgradePage.tsx`、其 git 历史/任何 diff |
| 声明 | 实现者声明："I did not open, read, cat, diff or inspect `SupportOrUpgradePage.tsx`, and I did not touch git history/log/diff." |

## 2. 披露：一次非故意的暴露（已评估为不实质）

实现者在检索项目惯例时执行了一次**全仓 grep**（`grep -r useTranslation web/src/components`），其输出**附带打印了原实现的两行**：

```
import { useTranslation } from "react-i18next";
const { t } = useTranslation();
```

（仅这两行，加上文件名与行号；未出现 JSX、类名、注释或结构。）

**评估**：不构成实质污染。原因：这两行所承载的信息（"使用 react-i18next 的 `useTranslation` 并解构出 `t`"）已由 `spec.md` §3/§5 **明确要求**，属于规格规定的公开契约，不含额外表达。实现者未据此进入该文件，产出中的差异（见 §3）也表明实现是独立形成的。

**流程改进（已采纳）**：后续批次的实现者提示词中，禁止范围扩展到"不得对包含目标文件的目录做全仓 grep"，并建议用 spec 指定的原语路径直接打开文件。

## 3. 产出与原实现的差异（表达层）

| 维度 | 原实现 | 净室实现 |
| --- | --- | --- |
| 导出形式 | `export function SupportOrUpgradePage()` | `export const SupportOrUpgradePage = () =>` |
| 导入顺序/分组 | 图标、UI 原语、i18n 交错 | 图标 + i18n 一组，UI 原语一组 |
| 垂直居中方式 | 内层 `m-auto` | 外层 `items-center justify-center` |
| 段间距技术 | 第一段 `<p className="mb-2">` | 容器 `space-y-2` + 普通 `<p>` |
| 注释 | 有 JSDoc 说明 | 无注释 |
| 可见文案 | 三句 | **相同**（属行为契约，见 `spec.md` §8） |

## 4. 结论

实现为**净室产出**，附带一次已披露且经评估不实质的暴露。差异集中在实现表达层，行为契约保持完全一致（由同一套验收测试在改前/改后分别验证，均全绿）。
