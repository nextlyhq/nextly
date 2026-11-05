/**
 * A document's version in the generated types: a read gives `_rev`, an update
 * sends it back or chooses `_overwrite`, and a create carries neither. An
 * update that says neither is refused, so the types must let a caller write
 * either without a cast.
 */
import { describe, expect, it } from "vitest";

import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import type { DynamicSingleRecord } from "../../../schemas/dynamic-singles/types";
import { TypeGenerator } from "./type-generator";

const posts = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [{ name: "title", type: "text", required: true }],
  timestamps: true,
} as unknown as DynamicCollectionRecord;

const settings = {
  slug: "settings",
  label: "Settings",
  fields: [{ name: "notice", type: "text" }],
} as unknown as DynamicSingleRecord;

const code = () =>
  new TypeGenerator().generateTypesFile([posts], [settings]).code;

/** The body of one generated interface or type alias, by name. */
function declarationOf(source: string, name: string): string {
  const start = source.search(new RegExp(`export (interface|type) ${name}\\b`));
  if (start < 0) throw new Error(`no ${name} in the generated code`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("the version in generated types", () => {
  it("is on what a read gives, for a collection entry and a Single", () => {
    expect(declarationOf(code(), "Posts")).toContain("  _rev?: string;");
    expect(declarationOf(code(), "Settings")).toContain("  _rev?: string;");
  });

  it("lets an update send the version back or choose to overwrite", () => {
    for (const name of ["PostsUpdateInput", "SettingsUpdateInput"]) {
      const update = declarationOf(code(), name);
      // `_rev` reaches the input through `Partial` of the read's type.
      expect(update, name).toContain("Partial<");
      expect(update, name).toContain("_overwrite?: boolean");
    }
  });

  it("leaves both out of a create, which is never judged by version", () => {
    const create = declarationOf(code(), "PostsCreateInput");
    expect(create).toContain('"_rev"');
    expect(create).not.toContain("_overwrite");
  });
});
