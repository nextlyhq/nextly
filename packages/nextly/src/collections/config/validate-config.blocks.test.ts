/**
 * A blocks field's policy and default are checked when the config loads, so a
 * field that could never hold a valid document is rejected at the declaration
 * rather than at every write. The same rules apply wherever a blocks field can
 * be declared, so collections, singles, and components are all covered here.
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { ComponentConfig } from "../../components/config/define-component";
import { validateComponentConfig } from "../../components/config/validate-component";
import type { SingleConfig } from "../../singles/config/define-single";
import { validateSingleConfig } from "../../singles/config/validate-single";
import { blocks, text } from "../fields/helpers";
import type { BlocksFieldConfig } from "../fields/types/blocks";
import type { CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

function collectionCodes(field: BlocksFieldConfig): string[] {
  const config: CollectionConfig = {
    slug: "pages",
    fields: [text({ name: "title" }), field],
  };
  return validateCollectionConfig(config).errors.map(e => e.code);
}

function singleCodes(field: BlocksFieldConfig): string[] {
  const config: SingleConfig = {
    slug: "homepage",
    fields: [text({ name: "title" }), field],
  };
  return validateSingleConfig(config).errors.map(e => e.code);
}

function componentCodes(field: BlocksFieldConfig): string[] {
  const config: ComponentConfig = {
    slug: "hero",
    fields: [text({ name: "title" }), field],
  };
  return validateComponentConfig(config).errors.map(e => e.code);
}

function node(type: string): BlockNode {
  return {
    id: `11111111-1111-4111-8111-${type.length.toString().padStart(12, "0")}`,
    type,
    version: 1,
    props: {},
  };
}

/**
 * A policy the type system rejects, which is the point: these cases assert the
 * runtime still refuses configurations TypeScript cannot express as valid.
 */
function withPolicy(policy: unknown): BlocksFieldConfig {
  return {
    name: "content",
    type: "blocks",
    blocks: policy,
  } as BlocksFieldConfig;
}

const surfaces = [
  { name: "collection", codesFor: collectionCodes },
  { name: "single", codesFor: singleCodes },
  { name: "component", codesFor: componentCodes },
];

describe.each(surfaces)("$name blocks field validation", ({ codesFor }) => {
  it("accepts a field with no policy and no default", () => {
    expect(codesFor(blocks({ name: "content" }))).toEqual([]);
  });

  it("rejects an empty kinds list", () => {
    // A field accepting no kind at all can never hold a document, so the
    // contradiction belongs in the declaration rather than in every write.
    expect(
      codesFor(blocks({ name: "content", blocks: { kinds: [] } }))
    ).toContain("FIELD_TYPE_INVALID");
  });

  it("accepts a non-empty kinds list", () => {
    expect(
      codesFor(blocks({ name: "content", blocks: { kinds: ["template"] } }))
    ).toEqual([]);
  });

  it("rejects an unknown document kind", () => {
    // The field-level check accepts a kind purely because it is listed here,
    // so nothing downstream would ever reject it.
    expect(codesFor(withPolicy({ kinds: ["nonsense"] }))).toContain(
      "FIELD_TYPE_INVALID"
    );
  });

  it("rejects a non-array allow list", () => {
    // The write-time check calls `.some()` on it, so a wrong shape would crash
    // every write rather than fail the configuration.
    expect(codesFor(withPolicy({ allow: "core/*" }))).toContain(
      "FIELD_TYPE_INVALID"
    );
  });

  it("rejects a non-object policy", () => {
    expect(codesFor(withPolicy(["core/*"]))).toContain("FIELD_TYPE_INVALID");
  });

  it("rejects a default whose kind the field does not accept", () => {
    expect(
      codesFor(
        blocks({
          name: "content",
          blocks: { kinds: ["template"] },
          defaultValue: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "page",
            nodes: [],
          },
        })
      )
    ).toContain("FIELD_DEFAULT_INVALID");
  });

  it("rejects a default holding a block the allow-list excludes", () => {
    expect(
      codesFor(
        blocks({
          name: "content",
          blocks: { allow: ["core/*"] },
          defaultValue: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "page",
            nodes: [node("marketing/banner")],
          },
        })
      )
    ).toContain("FIELD_DEFAULT_INVALID");
  });

  it("accepts a default holding a block the allow-list permits", () => {
    expect(
      codesFor(
        blocks({
          name: "content",
          blocks: { allow: ["core/*"] },
          defaultValue: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "page",
            nodes: [node("core/heading")],
          },
        })
      )
    ).toEqual([]);
  });

  it("accepts a default whose kind the field accepts", () => {
    expect(
      codesFor(
        blocks({
          name: "content",
          blocks: { kinds: ["template"] },
          defaultValue: {
            formatVersion: 1,
            kind: "template",
            nodes: [],
          },
        })
      )
    ).toEqual([]);
  });

  it("leaves a function default to the write path", () => {
    // Resolved per entry, so there is no value to check at config time.
    expect(
      codesFor(
        blocks({
          name: "content",
          defaultValue: () => ({
            formatVersion: 1 as const,
            kind: "page" as const,
            nodes: [],
          }),
        })
      )
    ).toEqual([]);
  });
});
