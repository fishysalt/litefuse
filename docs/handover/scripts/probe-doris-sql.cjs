// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 用 MySQL 协议直接读 Doris（FE 查询端口默认 9030），验证 trace/score 行是否真的落库。
// 用法 : node probe-doris-sql.cjs "<sql>" ["<sql>" ...]
// 计费 : 否 —— 只读数据库，不调用任何 LLM/Jev 接口。
// 依赖 : Doris FE 的 MySQL 端口在跑（默认 127.0.0.1:9030）；LF_REPO 指向仓库根。
// ────────────────────────────────────────────────────────────────────────
/**
 * Reads Doris over the MySQL protocol (FE query port 9030).
 *
 * The HTTP `/api/query/<db>` path answers 405 on this Doris build, which made
 * earlier probes report false negatives ("trace not visible", "no score").
 *
 *   node probe-doris-sql.cjs "<sql>" ["<sql>" ...]
 */
const path = require("path");

// Repo root: defaults to three levels up from this file
// (<repo>/docs/handover/scripts -> <repo>), override with LF_REPO on any machine.
const REPO = process.env.LF_REPO ?? path.resolve(__dirname, "..", "..", "..");
const mysql = require(
  path.join(REPO, "packages", "shared", "node_modules", "mysql2", "promise"),
);

const DORIS = {
  host: process.env.DORIS_MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.DORIS_QUERY_PORT ?? 9030),
  user: process.env.DORIS_USER ?? "root",
  password: process.env.DORIS_PASSWORD ?? "",
  database: process.env.DORIS_DB ?? "litefuse",
};

async function main() {
  const statements = process.argv.slice(2);
  if (!statements.length) throw new Error("pass at least one SQL statement");

  const connection = await mysql.createConnection({
    host: DORIS.host,
    port: DORIS.port,
    user: DORIS.user,
    password: DORIS.password,
    database: DORIS.database,
    multipleStatements: false,
  });

  for (const sql of statements) {
    try {
      const [rows] = await connection.query(sql);
      console.log(`\n$ ${sql}`);
      console.log(JSON.stringify(rows, null, 2).slice(0, 2000));
    } catch (error) {
      console.log(`\n$ ${sql}\nERROR: ${error.message}`);
    }
  }
  await connection.end();
}

main().catch((error) => {
  console.error("FAILED:", error.message);
  process.exitCode = 1;
});
