import { env } from "../../env";
import {
  type OutboundUrlValidationWhitelist,
  OutboundUrlValidationError,
  parseOutboundUrl,
  validateOutboundUrlHost,
} from "../outbound-url";

export type LlmBaseUrlValidationWhitelist = OutboundUrlValidationWhitelist;

export function llmBaseUrlWhitelistFromEnv(): LlmBaseUrlValidationWhitelist {
  if (env.NEXT_PUBLIC_LITEFUSE_CLOUD_REGION) {
    return {
      hosts: [],
      ips: [],
      ip_ranges: [],
    };
  }

  // Upstream's env schema declares these three as string[] (it pre-splits on
  // commas); this repo reads them raw, so split here.
  const splitList = (raw: string | undefined): string[] =>
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  return {
    hosts: splitList(process.env.LITEFUSE_LLM_CONNECTION_WHITELISTED_HOST),
    ips: splitList(process.env.LITEFUSE_LLM_CONNECTION_WHITELISTED_IPS),
    ip_ranges: splitList(
      process.env.LITEFUSE_LLM_CONNECTION_WHITELISTED_IP_SEGMENTS,
    ),
  };
}

export async function validateLlmConnectionBaseURL(
  urlString: string,
  whitelist: LlmBaseUrlValidationWhitelist = llmBaseUrlWhitelistFromEnv(),
): Promise<void> {
  const effectiveWhitelist = env.NEXT_PUBLIC_LITEFUSE_CLOUD_REGION
    ? {
        hosts: [],
        ips: [],
        ip_ranges: [],
      }
    : whitelist;

  const url = parseOutboundUrl(urlString);

  if (!["https:", "http:"].includes(url.protocol)) {
    throw new OutboundUrlValidationError(
      "protocol-not-allowed",
      "Only HTTP and HTTPS protocols are allowed",
    );
  }

  await validateOutboundUrlHost({
    url,
    whitelist: effectiveWhitelist,
    logContext: "LLM base URL",
    // Existing LLM validation accepts public IP literals after CIDR checks so
    // custom gateways are not forced through DNS at write time.
    shouldSkipDnsCheckForLiteralIps: true,
  });

  if (env.NEXT_PUBLIC_LITEFUSE_CLOUD_REGION && url.protocol !== "https:") {
    throw new OutboundUrlValidationError(
      "https-required",
      "Only HTTPS base URLs are allowed on Langfuse Cloud",
    );
  }
}
