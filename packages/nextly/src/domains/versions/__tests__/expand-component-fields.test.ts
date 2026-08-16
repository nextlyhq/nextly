/**
 * Component references must become something a field walker can descend into.
 *
 * A `component` field carries only a slug; its schema lives elsewhere. The
 * password stripper walks `group` and `repeater` containers, so unless a
 * reference is rewritten into one of those it sees a leaf and a credential
 * declared inside the referenced component survives into the snapshot.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { stripPasswordFieldValues } from "../../../shared/lib/password-fields";
import {
  expandComponentFields,
  stripPasswordsThroughComponents,
} from "../tag-component-types";

const f = (o: Record<string, unknown>) => o as unknown as FieldConfig;

describe("expandComponentFields", () => {
  it("lets the stripper reach a password inside a referenced component", () => {
    // The whole point. Without expansion this snapshot keeps `secret`.
    const schema = [f({ name: "creds", type: "component", component: "auth" })];
    const map = new Map<string, FieldConfig[]>([
      ["auth", [f({ name: "secret", type: "password" })]],
    ]);

    const entry: Record<string, unknown> = {
      creds: { secret: "plaintext-typed-by-the-author" },
    };
    stripPasswordFieldValues(entry, expandComponentFields(schema, map));

    expect(entry.creds).not.toMatchObject({
      secret: "plaintext-typed-by-the-author",
    });
  });

  it("leaves non-password values inside a referenced component alone", () => {
    // The negative control: over-stripping would silently degrade every
    // recovery point, and a strip-everything implementation would satisfy the
    // test above.
    const schema = [f({ name: "creds", type: "component", component: "auth" })];
    const map = new Map<string, FieldConfig[]>([
      [
        "auth",
        [
          f({ name: "secret", type: "password" }),
          f({ name: "label", type: "text" }),
        ],
      ],
    ]);

    const entry: Record<string, unknown> = {
      creds: { secret: "s", label: "Primary" },
    };
    stripPasswordFieldValues(entry, expandComponentFields(schema, map));

    expect(entry.creds).toMatchObject({ label: "Primary" });
  });

  it("reaches a password inside a dynamic zone's candidate component", () => {
    const schema = [
      f({ name: "zone", type: "dynamic-zone", components: ["auth", "hero"] }),
    ];
    const map = new Map<string, FieldConfig[]>([
      ["auth", [f({ name: "secret", type: "password" })]],
      ["hero", [f({ name: "heading", type: "text" })]],
    ]);

    const entry: Record<string, unknown> = {
      zone: [{ secret: "plaintext", heading: "Hi" }],
    };
    stripPasswordFieldValues(entry, expandComponentFields(schema, map));

    const rows = entry.zone as Record<string, unknown>[];
    expect(rows[0]).not.toMatchObject({ secret: "plaintext" });
    // The union strips by NAME across candidates, so an unrelated field from
    // another candidate must survive.
    expect(rows[0]).toMatchObject({ heading: "Hi" });
  });

  it("terminates on a component that references itself", () => {
    // A schema is free to be recursive; expansion must not be.
    const schema = [f({ name: "node", type: "component", component: "tree" })];
    const map = new Map<string, FieldConfig[]>([
      [
        "tree",
        [
          f({ name: "child", type: "component", component: "tree" }),
          f({ name: "secret", type: "password" }),
        ],
      ],
    ]);

    const expanded = expandComponentFields(schema, map);

    const entry: Record<string, unknown> = { node: { secret: "plaintext" } };
    stripPasswordFieldValues(entry, expanded);
    expect(entry.node).not.toMatchObject({ secret: "plaintext" });
  });

  it("descends into an inline group that holds a reference", () => {
    const schema = [
      f({
        name: "outer",
        type: "group",
        fields: [f({ name: "creds", type: "component", component: "auth" })],
      }),
    ];
    const map = new Map<string, FieldConfig[]>([
      ["auth", [f({ name: "secret", type: "password" })]],
    ]);

    const entry: Record<string, unknown> = {
      outer: { creds: { secret: "plaintext" } },
    };
    stripPasswordFieldValues(entry, expandComponentFields(schema, map));

    const outer = entry.outer as Record<string, unknown>;
    expect(outer.creds).not.toMatchObject({ secret: "plaintext" });
  });
});

describe("stripPasswordsThroughComponents", () => {
  const strip = stripPasswordFieldValues;

  it("reaches a password NESTED through a recursive component", () => {
    // The case a schema-side expansion cannot serve: `tree` contains itself,
    // so any expansion must stop at some depth and everything below the
    // cut-off keeps its password. Walking the data terminates naturally.
    const fields = [f({ name: "node", type: "component", component: "tree" })];
    const map = new Map<string, FieldConfig[]>([
      [
        "tree",
        [
          f({ name: "child", type: "component", component: "tree" }),
          f({ name: "secret", type: "password" }),
        ],
      ],
    ]);

    const entry: Record<string, unknown> = {
      node: {
        secret: "level-1",
        child: { secret: "level-2", child: { secret: "level-3" } },
      },
    };
    stripPasswordsThroughComponents(entry, fields, map, strip);

    const node = entry.node as Record<string, unknown>;
    const child = node.child as Record<string, unknown>;
    const grandchild = child.child as Record<string, unknown>;
    expect(node).not.toMatchObject({ secret: "level-1" });
    expect(child).not.toMatchObject({ secret: "level-2" });
    expect(grandchild).not.toMatchObject({ secret: "level-3" });
  });

  it("strips every row of a dynamic zone, not just the first", () => {
    const fields = [
      f({ name: "zone", type: "dynamic-zone", components: ["auth"] }),
    ];
    const map = new Map<string, FieldConfig[]>([
      ["auth", [f({ name: "secret", type: "password" })]],
    ]);

    const entry: Record<string, unknown> = {
      zone: [{ secret: "a" }, { secret: "b" }],
    };
    stripPasswordsThroughComponents(entry, fields, map, strip);

    const rows = entry.zone as Record<string, unknown>[];
    expect(rows[0]).not.toMatchObject({ secret: "a" });
    expect(rows[1]).not.toMatchObject({ secret: "b" });
  });

  it("leaves non-password values alone at every depth", () => {
    // Negative control: a strip-everything walker would satisfy the tests
    // above while destroying the recovery point it exists to preserve.
    const fields = [f({ name: "node", type: "component", component: "tree" })];
    const map = new Map<string, FieldConfig[]>([
      [
        "tree",
        [
          f({ name: "child", type: "component", component: "tree" }),
          f({ name: "secret", type: "password" }),
          f({ name: "label", type: "text" }),
        ],
      ],
    ]);

    const entry: Record<string, unknown> = {
      node: {
        secret: "s",
        label: "outer",
        child: { secret: "s", label: "inner" },
      },
    };
    stripPasswordsThroughComponents(entry, fields, map, strip);

    const node = entry.node as Record<string, unknown>;
    expect(node).toMatchObject({ label: "outer" });
    expect(node.child).toMatchObject({ label: "inner" });
  });

  it("refuses rather than silently skipping an unresolved component", () => {
    // `resolveComponentFieldMap` records a component only when the lookup
    // returned fields, so an unknown slug is ABSENT from the map. Treating
    // absence as "no fields" would descend into that value stripping nothing
    // and leave any password inside it in the snapshot -- a fail-open in the
    // one place that must fail closed.
    const fields = [f({ name: "creds", type: "component", component: "gone" })];
    const entry: Record<string, unknown> = { creds: { secret: "plaintext" } };

    expect(() =>
      stripPasswordsThroughComponents(
        entry,
        fields,
        new Map<string, FieldConfig[]>(),
        strip
      )
    ).toThrow();
  });

  it("strips a password declared inside an UNNAMED presentational group", () => {
    // An unnamed group has no key of its own, so its children's values live at
    // the parent level. Skipping the group because it has no name leaves them
    // untouched -- and nothing about the stored snapshot looks wrong.
    const fields = [
      f({ type: "group", fields: [f({ name: "secret", type: "password" })] }),
    ];
    const entry: Record<string, unknown> = { secret: "plaintext" };

    stripPasswordsThroughComponents(
      entry,
      fields,
      new Map<string, FieldConfig[]>(),
      strip
    );

    expect(entry).not.toMatchObject({ secret: "plaintext" });
  });

  it("reaches a component referenced from an unnamed group", () => {
    const fields = [
      f({
        type: "group",
        fields: [f({ name: "creds", type: "component", component: "auth" })],
      }),
    ];
    const map = new Map<string, FieldConfig[]>([
      ["auth", [f({ name: "secret", type: "password" })]],
    ]);
    const entry: Record<string, unknown> = { creds: { secret: "plaintext" } };

    stripPasswordsThroughComponents(entry, fields, map, strip);

    expect(entry.creds).not.toMatchObject({ secret: "plaintext" });
  });
});
