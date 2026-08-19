// Regenerates AGENTS.measured.md from live measurements, so AGENTS.md can hold
// rules while the numbers those rules cite stay fresh. A quoted figure in a
// hand-written document is stale the day after it is written; a generated file
// carries its own measurement date and the exact command, so a reader can
// re-run rather than trust.
//
// Cheap facts run on every invocation. Facts needing a forced turbo run are
// heavy (minutes of CPU) and run only with --full; without it they are listed
// as not measured in this run, never seeded from memory — an unmeasured row
// must not look like a measured one.
//
// Two properties this file holds deliberately:
// - the command shown in each row is the command that RAN — one
//   implementation of each question, so display and measurement cannot drift;
// - a command's exit status is captured beside its output, never lost to a
//   pipeline, so a failing measurement reads as a failure rather than as a
//   number.
//
//   node scripts/measure-facts.mjs           # cheap facts only
//   node scripts/measure-facts.mjs --full    # also the forced turbo runs

import { spawnSync, execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Measurements are properties of the repository, not of wherever the caller
// happens to stand, so every command runs from the repository root.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const FULL = process.argv.includes("--full");
const STDOUT = process.argv.includes("--stdout");
const onlyArg = process.argv.find(a => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice(7).split(",") : null;
if (ONLY && !STDOUT) {
  process.stderr.write("--only selects a subset, so it writes nowhere: pair it with --stdout\n");
  process.exit(1);
}

// Runs the row's own command and reports output AND status together. spawnSync
// through bash keeps shell syntax available without a pipeline swallowing the
// exit code: the status here is the whole command's, read directly.
function measure(cmd) {
  const r = spawnSync("bash", ["-o", "pipefail", "-c", cmd], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  return { out, status: r.status };
}

// The turbo summary line ("Tasks: N successful, M total") is the number the
// humans quote, so it is the number recorded — with the run's exit status,
// because turbo exits nonzero when tasks fail and that is part of the reading.
function turboRow(cmd) {
  const { out, status } = measure(cmd);
  const m = out.match(/Tasks:\s+(\d+)\s+successful,\s+(\d+)\s+total/);
  return {
    out: m ? `${m[1]} of ${m[2]} successful` : "summary line not found (turbo output format changed?)",
    status,
  };
}

// Heavy rows depend on what is already built: a forced run reads no cache, but
// an existing dist still satisfies the sibling imports the cold numbers are
// about. Recording the dist-state beside the number lets a reader interpret it
// instead of trusting a label the generator never established.
function distState() {
  const pkgs = readdirSync("packages").filter(p => existsSync(`packages/${p}/package.json`));
  const built = pkgs.filter(p => existsSync(`packages/${p}/dist`));
  return `${built.length} of ${pkgs.length} packages have dist/`;
}

const facts = [
  {
    id: "packages",
    what: "packages in the workspace",
    cmd: "ls packages | tr '\\n' ' '",
  },
  {
    id: "pr-scopes",
    what: "PR scopes accepted by the title check (the enforced list; commitlint checks format only, not scope membership)",
    cmd: "sed -n '/scopes: |/,/requireScope/p' .github/workflows/pr-title.yml | sed '1d;$d' | tr -d ' ' | grep . | awk '/^[a-z0-9-]+$/{print;next}{exit 1}' | tr '\\n' ' '",
  },
  {
    id: "engines",
    what: "supported node ranges and the pinned pnpm",
    cmd: `node -e "const p=require('./package.json');console.log(p.engines.node, '·', p.packageManager)"`,
  },
  {
    id: "comment-convention",
    what: "comment-convention baseline (allowlisted pre-existing offences)",
    cmd: "node scripts/check-comment-convention.mjs 2>&1 | tail -1",
  },
  {
    id: "check-types-cold",
    what: "check-types with the turbo cache forced off (read the dist-state line before interpreting)",
    cmd: "pnpm turbo run check-types --continue --force",
    heavy: true,
  },
  {
    id: "lint-cold",
    what: "lint with the turbo cache forced off (read the dist-state line before interpreting)",
    cmd: "pnpm turbo run lint --continue --force",
    heavy: true,
  },
];

// A cheap run keeps the committed file's heavy rows instead of replacing
// them with an unmeasured marker: destroying a measurement is not the same
// act as declining to repeat it. The carried rows keep their own provenance.
function carriedForward(id, cmd) {
  try {
    const prev = readFileSync("AGENTS.measured.md", "utf8");
    const fence = "```";
    const m = prev.match(new RegExp(
      "## " + id + "\\n[\\s\\S]*?\\n" + fence + "\\n(\\$[^\\n]*\\n[\\s\\S]*?)\\n" + fence,
    ));
    if (m && !m[1].includes("not measured in this run")) {
      return m[1].split("\n");
    }
  } catch {
    // fall through: no previous file, nothing to carry
  }
  return [`$ ${cmd}`, "(not measured in this run — heavy; re-run with --full)"];
}

function revision() {
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() ? "-dirty" : "";
    return sha.slice(0, 9) + dirty;
  } catch {
    return "unknown";
  }
}

const REV = revision();
const lines = [
  "<!-- GENERATED by scripts/measure-facts.mjs — do not edit. -->",
  `<!-- Regenerate: node scripts/measure-facts.mjs${FULL ? " --full" : ""} · run at ${new Date().toISOString()} · revision ${REV} -->`,
  "",
  "# Measured facts",
  "",
  "Perishable numbers referenced by AGENTS.md. Every row shows the command that",
  "actually ran and its exit status, so a doubtful reader re-runs instead of",
  "trusting and a failed measurement cannot read as a number. Heavy rows need",
  "`--full`; their meaning depends on the build state recorded beside them.",
  "",
];

let failed = 0;
for (const f of facts) {
  if (ONLY && !ONLY.includes(f.id)) continue;
  lines.push(`## ${f.id}`, "", f.what, "", "```");
  if (f.heavy && !FULL) {
    // The carried block keeps its ORIGINAL command line and revision stamp:
    // a measurement that did not run in this run must not wear this run's
    // badge, or a stale number is indistinguishable from a fresh one.
    lines.push(...carriedForward(f.id, f.cmd));
  } else if (f.heavy) {
    lines.push(`$ ${f.cmd}   # at ${REV}`);
    const { out, status } = turboRow(f.cmd);
    lines.push(`${out}  [exit ${status}]`, `dist-state at measurement: ${distState()}`);
    if (!/of \d+ successful/.test(out)) failed++;
  } else {
    lines.push(`$ ${f.cmd}   # at ${REV}`);
    const { out, status } = measure(f.cmd);
    if (status !== 0) failed++;
    lines.push(status === 0 ? out : `MEASUREMENT FAILED [exit ${status}]: ${out.split("\n").slice(-1)[0]}`);
  }
  lines.push("```", "");
}

if (STDOUT) {
  process.stdout.write(lines.slice(4).join("\n") + "\n");
} else {
  writeFileSync("AGENTS.measured.md", lines.join("\n"));
  process.stdout.write(`AGENTS.measured.md written (${FULL ? "full" : "cheap"} run)\n`);
}
// A run that could not measure something must not exit as though it did.
process.exitCode = failed ? 1 : 0;
