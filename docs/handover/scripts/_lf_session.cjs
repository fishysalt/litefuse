// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 共享库（不是能直接跑的探测脚本）：NextAuth 凭据登录 + 极简 tRPC 调用器。
// 用法 : 被其它探测脚本 require("./_lf_session.cjs")；可单独 node -e 调用 login/trpc。
// 计费 : 否（只做登录与 tRPC 转发，本身不调用任何 LLM/Jev 接口）。
// 依赖 : Litefuse web 服务需在该地址在跑（默认 http://localhost:3000）。
// 凭据 : 账号密码一律从 LF_PROBE_EMAIL / LF_PROBE_PASSWORD 读，仓库里不留真实值。
// ────────────────────────────────────────────────────────────────────────
/**
 * Shared session helper for the Litefuse probes: NextAuth credentials login and
 * a minimal tRPC caller.
 *
 * The one non-obvious detail: NextAuth requires its csrf COOKIE (not just the
 * token from `GET /api/auth/csrf`) on the credentials POST. Without it the
 * endpoint still answers 200 but sets no session cookie, which looks exactly
 * like a wrong password.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.env.LF_BASE ?? "http://localhost:3000";

/**
 * Demo-account credentials. The password is deliberately NOT stored in this
 * repository (it is public), so it must come from the environment; a missing
 * password is a hard error instead of a silently-working default.
 */
function probeCredentials() {
  const email = process.env.LF_PROBE_EMAIL ?? "jev-demo@litefuse.local";
  const password = process.env.LF_PROBE_PASSWORD;
  if (!password) {
    throw new Error(
      "LF_PROBE_PASSWORD is not set. The demo account password is never stored " +
        "in this repo — export it first, e.g.  export LF_PROBE_PASSWORD='...'",
    );
  }
  return { email, password };
}

async function login({
  email,
  password,
  jarPath = path.join(os.tmpdir(), "lf-probe-cookies.txt"),
} = {}) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfCookies = csrfRes.headers.getSetCookie?.() ?? [];
  const { csrfToken } = await csrfRes.json();

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfCookies.map((cookie) => cookie.split(";")[0]).join("; "),
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: `${BASE}/`,
      json: "true",
    }),
    redirect: "manual",
  });

  const setCookies = res.headers.getSetCookie?.() ?? [];
  const jar = setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
  fs.writeFileSync(jarPath, jar, "utf8");

  const session = await (
    await fetch(`${BASE}/api/auth/session`, { headers: { cookie: jar } })
  ).json();
  if (session?.user?.email !== email) {
    throw new Error(
      `login failed for ${email} (status ${res.status}, cookies: ${setCookies
        .map((cookie) => cookie.split("=")[0])
        .join(", ")})`,
    );
  }
  return jar;
}

async function trpc(path$, { method = "POST", input, cookie } = {}) {
  const url =
    method === "GET"
      ? `${BASE}/api/trpc/${path$}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: input } }))}`
      : `${BASE}/api/trpc/${path$}?batch=1`;
  const res = await fetch(url, {
    method,
    headers: {
      cookie,
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST"
      ? { body: JSON.stringify({ 0: { json: input } }) }
      : {}),
  });
  const text = await res.text();
  const first = JSON.parse(text)[0];
  if (first?.error) {
    throw new Error(
      `${path$} -> ${res.status} ${first.error?.json?.code}: ${first.error?.json?.message}`,
    );
  }
  return first?.result?.data?.json;
}

module.exports = { BASE, login, trpc, probeCredentials };
