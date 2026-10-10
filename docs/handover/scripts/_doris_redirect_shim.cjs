// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 挡在 Doris FE 前面的本地开发垫片：只把 307 重定向里的 Location 主机改写成本机
//        发布出来的 BE 端口，让 stream load 的第二跳能从宿主机打通。
// 用法 : node _doris_redirect_shim.cjs   （默认监听 127.0.0.1:8031 -> 上游 FE 8030）
//        然后把应用的 DORIS_FE_HTTP_URL 指向 http://127.0.0.1:8031
// 计费 : 否 —— 只改写 HTTP 响应头并转发，不调用任何 LLM/Jev 接口。
// 依赖 : 上游 Doris FE HTTP（默认 8030）与 BE HTTP（默认 8040）都在跑。
// ────────────────────────────────────────────────────────────────────────
/**
 * Local-only dev shim for Windows + Docker Desktop.
 *
 * Litefuse web/worker run on the host, Doris FE+BE run in Docker. A Doris stream
 * load does: empty-body PUT to FE -> FE answers 307 with a Location pointing at
 * the BE's container-internal IP (e.g. http://<be-container-ip>:8040/...)
 * -> client PUTs the body there. A host with no route to the Docker bridge
 * subnet cannot reach that second leg, so it times out (ETIMEDOUT).
 *
 * This shim sits in front of the FE and rewrites only the Location authority to
 * the host-published BE port (127.0.0.1:8040). On Linux/WSL, where container IPs
 * are routable, it is unnecessary — which is the case on macOS/Docker Desktop
 * for Linux containers too, so check reachability before enabling it.
 *
 *   DORIS_FE_HTTP_URL=http://127.0.0.1:8031   (FE HTTP 8030 -> this shim)
 *   DORIS_FE_QUERY_PORT=9030                  (FE MySQL, used directly)
 */

const http = require("node:http");

const LISTEN_HOST = process.env.SHIM_LISTEN_HOST || "127.0.0.1";
const LISTEN_PORT = Number(process.env.SHIM_PORT || 8031);
const UPSTREAM_HOST = process.env.SHIM_UPSTREAM_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.SHIM_UPSTREAM_PORT || 8030);
// Host-published BE HTTP port: reachable from the host, unlike the BE's
// container IP that the FE puts into the redirect.
const BE_REWRITE_TARGET = process.env.SHIM_BE_TARGET || "127.0.0.1:8040";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function rewriteLocation(value) {
  return String(value).replace(
    /^(https?:\/\/)(?:[^@/]*@)?([^/]+)/,
    (_m, scheme, _authority) => `${scheme}${BE_REWRITE_TARGET}`,
  );
}

const server = http.createServer((req, res) => {
  const headers = { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` };
  for (const key of Object.keys(headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) delete headers[key];
  }

  const upstream = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers,
    },
    (upRes) => {
      const outHeaders = {};
      for (const [key, value] of Object.entries(upRes.headers)) {
        if (HOP_BY_HOP.has(key.toLowerCase())) continue;
        outHeaders[key] =
          key.toLowerCase() === "location" ? rewriteLocation(value) : value;
      }
      if (upRes.headers.location) {
        console.log(
          `[shim] ${req.method} ${req.url} -> ${upRes.statusCode} location ${upRes.headers.location} => ${outHeaders.location}`,
        );
      } else {
        console.log(`[shim] ${req.method} ${req.url} -> ${upRes.statusCode}`);
      }
      res.writeHead(upRes.statusCode, outHeaders);
      upRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    console.error(`[shim] upstream error for ${req.method} ${req.url}:`, err.message);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `shim upstream error: ${err.message}` }));
  });

  req.pipe(upstream);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[shim] listening on http://${LISTEN_HOST}:${LISTEN_PORT} -> http://${UPSTREAM_HOST}:${UPSTREAM_PORT}, redirect authority rewritten to ${BE_REWRITE_TARGET}`,
  );
});
