// Under Cache Components, Next.js keeps a visited page mounted but hidden, so
// the document can hold a hidden copy of the page the browser suite is on. A
// locator that finds an element by its id matches the hidden copy's element as
// readily as the visible one's. Role, label and text locators skip hidden
// elements; an id locator does only when it says `:visible`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Each id-based lookup in a source that could match a hidden copy. */
export function hiddenCopyLookups(source) {
  const found = [];
  for (const [, , selector] of source.matchAll(
    /\.locator\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g
  )) {
    // An attribute's value can hold a `#` (`a[href="#top"]`) without naming an
    // id, so ids are looked for outside the brackets, and `[id=` inside them.
    const byId =
      /\[id[\^$*~|]?=/.test(selector) ||
      /#[A-Za-z_]/.test(selector.replace(/\[[^\]]*\]/g, ""));
    if (byId && !/:visible/.test(selector)) found.push(`locator(${selector})`);
  }
  for (const [call] of source.matchAll(
    /getElementById\(|querySelector(?:All)?\(\s*["'`]#/g
  ))
    found.push(call);
  return found;
}

/** The browser suite's own source files, as git tracks them. */
function browserSuiteFiles() {
  return execFileSync("git", ["ls-files", "e2e"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(file => /\.(ts|tsx|mts)$/.test(file));
}

describe("the browser suite's locators", () => {
  it("find no element by id that a hidden copy of the page could hold", () => {
    const files = browserSuiteFiles();
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap(file =>
      hiddenCopyLookups(readFileSync(path.join(ROOT, file), "utf8")).map(
        lookup => `${file}: ${lookup}`
      )
    );
    expect(found).toEqual([]);
  });

  it("tell an id lookup from a visible-only one and from other locators", () => {
    expect(hiddenCopyLookups('page.locator("#main-content")')).toHaveLength(1);
    expect(hiddenCopyLookups("page.locator('[id=\"pane\"]')")).toHaveLength(1);
    expect(
      hiddenCopyLookups(
        "page.locator(`[id=\"${await d.getAttribute('aria-controls')}\"]`)"
      )
    ).toHaveLength(1);
    expect(
      hiddenCopyLookups('el => document.getElementById("x")')
    ).toHaveLength(1);
    expect(hiddenCopyLookups('page.locator("#main-content:visible")')).toEqual(
      []
    );
    expect(
      hiddenCopyLookups('page.getByRole("button", { name: "Save" })')
    ).toEqual([]);
    expect(hiddenCopyLookups("page.locator(\"a[href='#top']\")")).toEqual([]);
    expect(hiddenCopyLookups('page.locator("th#name")')).toHaveLength(1);
    expect(hiddenCopyLookups("page.locator('[id^=\"editor-\"]')")).toHaveLength(
      1
    );
  });
});
