/**
 * The admin stylesheet is generated from the admin's source code alone.
 *
 * Tailwind reads class-shaped words from every file it scans, prose included.
 * With automatic detection the admin's build scanned the whole package: a
 * Markdown note quoting an arbitrary class with an elided value (`[var(...)]`)
 * became invalid CSS, and every admin route answered 500 with an error naming
 * `globals.css`. This compiles `globals.css` exactly as `build-css.mjs` does,
 * with a probe beside the package's notes and one inside `src`, and requires
 * the first to be ignored and the second to be read.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Widths no admin file uses, so finding one in the output can only mean its
// probe was read.
const OUTSIDE_SRC = "w-[17.0625px]";
const INSIDE_SRC = "w-[18.0625px]";
const notes = path.join(ROOT, `css-sources-probe-${process.pid}.md`);
const source = path.join(ROOT, "src", `css-sources-probe-${process.pid}.txt`);
let css = "";

beforeAll(() => {
  fs.writeFileSync(
    notes,
    `A note quoting max-w-[var(...)] and ${OUTSIDE_SRC} as prose.\n`
  );
  fs.writeFileSync(source, `${INSIDE_SRC}\n`);

  const require = createRequire(import.meta.url);
  const twPkg = require.resolve("@tailwindcss/cli/package.json");
  const twBin = JSON.parse(fs.readFileSync(twPkg, "utf-8")).bin;
  const twCli = path.resolve(
    path.dirname(twPkg),
    typeof twBin === "string" ? twBin : twBin.tailwindcss
  );
  const out = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "nx-css-sources-")),
    "out.css"
  );
  // The build's own entry and working directory, which decide what is scanned.
  execFileSync(
    process.execPath,
    [twCli, "-i", path.join(ROOT, "src/styles/globals.css"), "-o", out],
    { cwd: ROOT, stdio: "pipe" }
  );
  css = fs.readFileSync(out, "utf-8");
}, 60_000);

afterAll(() => {
  fs.rmSync(notes, { force: true });
  fs.rmSync(source, { force: true });
});

describe("what the admin stylesheet is generated from", () => {
  it("reads the admin's source code", () => {
    expect(css).toContain("18.0625px");
  });

  it("ignores files outside it, such as the package's notes", () => {
    expect(css).not.toContain("17.0625px");
    expect(css).not.toContain("var(...)");
  });
});
