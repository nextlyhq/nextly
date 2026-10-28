// Under Cache Components, Next.js keeps a visited page mounted but hidden, so
// the document can hold a hidden copy of the page the browser suite is on. A
// locator that finds an element by its id matches the hidden copy's element as
// readily as the visible one's, and so do text, label, test-id and placeholder
// locators. A role locator does not: it leaves out what is hidden unless it
// asks for `includeHidden`. A locator chained under a visible one cannot reach
// a hidden copy, so only those taken from `page` itself are weighed.
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
/**
 * Each page-level text, label, test-id or placeholder locator in a source that
 * is not filtered to visible elements, by method name.
 */
export function hiddenMatchingPageLocators(source) {
  const found = [];
  const call = /\bpage\.(getByText|getByLabel|getByTestId|getByPlaceholder)\(/g;
  for (const match of source.matchAll(call)) {
    // The call's own closing parenthesis, by depth, outside its strings.
    let depth = 1;
    let quote = null;
    let i = match.index + match[0].length;
    for (; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i += 1;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
    }
    const after = source.slice(i).trimStart();
    if (!/^\.filter\(\s*\{\s*visible:\s*true\s*\}\s*\)/.test(after))
      found.push(match[1]);
  }
  return found;
}

/**
 * The page-level locators written before the browser suite ran with Cache
 * Components on, by file. Each count is exact and may only go down: a new
 * locator adds `.filter({ visible: true })` instead, and a file whose
 * locators are filtered lowers or drops its line.
 */
const UNFILTERED_BEFORE_CACHE_COMPONENTS = {
  "e2e/tests/api-key-form.spec.ts": 4,
  "e2e/tests/api-playground-metrics.spec.ts": 2,
  "e2e/tests/autosave-recovery.spec.ts": 5,
  "e2e/tests/blocks-page.spec.ts": 1,
  "e2e/tests/builder-field-gates.spec.ts": 1,
  "e2e/tests/builder-language.spec.ts": 1,
  "e2e/tests/builder-lock.spec.ts": 3,
  "e2e/tests/builder-screen.spec.ts": 1,
  "e2e/tests/canvas/editor-acceptance.spec.ts": 2,
  "e2e/tests/canvas/preview-container.spec.ts": 12,
  "e2e/tests/dashboard-arrangement.spec.ts": 2,
  "e2e/tests/dashboard-breakdown.spec.ts": 1,
  "e2e/tests/dashboard-card-settings.spec.ts": 3,
  "e2e/tests/dashboard-card-tiers.spec.ts": 1,
  "e2e/tests/dashboard-chart-reach.spec.ts": 1,
  "e2e/tests/dashboard-content-widgets.spec.ts": 3,
  "e2e/tests/dashboard-count.spec.ts": 1,
  "e2e/tests/dashboard-customise.spec.ts": 13,
  "e2e/tests/dashboard-grid.spec.ts": 4,
  "e2e/tests/dashboard-needs-attention.spec.ts": 1,
  "e2e/tests/dashboard-note.spec.ts": 2,
  "e2e/tests/dashboard-reads.spec.ts": 1,
  "e2e/tests/dashboard-recently-edited.spec.ts": 1,
  "e2e/tests/dashboard-slow-card.spec.ts": 1,
  "e2e/tests/dashboard-summary-cards.spec.ts": 1,
  "e2e/tests/email-design.spec.ts": 3,
  "e2e/tests/email-hub-read-only.spec.ts": 1,
  "e2e/tests/email-workbench.spec.ts": 8,
  "e2e/tests/entry-list-editor.spec.ts": 1,
  "e2e/tests/entry-opens-read-only-two-roles.spec.ts": 1,
  "e2e/tests/entry-opens-read-only.spec.ts": 1,
  "e2e/tests/entry-read-only-in-one-language.spec.ts": 2,
  "e2e/tests/form-builder.spec.ts": 7,
  "e2e/tests/history-compare-changes.spec.ts": 5,
  "e2e/tests/history-story-list.spec.ts": 1,
  "e2e/tests/media-upload.spec.ts": 4,
  "e2e/tests/plugin-admin-styling.spec.ts": 1,
  "e2e/tests/plugin-blocks.spec.ts": 1,
  "e2e/tests/plugin-page-routing.spec.ts": 2,
  "e2e/tests/plugin-text-widget.spec.ts": 1,
  "e2e/tests/plugin-widget-kit.spec.ts": 16,
  "e2e/tests/production/component-map.spec.ts": 1,
  "e2e/tests/production/first-admin-setup.spec.ts": 6,
  "e2e/tests/refused-delete-says-why.spec.ts": 2,
  "e2e/tests/releases-list.spec.ts": 2,
  "e2e/tests/restricted-related-item-in-field-groups.spec.ts": 2,
  "e2e/tests/restricted-related-item.spec.ts": 3,
  "e2e/tests/schema-builder.spec.ts": 4,
  "e2e/tests/setup-refused-origin.spec.ts": 5,
  "e2e/tests/share-preview-links.spec.ts": 2,
  "e2e/tests/shell/driver.ts": 2,
  "e2e/tests/shell/shell.spec.ts": 17,
  "e2e/tests/submissions.spec.ts": 1,
  "e2e/tests/user-fields.spec.ts": 2,
};

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

  it("hold their unfiltered page-level locators to the counts written before Cache Components", () => {
    const counts = {};
    for (const file of browserSuiteFiles()) {
      const found = hiddenMatchingPageLocators(
        readFileSync(path.join(ROOT, file), "utf8")
      );
      if (found.length > 0) counts[file] = found.length;
    }
    expect(counts).toEqual(UNFILTERED_BEFORE_CACHE_COMPONENTS);
  });

  it("tell an unfiltered page-level locator from a filtered or chained one", () => {
    expect(hiddenMatchingPageLocators('page.getByText("Saved")')).toEqual([
      "getByText",
    ]);
    expect(
      hiddenMatchingPageLocators('page.getByTestId("a(b)").first()')
    ).toEqual(["getByTestId"]);
    expect(
      hiddenMatchingPageLocators(
        'page.getByLabel("Title").filter({ visible: true })'
      )
    ).toEqual([]);
    expect(hiddenMatchingPageLocators('dialog.getByText("Saved")')).toEqual([]);
    expect(
      hiddenMatchingPageLocators('page.getByRole("button", { name: "Save" })')
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
