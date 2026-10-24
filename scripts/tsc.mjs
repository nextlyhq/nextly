#!/usr/bin/env node
// `tsc` with as many type-checking workers as this machine should run.
//
// TypeScript 7 checks a program in parallel (`--checkers`, default 4), and
// four of them peak at 5.5 GB on nextly alone, which an 8 GB laptop cannot
// spare. So every `check-types` runs the compiler through this, and the number
// comes from `local-limits.mjs`, which sizes every other heavy gate here:
// 4 on a 16 GB machine, 2 below that, 1 when the workers are held to one.
// `scripts/check-types-checkers.test.mjs` holds every package to it.
//
//   node scripts/tsc.mjs <tsc arguments>
import { spawnSync } from "node:child_process";

import { localLimits } from "./local-limits.mjs";
import { tscEntry } from "./tsc-cli.mjs";

const result = spawnSync(
  process.execPath,
  [
    tscEntry(),
    "--checkers",
    String(localLimits().checkers),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
