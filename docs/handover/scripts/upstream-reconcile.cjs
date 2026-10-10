// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 把这次改造涉及的几个文件，与上游 langfuse main 的最新版本逐文件做 diff，
//        打印精简差异，回答"上游现在多了什么、我们要不要跟"。
// 用法 : LF_UPSTREAM_CLONE=/path/to/langfuse-latest node upstream-reconcile.cjs
// 计费 : 否 —— 只从 GitHub 下载源码文本，不调用任何 LLM/Jev 接口。
// 依赖 : 需要 curl 可用 + 能访问 raw.githubusercontent.com；本地需有一份上游 clone。
// ────────────────────────────────────────────────────────────────────────
/**
 * Reconciles the areas this migration touched against the NEWEST upstream
 * (GitHub main), by fetching main's version of each file and diffing it against
 * the local upstream clone (which is what the v2 UI tree was copied from).
 *
 * Prints a compact per-file diff so "what is new upstream" is visible without
 * pulling whole files into the transcript.
 *
 *   node upstream-reconcile.cjs
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Local clone of the upstream repo. No absolute path is baked in: set
// LF_UPSTREAM_CLONE, or keep a `langfuse-latest` clone next to the repo.
const CLONE =
  process.env.LF_UPSTREAM_CLONE ??
  path.resolve(__dirname, "..", "..", "..", "..", "langfuse-latest");
const TMP = process.env.LF_TMP_DIR ?? os.tmpdir();

const FILES = [
  "packages/shared/src/server/llm/types.ts",
  "web/src/features/llm-api-key/components/TypeSafeUpstreamCards/TypeSafeUpstreamCards.tsx",
  "web/src/features/events/server/eventsRouter.ts",
  "web/src/features/events/server/eventsService.ts",
  "web/src/components/table/peek/hooks/usePeekNavigation.ts",
  "packages/shared/src/features/evals/observationForEval.ts",
  "packages/shared/src/server/queues.ts",
];

const RAW = "https://raw.githubusercontent.com/langfuse/langfuse/main/";

for (const rel of FILES) {
  const localPath = path.join(CLONE, rel);
  const tmpPath = path.join(TMP, "lf-main-" + rel.replace(/[\\/]/g, "_"));
  process.stdout.write(`\n=== ${rel} ===\n`);
  try {
    execFileSync("curl", ["-sS", "-L", "--max-time", "60", RAW + rel, "-o", tmpPath], {
      stdio: "pipe",
    });
  } catch (e) {
    console.log(`  fetch failed: ${e.message.slice(0, 120)}`);
    continue;
  }
  if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size < 50) {
    console.log("  fetch produced no content (file may have moved)");
    continue;
  }
  if (!fs.existsSync(localPath)) {
    console.log(`  local clone has no such file: ${localPath}`);
    continue;
  }
  const norm = (p) =>
    fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n").split("\n");
  const mainLines = norm(tmpPath);
  const cloneLines = norm(localPath);
  console.log(`  clone ${cloneLines.length} lines | main ${mainLines.length} lines`);

  const mainSet = new Set(mainLines);
  const cloneSet = new Set(cloneLines);
  const onlyMain = mainLines.filter((l) => l.trim() && !cloneSet.has(l));
  const onlyClone = cloneLines.filter((l) => l.trim() && !mainSet.has(l));
  console.log(`  added upstream (not in our clone): ${onlyMain.length} | removed/changed: ${onlyClone.length}`);
  const interesting = onlyMain.filter((l) =>
    /custom|resolve|TypeSafe|UPSTREAM|isRoot|root|tool_call|ioChar|includeToolCall|peek|reader|error|filter/i.test(l),
  );
  const show = (interesting.length ? interesting : onlyMain).slice(0, 14);
  for (const line of show) console.log(`    + ${line.trim().slice(0, 150)}`);
}
