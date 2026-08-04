/**
 * A single's row is auto-created on first read by inserting its defaults
 * directly, so nothing on the write path sees them. A function default is
 * resolved for the first time at that moment, which makes this the only place
 * a bad one can be caught — and a contributed control may be read-only, so a
 * value stored here could not be corrected from the UI afterwards.
 */
import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../schema/field-types/field-type-registry";
import { assertValidPluginDefault } from "../services/single-utils";

afterEach(() => clearFieldTypes());

function registerDoc(): void {
  registerFieldType({
    type: "doc",
    storage: "json",
    component: "@acme/doc/admin#Input",
    validate: value =>
      (value as { kind?: string })?.kind === "page"
        ? true
        : "content must be a page document.",
  });
}

describe("assertValidPluginDefault", () => {
  it("refuses a resolved default the field's own type rejects", async () => {
    registerDoc();

    await expect(
      assertValidPluginDefault(
        { name: "content", type: "doc" },
        { kind: "template" },
        "homepage"
      )
    ).rejects.toThrow(NextlyError);
  });

  it("names the field and carries the type's own message", async () => {
    registerDoc();

    let messages = "";
    try {
      await assertValidPluginDefault(
        { name: "content", type: "doc" },
        { kind: "template" },
        "homepage"
      );
    } catch (error) {
      if (!(error instanceof NextlyError)) throw error;
      const data = error.publicData as
        | { errors?: Array<{ path: string; message: string }> }
        | undefined;
      messages = (data?.errors ?? [])
        .map(i => `${i.path}: ${i.message}`)
        .join(" ");
    }

    expect(messages).toContain("content:");
    expect(messages).toContain("must be a page document");
  });

  it("accepts a default the type allows", async () => {
    registerDoc();

    await expect(
      assertValidPluginDefault(
        { name: "content", type: "doc" },
        { kind: "page" },
        "homepage"
      )
    ).resolves.toBeUndefined();
  });

  it("refuses a default that contradicts the type's storage primitive", async () => {
    // A type that declares no `validate` of its own still states what its
    // column holds. Without the primitive check this reaches the auto-create
    // insert and fails at the database on a strict dialect, or stores the
    // wrong representation on SQLite.
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "@acme/ratings/admin#Input",
    });

    await expect(
      assertValidPluginDefault(
        { name: "score", type: "rating" },
        "not-a-number",
        "homepage"
      )
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("accepts a default its storage primitive allows", async () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "@acme/ratings/admin#Input",
    });

    await expect(
      assertValidPluginDefault({ name: "score", type: "rating" }, 4, "homepage")
    ).resolves.toBeUndefined();
  });

  it("refuses an empty default the storage primitive cannot hold", async () => {
    // An empty submission means "not provided" and only `required` applies to
    // it. An empty DEFAULT is what the column will hold, so judging it as an
    // omission let a number-backed `() => ""` reach the insert unchecked.
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "@acme/ratings/admin#Input",
    });

    await expect(
      assertValidPluginDefault(
        { name: "score", type: "rating" },
        "",
        "homepage"
      )
    ).rejects.toBeInstanceOf(NextlyError);
  });

  it("still accepts an empty default the primitive can hold", async () => {
    registerFieldType({
      type: "note",
      storage: "text",
      component: "@acme/notes/admin#Input",
    });

    await expect(
      assertValidPluginDefault({ name: "body", type: "note" }, "", "homepage")
    ).resolves.toBeUndefined();
  });

  it("does not enforce required, which a default cannot violate", async () => {
    // The default IS the value, so absence is not a violation here; enforcing
    // it would refuse configs that boot today.
    registerDoc();

    await expect(
      assertValidPluginDefault(
        { name: "content", type: "doc", required: true } as {
          name?: string;
          type?: string;
        },
        { kind: "page" },
        "homepage"
      )
    ).resolves.toBeUndefined();
  });

  it("leaves a built-in type alone", async () => {
    // Only a contributed type's own rules run here. The built-in checks and the
    // field's own `validate` belong to the write path, and running them would
    // newly refuse defaults that boot fine today.
    await expect(
      assertValidPluginDefault({ name: "title", type: "text" }, 42, "homepage")
    ).resolves.toBeUndefined();
  });
});
