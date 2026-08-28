import { prisma } from "@langfuse/shared/src/db";
import { redis, type ApiAccessScope } from "@langfuse/shared/src/server";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { type NextApiRequest, type NextApiResponse } from "next";

/**
 * 组织级 key 鉴权中间件（SCIM 类端点，不检查 entitlement）。
 *
 * 只走两道关卡：
 *   1. Basic Auth 解析并校验 key → 失败 401
 *   2. 必须是组织级 key（accessLevel === "organization"）→ 否则 403
 *
 * 通过后返回 scope；失败时已写入响应并返回 null。
 */
export async function requireOrganizationKey(
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

  return auth.scope;
}
