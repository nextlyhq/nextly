/**
 * A list surface may not compose its own toolbar.
 *
 * `ListView` settles the gap above the table, the search field's width and the
 * order of the controls. None of that survives if a page can put a `SearchBar`
 * beside its table directly, which is how the codebase came to hold four
 * arrangements at once — and a documented rule with nothing enforcing it is not
 * a control.
 *
 * The rule: a file that renders a TABLE must not also render a `SearchBar`. It
 * hands `search` to `ListView` instead. Files that render a search field
 * WITHOUT a table are untouched — the media picker, the command palette and the
 * relationship picker are all legitimately search-without-a-list.
 */
import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

/**
 * Surfaces that still compose their own toolbar, listed so the guard can be
 * enforcing while they are converted one at a time.
 *
 * This is a RATCHET, not an exemption: the assertion below is equality, so
 * adding a surface fails and so does leaving a converted one behind. It may
 * only ever shrink, and it is empty when the migration is done.
 */
const NOT_YET_CONVERTED = [
  "pages/dashboard/field-group/components/FieldGroupTable.tsx",
  // Its LIST is converted; an error branch still renders a search field of its
  // own, at a fifth width. That branch shows search beside an alert and no
  // table at all, so converting it is a question about how a failed list
  // reports itself rather than about the toolbar.
  "pages/dashboard/settings/email-providers/index.tsx",
  "pages/dashboard/settings/email-templates/index.tsx",
  "pages/dashboard/singles/components/SinglesTable.tsx",
];

/** Renders a table, so it is a list surface and the rule applies. */
const RENDERS_TABLE = /<(DataTableView|ListView)[\s<>]/;
/** Renders the search field itself rather than delegating it. */
const RENDERS_SEARCH = /<SearchBar[\s/>]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (
      entry.name.endsWith(".tsx") &&
      !/\.test\.tsx$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The check itself, over an explicit file list, so the controls below can run
 * it on inputs whose answer is known rather than re-deriving it.
 */
function offendersIn(files: string[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // The toolbar is the ONE place allowed to render both.
    if (file.endsWith(join("list-view", "ListToolbar.tsx"))) continue;
    if (RENDERS_TABLE.test(source) && RENDERS_SEARCH.test(source)) {
      offenders.push(file.replace(`${SRC}/`, ""));
    }
  }
  return offenders;
}

describe("no hand-rolled list toolbars", () => {
  const files = walk(SRC);

  /**
   * The population, asserted BEFORE the verdict. A scan whose glob missed the
   * tree reports zero offenders in exactly the same words as a clean one, and
   * the count alone does not separate them — so this also requires a file the
   * scan must have reached by name.
   */
  it("reads the admin source tree", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(
      files.some(f => f.endsWith(join("list-view", "index.tsx"))),
      "the scan did not reach ListView's own directory, so a clean result " +
        "says nothing about the surfaces it was meant to check"
    ).toBe(true);
  });

  /**
   * Equality rather than a subset check, so the list is a ratchet in both
   * directions: a NEW hand-rolled toolbar fails, and so does an entry left
   * behind after its surface was converted. A subset check would let the list
   * rot into an exemption nobody revisits.
   */
  it("has exactly the known-unconverted surfaces, and no others", () => {
    expect(
      offendersIn(files).sort(),
      "A file renders a table AND a SearchBar, so it composes a toolbar of its " +
        "own. Pass `search` to ListView instead — it owns the field's width " +
        "and the row's spacing. If you CONVERTED a surface, remove it from " +
        "NOT_YET_CONVERTED in this file; that list may only shrink."
    ).toEqual([...NOT_YET_CONVERTED].sort());
  });

  /**
   * POSITIVE control: a file carrying the violating shape must be reported BY
   * NAME. Without this, a check that reports nothing under every circumstance
   * passes the assertion above for the wrong reason.
   */
  it("reports a hand-rolled toolbar when one exists", () => {
    const fixture = join(SRC, "components", "__hand-rolled-fixture.tsx");
    writeFileSync(
      fixture,
      `export const X = () => (<div><SearchBar value="" /><DataTableView rows={[]} /></div>);\n`
    );
    try {
      const found = offendersIn([fixture]);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("__hand-rolled-fixture.tsx");
    } finally {
      rmSync(fixture, { force: true });
    }
  });

  /**
   * NEGATIVE control, in the same shape as the findings: a surface that renders
   * a table and delegates its search is silent. Paired with the positive above,
   * this separates "correctly quiet" from "cannot see anything".
   */
  it("stays silent on a surface that delegates its search", () => {
    const fixture = join(SRC, "components", "__delegating-fixture.tsx");
    writeFileSync(
      fixture,
      `export const X = () => (<ListView search={{ value: "", onChange: () => {} }} rows={[]} />);\n`
    );
    try {
      expect(offendersIn([fixture])).toEqual([]);
    } finally {
      rmSync(fixture, { force: true });
    }
  });
});
