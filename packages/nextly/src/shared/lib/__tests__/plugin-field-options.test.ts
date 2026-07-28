/**
 * A plugin-contributed field type can state rules about its own DECLARATION.
 *
 * `validate` answers "is this value allowed in this field". This answers "is
 * this field declared coherently at all" — and the distinction matters because
 * a schema defect reported per write is reported to the wrong person: the
 * writer cannot fix it, and it fails every write until whoever declared the
 * field notices.
 */
import { describe, expect, it, afterEach, vi } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
  withoutDisabledBehavior,
} from "../../../domains/schema/field-types/field-type-registry";
import type { PluginFieldType } from "../../../plugins/contributions";
import { pluginFieldOptionIssues } from "../plugin-field-options";

afterEach(() => {
  clearFieldTypes();
});

/** Register a type whose declaration check returns whatever the test wants. */
function registerDocument(
  validateOptions: PluginFieldType["validateOptions"]
): void {
  registerFieldType({
    type: "document",
    storage: "json",
    component: "@acme/docs/admin#DocumentInput",
    validateOptions,
  });
}

describe("plugin field-type option validation", () => {
  it("accepts a declaration the type approves", () => {
    registerDocument(() => true);

    expect(pluginFieldOptionIssues({ name: "body", type: "document" })).toEqual(
      []
    );
  });

  it("reports a string return against the field itself", () => {
    registerDocument(() => "blocks must declare allow or kinds");

    expect(pluginFieldOptionIssues({ name: "body", type: "document" })).toEqual(
      [{ message: "blocks must declare allow or kinds.", path: undefined }]
    );
  });

  it("locates an array return against the option it names", () => {
    registerDocument(() => [
      {
        path: "blocks.kinds",
        code: "EMPTY_POLICY",
        message: "kinds cannot be empty",
      },
      { message: "the field accepts nothing" },
    ]);

    // No code survives: the config validators report through closed, public
    // code unions, so a plugin-defined string would reach a consumer handling
    // the declared members exhaustively and be one none of them covers.
    expect(pluginFieldOptionIssues({ name: "body", type: "document" })).toEqual(
      [
        { path: "blocks.kinds", message: "kinds cannot be empty." },
        { path: undefined, message: "the field accepts nothing." },
      ]
    );
  });

  it("gives the check the whole declaration to read", () => {
    const seen = vi.fn(() => true as const);
    registerDocument(seen);

    pluginFieldOptionIssues({
      name: "body",
      type: "document",
      blocks: { kinds: ["page"] },
    });

    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "body",
        type: "document",
        blocks: { kinds: ["page"] },
      })
    );
  });

  it("hands over a detached declaration", () => {
    const kinds = ["page"];
    registerDocument(field => {
      const blocks = field.blocks;
      if (blocks !== null && typeof blocks === "object") {
        (blocks as { kinds: string[] }).kinds.push("injected");
      }
      return true;
    });

    pluginFieldOptionIssues({
      name: "body",
      type: "document",
      blocks: { kinds },
    });

    // The config being validated is about to be registered; a check that edits
    // it would change the schema the app then runs on.
    expect(kinds).toEqual(["page"]);
  });

  it("treats a throwing check as a rejected declaration, not a failed boot", () => {
    registerDocument(() => {
      throw new Error("plugin is confused");
    });

    // One defective plugin must not stop the app from starting with a stack
    // trace: the field it declared is refused, and the message says which.
    expect(pluginFieldOptionIssues({ name: "body", type: "document" })).toEqual(
      [{ message: "document field is not declared correctly." }]
    );
  });

  it("refuses a return outside the documented union", () => {
    registerDocument(
      (() => undefined) as unknown as PluginFieldType["validateOptions"]
    );

    expect(pluginFieldOptionIssues({ name: "body", type: "document" })).toEqual(
      [{ message: "document field is not declared correctly." }]
    );
  });

  it("leaves built-in and unregistered types alone", () => {
    registerDocument(() => "never runs");

    expect(pluginFieldOptionIssues({ name: "title", type: "text" })).toEqual(
      []
    );
    expect(
      pluginFieldOptionIssues({ name: "x", type: "unregistered" })
    ).toEqual([]);
    expect(pluginFieldOptionIssues({ name: "x" })).toEqual([]);
  });

  it("does not run for a disabled plugin's type", () => {
    // Declaration checks are the plugin's code, exactly as `validate` is, and a
    // disabled plugin contributes no behavior — but its collections are
    // retained, so their fields must still resolve.
    const document: PluginFieldType = {
      type: "document",
      storage: "json",
      component: "@acme/docs/admin#DocumentInput",
      validateOptions: () => "this must never run",
    };
    registerFieldType(withoutDisabledBehavior(document, { enabled: false }));

    expect(pluginFieldOptionIssues({ name: "body", type: "document" })).toEqual(
      []
    );
  });
});
