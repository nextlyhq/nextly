import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { defineConfig } from "../define-config";

const field = { type: "text" as const, name: "title" };

function build(dbName: string, kind: "collections" | "singles") {
  const entity = {
    slug: "widgets",
    label: { singular: "Widget", plural: "Widgets" },
    dbName,
    fields: [field],
  };
  return () =>
    defineConfig({
      collections: kind === "collections" ? [entity] : [],
      singles: kind === "singles" ? [entity] : [],
    } as never);
}

// The field-group storage migration will create tables under `fg_`. A config
// that claims the prefix first would leave the migration renaming onto a table
// it does not own, so the claim is refused while it is still only a config edit.
describe("reserved field-group table prefix", () => {
  it.each(["collections", "singles"] as const)(
    "rejects a %s dbName that claims the reserved prefix",
    kind => {
      expect(build("fg_widgets", kind)).toThrow(NextlyError);
    }
  );

  it("matches the prefix regardless of case", () => {
    // Identifier case is server configuration, so an upper-case spelling can
    // still land on the same table.
    expect(build("FG_Widgets", "collections")).toThrow(NextlyError);
  });

  it("names the offending table and the prefix in the failure detail", () => {
    try {
      build("fg_widgets", "collections")();
      expect.unreachable("expected a reserved-prefix failure");
    } catch (error) {
      const detail = JSON.stringify(error);
      expect(detail).toContain("fg_widgets");
      expect(detail).toContain("RESERVED_TABLE_PREFIX");
    }
  });

  it("allows a dbName that merely contains the prefix elsewhere", () => {
    // Only the leading position is reserved; `my_fg_widgets` is not storage the
    // migration will ever address.
    expect(build("my_fg_widgets", "collections")).not.toThrow();
  });

  it("allows an unrelated dbName", () => {
    expect(build("dc_widgets", "collections")).not.toThrow();
  });
});
