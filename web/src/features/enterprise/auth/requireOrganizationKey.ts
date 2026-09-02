import { prisma } from "@langfuse/shared/src/db";
import { redis, type ApiAccessScope } from "@langfuse/shared/src/server";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { type NextApiRequest, type NextApiResponse } from "next";

/**
 * Organization-level key auth middleware (SCIM-style endpoints; no entitlement check).
 *
 * Only two checks:
 *   1. Parse and verify the key from Basic Auth → 401 on failure
 *   2. Must be an organization-level key (accessLevel === "organization") → otherwise 403
 *
 * Returns the scope on success; on failure the response has already been written and null is returned.
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
