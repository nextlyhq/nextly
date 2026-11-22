import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

/**
 * The composed stylesheet the other style tests read is only as complete as
 * the index's imports and the helper's reading of them. These hold both: a
 * partial the index forgot would build nothing and be checked by nothing, and
 * a reading that skipped an import would let every "this rule is absent"
 * assertion pass on missing text.
 */

const STYLES_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX = "builder-chrome.css";

const readDisk = (url: string): string =>
  readFileSync(fileURLToPath(url), "utf8");

/** A reader over named texts, by the file name at the end of each URL. */
function fakeFiles(files: Record<string, string>): (url: string) => string {
  return url => {
    const name = url.slice(url.lastIndexOf("/") + 1);
    const text = files[name];
    if (text === undefined) throw new Error(`no such file: ${name}`);
    return text;
  };
}

describe("the chrome stylesheet's index", () => {
  const index = readFileSync(join(STYLES_DIR, INDEX), "utf8");
  const imported = [...index.matchAll(/^@import "\.\/([^"]+)";$/gm)].map(
    match => match[1]!
  );

  it("imports every partial beside it exactly once", () => {
    const partials = readdirSync(STYLES_DIR)
      .filter(name => name.endsWith(".css") && name !== INDEX)
      .sort();
    expect(partials.length).toBeGreaterThan(0);
    expect([...imported].sort()).toEqual(partials);
  });

  it("composes to every partial's text, in the order it imports them", () => {
    const composed = chromeStylesheetSource(readDisk);
    let from = 0;
    for (const name of imported) {
      const text = readFileSync(join(STYLES_DIR, name), "utf8").replace(
        /\n$/,
        ""
      );
      const at = composed.indexOf(text, from);
      expect(at, name).toBeGreaterThanOrEqual(from);
      from = at + text.length;
    }
    expect(composed).not.toMatch(/^@import "\.\//m);
  });
});

describe("chromeStylesheetSource", () => {
  it("puts each partial where it is imported, following nested imports", () => {
    const read = fakeFiles({
      [INDEX]: 'top\n@import "./a.css";\n\n@import "./b.css";\nend\n',
      "a.css": 'a1\n@import "./c.css";\na2\n',
      "b.css": "b\n",
      "c.css": "c\n",
    });
    expect(chromeStylesheetSource(read)).toBe("top\na1\nc\na2\n\nb\nend\n");
  });

  it("leaves a package's import and a quoted one in a comment alone", () => {
    const read = fakeFiles({
      [INDEX]:
        '@import "tailwindcss/utilities.css" layer(utilities);\n/* @import "tailwindcss"; */\n',
    });
    expect(chromeStylesheetSource(read)).toBe(
      '@import "tailwindcss/utilities.css" layer(utilities);\n/* @import "tailwindcss"; */\n'
    );
  });

  it.each([
    ["single quotes", "@import './a.css';"],
    ["url()", '@import url("./a.css");'],
    ["a layer after it", '@import "./a.css" layer(base);'],
    ["indentation", '  @import "./a.css";'],
    ["a parent folder", '@import "../a.css";'],
  ])("refuses a relative import written with %s", (_form, rule) => {
    const read = fakeFiles({ [INDEX]: `${rule}\n`, "a.css": "a\n" });
    expect(() => chromeStylesheetSource(read)).toThrow(
      /still imports a relative path at line 1/
    );
  });
});
