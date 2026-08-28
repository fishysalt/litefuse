import { Role } from "@langfuse/shared";

/**
 * 付费扩展角色：只有付费 plan（Pro / Team / self-hosted:enterprise，即有 admin-api）才可选。
 * 免费 plan（cloud:developer / oss）只能选基础角色 OWNER/ADMIN/MEMBER/VIEWER/NONE。
 */
export const extendedRoles: Role[] = [
  Role.DEVELOPER,
  Role.PROMPT_MANAGER,
  Role.EVALUATOR,
  Role.ANNOTATOR,
  Role.AUDITOR,
];

/**
 * 根据是否付费返回可选择的角色列表。
 * 付费：全部 10 个角色；免费：基础 5 个角色（排除扩展角色）。
 */
export const getSelectableRoles = (isPaidPlan: boolean): Role[] =>
  Object.values(Role).filter(
    (role) => isPaidPlan || !extendedRoles.includes(role),
  );

/**
 * 角色层级（数字越大权限越高），用于「不能授予高于自己角色」的校验。
 * 层级：OWNER > ADMIN > DEVELOPER > MEMBER > PROMPT_MANAGER > EVALUATOR > ANNOTATOR > VIEWER > AUDITOR > NONE
 * 其中 DEVELOPER / PROMPT_MANAGER / EVALUATOR / ANNOTATOR / AUDITOR 为付费扩展角色。
 */
export const orderedRoles: Record<Role, number> = {
  [Role.OWNER]: 9,
  [Role.ADMIN]: 8,
  [Role.DEVELOPER]: 7,
  [Role.MEMBER]: 6,
  [Role.PROMPT_MANAGER]: 5,
  [Role.EVALUATOR]: 4,
  [Role.ANNOTATOR]: 3,
  [Role.VIEWER]: 2,
  [Role.AUDITOR]: 1,
  [Role.NONE]: 0,
};
