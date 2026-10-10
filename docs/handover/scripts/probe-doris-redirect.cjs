// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 回答 Doris 写入路径的两个环境问题：FE 对 stream-load PUT 返回的 Location 是什么、
//        以及那个 Location 从本机是否可达（这正是需要 BE 重定向代理/垫片的原因）。
// 用法 : node probe-doris-redirect.cjs
// 计费 : 否 —— PUT 不带 body / 不带数据，不会写入任何行；也不调用 LLM/Jev。
// 依赖 : Doris FE 的 HTTP 端口在跑（默认 127.0.0.1:8030）。
// ────────────────────────────────────────────────────────────────────────
/**
 * Answers two environment questions for the Doris write path:
 *   1. What Location does the FE return for a stream-load PUT?
 *   2. Is that Location reachable from THIS host (the reason the manual's proxy
 *      exists)?
 *
 * The PUT carries no body and no rows, so nothing is written.
 *
 *   node probe-doris-redirect.cjs
 */
const net = require("net");
const http = require("http");

const FE = process.env.DORIS_FE_HTTP_URL ?? "http://localhost:8030";
const DB = process.env.DORIS_DB ?? "litefuse";
const TABLE = process.env.PROBE_TABLE ?? "scores";
// FE credentials are never hardcoded: local dev defaults to root / empty password.
const DORIS_USER = process.env.DORIS_USER ?? "root";
const DORIS_PASSWORD = process.env.DORIS_PASSWORD ?? "";

/** Node's http client can set `Expect: 100-continue`, which the FE requires
 * before it will answer a stream-load PUT with the 307 pointing at a BE. */
function feProbe(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(FE);
    const req = http.request(
      {
        host: url.hostname,
        port: Number(url.port || 80),
        method: "PUT",
        path,
        headers: {
          authorization:
            "Basic " +
            Buffer.from(`${DORIS_USER}:${DORIS_PASSWORD}`).toString("base64"),
          "content-type": "application/json",
          "content-length": "0",
          expect: "100-continue",
          label: `probe-noredirect-${Date.now()}`,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const result = await feProbe(`/api/${DB}/${TABLE}/_stream_load`);
  console.log(`FE probe: ${result.status}`);
  console.log(`location: ${result.location ?? "(none)"}`);
  console.log(`body: ${result.body.slice(0, 200)}`);
  if (!result.location) return;

  const target = new URL(result.location);
  await new Promise((resolve) => {
    const socket = net.connect(
      { host: target.hostname, port: Number(target.port || 80) },
      () => {
        console.log(`\n${target.hostname}:${target.port} -> REACHABLE`);
        socket.destroy();
        resolve();
      },
    );
    socket.setTimeout(4000);
    socket.on("timeout", () => {
      console.log(`\n${target.hostname}:${target.port} -> TIMEOUT (unreachable)`);
      socket.destroy();
      resolve();
    });
    socket.on("error", (error) => {
      console.log(`\n${target.hostname}:${target.port} -> ERROR ${error.code}`);
      resolve();
    });
  });
})().catch((error) => {
  console.error("FAILED:", error.message);
  process.exitCode = 1;
});
