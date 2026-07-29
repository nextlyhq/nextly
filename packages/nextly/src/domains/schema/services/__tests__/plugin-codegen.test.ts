/**
 * A plugin field type renders itself in the generated output.
 *
 * The generators know the built-in types by name, so without this a custom type
 * lands on the fallback: `unknown`/`string` in the TypeScript file and no entry
 * at all in the Zod schema. Either makes a structured plugin type something the
 * app has to cast at every use, which is the reason a plugin would contribute a
 * real type instead of storing opaque JSON.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { PluginFieldType } from "../../../../plugins/contributions";
import type { DynamicCollectionRecord } from "../../../../schemas/dynamic-collections/types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../field-types/field-type-registry";
import { TypeGenerator } from "../type-generator";
import { ZodGenerator } from "../zod-generator";

/** A type whose generated shape narrows to the options the field declares. */
const RATING: PluginFieldType = {
  type: "star-rating",
  storage: "number",
  component: "@acme/ratings/admin#StarRating",
  codegen: {
    imports: [{ names: ["Rating"], from: "@acme/ratings" }],
    tsType: field => {
      const max = (field as { ratingScale?: { max?: number } }).ratingScale
        ?.max;
      return typeof max === "number" ? `Rating<${max}>` : "Rating";
    },
    zodSchema: field => {
      const max = (field as { ratingScale?: { max?: number } }).ratingScale
        ?.max;
      return typeof max === "number"
        ? `z.number().min(0).max(${max})`
        : "z.number()";
    },
  },
};

/** A type that contributes nothing, to pin the fallback it should get. */
const OPAQUE: PluginFieldType = {
  type: "opaque-thing",
  storage: "json",
  component: "@acme/opaque/admin#OpaqueInput",
};

/** Number-backed and silent, where the storage fallback is worth something. */
const TALLY: PluginFieldType = {
  type: "tally",
  storage: "number",
  component: "@acme/tally/admin#TallyInput",
};

const collection = (fields: unknown[]) =>
  ({
    slug: "posts",
    labels: { singular: "Post", plural: "Posts" },
    fields,
  }) as unknown as DynamicCollectionRecord;

afterEach(() => {
  clearFieldTypes();
});

describe("plugin field types in the TypeScript generator", () => {
  it("emits the type the field's own type declares", () => {
    registerFieldType(RATING);
    const file = new TypeGenerator().generateTypesFile([
      collection([
        { name: "score", type: "star-rating", ratingScale: { max: 5 } },
      ]),
    ]);

    expect(file.code).toContain("score?: Rating<5>;");
    expect(file.code).toContain('import type { Rating } from "@acme/ratings";');
  });

  it("falls back to what the type stores when it renders nothing", () => {
    registerFieldType(TALLY);
    const file = new TypeGenerator().generateTypesFile([
      collection([{ name: "hits", type: "tally" }]),
    ]);

    // The registry knows a `number`-backed type stores a number, with or
    // without a `tsType`, so degrading it to `unknown` would discard that.
    expect(file.code).toContain("hits?: number;");
  });

  it("uses the json storage shape for a json-backed silent type", () => {
    registerFieldType(OPAQUE);
    const file = new TypeGenerator().generateTypesFile([
      collection([{ name: "blob", type: "opaque-thing" }]),
    ]);

    expect(file.code).toContain("blob?: unknown;");
    expect(file.code).not.toContain("@acme/opaque");
  });

  it("reads an option the Schema Builder moved into the container", () => {
    registerFieldType(RATING);
    const file = new TypeGenerator().generateTypesFile([
      collection([
        {
          name: "score",
          type: "star-rating",
          pluginOptions: { ratingScale: { max: 7 } },
        },
      ]),
    ]);

    // An ordinary save relocates unmodelled options, so a callback reading the
    // raw field would silently start emitting the un-narrowed type.
    expect(file.code).toContain("score?: Rating<7>;");
  });

  it("imports nothing for a registered type no field uses", () => {
    registerFieldType(RATING);
    const file = new TypeGenerator().generateTypesFile([
      collection([{ name: "title", type: "text" }]),
    ]);

    expect(file.code).not.toContain("@acme/ratings");
  });

  it("reaches a field nested in a container", () => {
    registerFieldType(RATING);
    const file = new TypeGenerator().generateTypesFile([
      collection([
        {
          name: "reviews",
          type: "repeater",
          fields: [
            { name: "score", type: "star-rating", ratingScale: { max: 10 } },
          ],
        },
      ]),
    ]);

    expect(file.code).toContain("Rating<10>");
    expect(file.code).toContain('import type { Rating } from "@acme/ratings";');
  });
});

describe("plugin field types in the Zod generator", () => {
  it("emits the schema the field's own type declares", () => {
    registerFieldType(RATING);
    const schema = new ZodGenerator().generateSchema(
      collection([
        {
          name: "score",
          type: "star-rating",
          ratingScale: { max: 5 },
          required: true,
        },
      ])
    );

    expect(schema.code).toContain("z.number().min(0).max(5)");
  });

  it("falls back to the storage primitive's schema when it declares none", () => {
    registerFieldType(TALLY);
    const schema = new ZodGenerator().generateSchema(
      collection([{ name: "hits", type: "tally" }])
    );

    // Dropping the field would leave a stored value with nothing validating it.
    expect(schema.code).toContain("hits");
    expect(schema.code).toContain("z.number()");
  });

  it("emits the imports its expression relies on", () => {
    registerFieldType(RATING);
    const schema = new ZodGenerator().generateSchema(
      collection([
        { name: "score", type: "star-rating", ratingScale: { max: 5 } },
      ])
    );

    // The expression may name a type — `z.custom<Rating>()` — and the file
    // would otherwise reference an identifier it never imported.
    expect(schema.code).toContain(
      'import type { Rating } from "@acme/ratings";'
    );
  });

  it("reads an option the Schema Builder moved into the container", () => {
    registerFieldType(RATING);
    const schema = new ZodGenerator().generateSchema(
      collection([
        {
          name: "score",
          type: "star-rating",
          pluginOptions: { ratingScale: { max: 7 } },
          required: true,
        },
      ])
    );

    expect(schema.code).toContain("z.number().min(0).max(7)");
  });
});
