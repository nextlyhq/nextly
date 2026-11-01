#!/usr/bin/env node
// `tsc` with as many type-checking workers as this machine should run.
//
// TypeScript 7 checks a program in parallel (`--checkers`, default 4), and
// four of them peak at 5.5 GB on nextly alone, which an 8 GB laptop cannot
// spare. So every `check-types` runs the compiler through this, and the number
// comes from `local-limits.mjs`, which sizes every other heavy gate here:
// 4 on a 16 GB machine, 2 on a 12 GB one, 1 on an 8 GB one or when the workers
// are held to one. `compile()` in `tsc-cli.mjs`, which tests use, is given the
// same number through the same `checkerArgs`.
// `scripts/check-types-checkers.test.mjs` holds every package to it.
//
//   node scripts/tsc.mjs <tsc arguments>
import { spawnSync } from "node:child_process";

import { localLimits } from "./local-limits.mjs";
import { checkerArgs, killedMessage, tscEntry } from "./tsc-cli.mjs";

const limits = localLimits();
const result = spawnSync(
  process.execPath,
  [tscEntry(), ...checkerArgs(limits), ...process.argv.slice(2)],
  { stdio: "inherit" }
);
if (result.error) throw result.error;
// A compiler the kernel stopped for memory prints nothing; said as a kill, so
// the pre-push's "the typecheck is red" is not read as a type error.
if (result.signal) console.error(killedMessage(result.signal, limits.checkers));
process.exitCode = result.status ?? 1;
