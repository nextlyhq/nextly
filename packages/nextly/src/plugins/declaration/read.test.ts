/**
 * Reading a package.json's `nextly` key: nothing declared, today's
 * registration block, a declaration, and a format newer than this Nextly.
 */
import { describe, expect, it } from "vitest";

import { readPluginPackageDeclaration } from "./read";

describe("reading a package's nextly key", () => {
  it.each([
    ["no package.json value", undefined],
    ["no nextly key", { name: "@acme/seo" }],
    ["a nextly key that is not an object", { nextly: "yes" }],
    ["a nextly key with neither format nor plugin", { nextly: { other: 1 } }],
  ])("finds nothing declared with %s", (_, manifest) => {
    expect(readPluginPackageDeclaration(manifest)).toEqual({ kind: "none" });
  });

  it("reads a package with only today's registration block as it always was", () => {
    expect(
      readPluginPackageDeclaration({
        nextly: { plugin: { export: "default" } },
      })
    ).toEqual({ kind: "registration", registration: { export: "default" } });
  });

  it("refuses a malformed registration block, naming the field", () => {
    expect(
      readPluginPackageDeclaration({ nextly: { plugin: { export: "a-b" } } })
    ).toEqual({
      kind: "invalid",
      of: "registration",
      problems: [
        "nextly.plugin.export: `export` must be a JavaScript name, or `default`",
      ],
    });
  });

  it("reads a declaration in a newer format only for its Nextly versions", () => {
    // Fields that mean something else in format 2 are not read as format 1's,
    // so a malformed one does not turn the answer into "invalid".
    expect(
      readPluginPackageDeclaration({
        nextly: { format: 2, core: " ^1.0.0 ", databases: "every" },
      })
    ).toEqual({ kind: "newer-format", format: 2, core: "^1.0.0" });
    expect(readPluginPackageDeclaration({ nextly: { format: 99 } })).toEqual({
      kind: "newer-format",
      format: 99,
    });
  });
});
