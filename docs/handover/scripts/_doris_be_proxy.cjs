// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 把 Doris FE 307 重定向里的 BE「容器内网地址」重写成本机能连上的地址，
//        使 stream load / 写入类操作可用；同时兼作普通正向代理（含 CONNECT 隧道）。
// 用法 : node _doris_be_proxy.cjs   （默认监听 127.0.0.1:8899）
// 计费 : 否 —— 只转发 HTTP/TCP，不调用任何 LLM/Jev 接口。
// 依赖 : 本机 Doris BE 的 HTTP 端口（默认 8040）已在跑；需要 worker 侧 HTTP_PROXY 指过来。
// ────────────────────────────────────────────────────────────────────────
/**
 * Forward proxy that makes Doris stream loads work from a host that cannot
 * reach the BE's container-internal address.
 *
 * Why it exists: the Doris FE answers a stream-load PUT with
 * `307 Location: http://root:@<be-container-ip>:8040/api/...` — the BE's
 * *container* IP, which the host cannot reach (`TIMEOUT`). The BE's real port is
 * published on the loopback address, so this proxy rewrites that authority on
 * both sides:
 *
 *   * absolute-form request targets (`PUT http://<be-container-ip>:8040/...`)
 *     are re-pointed at the reachable host/port, and
 *   * `location` response headers are rewritten the same way, so a client that
 *     follows the redirect itself also lands on a reachable address.
 *
 * Everything else is a plain forward proxy, including CONNECT tunnelling so
 * HTTPS calls (LLM providers) keep working when the worker runs with
 * `HTTP_PROXY=http://127.0.0.1:8899`.
 *
 *   node _doris_be_proxy.cjs       (listens on 8899)
 */
const http = require("http");
const net = require("net");

const PORT = Number(process.env.PROXY_PORT ?? 8899);
const BE_PORT = Number(process.env.DORIS_BE_HTTP_PORT ?? 8040);
const BE_REACHABLE_HOST = process.env.DORIS_BE_REACHABLE_HOST ?? "127.0.0.1";

/** Rewrites `<any-host>:8040` to the host-published BE address. */
function rewriteAuthority(value) {
  if (typeof value !== "string") return value;
  return value.replace(
    /(https?:\/\/)([^@/\s]*@)?([^@/\s:]+):(\d+)/g,
    (match, scheme, credentials, host, port) => {
      if (Number(port) !== BE_PORT) return match;
      if (host === BE_REACHABLE_HOST) return match;
      return `${scheme}${credentials ?? ""}${BE_REACHABLE_HOST}:${BE_PORT}`;
    },
  );
}

function targetOf(req) {
  // Absolute-form (what a proxied client sends) vs. origin-form with Host.
  if (/^https?:\/\//i.test(req.url)) {
    const url = new URL(rewriteAuthority(req.url));
    return {
      host: url.hostname,
      port: Number(url.port || 80),
      path: `${url.pathname}${url.search}`,
    };
  }
  const hostHeader = req.headers.host ?? "";
  const [host, port] = hostHeader.split(":");
  return { host, port: Number(port || 80), path: req.url };
}

const server = http.createServer((req, res) => {
  const target = targetOf(req);
  const original = req.url;
  const upstream = http.request(
    {
      host: target.host,
      port: target.port,
      method: req.method,
      path: target.path,
      headers: { ...req.headers, host: `${target.host}:${target.port}` },
    },
    (upstreamRes) => {
      const headers = { ...upstreamRes.headers };
      if (headers.location) headers.location = rewriteAuthority(headers.location);
      const rewrote =
        headers.location && headers.location !== upstreamRes.headers.location;
      console.log(
        `${req.method} ${original} -> ${target.host}:${target.port} ${upstreamRes.statusCode}${rewrote ? " (location rewritten)" : ""}`,
      );
      res.writeHead(upstreamRes.statusCode ?? 502, headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    console.log(
      `${req.method} ${original} -> ${target.host}:${target.port} ERROR ${error.code ?? error.message}`,
    );
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`proxy error: ${error.code ?? error.message}`);
  });

  req.pipe(upstream);
});

// HTTPS through the proxy (LLM API calls) is a plain TCP tunnel.
server.on("connect", (req, clientSocket, head) => {
  const [host, port] = (req.url ?? "").split(":");
  const upstream = net.connect(Number(port || 443), host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `doris BE redirect proxy on http://127.0.0.1:${PORT} (rewrites *:${BE_PORT} -> ${BE_REACHABLE_HOST}:${BE_PORT})`,
  );
});
