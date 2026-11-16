/**
 * A blocks field's rows: each registered block its allow-list admits, with
 * that block's props, read-only and naming who registered it; the entries
 * that admit no registered block; and why the blocks are not shown, when
 * they are not.
 */
import { describe, expect, it } from "vitest";

import {
  nestedFixtureBlockCatalogs,
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "@admin/components/features/schema-builder/__fixtures__/nested-fixture";
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { blockCatalogKey, type BlockCatalog } from "../block-rows";
import {
  buildOutline,
  describeReadOnly,
  flattenOutline,
  type OutlineNode,
} from "../outline-model";

function outline(
  blockCatalogs?: ReadonlyMap<string, BlockCatalog>,
  fields: BuilderField[] = nestedFixtureFields()
): Map<string, OutlineNode> {
  return new Map(
    flattenOutline(
      buildOutline(fields, {
        entityReadOnly: false,
        fieldGroups: nestedFixtureFieldGroups(),
        ...(blockCatalogs ? { blockCatalogs } : {}),
      })
    ).map(node => [node.path, node])
  );
}

describe("a blocks field's rows", () => {
  it("draws each accepted block with its props beneath it, read-only, naming who registered it", () => {
    const rows = outline(nestedFixtureBlockCatalogs());
    expect(rows.get("body")?.children.map(child => child.path)).toEqual([
      "body/#core/heading",
    ]);
    const heading = rows.get("body/#core/heading");
    expect(heading).toMatchObject({
      meta: "block",
      typeName: "Block",
      container: "block",
      own: false,
      readOnly: { kind: "block", source: "@nextlyhq/plugin-page-builder" },
    });
    expect(heading?.field.label).toBe("Heading");
    expect(
      heading?.children.map(prop => [prop.field.label, prop.typeName])
    ).toEqual([
      ["Text", "string"],
      ["Level", "select"],
    ]);
    expect(rows.get("body/#core/heading/#level")?.meta).toBe("prop");
    expect(
      describeReadOnly({
        kind: "block",
        source: "@nextlyhq/plugin-page-builder",
      })
    ).toBe("Defined by @nextlyhq/plugin-page-builder");
    expect(describeReadOnly({ kind: "block", source: null })).toBe(
      "A registered block"
    );
  });

  it("names the entries that admit no registered block", () => {
    expect(outline(nestedFixtureBlockCatalogs()).get("body")?.blocks).toEqual({
      allow: ["core/heading", "acme/hero"],
      unmatched: ["acme/hero"],
    });
  });

  it.each(["loading", "failed", "unavailable"] as const)(
    "draws no block, and says why, while its listing is %s",
    state => {
      const body = outline(
        new Map([[blockCatalogKey(["core/heading", "acme/hero"]), { state }]])
      ).get("body");
      expect(body?.children).toEqual([]);
      expect(body?.blocks?.unavailable).toBe(state);
    }
  );

  it("reads nothing for a field accepting no block", () => {
    const rows = outline(new Map(), [
      {
        id: "f-none",
        name: "none",
        label: "None",
        type: "blocks",
        blocks: { allow: [] },
      } as BuilderField,
    ]);
    expect(rows.get("none")?.blocks).toEqual({ allow: [] });
  });

  it("shows the policy alone when nothing asked for the listing", () => {
    expect(outline().get("body")?.blocks).toEqual({
      allow: ["core/heading", "acme/hero"],
    });
  });
});
