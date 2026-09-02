import { env } from "@/src/env.mjs";

/**
 * Whether multi-tenant SSO is available: enabled only on Cloud deployments (region is set).
 * False on self-hosted deployments, where custom SSO configs are not loaded.
 */
export const isMultiTenantSsoAvailable = Boolean(
  env.NEXT_PUBLIC_LITEFUSE_CLOUD_REGION,
);
