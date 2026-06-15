import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldConfig } from "../../collections/fields/types";
import type { NextlyServiceConfig } from "../../di/register";
import { NextlyError } from "../../errors/nextly-error";

import { validateMergedRelations } from "./validate-relations";

const rel = (name: string, relationTo: string | string[]): FieldConfig =>
  ({ name, type: "relationship", relationTo }) as unknown as FieldConfig;
const coll = (slug: string, fields: FieldConfig[] = []): CollectionConfig =>
  ({ slug, fields }) as unknown as CollectionConfig;
const cfg = (collections: CollectionConfig[]): NextlyServiceConfig =>
  ({
    collections,
    singles: [],
    components: [],
  }) as unknown as NextlyServiceConfig;

const caught = (fn: () => unknown): NextlyError => {
  try {
    fn();
  } catch (err) {
    return err as NextlyError;
  }
  throw new Error("expected validateMergedRelations to throw");
};

describe("validateMergedRelations (D15)", () => {
  it("accepts a relationTo pointing at a collection in the merged set", () => {
    expect(() =>
      validateMergedRelations(
        cfg([coll("posts"), coll("comments", [rel("post", "posts")])])
      )
    ).not.toThrow();
  });

  it("accepts the core relation targets (users/media)", () => {
    expect(() =>
      validateMergedRelations(cfg([coll("comments", [rel("author", "users")])]))
    ).not.toThrow();
  });

  it("throws NEXTLY_SCHEMA_RELATION_TARGET_MISSING for an unknown target", () => {
    const err = caught(() =>
      validateMergedRelations(cfg([coll("comments", [rel("post", "ghost")])]))
    );
    expect(err.code).toBe("NEXTLY_SCHEMA_RELATION_TARGET_MISSING");
    expect(err.logContext?.target).toBe("ghost");
    expect(err.logContext?.source).toBe("comments");
  });

  it("a plugin-free config with internal relations passes unchanged (G6 guard)", () => {
    expect(() =>
      validateMergedRelations(
        cfg([coll("authors"), coll("books", [rel("author", "authors")])])
      )
    ).not.toThrow();
  });

  it("validates every target of a polymorphic relationTo array", () => {
    const err = caught(() =>
      validateMergedRelations(
        cfg([coll("posts"), coll("comments", [rel("ref", ["posts", "ghost"])])])
      )
    );
    expect(err.logContext?.target).toBe("ghost");
  });
});
