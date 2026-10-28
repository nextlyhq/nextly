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
 * is not filtered to visible elements, named by its method and its first
 * argument as written, whitespace collapsed: `getByText("Saved")`.
 */
export function hiddenMatchingPageLocators(source) {
  const found = [];
  const call = /\bpage\.(getByText|getByLabel|getByTestId|getByPlaceholder)\(/g;
  for (const match of source.matchAll(call)) {
    // The call's own closing parenthesis, and the end of its first argument,
    // by depth, outside its strings.
    const from = match.index + match[0].length;
    let depth = 1;
    let quote = null;
    let firstEnd = -1;
    let i = from;
    for (; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i += 1;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      // A regular expression as the first argument, read as a string is, so
      // a comma or bracket inside it is not taken for the source's own.
      else if (c === "/" && source.slice(from, i).trim() === "") quote = c;
      else if (c === "(" || c === "[" || c === "{") depth += 1;
      else if (c === ")" || c === "]" || c === "}") depth -= 1;
      else if (c === "," && depth === 1 && firstEnd === -1) firstEnd = i;
    }
    const argument = source
      .slice(from, firstEnd === -1 ? i - 1 : firstEnd)
      .replace(/\s+/g, " ")
      .trim();
    const after = source.slice(i).trimStart();
    if (!/^\.filter\(\s*\{\s*visible:\s*true\s*\}\s*\)/.test(after))
      found.push(`${match[1]}(${argument})`);
  }
  return found;
}

/**
 * The page-level locators written before the browser suite ran with Cache
 * Components on, each by its file, method and first argument. The list is
 * exact and may only shrink: a new or changed locator adds
 * `.filter({ visible: true })` instead, and one filtered or removed leaves the
 * list with it, so one cannot be swapped for another under an unchanged count.
 */
const UNFILTERED_BEFORE_CACHE_COMPONENTS = [
  'e2e/tests/api-key-form.spec.ts: getByTestId("api-key-summary")',
  'e2e/tests/api-key-form.spec.ts: getByText("Choose a role to see what this key will be able to do.")',
  "e2e/tests/api-key-form.spec.ts: getByText(/It follows your permissions/)",
  "e2e/tests/api-key-form.spec.ts: getByText(/when they change, this key's change with them/)",
  'e2e/tests/api-playground-metrics.spec.ts: getByTestId("response-meta")',
  'e2e/tests/api-playground-metrics.spec.ts: getByTestId("response-toolbar")',
  "e2e/tests/autosave-recovery.spec.ts: getByText(/unsaved changes from/i)",
  "e2e/tests/autosave-recovery.spec.ts: getByText(/unsaved changes from/i)",
  "e2e/tests/autosave-recovery.spec.ts: getByText(/unsaved changes from/i)",
  "e2e/tests/autosave-recovery.spec.ts: getByText(/unsaved changes from/i)",
  "e2e/tests/autosave-recovery.spec.ts: getByText(/unsaved changes from/i)",
  "e2e/tests/blocks-page.spec.ts: getByText(LEAD_PARAGRAPH)",
  "e2e/tests/builder-field-gates.spec.ts: getByText(/read-only/)",
  'e2e/tests/builder-language.spec.ts: getByText("Opens the default language, the one the Page Builder edits.")',
  'e2e/tests/builder-lock.spec.ts: getByText("Someone is waiting to edit this document.")',
  "e2e/tests/builder-lock.spec.ts: getByText(/is editing this document/)",
  "e2e/tests/builder-lock.spec.ts: getByText(/took over this document\\. Your unsaved changes are still here/)",
  "e2e/tests/builder-screen.spec.ts: getByText(/You have unsaved changes from/)",
  'e2e/tests/canvas/editor-acceptance.spec.ts: getByLabel("Text")',
  'e2e/tests/canvas/editor-acceptance.spec.ts: getByLabel("Text")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("go-base")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("go-base")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("go-cramped")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("go-cramped")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("go-narrow")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("go-narrow")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("go-overflow")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("go-wide")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("measured")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("measured")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("measured")',
  'e2e/tests/canvas/preview-container.spec.ts: getByTestId("measured")',
  'e2e/tests/dashboard-arrangement.spec.ts: getByTestId("dashboard-edit-begin")',
  'e2e/tests/dashboard-arrangement.spec.ts: getByTestId("dashboard-edit-begin")',
  "e2e/tests/dashboard-breakdown.spec.ts: getByTestId(`widget-cell-${CARD}`)",
  'e2e/tests/dashboard-card-settings.spec.ts: getByTestId("dashboard-edit-begin")',
  'e2e/tests/dashboard-card-settings.spec.ts: getByTestId("widget-grid-live")',
  "e2e/tests/dashboard-card-settings.spec.ts: getByTestId(`widget-cell-${CARD}`)",
  "e2e/tests/dashboard-card-tiers.spec.ts: getByTestId(`widget-cell-${widgetId}`)",
  "e2e/tests/dashboard-chart-reach.spec.ts: getByTestId(`widget-cell-${id}`)",
  'e2e/tests/dashboard-content-widgets.spec.ts: getByTestId("widget-cell-core/over-time")',
  'e2e/tests/dashboard-content-widgets.spec.ts: getByTestId("widget-cell-core/recent-entries")',
  'e2e/tests/dashboard-content-widgets.spec.ts: getByTestId("widget-grid-live")',
  "e2e/tests/dashboard-count.spec.ts: getByTestId(`widget-cell-${CARD}`)",
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("card-height-menu")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("card-width-menu")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("card-width-menu")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("card-width-menu")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("dashboard-edit-begin")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("dashboard-edit-begin")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("dashboard-edit-begin")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("widget-drag-chip")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("widget-drag-handle")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("widget-drop-line")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("widget-drop-line")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("widget-drop-line")',
  'e2e/tests/dashboard-customise.spec.ts: getByTestId("widget-grid-live")',
  'e2e/tests/dashboard-grid.spec.ts: getByTestId("card-height-menu")',
  'e2e/tests/dashboard-grid.spec.ts: getByTestId("card-width-menu")',
  'e2e/tests/dashboard-grid.spec.ts: getByTestId("dashboard-edit-begin")',
  "e2e/tests/dashboard-grid.spec.ts: getByTestId(`widget-cell-${GET_STARTED}`)",
  "e2e/tests/dashboard-needs-attention.spec.ts: getByTestId(`widget-cell-${CARD}`)",
  "e2e/tests/dashboard-note.spec.ts: getByTestId(`widget-cell-${CARD}`)",
  "e2e/tests/dashboard-note.spec.ts: getByTestId(`widget-cell-${CARD}`)",
  'e2e/tests/dashboard-reads.spec.ts: getByTestId("dashboard-container")',
  "e2e/tests/dashboard-recently-edited.spec.ts: getByTestId(`widget-cell-${CARD}`)",
  "e2e/tests/dashboard-slow-card.spec.ts: getByTestId(`widget-cell-${SLOW_CARD}`)",
  "e2e/tests/dashboard-summary-cards.spec.ts: getByTestId(`widget-cell-${id}`)",
  'e2e/tests/email-design.spec.ts: getByLabel("Accent colour")',
  'e2e/tests/email-design.spec.ts: getByLabel("Accent colour")',
  'e2e/tests/email-design.spec.ts: getByText("Unsaved")',
  'e2e/tests/email-hub-read-only.spec.ts: getByText("Welcome")',
  'e2e/tests/email-workbench.spec.ts: getByTestId("workbench-header")',
  'e2e/tests/email-workbench.spec.ts: getByTestId("workbench-phone-bar")',
  'e2e/tests/email-workbench.spec.ts: getByTestId("workbench-phone-preview")',
  'e2e/tests/email-workbench.spec.ts: getByTestId("workbench-preview")',
  'e2e/tests/email-workbench.spec.ts: getByTestId("workbench-sheet")',
  'e2e/tests/email-workbench.spec.ts: getByTestId("workbench-sheet")',
  "e2e/tests/email-workbench.spec.ts: getByTestId(testId)",
  "e2e/tests/email-workbench.spec.ts: getByText(/Nextly keeps this email up to date/)",
  'e2e/tests/entry-list-editor.spec.ts: getByTestId("document-lock-banner")',
  'e2e/tests/entry-opens-read-only-two-roles.spec.ts: getByTestId("document-lock-banner")',
  'e2e/tests/entry-opens-read-only.spec.ts: getByTestId("document-lock-banner")',
  'e2e/tests/entry-read-only-in-one-language.spec.ts: getByTestId("document-lock-banner")',
  'e2e/tests/entry-read-only-in-one-language.spec.ts: getByText("Setting up your workspace")',
  'e2e/tests/form-builder.spec.ts: getByText("Admin notification")',
  'e2e/tests/form-builder.spec.ts: getByText("Admin notification")',
  'e2e/tests/form-builder.spec.ts: getByText("Conditional")',
  'e2e/tests/form-builder.spec.ts: getByText("Conditional")',
  'e2e/tests/form-builder.spec.ts: getByText("No template \u2014 will not send")',
  'e2e/tests/form-builder.spec.ts: getByText("Thank you for your submission!")',
  'e2e/tests/form-builder.spec.ts: getByText("To team@example.com")',
  'e2e/tests/history-compare-changes.spec.ts: getByText("Title")',
  'e2e/tests/history-compare-changes.spec.ts: getByText("Title")',
  "e2e/tests/history-compare-changes.spec.ts: getByText(/^2 of \\d+ fields changed$/)",
  "e2e/tests/history-compare-changes.spec.ts: getByText(/^Version \\d+$/)",
  "e2e/tests/history-compare-changes.spec.ts: getByText(/^\\d+ of .*fields.* changed$/)",
  'e2e/tests/history-story-list.spec.ts: getByText("Nothing to show for this filter.")',
  'e2e/tests/media-upload.spec.ts: getByText("File is too large (max 10 MB)")',
  'e2e/tests/media-upload.spec.ts: getByText("Skipped: only 10 files can be uploaded at once")',
  'e2e/tests/media-upload.spec.ts: getByText("Too many files")',
  "e2e/tests/media-upload.spec.ts: getByText(/larger than \\d+ bytes/)",
  "e2e/tests/plugin-admin-styling.spec.ts: getByTestId(testId)",
  'e2e/tests/plugin-blocks.spec.ts: getByText("Stored plain")',
  'e2e/tests/plugin-page-routing.spec.ts: getByTestId("sf-card")',
  'e2e/tests/plugin-page-routing.spec.ts: getByText("Page Not Found")',
  'e2e/tests/plugin-text-widget.spec.ts: getByTestId("widget-cell-style-fixture/notes")',
  'e2e/tests/plugin-widget-kit.spec.ts: getByTestId("dashboard-edit-begin")',
  'e2e/tests/plugin-widget-kit.spec.ts: getByTestId("dashboard-edit-begin")',
  'e2e/tests/plugin-widget-kit.spec.ts: getByTestId("kit-card")',
  'e2e/tests/plugin-widget-kit.spec.ts: getByTestId("kit-card")',
  'e2e/tests/plugin-widget-kit.spec.ts: getByTestId("kit-card")',
  'e2e/tests/plugin-widget-kit.spec.ts: getByTestId("kit-card")',
  'e2e/tests/plugin-widget-kit.spec.ts: getByTestId("kit-card")',
  "e2e/tests/plugin-widget-kit.spec.ts: getByTestId(`widget-cell-${HIDES}`)",
  "e2e/tests/plugin-widget-kit.spec.ts: getByTestId(`widget-cell-${HIDES}`)",
  "e2e/tests/plugin-widget-kit.spec.ts: getByTestId(`widget-cell-${KIT}`)",
  "e2e/tests/plugin-widget-kit.spec.ts: getByTestId(`widget-cell-${LOAD_THROWS}`)",
  "e2e/tests/plugin-widget-kit.spec.ts: getByTestId(`widget-cell-${NEEDS}`)",
  "e2e/tests/plugin-widget-kit.spec.ts: getByTestId(`widget-cell-${NOT_SHOWN}`)",
  "e2e/tests/plugin-widget-kit.spec.ts: getByTestId(`widget-cell-${THROWS}`)",
  'e2e/tests/plugin-widget-kit.spec.ts: getByText("This plugin component failed to load")',
  'e2e/tests/plugin-widget-kit.spec.ts: getByText("customer 42")',
  'e2e/tests/production/component-map.spec.ts: getByText("Never built")',
  'e2e/tests/production/first-admin-setup.spec.ts: getByLabel("Email Address")',
  'e2e/tests/production/first-admin-setup.spec.ts: getByLabel("Full Name")',
  'e2e/tests/production/first-admin-setup.spec.ts: getByLabel("Setup token")',
  'e2e/tests/production/first-admin-setup.spec.ts: getByLabel("Setup token")',
  'e2e/tests/production/first-admin-setup.spec.ts: getByLabel("Setup token")',
  "e2e/tests/production/first-admin-setup.spec.ts: getByText(/a valid setup token is required/i)",
  "e2e/tests/refused-delete-says-why.spec.ts: getByText(/failed to delete/i)",
  "e2e/tests/refused-delete-says-why.spec.ts: getByText(error.message)",
  'e2e/tests/releases-list.spec.ts: getByPlaceholder("Search by title or description")',
  "e2e/tests/releases-list.spec.ts: getByText(new RegExp(`Showing ${from}.${to} of ${total} releases?$`))",
  'e2e/tests/restricted-related-item-in-field-groups.spec.ts: getByLabel("Headline")',
  'e2e/tests/restricted-related-item-in-field-groups.spec.ts: getByLabel("Title")',
  'e2e/tests/restricted-related-item.spec.ts: getByLabel("Excerpt")',
  'e2e/tests/restricted-related-item.spec.ts: getByLabel("Headline")',
  'e2e/tests/restricted-related-item.spec.ts: getByText("Readable category")',
  'e2e/tests/schema-builder.spec.ts: getByText("Read-only \u2014 defined in code")',
  "e2e/tests/schema-builder.spec.ts: getByText(kind.entity)",
  "e2e/tests/schema-builder.spec.ts: getByText(kind.ownField)",
  "e2e/tests/schema-builder.spec.ts: getByText(kind.ownField)",
  "e2e/tests/setup-refused-origin.spec.ts: getByPlaceholder(/email address/i)",
  "e2e/tests/setup-refused-origin.spec.ts: getByPlaceholder(/email address/i)",
  "e2e/tests/setup-refused-origin.spec.ts: getByPlaceholder(/full name/i)",
  "e2e/tests/setup-refused-origin.spec.ts: getByPlaceholder(/full name/i)",
  "e2e/tests/setup-refused-origin.spec.ts: getByPlaceholder(/full name/i)",
  'e2e/tests/share-preview-links.spec.ts: getByText("All links to this page are revoked.")',
  'e2e/tests/share-preview-links.spec.ts: getByText("No live links to this page.")',
  'e2e/tests/shell/driver.ts: getByTestId("panel-slot")',
  'e2e/tests/shell/driver.ts: getByTestId("panel-slot")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("overlay-content")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("overlay-content")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("overlay-content")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("overlay-content")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("overlay-content")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("overlay-trigger")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("overlay-trigger")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("overlay-trigger")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("overlay-trigger")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("shell-container")',
  'e2e/tests/shell/shell.spec.ts: getByTestId("shell-container")',
  "e2e/tests/shell/shell.spec.ts: getByText(/needs more width/i)",
  "e2e/tests/shell/shell.spec.ts: getByText(/needs more width/i)",
  "e2e/tests/shell/shell.spec.ts: getByText(/needs more width/i)",
  "e2e/tests/shell/shell.spec.ts: getByText(/needs more width/i)",
  "e2e/tests/shell/shell.spec.ts: getByText(/needs more width/i)",
  "e2e/tests/shell/shell.spec.ts: getByText(/needs more width/i)",
  'e2e/tests/submissions.spec.ts: getByText("bot@example.com")',
  "e2e/tests/user-fields.spec.ts: getByText(/cannot change once the field exists/i)",
  "e2e/tests/user-fields.spec.ts: getByText(FIELD_NAME)",
];

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

  it("hold their unfiltered page-level locators to those written before Cache Components", () => {
    const found = browserSuiteFiles().flatMap(file =>
      hiddenMatchingPageLocators(
        readFileSync(path.join(ROOT, file), "utf8")
      ).map(locator => `${file}: ${locator}`)
    );
    expect(found.sort()).toEqual(UNFILTERED_BEFORE_CACHE_COMPONENTS);
  });

  it("tell an unfiltered page-level locator from a filtered or chained one", () => {
    expect(hiddenMatchingPageLocators('page.getByText("Saved")')).toEqual([
      'getByText("Saved")',
    ]);
    expect(
      hiddenMatchingPageLocators('page.getByTestId("a(b)").first()')
    ).toEqual(['getByTestId("a(b)")']);
    expect(
      hiddenMatchingPageLocators(
        "page.getByText(\n  /a, (b)/,\n  { exact: true }\n)"
      )
    ).toEqual(["getByText(/a, (b)/)"]);
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
