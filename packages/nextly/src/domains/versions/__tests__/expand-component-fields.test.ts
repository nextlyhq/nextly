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
import { expandComponentFields } from "../tag-component-types";

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
