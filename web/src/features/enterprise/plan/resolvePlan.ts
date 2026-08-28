import { type Plan } from "@langfuse/shared";

/**
 * 自托管实例的 plan 判定：根据 EE license key 前缀映射到 plan。
 * - litefuse_ee_ → self-hosted:enterprise
 * 无 license 或前缀不识别时返回 null（表示回退 oss 基础 plan）。
 *
 * 与 Cloud 分支（读 cloudConfig.plan）共同构成完整的 plan 解析逻辑，
 * 见 @/src/features/entitlements/server/getPlan 的接入点。
 */
export function resolveSelfHostedPlan(licenseKey?: string): Plan | null {
  if (!licenseKey) return null;
  if (licenseKey.startsWith("litefuse_ee_")) return "self-hosted:enterprise";
  return null;
}
