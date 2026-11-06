/**
 * The one Tailwind compilation the admin stylesheet is built with: the CLI,
 * run from the package root, on the entry and output given. `build-css.mjs`
 * builds the shipped stylesheet through it, and the source test compiles
 * through it too, so the test reads exactly what the build does.
 */

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** The stylesheet entry, whose `@source` lines decide what is scanned. */
export const STYLES_ENTRY = path.join(PACKAGE_ROOT, "src/styles/globals.css");

/**
 * Compile `input` to `output` with the Tailwind CLI from the package root.
 * `stdio` only says where the CLI's log goes; the compilation is the same.
 */
export function compileTailwind({
  input,
  output,
  minify = false,
  stdio = "inherit",
}) {
  execSync(
    `npx @tailwindcss/cli -i "${input}" -o "${output}"${minify ? " --minify" : ""}`,
    { cwd: PACKAGE_ROOT, stdio }
  );
}
