import { type NextApiRequest, type NextApiResponse } from "next";
import { createSsoConfig } from "@/src/features/enterprise/sso/createSsoConfig";

/**
 * POST /api/auth/add-sso-config —— 创建多租户 SSO 配置。
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await createSsoConfig(req, res);
}
