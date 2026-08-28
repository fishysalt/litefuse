import { prisma } from "@langfuse/shared/src/db";
import { redis, type ApiAccessScope } from "@langfuse/shared/src/server";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { type NextApiRequest, type NextApiResponse } from "next";

/**
 * 组织管理 API 鉴权中间件（admin-api 类端点）。
 *
 * 依次通过三道关卡：
 *   1. Basic Auth 解析并校验 key → 失败 401
 *   2. 必须是组织级 key（accessLevel === "organization"）→ 否则 403
 *   3. 组织的 plan 必须含 admin-api entitlement → 否则 403
 *
 * 全部通过后返回 scope（含 orgId / plan），业务函数用它做资源归属过滤（防跨组织）。
 * 任一关卡失败时，本函数已写入响应并返回 null，调用方直接 return 即可。
 */
export async function requireAdminApi(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<ApiAccessScope | null> {
  const auth = await new ApiAuthService(
    prisma,
    redis,
  ).verifyAuthHeaderAndReturnScope(req.headers.authorization);

  if (!auth.validKey) {
    res.status(401).json({ error: auth.error });
    return null;
  }

  if (auth.scope.accessLevel !== "organization" || !auth.scope.orgId) {
    res.status(403).json({
      error:
        "Invalid API key. Organization-scoped API key required for this operation.",
    });
    return null;
  }

  if (
    !hasEntitlementBasedOnPlan({
      plan: auth.scope.plan,
      entitlement: "admin-api",
    })
  ) {
    res.status(403).json({
      error: "This feature is not available on your current plan.",
    });
    return null;
  }

  return auth.scope;
}
