import { describe, expect, it } from "vitest";

import type { StoredHookConfig } from "@admin/types/collection";

import { summarizeStoredHooks } from "../stored-hook-summary";

// Each case is a hook as the server stores and runs it: the executor hands the
// stored `config` to the hook as it is, with no defaults filled in, so the
// summary describes the stored values and says when one is missing.
function hook(overrides: Partial<StoredHookConfig>): StoredHookConfig {
  return {
    hookId: "auto-slug",
    hookType: "beforeChange",
    enabled: true,
    config: {},
    order: 0,
    ...overrides,
  };
}

describe("summarizeStoredHooks", () => {
  it("describes a slug hook from its stored settings", () => {
    const [summary] = summarizeStoredHooks([
      hook({
        hookId: "auto-slug",
        config: {
          sourceField: "title",
          targetField: "slug",
          overwriteExisting: false,
        },
      }),
    ]);

    expect(summary.name).toBe("Auto-generate Slug");
    expect(summary.does).toBe(
      "Fills slug from title, unless slug already has a value."
    );
    expect(summary.when).toBe("Before an entry is created or updated");
    expect(summary.on).toBe(true);
    expect(summary.settings).toEqual([
      { label: "Field to generate slug from", value: "title" },
      { label: "Field to store slug in", value: "slug" },
      { label: "Overwrite existing slug values", value: "No" },
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

  it("describes an audit hook from its stored settings", () => {
    const [summary] = summarizeStoredHooks([
      hook({
        hookId: "audit-fields",
        config: { createdByField: "author", updatedByField: "editor" },
      }),
    ]);

    expect(summary.name).toBe("Set Audit Fields");
    expect(summary.does).toBe(
      "Records who created an entry in author, and who last changed it in editor."
    );
    expect(summary.settings).toEqual([
      { label: "Field for creator user ID", value: "author" },
      { label: "Field for updater user ID", value: "editor" },
    ]);
  });

  it("describes a uniqueness hook from its stored settings", () => {
    const [summary] = summarizeStoredHooks([
      hook({
        hookId: "unique-validation",
        config: {
          field: "email",
          errorMessage: "Email taken",
          caseInsensitive: true,
        },
      }),
    ]);

    expect(summary.name).toBe("Validate Uniqueness");
    expect(summary.does).toBe(
      'Refuses an entry whose email another entry already uses, ignoring case, saying "Email taken".'
    );
    expect(summary.settings).toEqual([
      { label: "Field to validate", value: "email" },
      { label: "Error message for duplicate values", value: "Email taken" },
      { label: "Case-insensitive comparison", value: "Yes" },
    ]);
  });

  it("names a missing stored setting rather than assuming its default", () => {
    // The executor passes the stored config through unparsed, so a setting
    // absent from the row is absent when the hook runs: the summary must not
    // claim "slug" for a target field that was never stored.
    const [summary] = summarizeStoredHooks([
      hook({ hookId: "auto-slug", config: { sourceField: "title" } }),
    ]);

    expect(summary.does).toBe(
      "Fills (not set) from title, unless (not set) already has a value."
    );
    expect(summary.settings).toContainEqual({
      label: "Field to store slug in",
      value: "Not set",
    });
  });

  it("lists a stored setting the hook does not declare, by its key", () => {
    const [summary] = summarizeStoredHooks([
      hook({
        hookId: "audit-fields",
        config: {
          createdByField: "a",
          updatedByField: "b",
          extra: 3,
        },
      }),
    ]);

    expect(summary.settings).toContainEqual({ label: "extra", value: "3" });
  });

  it("says an unknown hook runs nothing", () => {
    const [summary] = summarizeStoredHooks([
      hook({ hookId: "send-sms", config: { to: "+1" } }),
    ]);

    expect(summary.known).toBe(false);
    expect(summary.name).toBe("send-sms");
    expect(summary.does).toBe(
      "Not a hook this version of Nextly knows, so it runs nothing."
    );
    expect(summary.settings).toEqual([{ label: "to", value: "+1" }]);
  });

  it("describes when a hook runs from its stored phase", () => {
    const [summary] = summarizeStoredHooks([
      hook({ hookId: "audit-fields", hookType: "beforeCreate" }),
    ]);

    expect(summary.when).toBe("Before an entry is created");
  });

  it("marks a turned-off hook as off", () => {
    const [summary] = summarizeStoredHooks([hook({ enabled: false })]);

    expect(summary.on).toBe(false);
  });

  it("lists hooks in the order they run, not the order they are stored", () => {
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

  it("groups hooks by when they run before ordering them within a phase", () => {
    // `order` only orders hooks within a phase: an after-create hook with a
    // lower `order` still runs after a before-create one.
    const summaries = summarizeStoredHooks([
      hook({ hookId: "audit-fields", hookType: "afterCreate", order: 0 }),
      hook({ hookId: "auto-slug", hookType: "beforeCreate", order: 1 }),
    ]);

    expect(summaries.map(s => s.hookId)).toEqual(["auto-slug", "audit-fields"]);
  });

  it("says a known hook stored where it cannot act changes nothing", () => {
    // After the write the server ignores what a hook returns, so a slug hook
    // there fills nothing and a uniqueness hook there refuses nothing.
    const [slug, unique] = summarizeStoredHooks([
      hook({ hookId: "auto-slug", hookType: "afterCreate", order: 0 }),
      hook({ hookId: "unique-validation", hookType: "afterUpdate", order: 1 }),
    ]);

    expect(slug.does).toBe(
      "Runs, but changes nothing: Auto-generate Slug only acts before an entry is created or updated."
    );
    expect(unique.does).toBe(
      "Runs, but changes nothing: Validate Uniqueness only acts before an entry is created or updated."
    );
  });

  it("says a hook stored in a phase the server never runs never runs", () => {
    for (const phase of ["beforeOperation", "beforeRead", "duringLunch"]) {
      const [summary] = summarizeStoredHooks([
        hook({ hookId: "auto-slug", hookType: phase as never }),
      ]);
      expect(summary.when).toBe(`Never (stored as "${phase}")`);
      expect(summary.does).toBe(
        "Never runs: the server does not run stored hooks at this point."
      );
    }
  });

  it("shows a malformed entry as unreadable, after the hooks that run", () => {
    // The API stores `hooks` as an array of anything, so an entry may be null
    // or missing its fields; reading one as a hook would throw.
    const summaries = summarizeStoredHooks([
      null,
      { hookId: "audit-fields" },
      hook({ hookId: "auto-slug" }),
    ]);

    expect(summaries.map(s => s.name)).toEqual([
      "Auto-generate Slug",
      "Unreadable entry",
      "Unreadable entry",
    ]);
    expect(summaries[1].does).toBe(
      "This stored entry is not in the shape a hook is stored in, so what it does cannot be shown."
    );
  });

  it("lists a create's own before hooks ahead of its before-change ones", () => {
    // A create runs its stored `beforeCreate` hooks, then the `beforeChange`
    // ones in a separate pass, whatever their `order` across the two.
    const summaries = summarizeStoredHooks([
      hook({ hookId: "audit-fields", hookType: "beforeChange", order: 0 }),
      hook({ hookId: "auto-slug", hookType: "beforeCreate", order: 5 }),
    ]);

    expect(summaries.map(s => s.hookId)).toEqual(["auto-slug", "audit-fields"]);
  });

  it("orders after-change hooks together with after-create ones", () => {
    // `afterChange` is matched into the same pass as `afterCreate` and sorted
    // with it by `order`, so neither phase goes first as a block.
    const summaries = summarizeStoredHooks([
      hook({ hookId: "audit-fields", hookType: "afterCreate", order: 1 }),
      hook({ hookId: "auto-slug", hookType: "afterChange", order: 0 }),
      hook({ hookId: "unique-validation", hookType: "afterCreate", order: 2 }),
    ]);

    expect(summaries.map(s => s.hookId)).toEqual([
      "auto-slug",
      "audit-fields",
      "unique-validation",
    ]);
  });

  it("says an audit hook stored for updates records only the updater", () => {
    const [summary] = summarizeStoredHooks([
      hook({
        hookId: "audit-fields",
        hookType: "beforeUpdate",
        config: { createdByField: "author", updatedByField: "editor" },
      }),
    ]);

    expect(summary.does).toBe("Records who last changed an entry in editor.");
  });

  it("names wrongly typed settings instead of describing what they would do", () => {
    // The server passes stored settings unparsed: a stored "false" is truthy
    // there and overwrites, so reading it as "keeps the value" would be wrong.
    const [summary] = summarizeStoredHooks([
      hook({
        hookId: "auto-slug",
        config: {
          sourceField: "title",
          targetField: "slug",
          overwriteExisting: "false",
        },
      }),
    ]);

    expect(summary.does).toBe(
      "Runs with settings of the wrong type (overwriteExisting), so what it does cannot be described exactly."
    );
  });

  it("returns nothing for a collection without stored hooks", () => {
    expect(summarizeStoredHooks(undefined)).toEqual([]);
    expect(summarizeStoredHooks([])).toEqual([]);
  });
});
