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

  it("terminates when an unnamed container's fields reach itself", () => {
    // The version-read path calls this after the resolver, so a schema whose
    // unnamed group holds itself reached here even once the resolver was safe.
    // This branch recurses on the SAME value with a different field list, which
    // is the only one that can loop.
    const group: Record<string, unknown> = { fields: [] };
    (group.fields as unknown[]).push(
      group,
      f({ name: "secret", type: "password" })
    );

    const entry: Record<string, unknown> = { secret: "hunter2" };
    stripPasswordsThroughComponents(
      entry,
      [group] as unknown as FieldConfig[],
      new Map(),
      strip
    );

    // Terminated AND still did its job: the password beside the cycle is gone.
    expect(entry.secret).toBeUndefined();
  });

  it("walks the SAME unnamed container once per row, not once in total", () => {
    // The control for the guard above, and it has to reach the guarded branch
    // to mean anything: the container must be UNNAMED, so each row descends
    // through the very same object. Tracking visited containers globally
    // rather than per-path walks row one and silently skips the rest, leaving
    // every later row's password in the snapshot.
    const layout = { fields: [f({ name: "secret", type: "password" })] };
    const rows = f({
      name: "items",
      type: "repeater",
      fields: [layout],
    });

    const entry: Record<string, unknown> = {
      items: [{ secret: "a" }, { secret: "b" }, { secret: "c" }],
    };
    stripPasswordsThroughComponents(
      entry,
      [rows] as unknown as FieldConfig[],
      new Map(),
      strip
    );

    const walked = entry.items as Record<string, unknown>[];
    expect(walked.map(r => r.secret)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

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

  it("strips a password inside a migrated fieldGroup reference", () => {
    // The separating case for the dual-vocabulary reads: a definition whose
    // type token and reference key are both migrated spellings. A slug walk
    // reading only the legacy keys finds nothing here, and the plaintext
    // rides into the version snapshot.
    const fields = [
      f({ name: "auth", type: "fieldGroup", fieldGroup: "auth" }),
    ];
    const map = new Map<string, FieldConfig[]>([
      ["auth", [f({ name: "secret", type: "password" })]],
    ]);

    const entry: Record<string, unknown> = {
      auth: { secret: "plaintext" },
    };
    stripPasswordsThroughComponents(entry, fields, map, strip);

    expect(entry.auth).not.toMatchObject({ secret: "plaintext" });
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

  it("judges each dynamic-zone row against its OWN component schema", () => {
    // Two alternatives share the field name `token`; only one declares it a
    // password. Unioning would empty it from BOTH rows, quietly destroying a
    // legitimate value in the recovery point.
    const fields = [
      f({ name: "zone", type: "dynamic-zone", components: ["auth", "embed"] }),
    ];
    const map = new Map<string, FieldConfig[]>([
      ["auth", [f({ name: "token", type: "password" })]],
      ["embed", [f({ name: "token", type: "text" })]],
    ]);

    const entry: Record<string, unknown> = {
      zone: [
        { _componentType: "auth", token: "secret-value" },
        { _componentType: "embed", token: "public-value" },
      ],
    };
    stripPasswordsThroughComponents(entry, fields, map, strip);

    const rows = entry.zone as Record<string, unknown>[];
    expect(rows[0]).not.toMatchObject({ token: "secret-value" });
    // The ordinary alternative keeps its value.
    expect(rows[1]).toMatchObject({ token: "public-value" });
  });

  it("falls back to the union for an untagged row", () => {
    // No tag means nothing to select on, and over-stripping beats leaking.
    const fields = [
      f({ name: "zone", type: "dynamic-zone", components: ["auth", "embed"] }),
    ];
    const map = new Map<string, FieldConfig[]>([
      ["auth", [f({ name: "token", type: "password" })]],
      ["embed", [f({ name: "token", type: "text" })]],
    ]);

    const entry: Record<string, unknown> = { zone: [{ token: "unknown" }] };
    stripPasswordsThroughComponents(entry, fields, map, strip);

    expect((entry.zone as Record<string, unknown>[])[0]).not.toMatchObject({
      token: "unknown",
    });
  });
});
