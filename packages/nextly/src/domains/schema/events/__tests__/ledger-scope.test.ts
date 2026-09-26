/**
 * Keeping plugin rows out of the app's ledger commands.
 *
 * `migrate:down` picks the newest applied row of any kind, so without this it
 * would revert a plugin's migration while reporting an app rollback.
 */
import { describe, expect, it } from "vitest";

import {
  isPluginLedgerRow,
  pluginOfLedgerRow,
  scopeLedgerRows,
} from "../ledger-scope";

const rows = [
  { filename: "0001_initial.sql" },
  { filename: "plugin:auth/001_init" },
  { filename: "plugin:billing/001_init" },
  { filename: "0002_add_posts.sql" },
  { filename: null },
];

describe("recognising a plugin row", () => {
  it("identifies qualified filenames", () => {
    expect(isPluginLedgerRow("plugin:auth/001_init")).toBe(true);
    expect(isPluginLedgerRow("0001_initial.sql")).toBe(false);
    expect(isPluginLedgerRow(null)).toBe(false);
  });

  it("extracts the plugin name", () => {
    expect(pluginOfLedgerRow("plugin:auth/001_init")).toBe("auth");
    expect(pluginOfLedgerRow("0001_initial.sql")).toBeNull();
  });

  it("treats a malformed qualified name as a plugin's, not the app's", () => {
    // Safer in the direction that matters: reading it as the app's would hand
    // it to `migrate:down`.
    expect(pluginOfLedgerRow("plugin:auth")).toBe("auth");
  });
});

describe("scoping", () => {
  it("excludes every plugin row by default", () => {
    expect(scopeLedgerRows(rows).map(r => r.filename)).toEqual([
      "0001_initial.sql",
      "0002_add_posts.sql",
      null,
    ]);
  });

  it("selects exactly one plugin when named", () => {
    expect(scopeLedgerRows(rows, "auth").map(r => r.filename)).toEqual([
      "plugin:auth/001_init",
    ]);
  });

  it("never returns the union", () => {
    // A command operating on both would revert an app migration while the
    // operator was asking about a plugin.
    const scoped = scopeLedgerRows(rows, "auth");
    expect(scoped.some(r => r.filename?.endsWith(".sql"))).toBe(false);
  });

  it("returns nothing for a plugin with no rows", () => {
    expect(scopeLedgerRows(rows, "nobody")).toEqual([]);
  });
});

describe("a scoped npm plugin name", () => {
  it("is read whole, not truncated at its own slash", () => {
    // `@acme/nextly-plugin-auth` contains a slash, and the qualified filename
    // is `plugin:<name>/<module>` — so splitting on the FIRST slash returned
    // `@acme`. Every scoped plugin therefore matched no ledger rows, and
    // `migrate:status --plugin` and `migrate:down --plugin` silently reported
    // nothing for it.
    expect(pluginOfLedgerRow("plugin:@acme/nextly-plugin-auth/001_init")).toBe(
      "@acme/nextly-plugin-auth"
    );
  });

  it("selects that plugin's rows and no others", () => {
    const rows = [
      { filename: "plugin:@acme/nextly-plugin-auth/001_init" },
      { filename: "plugin:@acme/nextly-plugin-seo/001_init" },
      { filename: "0001_app.sql" },
    ];

    expect(
      scopeLedgerRows(rows, "@acme/nextly-plugin-auth").map(r => r.filename)
    ).toEqual(["plugin:@acme/nextly-plugin-auth/001_init"]);
  });

  it("still reads an unscoped name", () => {
    // The control: the simple shape must keep working.
    expect(pluginOfLedgerRow("plugin:fx/001_init")).toBe("fx");
  });
});
