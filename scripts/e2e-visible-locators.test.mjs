// Under Cache Components, Next.js keeps a visited page mounted but hidden, so
// the document can hold a hidden copy of the page the browser suite is on. A
// locator that finds an element by its id matches the hidden copy's element as
// readily as the visible one's. Text, label, test-id and placeholder locators
// taken from `page` find visible elements only, through the page the suite's
// own `test` hands every spec (`tests/support/test.ts`), and a role locator
// leaves hidden elements out unless asked; an id locator does neither, unless
// it says `:visible`.
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

/** A page's locators that the suite holds to visible elements. */
const VISIBLE_ONLY =
  /^(\w*[pP]age)\.(getByText|getByLabel|getByTestId|getByPlaceholder)\(/;

/**
 * Each assertion in a source that something is absent, made on one of a
 * page's visible-only locators: `toHaveCount(0)` or `not.toBeAttached()`. Those
 * prove something was never rendered, so they must see hidden elements too,
 * through `includingHidden(page)`; on a visible-only locator a hidden element
 * the page should never have held would pass them. The subject is read
 * directly, or through a name the file binds to such a locator
 * (`const banner = () => page.getByTestId(...)`). `toBeHidden` is not
 * weighed: a visible-only locator gives it the answer it should.
 */
export function absenceOnVisibleOnlyPage(source) {
  const bound = new Set(
    [
      ...source.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*(?:\(\s*\)\s*=>\s*)?(\w*[pP]age\.(?:getByText|getByLabel|getByTestId|getByPlaceholder)\()/g
      ),
    ].map(([, name]) => name)
  );
  const found = [];
  for (const match of source.matchAll(/\bexpect\(/g)) {
    const from = match.index + match[0].length;
    let depth = 1;
    let quote = null;
    let i = from;
    for (; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i += 1;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(" || c === "[" || c === "{") depth += 1;
      else if (c === ")" || c === "]" || c === "}") depth -= 1;
    }
    const subject = source.slice(from, i - 1).trim();
    const name = /^(\w+)(?:\(\s*\))?$/.exec(subject)?.[1];
    if (!VISIBLE_ONLY.test(subject) && !(name && bound.has(name))) continue;
    const assertion =
      /^\s*\.(toHaveCount\(\s*0\s*\)|not\s*\.\s*toBeAttached\()/.exec(
        source.slice(i)
      );
    if (assertion)
      found.push(
        `${subject.split("(")[0]} ${assertion[1].replace(/\s+/g, "")}`
      );
  }
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

  it("assert absence only where a hidden element would be seen too", () => {
    const found = browserSuiteFiles().flatMap(file =>
      absenceOnVisibleOnlyPage(readFileSync(path.join(ROOT, file), "utf8")).map(
        assertion => `${file}: ${assertion}`
      )
    );
    expect(found).toEqual([]);
  });

  it("tell an absence on a visible-only locator from one that sees hidden elements", () => {
    expect(
      absenceOnVisibleOnlyPage(
        'await expect(page.getByText("secret")).toHaveCount(0);'
      )
    ).toEqual(["page.getByText toHaveCount(0)"]);
    expect(
      absenceOnVisibleOnlyPage(
        'await expect(\n  otherPage.getByTestId("x")\n).not.toBeAttached();'
      )
    ).toEqual(["otherPage.getByTestId not.toBeAttached("]);
    expect(
      absenceOnVisibleOnlyPage(
        'const banner = () => page.getByTestId("b");\nawait expect(banner()).toHaveCount(0);'
      )
    ).toEqual(["banner toHaveCount(0)"]);
    expect(
      absenceOnVisibleOnlyPage(
        'await expect(includingHidden(page).getByText("secret")).toHaveCount(0);'
      )
    ).toEqual([]);
    expect(
      absenceOnVisibleOnlyPage(
        'await expect(page.getByText("x")).toHaveCount(1);\nawait expect(page.getByText("y")).toBeHidden();\nawait expect(dialog.getByText("z")).toHaveCount(0);'
      )
    ).toEqual([]);
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
