import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldConfig } from "../../collections/fields/types";
import type { NextlyServiceConfig } from "../../di/register";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../plugin-context";

import {
  collectUnresolvedRelationTargets,
  finalizeRelationTargets,
  validateCrossPluginRelations,
  validateMergedRelations,
} from "./validate-relations";

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

describe("validateMergedRelations", () => {
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

describe("collectUnresolvedRelationTargets + finalizeRelationTargets", () => {
  it("collects relationTo targets absent from code+core without throwing", () => {
    const unresolved = collectUnresolvedRelationTargets(
      cfg([coll("posts"), coll("comments", [rel("page", "pages")])])
    );
    expect(unresolved).toEqual([
      { source: "comments", field: "page", target: "pages" },
    ]);
  });

  it("returns nothing when every target is code/core", () => {
    expect(
      collectUnresolvedRelationTargets(
        cfg([coll("posts"), coll("c", [rel("p", "posts")])])
      )
    ).toEqual([]);
  });

  it("finalize: a deferred target present in the Builder set passes (relate-to-Builder)", () => {
    const unresolved = collectUnresolvedRelationTargets(
      cfg([coll("comments", [rel("page", "pages")])])
    );
    expect(() => finalizeRelationTargets(unresolved, ["pages"])).not.toThrow();
  });

  it("finalize: a deferred target absent from the Builder set throws RELATION_TARGET_MISSING", () => {
    const unresolved = collectUnresolvedRelationTargets(
      cfg([coll("comments", [rel("page", "ghost")])])
    );
    const err = caught(() => finalizeRelationTargets(unresolved, ["pages"]));
    expect(err.code).toBe("NEXTLY_SCHEMA_RELATION_TARGET_MISSING");
    expect(err.logContext?.target).toBe("ghost");
  });
});

const plug = (
  name: string,
  opts: Partial<PluginDefinition>
): PluginDefinition => ({
  name,
  version: "1.0.0",
  nextly: ">=0.0.0",
  ...opts,
});

describe("validateCrossPluginRelations (D15 — cross-plugin dependsOn)", () => {
  const a = plug("@t/a", { contributes: { collections: [coll("forms")] } });

  it("passes when the relating plugin declares dependsOn on the target's owner", () => {
    const b = plug("@t/b", {
      contributes: { collections: [coll("comments", [rel("form", "forms")])] },
      dependsOn: { "@t/a": ">=1.0.0" },
    });
    expect(() => validateCrossPluginRelations([a, b])).not.toThrow();
  });

  it("throws NEXTLY_SCHEMA_CROSS_PLUGIN_RELATION without dependsOn", () => {
    const b = plug("@t/b", {
      contributes: { collections: [coll("comments", [rel("form", "forms")])] },
    });
    const err = caught(() => validateCrossPluginRelations([a, b]));
    expect(err.code).toBe("NEXTLY_SCHEMA_CROSS_PLUGIN_RELATION");
    expect(err.logContext?.sourcePlugin).toBe("@t/b");
    expect(err.logContext?.targetPlugin).toBe("@t/a");
    expect(err.logContext?.target).toBe("forms");
  });

  it("needs no dependsOn to relate to a core/code target", () => {
    const c = plug("@t/c", {
      contributes: { collections: [coll("x", [rel("u", "users")])] },
    });
    expect(() => validateCrossPluginRelations([c])).not.toThrow();
  });

  it("needs no dependsOn to relate to its own entity", () => {
    const d = plug("@t/d", {
      contributes: {
        collections: [coll("a"), coll("b", [rel("ref", "a")])],
      },
    });
    expect(() => validateCrossPluginRelations([d])).not.toThrow();
  });

  it("needs no dependsOn to relate to a Builder collection (not a plugin) (P8/OQ-P8-4)", () => {
    // `pages` is a Builder slug — owned by no plugin — so no dependsOn is required.
    const c = plug("@t/c", {
      contributes: { collections: [coll("x", [rel("pg", "pages")])] },
    });
    expect(() => validateCrossPluginRelations([c])).not.toThrow();
  });

  it("requires dependsOn for a cross-plugin relation added via contributes.extend", () => {
    const b = plug("@t/b", {
      contributes: {
        extend: [{ target: "posts", fields: [rel("formRef", "forms")] }],
      },
    });
    const err = caught(() => validateCrossPluginRelations([a, b]));
    expect(err.code).toBe("NEXTLY_SCHEMA_CROSS_PLUGIN_RELATION");
    expect(err.logContext?.sourcePlugin).toBe("@t/b");
    expect(err.logContext?.targetPlugin).toBe("@t/a");
  });

  it("accepts a cross-plugin extend relation when dependsOn is declared", () => {
    const b = plug("@t/b", {
      contributes: {
        extend: [{ target: "posts", fields: [rel("formRef", "forms")] }],
      },
      dependsOn: { "@t/a": ">=1.0.0" },
    });
    expect(() => validateCrossPluginRelations([a, b])).not.toThrow();
  });
});
