#!/usr/bin/env node

/**
 * Every `nextly <command>` a scaffolded project's scripts name must be a command
 * the CLI registers.
 *
 * The two sides live in different packages — `create-nextly-app` writes the
 * scripts, `nextly` registers the commands — and nothing compared them. Measured:
 * every project generated until now shipped `db:migrate:reset` calling `nextly
 * migrate:reset`, which the CLI has never registered, so the script failed the
 * first time a user ran it. A unit test in the generator pinned it as expected
 * output, because that test could only see one side.
 *
 * Both sides are DERIVED rather than restated: the commands come from the
 * scaffolded `package.json`, and the verdict comes from asking the real CLI.
 *
 * Usage:
 *   node scripts/check-scaffold-cli-scripts.mjs <scaffolded-dir> <path-to-cli.mjs>
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [projectArg, cliArg] = process.argv.slice(2);

if (!projectArg || !cliArg) {
  console.error(
    "usage: check-scaffold-cli-scripts.mjs <scaffolded-dir> <path-to-cli.mjs>"
  );
  process.exit(1);
}

const projectDir = resolve(projectArg);
const cliPath = resolve(cliArg);

/** Subcommands named by `nextly ...` anywhere in the generated scripts. */
function referencedCommands(scripts) {
  const found = new Set();
  for (const value of Object.values(scripts ?? {})) {
    // Split on `&&` so a chained script like `nextly migrate && next build`
    // contributes its `nextly` half rather than being skipped.
    for (const part of String(value).split("&&")) {
      const match = part.trim().match(/^nextly\s+([a-z][a-z0-9:-]*)/);
      if (match) found.add(match[1]);
    }
  }
  return [...found];
}

const manifestPath = join(projectDir, "package.json");
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
} catch (err) {
  console.error(`Cannot read ${manifestPath}: ${err.message}`);
  process.exit(1);
}

const referenced = referencedCommands(manifest.scripts);

// A positive control on the extraction. Reporting "every command is valid" after
// finding none is the failure this check would otherwise hide, and a broken
// pattern is likelier than a genuinely script-free scaffold.
if (referenced.length === 0) {
  console.error(
    `No 'nextly <command>' scripts found in ${manifestPath}. A scaffolded ` +
      "project has several, so this is a broken extraction rather than a pass."
  );
  process.exit(1);
}

/**
 * Whether the CLI registers this command.
 *
 * `help <cmd>` rather than `<cmd> --help`. Measured: the second exits 0 for an
 * UNKNOWN command, because it falls back to printing the root help — so a check
 * built on it passes for exactly the commands it exists to catch. `help` exits
 * non-zero when the command is not registered.
 */
function isRegistered(command) {
  const result = spawnSync(process.execPath, [cliPath, "help", command], {
    stdio: "ignore",
    // The CLI is only being asked to describe itself, so keep it away from any
    // ambient database configuration that could make it do more than that.
    env: { ...process.env, DATABASE_URL: "", DB_DIALECT: "" },
  });
  return result.status === 0;
}

// A control on the PROBE itself, before its verdicts are worth reading. A CLI
// path that does not run, or a `help` that always fails, would otherwise report
// every command as missing and read as a real finding.
if (!isRegistered("migrate")) {
  console.error(
    `The probe cannot confirm a command that certainly exists ('migrate') via ` +
      `${cliPath}. Build \`nextly\` first; a broken probe must not report ` +
      "missing commands."
  );
  process.exit(1);
}

const missing = referenced.filter(command => !isRegistered(command));

console.log(`scripts reference ${referenced.length} nextly command(s):`);
for (const command of referenced) {
  console.log(
    `  ${missing.includes(command) ? "MISSING" : "ok  "} nextly ${command}`
  );
}

if (missing.length > 0) {
  console.error(
    `\nThe generated scripts name ${missing.length} command(s) the CLI does not ` +
      `register: ${missing.join(", ")}`
  );
  console.error(
    "Either register them, or stop generating the script. A script naming a " +
      "command that does not exist fails only when a user runs it."
  );
  process.exit(1);
}

console.log(`\nAll ${referenced.length} commands are registered by the CLI.`);
