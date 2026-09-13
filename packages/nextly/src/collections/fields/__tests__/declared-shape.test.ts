/**
 * The projection publishes the declaration, and the classification is total.
 *
 * The first case here is the one that matters. A projection spelled as a list
 * of member names cannot notice that a name is absent from it, so the guard
 * cannot be another list: it has to read the schema every stored declaration is
 * validated against and insist that each key there was CLASSIFIED, as published
 * or as withheld.
 *
 * That turns "somebody forgot to forward the new key" into a red test on the
 * commit that adds the key, which is the only place the question can be
 * answered by the person who knows the answer.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { uiSchemaFieldSchema } from "../../../schemas/_zod/ui-schema";
import {
  declaredShape,
  SCHEMA_FIELD_KEYS,
  WITHHELD_FIELD_KEYS,
} from "../declared-shape";

/**
 * The manifest field schema's declared keys.
 *
 * `uiSchemaFieldSchema` is `z.lazy(() => z.object({...}).superRefine(...))`
 * because the shape references itself for nested fields, and it is typed as the
 * interface it validates rather than as the object, so neither the thunk nor
 * the shape is reachable through the declared type. Unwrapped through the
 * runtime members here rather than by re-listing the keys, because a re-listed
 * copy is the very thing this file exists to make unnecessary.
 *
 * Returns whatever it found, including nothing. The caller asserts the count,
 * so an unwrap that stops working fails loudly instead of certifying an empty
 * set against an empty set.
 */
function manifestFieldKeys(): string[] {
  const lazy = uiSchemaFieldSchema as unknown as {
    _def?: { getter?: () => unknown };
  };
  const inner = lazy._def?.getter?.();
  const object = inner as { shape?: Record<string, unknown> } | undefined;
  return Object.keys(object?.shape ?? {});
}

/**
 * The field keys the type generator reads off a declaration.
 *
 * A SECOND domain, because the manifest schema is not the whole one. It nests a
 * text field's bounds under `validation`, so a classification total over it
 * alone cannot see `minLength` written flat, which is how a code-first field is
 * allowed to write it and how the generator reads it. A guard that is total
 * over one of two schemas is a guard with the other one's keys outside it.
 *
 * Read from the generator's source rather than re-listed, for the same reason
 * the manifest keys are: a copy here is the thing this file exists to make
 * unnecessary. The caller asserts what the scan found before judging it.
 */
function generatorConsumedKeys(): string[] {
  const src = readFileSync(
    fileURLToPath(
      new URL(
        "../../../domains/schema/services/zod-generator.ts",
        import.meta.url
      )
    ),
    "utf8"
  );
  const keys = new Set<string>();
  for (const m of src.matchAll(/"([a-zA-Z_]+)" in field/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\bfield\.([a-zA-Z_]+)\b/g)) keys.add(m[1]);
  return [...keys].sort();
}

describe("every key the GENERATOR consumes is classified", () => {
  it("reaches the generator source at all", () => {
    // The control. An empty scan satisfies the totality check below perfectly,
    // and a moved file would produce exactly that.
    const keys = generatorConsumedKeys();

    expect(
      keys.length,
      "the generator source could not be scanned, so the check below proves " +
        "nothing"
    ).toBeGreaterThan(5);
    expect(keys).toContain("minLength");
  });

  it("classifies each one, so a constraint the API enforces is described", () => {
    // A key the generator reads is a key that shapes what the API will ACCEPT.
    // Leaving it unclassified means the projection describes a field as
    // unbounded while a write that exceeds the bound is still rejected.
    const published = new Set(SCHEMA_FIELD_KEYS);
    const withheld = new Set(WITHHELD_FIELD_KEYS);

    const unclassified = generatorConsumedKeys().filter(
      key => !published.has(key) && !withheld.has(key)
    );
    expect(
      unclassified,
      "these keys shape the generated validation schema and are classified " +
        "neither way. Publish the ones that describe the value; withhold the " +
        "rest deliberately"
    ).toEqual([]);
  });
});

describe("every key the manifest declares is classified", () => {
  it("reaches the manifest schema at all", () => {
    // The control. Every assertion below is satisfied perfectly by an unwrap
    // that returned nothing, so the instrument is checked before it is read.
    // The count is a floor rather than an exact number: this must not fail
    // merely because a key was added, which is what the next case is for.
    const keys = manifestFieldKeys();

    expect(
      keys.length,
      "the manifest field schema could not be unwrapped, so the classification " +
        "check below proves nothing"
    ).toBeGreaterThan(20);
    expect(keys).toContain("relationTo");
  });

  it("classifies each one as published or withheld, and never as both", () => {
    // The guard the recurrence is closed by. A key added to the manifest and
    // classified nowhere fails here, on the commit that adds it.
    const published = new Set(SCHEMA_FIELD_KEYS);
    const withheld = new Set(WITHHELD_FIELD_KEYS);

    const unclassified = manifestFieldKeys().filter(
      key => !published.has(key) && !withheld.has(key)
    );
    expect(
      unclassified,
      "these keys are declared by the manifest field schema and appear in " +
        "neither SCHEMA_FIELD_KEYS nor WITHHELD_FIELD_KEYS. Decide whether " +
        "each describes the field's value (publish it) or is presentation, " +
        "private plugin configuration or a function (withhold it)"
    ).toEqual([]);

    const both = SCHEMA_FIELD_KEYS.filter(key => withheld.has(key));
    expect(both, "a key cannot be both published and withheld").toEqual([]);
  });
});

describe("what the projection publishes", () => {
  it("carries a select's choices in BOTH spellings", () => {
    // The spelling split, which no code-first fixture exposes. A code-first select declares `options`; a
    // Builder-authored one declares `fieldOptions`, and a projection copying
    // only the first returns a Builder select with no choices at all while
    // looking correct against every code-first fixture.
    const [fromCode, fromBuilder] = declaredShape([
      { name: "status", type: "select", options: [{ label: "A", value: "a" }] },
      {
        name: "tier",
        type: "select",
        fieldOptions: [{ label: "B", value: "b" }],
      },
    ]);

    expect(fromCode!.options).toEqual([{ label: "A", value: "a" }]);
    expect(fromBuilder!.fieldOptions).toEqual([{ label: "B", value: "b" }]);
  });

  it("carries which field group a component embeds, in every spelling", () => {
    // A component field is a reference, not a container: without these it
    // reports a field of type `component` and nothing about what may go in it.
    // Four spellings because the storage migration rewrites the first two.
    const [single, many, migrated] = declaredShape([
      { name: "seo", type: "component", component: "seo" },
      { name: "zone", type: "component", components: ["hero", "cta"] },
      { name: "moved", type: "fieldGroup", fieldGroup: "seo" },
    ]);

    expect(single!.component).toBe("seo");
    expect(many!.components).toEqual(["hero", "cta"]);
    expect(migrated!.fieldGroup).toBe("seo");
  });

  it("carries a relationship's target and cardinality", () => {
    const [rel] = declaredShape([
      {
        name: "author",
        type: "relationship",
        relationTo: "users",
        hasMany: true,
      },
    ]);

    expect(rel!.relationTo).toBe("users");
    expect(rel!.hasMany).toBe(true);
  });
});

describe("what the projection withholds", () => {
  it("publishes no withheld key, even when every one is present", () => {
    // Asserted over the whole withheld list rather than per key, so a key added
    // to that list is covered by this test without anyone extending it.
    const source: Record<string, unknown> = { name: "title", type: "text" };
    for (const key of WITHHELD_FIELD_KEYS) source[key] = { secret: true };

    const [published] = declaredShape([source]);

    const leaked = WITHHELD_FIELD_KEYS.filter(key => key in published!);
    expect(leaked).toEqual([]);
    // The positive control: the field itself survived, so the emptiness above
    // is the filter working rather than the projection dropping everything.
    expect(published!.name).toBe("title");
  });

  it("drops a function value on a key it otherwise publishes", () => {
    // `defaultValue` is a plain value on a stored declaration and
    // `(data) => unknown` on a code-first one. The key is worth publishing and
    // the callable form is not: it serializes to nothing.
    const [computed, literal] = declaredShape([
      { name: "created", type: "date", defaultValue: () => "now" },
      { name: "state", type: "text", defaultValue: "draft" },
    ]);

    expect("defaultValue" in computed!).toBe(false);
    expect(literal!.defaultValue).toBe("draft");
  });

  it("omits an absent name rather than writing the key as undefined", () => {
    // A presentational field carries no name. `name: undefined` satisfies the
    // optional type and still appears in `Object.keys` and in an `in` check, so
    // a consumer enumerating members sees one that is not there.
    const [published] = declaredShape([{ type: "ui/divider" }]);

    expect("name" in published!).toBe(false);
  });

  it("drops an entry that declares no type", () => {
    // Every consumer dispatches on `type`, and the container rule reads it.
    // Defaulting one would put a shape in the answer that nothing declared.
    expect(declaredShape([{ name: "orphan" }, "not-a-field", null])).toEqual(
      []
    );
  });
});

describe("containment", () => {
  it("describes a container's children, recursively", () => {
    const [group] = declaredShape([
      {
        name: "hero",
        type: "group",
        fields: [
          {
            name: "inner",
            type: "repeater",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    ]);

    expect(group!.fields?.[0]?.fields?.[0]?.name).toBe("body");
  });

  it("reduces a container's children by the same rules as the top level", () => {
    // The recursion has to apply the filter, not just walk. A nested field
    // carrying private configuration would otherwise be published intact
    // because only the outer level was reduced.
    const [group] = declaredShape([
      {
        name: "hero",
        type: "group",
        fields: [
          { name: "body", type: "text", pluginOptions: { key: "private" } },
        ],
      },
    ]);

    expect("pluginOptions" in group!.fields![0]!).toBe(false);
  });

  it("drops a `fields` option on a type that is not a container", () => {
    // A contributed field type carries an index signature, so `fields` may hold
    // its own configuration — here an array, so an `Array.isArray` check alone
    // passes it through. The TYPE is what decides.
    const [chart] = declaredShape([
      { name: "chart", type: "acme/chart", fields: [{ some: "config" }] },
    ]);

    expect("fields" in chart!).toBe(false);
  });

  it("treats a field group as a leaf rather than a container", () => {
    // Its children belong to the group's own declaration, reached by the slug
    // this field names. Walking a `fields` array here would publish a copy that
    // the group is free to contradict.
    const [embedded] = declaredShape([
      {
        name: "seo",
        type: "component",
        component: "seo",
        fields: [{ name: "stale", type: "text" }],
      },
    ]);

    expect("fields" in embedded!).toBe(false);
    expect(embedded!.component).toBe("seo");
  });
});
