/**
 * A wrapper that runs its child SYNCHRONOUSLY, mirroring the CLI's own shape.
 *
 * The synchronous call is the point: it is what makes the wrapper unable to
 * pass a signal on, so a kill aimed at this process alone leaves the child
 * below it running.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

execFileSync(
  process.execPath,
  [path.join(here, "nested-child.mjs"), ...process.argv.slice(2)],
  { stdio: "inherit" }
);
