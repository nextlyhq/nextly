import { describe, expect, it } from "vitest";

import { summarizeStoredHooks } from "../stored-hook-summary";

/**
 * A stored hook as the API keeps it. `hookType` is a plain string, since the
 * collection endpoint accepts any value there.
 */
interface StoredHookRow {
  hookId: string;
  hookType: string;
  enabled: boolean;
  config: Record<string, unknown>;
  order: number;
}

// Each case is a hook as the server stores and runs it: the executor hands the
// stored `config` to the hook as it is, with no defaults filled in. A sentence
// is only given where the stored hook is fully described by it.
function hook(overrides: Partial<StoredHookRow>): StoredHookRow {
  return {
    hookId: "auto-slug",
    hookType: "beforeChange",
    enabled: true,
    config: {},
    order: 0,
    ...overrides,
  };
}

const SLUG = {
  sourceField: "title",
  targetField: "slug",
  overwriteExisting: false,
};
const AUDIT = { createdByField: "author", updatedByField: "editor" };
const UNIQUE = {
  field: "email",
  errorMessage: "Email taken",
  caseInsensitive: true,
};

const NOT_MADE_FOR =
  "Runs as stored, but what it does is not described here: it is stored for a phase it is not made for.";

describe("summarizeStoredHooks: what a hook does", () => {
  it("describes a slug hook stored with every setting", () => {
    const [summary] = summarizeStoredHooks([
      hook({ hookId: "auto-slug", config: SLUG, order: 3 }),
    ]);

    expect(summary.name).toBe("Auto-generate Slug");
    expect(summary.does).toBe(
      "Fills slug from title, unless slug already has a value."
    );
    expect(summary.when).toBe(
      "Before an entry is created or updated, after that write's own before hooks"
    );
    expect(summary.order).toBe(3);
    expect(summary.on).toBe(true);
    expect(summary.settings).toEqual([
      {
        key: "sourceField",
        label: "Field to generate slug from",
        value: "title",
      },
      { key: "targetField", label: "Field to store slug in", value: "slug" },
      {
        key: "overwriteExisting",
        label: "Overwrite existing slug values",
        value: "No",
      },
    ]);
  });

  it("says a slug hook that overwrites replaces the value already there", () => {
    const [summary] = summarizeStoredHooks([
      hook({
        hookId: "auto-slug",
        config: {
          sourceField: "name",
          targetField: "path",
          overwriteExisting: true,
        },
      }),
    ]);

    expect(summary.does).toBe(
      "Fills path from name, replacing any value already there."
    );
  });

  it("describes an audit hook for creates and updates", () => {
    const [summary] = summarizeStoredHooks([
      hook({ hookId: "audit-fields", config: AUDIT }),
    ]);

    expect(summary.does).toBe(
      "Records who created an entry in author, and who last changed it in editor."
    );
  });

  it("says an audit hook stored for updates records only the updater", () => {
    // The creator is written on a create alone.
    const [summary] = summarizeStoredHooks([
      hook({ hookId: "audit-fields", hookType: "beforeUpdate", config: AUDIT }),
    ]);

    expect(summary.does).toBe("Records who last changed an entry in editor.");
  });

  it("describes a uniqueness hook stored with every setting", () => {
    const [summary] = summarizeStoredHooks([
      hook({ hookId: "unique-validation", config: UNIQUE }),
    ]);

    expect(summary.does).toBe(
      'Refuses an entry whose email another entry already uses, ignoring case, saying "Email taken".'
    );
  });

  it("does not describe a hook with a setting missing", () => {
    // Stored without `field`, the server reads `data[undefined]` and validates
    // nothing: a sentence about refusing duplicates would be wrong.
    const [unique, slug] = summarizeStoredHooks([
      hook({
        hookId: "unique-validation",
        config: { errorMessage: "Taken", caseInsensitive: false },
      }),
      hook({ hookId: "auto-slug", config: { sourceField: "title" }, order: 1 }),
    ]);

    expect(unique.does).toBe(
      "Runs as stored, but what it does is not described here: settings missing or of the wrong type (field)."
    );
    expect(slug.does).toBe(
      "Runs as stored, but what it does is not described here: settings missing or of the wrong type (targetField, overwriteExisting)."
    );
    expect(slug.settings).toContainEqual({
      key: "targetField",
      label: "Field to store slug in",
      value: "Not set",
    });
  });

  it("does not describe a hook with a setting of the wrong type", () => {
    // A stored "false" is truthy where the server reads it, so it overwrites.
    const [summary] = summarizeStoredHooks([
      hook({
        hookId: "auto-slug",
        config: { ...SLUG, overwriteExisting: "false" },
      }),
    ]);

    expect(summary.does).toBe(
      "Runs as stored, but what it does is not described here: settings missing or of the wrong type (overwriteExisting)."
    );
  });

  it("does not describe a known hook stored for a phase it is not made for", () => {
    // After a read or before a delete these kinds still run and can change a
    // response or refuse a delete; that is not guessed at here.
    for (const phase of [
      "afterRead",
      "beforeDelete",
      "afterCreate",
      "afterChange",
    ]) {
      const [summary] = summarizeStoredHooks([
        hook({ hookId: "audit-fields", hookType: phase, config: AUDIT }),
      ]);
      expect(summary.does).toBe(NOT_MADE_FOR);
    }
  });

  it("says a hook stored in a phase the server never runs never runs", () => {
    for (const phase of ["beforeOperation", "beforeRead", "duringLunch"]) {
      const [summary] = summarizeStoredHooks([
        hook({ hookId: "auto-slug", hookType: phase, config: SLUG }),
      ]);
      expect(summary.when).toBe(`Never (stored as "${phase}")`);
      expect(summary.does).toBe(
        "Never runs: the server does not run stored hooks at this point."
      );
    }
  });

  it("says an unknown hook runs nothing, and lists its settings by key", () => {
    const [summary] = summarizeStoredHooks([
      hook({ hookId: "send-sms", config: { to: "+1" } }),
    ]);

    expect(summary.known).toBe(false);
    expect(summary.name).toBe("send-sms");
    expect(summary.does).toBe(
      "Not a hook this version of Nextly knows, so it runs nothing."
    );
    expect(summary.settings).toEqual([{ key: "to", label: "to", value: "+1" }]);
  });

  it("keys an undeclared setting by its own key, even when it reads like a declared one", () => {
    const [summary] = summarizeStoredHooks([
      hook({
        hookId: "auto-slug",
        config: { ...SLUG, "Field to generate slug from": 3 },
      }),
    ]);

    const keys = summary.settings.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(summary.settings).toContainEqual({
      key: "Field to generate slug from",
      label: "Field to generate slug from",
      value: "3",
    });
  });

  it("marks a turned-off hook as off", () => {
    const [summary] = summarizeStoredHooks([hook({ enabled: false })]);

    expect(summary.on).toBe(false);
  });
});

describe("summarizeStoredHooks: the order of the list", () => {
  it("orders hooks by `order` within one stored phase", () => {
    const summaries = summarizeStoredHooks([
      hook({ hookId: "unique-validation", order: 2 }),
      hook({ hookId: "auto-slug", order: 0 }),
      hook({ hookId: "audit-fields", order: 1 }),
    ]);

    expect(summaries.map(s => s.hookId)).toEqual([
      "auto-slug",
      "audit-fields",
      "unique-validation",
    ]);
  });

  it("keeps each stored phase together, never interleaving create and update hooks", () => {
    // No single write runs a create hook and an update hook, so ordering them
    // together by `order` would describe a sequence that never happens.
    const summaries = summarizeStoredHooks([
      hook({ hookId: "auto-slug", hookType: "beforeCreate", order: 0 }),
      hook({ hookId: "audit-fields", hookType: "beforeUpdate", order: 1 }),
      hook({ hookId: "unique-validation", hookType: "beforeCreate", order: 2 }),
    ]);

    expect(summaries.map(s => s.when)).toEqual([
      "Before an entry is created",
      "Before an entry is created",
      "Before an entry is updated",
    ]);
  });

  it("lists a write's own before hooks ahead of its before-change ones", () => {
    // A create runs `beforeCreate` and then `beforeChange` in a separate pass.
    const summaries = summarizeStoredHooks([
      hook({ hookId: "audit-fields", hookType: "beforeChange", order: 0 }),
      hook({ hookId: "auto-slug", hookType: "beforeCreate", order: 5 }),
    ]);

    expect(summaries.map(s => s.hookId)).toEqual(["auto-slug", "audit-fields"]);
  });

  it("says after-change hooks are sorted among that write's after hooks", () => {
    const [summary] = summarizeStoredHooks([
      hook({ hookId: "audit-fields", hookType: "afterChange", order: 1 }),
    ]);

    expect(summary.when).toBe(
      "After an entry is created or updated, sorted by order among that write's after hooks"
    );
    expect(summary.order).toBe(1);
  });

  it("shows a malformed entry as unreadable, after the hooks that run", () => {
    // The API stores `hooks` as an array of anything, so an entry may be null
    // or missing its fields; reading one as a hook would throw.
    const summaries = summarizeStoredHooks([
      null,
      { hookId: "audit-fields" },
      hook({ hookId: "auto-slug", hookType: "beforeRead" }),
      hook({ hookId: "auto-slug" }),
    ]);

    expect(summaries.map(s => s.name)).toEqual([
      "Auto-generate Slug",
      "Auto-generate Slug",
      "Unreadable entry",
      "Unreadable entry",
    ]);
    expect(summaries[1].when).toBe('Never (stored as "beforeRead")');
    expect(summaries[2].does).toBe(
      "This stored entry is not in the shape a hook is stored in, so what it does cannot be shown."
    );
    expect(summaries[2].order).toBeNull();
  });

  it("returns nothing for a collection without stored hooks", () => {
    expect(summarizeStoredHooks(undefined)).toEqual([]);
    expect(summarizeStoredHooks([])).toEqual([]);
  });
});
