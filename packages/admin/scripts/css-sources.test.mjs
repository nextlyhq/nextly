/**
 * The admin stylesheet is generated from the admin's source code alone.
 *
 * Tailwind reads class-shaped words from every file it scans, prose included.
 * With automatic detection the admin's build scanned the whole package: a
 * Markdown note quoting an arbitrary class with an elided value (`[var(...)]`)
 * became invalid CSS, and every admin route answered 500 with an error naming
 * `globals.css`. This compiles `globals.css` through the build's own helper,
 * with a probe beside the package's notes and one inside `src`, and requires
 * the first to be ignored and the second to be read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  compileTailwind,
  PACKAGE_ROOT,
  STYLES_ENTRY,
} from "./compile-tailwind.mjs";

// Widths no admin file uses, so finding one in the output can only mean its
// probe was read.
const OUTSIDE_SRC = "w-[17.0625px]";
const INSIDE_SRC = "w-[18.0625px]";
const notes = path.join(PACKAGE_ROOT, `css-sources-probe-${process.pid}.md`);
const source = path.join(
  PACKAGE_ROOT,
  "src",
  `css-sources-probe-${process.pid}.txt`
);
const created = [];
let outDir = "";
let css = "";

beforeAll(() => {
  // Created only where nothing is: a path left by an interrupted run fails
  // the test rather than being overwritten, and only what this run made is
  // removed after it.
  fs.writeFileSync(
    notes,
    `A note quoting max-w-[var(...)] and ${OUTSIDE_SRC} as prose.\n`,
    { flag: "wx" }
  );
  created.push(notes);
  fs.writeFileSync(source, `${INSIDE_SRC}\n`, { flag: "wx" });
  created.push(source);

  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "nx-css-sources-"));
  const out = path.join(outDir, "out.css");
  // The build's own compilation, so what is scanned here is what ships.
  compileTailwind({ input: STYLES_ENTRY, output: out, stdio: "pipe" });
  css = fs.readFileSync(out, "utf-8");
}, 60_000);

afterAll(() => {
  for (const file of created) fs.rmSync(file, { force: true });
  if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
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
