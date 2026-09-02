import { type NextApiRequest, type NextApiResponse } from "next";
import { createSsoConfig } from "@/src/features/enterprise/sso/createSsoConfig";

/**
 * POST /api/auth/add-sso-config — create a multi-tenant SSO config.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await createSsoConfig(req, res);
}
