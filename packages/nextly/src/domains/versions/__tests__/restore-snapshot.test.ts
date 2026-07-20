/**
 * What of a stored snapshot may be resubmitted.
 *
 * Two of these are load-bearing for reasons that are not obvious from the call
 * site: nothing downstream removes a key the schema no longer has, and a
 * localized snapshot holds one locale's values with no way to guess which.
 */
import { describe, it, expect } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { buildRestorePayload, canRestoreLocale } from "../restore-snapshot";

const fields = [
  { name: "title", type: "text" },
  { name: "body", type: "richText" },
] as FieldConfig[];

describe("buildRestorePayload", () => {
  it("keeps the values of fields the schema still has", () => {
    const { payload } = buildRestorePayload(
      { title: "Hello", body: { root: {} } },
      fields
    );

    expect(payload).toEqual({ title: "Hello", body: { root: {} } });
  });

  it("drops a field the schema no longer has, and reports it", () => {
    // Validation walks the schema's fields rather than the payload's keys, so
    // it ignores this; the update then names the missing column in raw SQL.
    const { payload, droppedFields } = buildRestorePayload(
      { title: "Hello", subtitle: "Gone" },
      fields
    );

    expect(payload).toEqual({ title: "Hello" });
    expect(droppedFields).toEqual(["subtitle"]);
  });

  it("never resubmits identity or ownership", () => {
    // Stripped here rather than downstream so hooks are not handed a forged
    // createdBy, and because the singles path never strips it at all.
    const { payload } = buildRestorePayload(
      {
        id: "e1",
        createdAt: "2020-01-01",
        created_by: "someone-else",
        createdBy: "someone-else",
        updatedAt: "2020-01-02",
        title: "Hello",
      },
      fields
    );

    expect(payload).toEqual({ title: "Hello" });
  });

  it("keeps the columns every document carries", () => {
    // `title` and `slug` are synthesized as columns when the schema declares no
    // field of that name, so they are always writable even though the field
    // list does not mention them.
    const { payload, droppedFields } = buildRestorePayload(
      { title: "Hello", status: "draft", slug: "hello" },
      [{ name: "body", type: "text" }] as FieldConfig[]
    );

    expect(payload).toMatchObject({
      title: "Hello",
      slug: "hello",
      status: "draft",
    });
    expect(droppedFields).toEqual([]);
  });

  it("drops status when the entity no longer has it", () => {
    // Turning draft/published off drops the column, so a snapshot from before
    // still names it and sending it would fail the whole restore.
    const { payload, droppedFields } = buildRestorePayload(
      { title: "Hello", status: "draft" },
      fields,
      { hasStatus: false }
    );

    expect(payload).toEqual({ title: "Hello" });
    expect(droppedFields).toEqual(["status"]);
  });

  it("does not resubmit a container holding a password", () => {
    // Capture strips passwords wherever they are, including inside a group, and
    // the update replaces a container whole — so restoring this one would wipe
    // the stored credential with the snapshot's blank.
    const withSecret = [
      {
        name: "account",
        type: "group",
        fields: [
          { name: "label", type: "text" },
          { name: "secret", type: "password" },
        ],
      },
    ] as FieldConfig[];

    const { payload, droppedFields } = buildRestorePayload(
      { account: { label: "Primary" } },
      withSecret
    );

    expect(payload).toEqual({});
    expect(droppedFields).toEqual(["account"]);
  });

  it("does not resubmit a field that is a password now", () => {
    // The snapshot may predate the field becoming a password — a text field
    // converted later leaves a readable value in old snapshots, and restoring
    // it would overwrite the live credential.
    const withSecret = [
      { name: "title", type: "text" },
      { name: "secret", type: "password" },
    ] as FieldConfig[];

    const { payload, droppedFields } = buildRestorePayload(
      { title: "Hello", secret: "was-plain-text-back-then" },
      withSecret
    );

    expect(payload).toEqual({ title: "Hello" });
    expect(droppedFields).toEqual(["secret"]);
  });

  it("still restores a container with no password in it", () => {
    const plain = [
      {
        name: "address",
        type: "group",
        fields: [{ name: "city", type: "text" }],
      },
    ] as FieldConfig[];

    const { payload } = buildRestorePayload(
      { address: { city: "Lisbon" } },
      plain
    );

    expect(payload).toEqual({ address: { city: "Lisbon" } });
  });

  it("keeps a value that was deliberately emptied", () => {
    // Update is a merge, so a field the snapshot holds as null must be sent to
    // restore the emptied state rather than leaving the current value.
    const { payload } = buildRestorePayload({ title: null }, fields);

    expect(payload).toEqual({ title: null });
  });

  it("yields nothing for a snapshot that is not an object", () => {
    expect(buildRestorePayload("corrupt", fields)).toEqual({
      payload: {},
      droppedFields: [],
    });
  });
});

describe("buildRestorePayload — layered schemas", () => {
  const ctx = { hasStatus: true, hasSlug: true, hasTitle: true };

  it("keeps the children of a presentational group", () => {
    // A nameless group lays fields out; its children are stored at the top
    // level, so treating the group as one key drops every field inside it.
    const grouped = [
      {
        name: "",
        type: "group",
        fields: [{ name: "city", type: "text" }],
      },
    ] as FieldConfig[];

    const { payload, droppedFields } = buildRestorePayload(
      { city: "Lisbon" },
      grouped,
      ctx
    );

    expect(payload).toEqual({ city: "Lisbon" });
    expect(droppedFields).toEqual([]);
  });

  it("keeps children of a presentational group nested inside another", () => {
    // Layout groups nest, so flattening one level would leave a grandchild's
    // key looking like a field the schema no longer has.
    const nestedGroups = [
      {
        name: "",
        type: "group",
        fields: [
          {
            name: "",
            type: "group",
            fields: [{ name: "city", type: "text" }],
          },
        ],
      },
    ] as FieldConfig[];

    const { payload, droppedFields } = buildRestorePayload(
      { city: "Lisbon" },
      nestedGroups,
      ctx
    );

    expect(payload).toEqual({ city: "Lisbon" });
    expect(droppedFields).toEqual([]);
  });

  it("drops a system column the entity does not have", () => {
    // A plugin collection has `slug` only when it declares it; naming a column
    // the table lacks fails the whole restore.
    const { payload, droppedFields } = buildRestorePayload(
      { title: "Hello", slug: "hello" },
      [{ name: "title", type: "text" }] as FieldConfig[],
      { hasStatus: true, hasSlug: false, hasTitle: true }
    );

    expect(payload).toEqual({ title: "Hello" });
    expect(droppedFields).toEqual(["slug"]);
  });

  it("prunes a key removed from inside a container", () => {
    // Validation walks the schema's fields, not the value's keys, so a removed
    // nested key would be written back into the JSON column untouched.
    const nested = [
      {
        name: "settings",
        type: "group",
        fields: [{ name: "kept", type: "text" }],
      },
    ] as FieldConfig[];

    const { payload, droppedFields } = buildRestorePayload(
      { settings: { kept: "yes", removedSince: "stale" } },
      nested,
      ctx
    );

    expect(payload).toEqual({ settings: { kept: "yes" } });
    expect(droppedFields).toEqual(["settings.removedSince"]);
  });

  it("prunes removed keys inside each row of a repeater", () => {
    const rows = [
      {
        name: "items",
        type: "repeater",
        fields: [{ name: "label", type: "text" }],
      },
    ] as FieldConfig[];

    const { payload, droppedFields } = buildRestorePayload(
      { items: [{ label: "a", gone: 1 }, { label: "b" }] },
      rows,
      ctx
    );

    expect(payload).toEqual({ items: [{ label: "a" }, { label: "b" }] });
    expect(droppedFields).toEqual(["items[0].gone"]);
  });

  it("skips a component whose schema holds a password", () => {
    // A component names its schema by slug rather than carrying it, so without
    // the resolved fields the walk cannot see the password inside.
    const withComponent = [
      { name: "auth", type: "component", component: "credentials" },
    ] as FieldConfig[];

    const componentFields = new Map([
      ["credentials", [{ name: "secret", type: "password" }] as FieldConfig[]],
    ]);

    const { payload, droppedFields } = buildRestorePayload(
      { auth: { _componentType: "credentials" } },
      withComponent,
      { ...ctx, componentFields }
    );

    expect(payload).toEqual({});
    expect(droppedFields).toEqual(["auth"]);
  });

  it("keeps a component instance id so the row is updated, not replaced", () => {
    // The save path uses the id to update the existing row; without it a
    // restore deletes and reinserts instances, taking their per-locale
    // companion rows and other row-scoped state with them.
    const withComponent = [
      { name: "blocks", type: "component", components: ["banner"] },
    ] as FieldConfig[];

    const componentFields = new Map([
      ["banner", [{ name: "heading", type: "text" }] as FieldConfig[]],
    ]);

    const { payload } = buildRestorePayload(
      {
        blocks: [
          { id: "row-1", _componentType: "banner", heading: "Hi", gone: 1 },
        ],
      },
      withComponent,
      { ...ctx, componentFields }
    );

    expect(payload).toEqual({
      blocks: [{ id: "row-1", _componentType: "banner", heading: "Hi" }],
    });
  });

  it("keeps a component's type discriminator when pruning it", () => {
    const withComponent = [
      { name: "hero", type: "component", component: "banner" },
    ] as FieldConfig[];

    const componentFields = new Map([
      ["banner", [{ name: "heading", type: "text" }] as FieldConfig[]],
    ]);

    const { payload } = buildRestorePayload(
      { hero: { _componentType: "banner", heading: "Hi", gone: 1 } },
      withComponent,
      { ...ctx, componentFields }
    );

    expect(payload).toEqual({
      hero: { _componentType: "banner", heading: "Hi" },
    });
  });
});

describe("canRestoreLocale", () => {
  it("allows an unlocalized document regardless of the version's locale", () => {
    expect(canRestoreLocale(false, null)).toBe(true);
    expect(canRestoreLocale(false, "de")).toBe(true);
  });

  it("allows a localized document when the version names its locale", () => {
    expect(canRestoreLocale(true, "de")).toBe(true);
  });

  it("refuses a localized document when the version does not", () => {
    // Writing it anyway would put one language's content into whichever locale
    // happens to be the default.
    expect(canRestoreLocale(true, null)).toBe(false);
  });
});
