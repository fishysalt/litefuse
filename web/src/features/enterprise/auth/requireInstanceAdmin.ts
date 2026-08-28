import { type NextApiRequest, type NextApiResponse } from "next";
import { AdminApiAuthService } from "@/src/server/adminApiAuth";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { resolveSelfHostedPlan } from "@/src/features/enterprise/plan/resolvePlan";

/**
 * Instance 管理鉴权中间件（admin 端点，与 public 的 requireAdminApi 不同）。
 *
 * 两道关卡：
 *   1. Bearer ADMIN_API_KEY 校验（AdminApiAuthService）→ 失败 401/403
 *   2. 实例级 plan 门控（self-hosted license 解析出的 plan 含 admin-api）→ 否则 403
 *
 * 通过返回 true；失败已写入响应并返回 false。
 */
export function requireInstanceAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
): boolean {
  if (!AdminApiAuthService.handleAdminAuth(req, res)) {
    return false;
  }

  const instancePlan = resolveSelfHostedPlan(
    process.env.LITEFUSE_EE_LICENSE_KEY,
  );

  if (
    !hasEntitlementBasedOnPlan({
      plan: instancePlan,
      entitlement: "admin-api",
    })
  ) {
    res.status(403).json({
      error: "This feature is not available on your current plan.",
    });
    return false;
  }

  return true;
}
