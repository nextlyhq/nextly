#!/usr/bin/env node
/**
 * Lint Report — runs ESLint across every workspace package, writes a
 * markdown inventory per package to findings/lint-cleanup/, and prints
 * a summary table.
 *
 * Usage:
 *   pnpm lint:report              # all packages
 *   pnpm lint:report nextly admin # specific packages
 *
 * The per-package inventory files are the source of truth for the
 * alpha-lint-cleanup effort (see findings/lint-cleanup/README.md).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const reportDir = resolve(repoRoot, "findings/lint-cleanup");

// Full list of published workspace packages that have a lint script.
// Keep this in sync with workspaces in pnpm-workspace.yaml.
const ALL_PACKAGES = [
  "adapter-drizzle",
  "adapter-postgres",
  "adapter-sqlite",
  "adapter-mysql",
  "client",
  "ui",
  "storage-s3",
  "storage-uploadthing",
  "storage-vercel-blob",
  "telemetry",
  "create-nextly-app",
  "plugin-form-builder",
  "nextly",
  "admin",
];

const args = process.argv.slice(2);
const packages = args.length > 0 ? args : ALL_PACKAGES;

mkdirSync(reportDir, { recursive: true });

const byPackage = {};
const today = new Date().toISOString().slice(0, 10);

for (const pkg of packages) {
  const pkgDir = resolve(repoRoot, "packages", pkg);
  if (!existsSync(pkgDir)) {
    console.warn(`[skip] packages/${pkg} does not exist`);
    continue;
  }

  process.stdout.write(`Linting packages/${pkg} ... `);
  let resultJson;
  try {
    // eslint exits non-zero when there are problems; capture stdout regardless.
    resultJson = execSync(`npx eslint . --format=json`, {
      cwd: pkgDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
    resultJson = err.stdout?.toString() ?? "[]";
  }

  let results;
  try {
    results = JSON.parse(resultJson);
  } catch {
    console.log(`FAILED to parse eslint output`);
    continue;
  }

  const errorCount = results.reduce((s, f) => s + f.errorCount, 0);
  const warningCount = results.reduce((s, f) => s + f.warningCount, 0);

  byPackage[pkg] = { errorCount, warningCount, results };

  console.log(`errors=${errorCount} warnings=${warningCount}`);

  // Write per-package inventory
  writePackageReport(pkg, errorCount, warningCount, results);
}

// Write summary
writeSummary(byPackage);

function writePackageReport(pkg, errorCount, warningCount, results) {
  let out = `# ${pkg} lint inventory\n\n`;
  out += `**Status:** ${errorCount} errors, ${warningCount} warnings\n`;
  out += `**Generated:** ${today}\n\n`;

  if (errorCount === 0 && warningCount === 0) {
    out += "✅ Clean.\n";
    writeFileSync(resolve(reportDir, `${pkg}.md`), out);
    return;
  }

  // By rule
  const byRule = {};
  results.forEach((f) =>
    f.messages.forEach((m) => {
      const k = (m.severity === 2 ? "E" : "W") + ":" + (m.ruleId ?? "parse");
      byRule[k] = (byRule[k] ?? 0) + 1;
    }),
  );

  out += "## By rule\n\n| Count | Severity | Rule |\n|---:|---|---|\n";
  Object.entries(byRule)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, c]) => {
      const sev = k.startsWith("E:") ? "error" : "warn";
      const rule = k.substring(2);
      out += `| ${c} | ${sev} | \`${rule}\` |\n`;
    });

  // By file
  const filesWithIssues = results
    .filter((f) => f.errorCount || f.warningCount)
    .sort(
      (a, b) =>
        b.errorCount * 10 + b.warningCount - (a.errorCount * 10 + a.warningCount),
    );

  out += "\n## By file (hottest first)\n\n| Errors | Warnings | File |\n|---:|---:|---|\n";
  filesWithIssues.forEach((f) => {
    const rel = f.filePath.replace(/.*packages\//, "packages/");
    out += `| ${f.errorCount} | ${f.warningCount} | \`${rel}\` |\n`;
  });

  // Detailed per-file issues
  out += "\n## Details per file\n\n";
  filesWithIssues.forEach((f) => {
    const rel = f.filePath.replace(/.*packages\//, "packages/");
    out += `### ${rel}\n\n`;
    f.messages.forEach((m) => {
      const sev = m.severity === 2 ? "error" : "warn";
      out += `- L${m.line}:${m.column} [${sev}] \`${m.ruleId ?? "parse"}\`: ${m.message}\n`;
    });
    out += "\n";
  });

  writeFileSync(resolve(reportDir, `${pkg}.md`), out);
}

function writeSummary(byPackage) {
  const entries = Object.entries(byPackage).sort((a, b) => {
    const aTotal = a[1].errorCount + a[1].warningCount;
    const bTotal = b[1].errorCount + b[1].warningCount;
    return bTotal - aTotal;
  });

  let totalErr = 0;
  let totalWarn = 0;

  console.log("\n=== Summary ===");
  for (const [pkg, { errorCount, warningCount }] of entries) {
    totalErr += errorCount;
    totalWarn += warningCount;
    console.log(
      `${pkg.padEnd(22)} errors=${String(errorCount).padStart(5)} warnings=${String(warningCount).padStart(5)}`,
    );
  }
  console.log(
    `${"TOTAL".padEnd(22)} errors=${String(totalErr).padStart(5)} warnings=${String(totalWarn).padStart(5)}`,
  );
  console.log(`\nPer-package reports written to: ${reportDir}/`);

  // Aggregate rules across all packages for the README
  const byRuleGlobal = {};
  for (const [, { results }] of entries) {
    results.forEach((f) =>
      f.messages.forEach((m) => {
        const k = (m.severity === 2 ? "E" : "W") + ":" + (m.ruleId ?? "parse");
        byRuleGlobal[k] = (byRuleGlobal[k] ?? 0) + 1;
      }),
    );
  }

  // Only rewrite the README if we linted everything; otherwise we'd stomp partial data.
  if (Object.keys(byPackage).length === ALL_PACKAGES.length) {
    writeReadme(entries, byRuleGlobal, totalErr, totalWarn);
  }
}

function writeReadme(entries, byRuleGlobal, totalErr, totalWarn) {
  let out = "# Lint Cleanup Inventory\n\n";
  out += `Generated ${today} via \`pnpm lint:report\`.\n\n`;
  out += "## Totals\n\n";
  out += `**${totalErr} errors + ${totalWarn} warnings = ${totalErr + totalWarn} total issues.**\n\n`;

  const clean = entries.filter(
    ([, s]) => s.errorCount === 0 && s.warningCount === 0,
  );
  if (clean.length > 0) {
    out += `Clean packages: ${clean.map(([p]) => `\`${p}\``).join(", ")}.\n\n`;
  }

  out += "## Per-package\n\n";
  out += "| Package | Errors | Warnings | Report |\n| --- | ---: | ---: | --- |\n";
  for (const [pkg, { errorCount, warningCount }] of entries) {
    if (errorCount === 0 && warningCount === 0) continue;
    out += `| ${pkg} | ${errorCount} | ${warningCount} | [${pkg}.md](${pkg}.md) |\n`;
  }

  out += "\n## Top rules across all packages\n\n";
  out += "| Count | Severity | Rule |\n| ---: | --- | --- |\n";
  Object.entries(byRuleGlobal)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .forEach(([k, c]) => {
      const sev = k.startsWith("E:") ? "error" : "warn";
      const rule = k.substring(2);
      out += `| ${c} | ${sev} | \`${rule}\` |\n`;
    });

  out += "\n## Excluded from lint (by design)\n\n";
  out += "- Test files (`**/*.{test,spec}.{ts,tsx,js,jsx}`, `**/__tests__/**`, `**/__mocks__/**`) — quality enforced by vitest\n";
  out += "- Config files (`tsup.config.*`, `next.config.*`, `vitest.config.*`, `eslint.config.*`, `postcss.config.*`, `tailwind.config.*`, `drizzle.config.*`, `rollup.*.config.*`) — hand-maintained\n";
  out += "- Build scripts + CLI binaries (`**/scripts/**`, `**/bin/**`, `**/run-*.{ts,js,mjs}`) — dev tooling\n";
  out += "- `packages/eslint-config/**` — shared config package's own source\n";
  out += "- `packages/create-nextly-app/templates/**` — end-user scaffolding\n";
  out += "- Build artifacts (`dist/**`, `.turbo/**`, `node_modules/**`, `**/*.d.ts`)\n";

  out += "\n## How to re-generate this\n\n";
  out += "```bash\n";
  out += "pnpm lint:report                 # all packages, rewrites this README\n";
  out += "pnpm lint:report nextly admin    # just these two packages (README not touched)\n";
  out += "```\n";

  writeFileSync(resolve(reportDir, "README.md"), out);
  console.log(
    `Summary README written to: ${resolve(reportDir, "README.md")}`,
  );
}

// Also load the previous README (if any) just so we can note if anything's been cleared
try {
  const prev = readFileSync(resolve(reportDir, "README.md"), "utf8");
  if (prev.length > 0) {
    // no-op — just confirming the file read works
  }
} catch {
  // no previous report, fine
}
