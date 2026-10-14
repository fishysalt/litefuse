import { type Provider } from "next-auth/providers/index";
import { logger, traceException } from "@langfuse/shared/src/server";

import { isMultiTenantSsoAvailable } from "@/src/features/auth/sso/isMultiTenantSsoAvailable";

/**
 * Community-edition-facing gateway to the Enterprise (paid) multi-tenant SSO
 * implementation.
 *
 * LICENSE-EE scopes the enterprise license to the paths in ANNEX A. The NextAuth
 * configuration and the sign-in page are plain community code, so they must not
 * import anything from there at module scope — otherwise a free deployment loads
 * licensed code just to render a login form. Routing those call sites through
 * this gateway keeps the community bundle free of enterprise modules: the EE
 * module is pulled in with a *dynamic* import, and only when the instance
 * actually holds an Enterprise license.
 *
 * Every function mirrors the signature and the disabled-license return value of
 * its enterprise counterpart, so call sites do not change shape:
 *   buildSsoProviders()                -> []      (enterprise: [] without license)
 *   hasSsoConfig()                     -> false
 *   resolveSsoProviderIdForDomain()    -> null
 *   resolveMultiTenantSsoConfig()      -> { isMultiTenantSsoProvider: false, domain: null }
 */

type EnterpriseSsoModule =
  typeof import("@/src/features/enterprise/sso/ssoProviders");

let modulePromise: Promise<EnterpriseSsoModule | null> | null = null;

/**
 * Load the enterprise SSO module, or null when the instance is not licensed.
 *
 * The promise is cached so the dynamic import happens at most once per process.
 * A failed import is treated like an unlicensed instance: SSO is an optional
 * feature and must never take the whole auth configuration down with it.
 */
function loadEnterpriseSso(): Promise<EnterpriseSsoModule | null> {
  if (!isMultiTenantSsoAvailable) return Promise.resolve(null);

  modulePromise ??= import("@/src/features/enterprise/sso/ssoProviders").catch(
    (error) => {
      logger.error("Failed to load the enterprise SSO implementation", error);
      traceException(error);
      return null;
    },
  );

  return modulePromise;
}

export async function buildSsoProviders(): Promise<Provider[]> {
  const enterpriseSso = await loadEnterpriseSso();
  return enterpriseSso ? enterpriseSso.buildSsoProviders() : [];
}

export async function hasSsoConfig(): Promise<boolean> {
  const enterpriseSso = await loadEnterpriseSso();
  return enterpriseSso ? enterpriseSso.hasSsoConfig() : false;
}

export async function resolveSsoProviderIdForDomain(
  domain: string,
): Promise<string | null> {
  const enterpriseSso = await loadEnterpriseSso();
  return enterpriseSso
    ? enterpriseSso.resolveSsoProviderIdForDomain(domain)
    : null;
}

export async function resolveMultiTenantSsoConfig({
  providerId,
}: {
  providerId: string;
}): Promise<
  | { isMultiTenantSsoProvider: true; domain: string }
  | { isMultiTenantSsoProvider: false; domain: null }
> {
  const enterpriseSso = await loadEnterpriseSso();
  return enterpriseSso
    ? enterpriseSso.resolveMultiTenantSsoConfig({ providerId })
    : { isMultiTenantSsoProvider: false, domain: null };
}
