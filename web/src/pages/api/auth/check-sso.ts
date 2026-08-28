/**
 * 检查给定域名是否配置了自定义 SSO provider。
 * 无配置或 SSO 不可用时返回 404。
 */
import { resolveSsoProviderIdForDomain } from "@/src/features/enterprise/sso/ssoProviders";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod/v4";

const requestSchema = z.object({
  domain: z.string().min(1),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const validBody = requestSchema.safeParse(req.body);
  if (!validBody.success) {
    return res.status(400).json({ message: "Invalid request body" });
  }

  const providerId = await resolveSsoProviderIdForDomain(validBody.data.domain);

  if (!providerId) {
    return res.status(404).json({ message: "No SSO provider configured" });
  }

  return res.status(200).json({ providerId });
}
