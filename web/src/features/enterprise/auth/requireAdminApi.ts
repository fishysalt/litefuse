import { prisma } from "@langfuse/shared/src/db";
import { redis, type ApiAccessScope } from "@langfuse/shared/src/server";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { type NextApiRequest, type NextApiResponse } from "next";

/**
 * Auth middleware for organization admin API endpoints (admin-api).
 *
 * Runs three checks in order:
 *   1. Parse and verify the key from Basic Auth → 401 on failure
 *   2. Must be an organization-level key (accessLevel === "organization") → otherwise 403
 *   3. The organization's plan must include the admin-api entitlement → otherwise 403
 *
 * On success returns the scope (with orgId / plan), which business functions use to filter resource ownership (prevents cross-organization access).
 * If any check fails, this function has already written the response and returns null; the caller can simply return.
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
