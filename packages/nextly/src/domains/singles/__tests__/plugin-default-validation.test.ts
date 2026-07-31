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

  it("leaves a built-in type alone", async () => {
    // Only a contributed type's own rules run here. The built-in checks and the
    // field's own `validate` belong to the write path, and running them would
    // newly refuse defaults that boot fine today.
    await expect(
      assertValidPluginDefault({ name: "title", type: "text" }, 42, "homepage")
    ).resolves.toBeUndefined();
  });
});
