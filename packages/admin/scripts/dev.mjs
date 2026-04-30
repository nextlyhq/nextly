#!/usr/bin/env node

/**
 * Admin dev orchestrator.
 *
 * Runs `tsup --watch` (JS/TS bundling) and `build-css-watch.mjs`
 * (Tailwind compile + .adminapp scoping post-process) as parallel
 * children of a single Node process, so admin's package.json can expose
 * one command (`dev`) that Turborepo runs alongside the playground's
 * `next dev` and admin contributors can invoke directly without juggling
 * two terminals.
 *
 * stdio is inherited so log output from both children is interleaved
 * into the single dev terminal. SIGINT/SIGTERM are forwarded to children
 * — important when Turborepo or the user kills the process tree.
 *
 * If either child exits non-zero, the orchestrator brings down its
 * sibling and exits with the same code, so a Tailwind config error
 * doesn't leave a half-functional dev loop running silently.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// `shell: true` lets npm workspaces resolve `tsup` cross-platform
// (npx is a `.cmd` shim on Windows). The command is a single static
// string with no interpolated input, which is the form Node's
// child_process docs recommend when `shell: true` is needed —
// avoids the DEP0190 deprecation that fires when args are passed
// separately under shell: true.
const children = [
  {
    name: "tsup",
    proc: spawn("npx tsup --watch", {
      cwd: rootDir,
      stdio: "inherit",
      shell: true,
    }),
  },
  {
    name: "css-watch",
    proc: spawn(process.execPath, [path.join(__dirname, "build-css-watch.mjs")], {
      cwd: rootDir,
      stdio: "inherit",
    }),
  },
];

let shuttingDown = false;
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { proc } of children) {
    if (!proc.killed && proc.exitCode === null) {
      proc.kill(signal);
    }
  }
  // Give children a brief moment to clean up; then exit.
  setTimeout(() => process.exit(exitCode), 200);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

children.forEach(({ name, proc }) => {
  proc.on("exit", code => {
    if (shuttingDown) return;
    if (code !== 0 && code !== null) {
      console.error(
        `[admin:dev] ${name} exited with code ${code}; shutting down siblings`
      );
      shutdown("SIGTERM", code);
    }
  });
});
