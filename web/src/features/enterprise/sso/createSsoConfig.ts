import { prisma } from "@langfuse/shared/src/db";
import { encrypt } from "@langfuse/shared/encryption";
import { type NextApiRequest, type NextApiResponse } from "next";
import { env } from "@/src/env.mjs";
import { logger } from "@langfuse/shared/src/server";
import { AdminApiAuthService } from "@/src/server/adminApiAuth";
import { isMultiTenantSsoAvailable } from "@/src/features/enterprise/sso/ssoAvailable";
import { ssoProviderSchema } from "@/src/features/enterprise/sso/ssoConfigSchema";

/**
 * Create a multi-tenant SSO config (POST /api/auth/add-sso-config).
 * Cloud deployments only; authenticated via ADMIN_API_KEY, and clientSecret is encrypted before storage.
 */
export async function createSsoConfig(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (!isMultiTenantSsoAvailable) {
      res
        .status(403)
        .json({ error: "Multi-tenant SSO is not available on your instance" });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    if (!env.ADMIN_API_KEY) {
      res.status(500).json({ error: "ADMIN_API_KEY is not set" });
      return;
    }

    if (!env.ENCRYPTION_KEY) {
      res.status(500).json({ error: "ENCRYPTION_KEY is not set" });
      return;
    }

    if (
      !AdminApiAuthService.handleAdminAuth(req, res, {
        isAllowedOnLangfuseCloud: true,
      })
    ) {
      return;
    }

    const body = ssoProviderSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error });
      return;
    }

    const { domain, authProvider, authConfig } = body.data;

    // Duplicate check: only one SSO config is allowed per domain
    const existingConfig = await prisma.ssoConfig.findUnique({
      where: { domain },
    });
    if (existingConfig) {
      logger.info(
        `Attempt to create duplicate SSO configuration for domain: ${domain}`,
      );
      res.status(409).json({
        error: `An SSO configuration already exists for domain '${domain}'`,
      });
      return;
    }

    const encryptedClientSecret = authConfig
      ? { ...authConfig, clientSecret: encrypt(authConfig.clientSecret) }
      : undefined;

    await prisma.ssoConfig.create({
      data: {
        domain,
        authProvider,
        authConfig: encryptedClientSecret,
      },
    });

    res.status(201).json({ message: "SSO configuration created successfully" });
  } catch (e) {
    logger.error("Failed to create SSO configuration", e);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
