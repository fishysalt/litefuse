// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 对本机 SOCKS5 代理端口直接做握手，逐个目标域名看 CONNECT 的 RFC1928 返回码，
//        用来判断"出网失败"到底是代理没起、被规则拒绝、还是目标不可达。
// 用法 : node probe-vpn-socks.cjs        （可用 VPN_SOCKS_HOST / VPN_PORT 覆盖）
// 计费 : 否 —— 只做 TCP/SOCKS5 握手并立刻断开，不发送任何 API 请求、不带鉴权，
//        因此不会消耗 Jev/DeepSeek 任何额度。
// 依赖 : 本机有一个 SOCKS5 代理在监听（默认 127.0.0.1:12450）。
// ────────────────────────────────────────────────────────────────────────
/**
 * Talks SOCKS5 to a local proxy port to find out exactly why the connection
 * cannot be established, and whether the egress is the expected region.
 *
 * Reply codes (RFC 1928): 0x00 success, 0x01 general failure, 0x02 not allowed
 * by ruleset, 0x03 network unreachable, 0x04 host unreachable,
 * 0x05 connection refused, 0x06 TTL expired, 0x07 command not supported,
 * 0x08 address type not supported.
 *
 *   node probe-vpn-socks.cjs
 *
 * NOTE: the endpoints below are public API hostnames, not internal addresses.
 * If you add internal/VPN addresses here, read them from the environment instead
 * of committing them.
 */
const net = require("net");

// Local proxy endpoint: host and port are both env-overridable, loopback by
// default. No credentials are involved (this probe offers only the no-auth
// SOCKS5 method).
const PROXY = {
  host: process.env.VPN_SOCKS_HOST ?? "127.0.0.1",
  port: Number(process.env.VPN_PORT ?? 12450),
};
const TARGETS = [
  ["api.typesafe.ai", 443],
  ["www.cloudflare.com", 443],
  ["api.deepseek.com", 443],
];

const CODE = {
  0x00: "succeeded",
  0x01: "general SOCKS server failure",
  0x02: "connection not allowed by ruleset",
  0x03: "network unreachable",
  0x04: "host unreachable",
  0x05: "connection refused",
  0x06: "TTL expired",
  0x07: "command not supported",
  0x08: "address type not supported",
};

function socksConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect(PROXY.port, PROXY.host);
    let stage = "greeting";
    const done = (msg) => {
      socket.destroy();
      resolve(msg);
    };
    socket.setTimeout(12000);
    socket.on("timeout", () => done("TIMEOUT"));
    socket.on("error", (e) => done(`socket error ${e.code ?? e.message}`));
    socket.on("connect", () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00])); // ver 5, 1 method, no-auth
    });
    socket.on("data", (buf) => {
      if (stage === "greeting") {
        if (buf[0] !== 0x05) return done(`not SOCKS5 (first byte 0x${buf[0].toString(16)})`);
        if (buf[1] === 0xff) return done("server requires auth (no acceptable method)");
        stage = "reply";
        const hostBuf = Buffer.from(host, "ascii");
        socket.write(
          Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), // CONNECT, domain name
            hostBuf,
            Buffer.from([(port >> 8) & 0xff, port & 0xff]),
          ]),
        );
        return;
      }
      // reply: ver, rep, rsv, atyp, addr..., port
      const rep = buf[1];
      return done(`reply 0x${rep.toString(16).padStart(2, "0")} (${CODE[rep] ?? "unknown"})`);
    });
  });
}

(async () => {
  console.log(`SOCKS5 proxy: ${PROXY.host}:${PROXY.port}`);
  for (const [host, port] of TARGETS) {
    const result = await socksConnect(host, port);
    console.log(`  ${host}:${port} -> ${result}`);
  }
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exitCode = 1;
});
