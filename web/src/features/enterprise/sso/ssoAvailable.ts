import { env } from "@/src/env.mjs";

/**
 * 多租户 SSO 是否可用：仅在 Cloud 部署（设置了 region）时启用。
 * 自托管部署下为 false，不加载自定义 SSO 配置。
 */
export const isMultiTenantSsoAvailable = Boolean(
  env.NEXT_PUBLIC_LITEFUSE_CLOUD_REGION,
);
