/**
 * "Which columns has this reader hidden" has ONE implementation.
 *
 * `useColumnVisibility` owns the storage. `useListColumns` adapts it to the
 * shape `ListView` renders, and is composed by `useTableColumns`, which owns
 * the three-decision entity table column policy (pinned sets, storage key,
 * hidden resolution). Entity tables must use `useTableColumns` rather than
 * recreating the policy or reaching for low-level hooks directly.
 *
 * There is a second, sharper reason this is a boundary rather than advice: the
 * storage hook re-reads in an effect keyed on its ARRAY arguments, so an inline
 * `defaultVisible` loops forever. `useListColumns` keys by value and prevents
 * it. Calling the storage hook directly re-opens that trap.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** The adapter, and the hook's own definition and tests, may name it. */
const ALLOWED_STORAGE = [
  join("hooks", "useColumnVisibility.ts"),
  join("hooks", "index.ts"),
  join("list-view", "useListColumns.ts"),
];

/**
 * Direct `useListColumns` callers: only the adapter itself, its export, the
 * policy hook that composes it, and the schema-driven EntryList feature.
 */
const ALLOWED_LIST_COLUMNS = [
  join("list-view", "useListColumns.ts"),
  join("list-view", "useTableColumns.ts"),
  join("list-view", "index.tsx"),
  join("entries", "EntryList", "EntryList.tsx"),
  join("entries", "EntryList", "EntryTable.tsx"),
];

/** The complete inventory of admin entity table surfaces. */
const ENTITY_TABLE_SURFACES = [
  join("components", "features", "api-keys", "ApiKeyTable.tsx"),
  join("components", "features", "webhooks", "WebhookTable.tsx"),
  join("pages", "dashboard", "collection", "components", "CollectionTable.tsx"),
  join(
    "pages",
    "dashboard",
    "field-group",
    "components",
    "FieldGroupTable.tsx"
  ),
  join("pages", "dashboard", "plugins", "components", "PluginsTable.tsx"),
  join("pages", "dashboard", "roles", "components", "RoleTable.tsx"),
  join("pages", "dashboard", "settings", "email-providers", "index.tsx"),
  join("pages", "dashboard", "settings", "email-templates", "index.tsx"),
  join("pages", "dashboard", "settings", "image-sizes", "index.tsx"),
  join("pages", "dashboard", "singles", "components", "SinglesTable.tsx"),
  join("pages", "dashboard", "users", "components", "UserTable.tsx"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("one columns mechanism", () => {
  const files = walk(SRC);

  /**
   * Population before verdict: a scan that reached nothing reports no direct
   * callers in exactly the same words as a clean one. Asserted by MEMBERSHIP,
   * because a count passes on any set of the right size.
   */
  it("reads the admin source, including both hooks and all entity tables", () => {
    const rel = files.map(f => relative(SRC, f));
    expect(rel).toContain(join("hooks", "useColumnVisibility.ts"));
    expect(rel).toContain(
      join("components", "ui", "table", "list-view", "useListColumns.ts")
    );
    expect(rel).toContain(
      join("components", "ui", "table", "list-view", "useTableColumns.ts")
    );
    for (const surface of ENTITY_TABLE_SURFACES) {
      expect(rel).toContain(surface);
    }
  });

  it("has no product code calling the storage hook directly", () => {
    const offenders = files
      .filter(file => !ALLOWED_STORAGE.some(allowed => file.endsWith(allowed)))
      .filter(file => /useColumnVisibility/.test(readFileSync(file, "utf8")))
      .map(file => relative(SRC, file));

    expect(
      offenders,
      "These call `useColumnVisibility` directly. Use `useListColumns` from " +
        "`components/ui/table/list-view` instead: it is the one adapter, and " +
        "it stabilises its array arguments by value, which the storage hook " +
        "requires and does not enforce."
    ).toEqual([]);
  });

  it("requires entity table surfaces to use useTableColumns rather than useListColumns directly", () => {
    const offenders = files
      .filter(
        file => !ALLOWED_LIST_COLUMNS.some(allowed => file.endsWith(allowed))
      )
      .filter(file => /useListColumns/.test(readFileSync(file, "utf8")))
      .map(file => relative(SRC, file));

    expect(
      offenders,
      "These call `useListColumns` directly. Use `useTableColumns` from " +
        "`components/ui/table/list-view` instead: it enforces the pinned-column " +
        "and hidden-column resolution policy across entity tables."
    ).toEqual([]);
  });

  it("requires every entity table surface to adopt useTableColumns", () => {
    const missing = ENTITY_TABLE_SURFACES.filter(surface => {
      const fullPath = join(SRC, surface);
      const content = readFileSync(fullPath, "utf8");
      return !/useTableColumns\(/.test(content);
    });

    expect(
      missing,
      "Every admin entity table surface must adopt `useTableColumns` to " +
        "enforce the unified column policy (pinned sets, storage key, and " +
        "hidden resolution)."
    ).toEqual([]);
  });
});
