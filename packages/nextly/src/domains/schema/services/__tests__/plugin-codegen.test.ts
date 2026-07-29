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

import { NextlyError } from "../../../../errors/nextly-error";

import type { PluginFieldType } from "../../../../plugins/contributions";
import type { DynamicCollectionRecord } from "../../../../schemas/dynamic-collections/types";
import {
  clearFieldTypes,
  registerFieldType,
  withoutDisabledBehavior,
} from "../../field-types/field-type-registry";
import { TypeGenerator } from "../type-generator";
import { ZodGenerator } from "../zod-generator";

/** A type whose generated shape narrows to the options the field declares. */
const RATING: PluginFieldType = {
  type: "star-rating",
  storage: "number",
  component: "@acme/ratings/admin#StarRating",
  codegen: {
    tsImports: [{ names: ["Rating"], from: "@acme/ratings" }],
    zodImports: [{ names: ["Rating"], from: "@acme/ratings" }],
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

describe("plugin field types on user fields", () => {
  const userField = (extra: Record<string, unknown>) =>
    ({
      id: "f1",
      name: "score",
      label: "Score",
      required: false,
      ...extra,
    }) as unknown as Parameters<TypeGenerator["generateTypesFile"]>[3][number];

  it("emits the type and its import for a field only on users", () => {
    registerFieldType(RATING);
    const file = new TypeGenerator().generateTypesFile(
      [],
      [],
      [],
      [
        userField({
          type: "star-rating",
          pluginOptions: { ratingScale: { max: 4 } },
        }),
      ]
    );

    expect(file.code).toContain("Rating<4>");
    // The interface would otherwise name a type the file never imports.
    expect(file.code).toContain('import type { Rating } from "@acme/ratings";');
  });

  it("falls back to what a silent type stores rather than string", () => {
    registerFieldType(TALLY);
    const file = new TypeGenerator().generateTypesFile(
      [],
      [],
      [],
      [userField({ type: "tally" })]
    );

    expect(file.code).toContain("score?: number;");
  });
});

describe("codegen import collisions", () => {
  /** The issue messages a generation refusal carries. */
  const refusalMessages = (generate: () => unknown): string[] => {
    try {
      generate();
    } catch (error) {
      if (!(error instanceof NextlyError)) throw error;
      const data = error.publicData as
        | { errors?: Array<{ message: string }> }
        | undefined;
      return (data?.errors ?? []).map(issue => issue.message);
    }
    return [];
  };

  it("refuses two modules claiming one local name", () => {
    registerFieldType(RATING);
    registerFieldType({
      type: "other-rating",
      storage: "number",
      component: "@other/ratings/admin#Input",
      codegen: {
        tsImports: [{ names: ["Rating"], from: "@other/ratings" }],
        tsType: () => "Rating",
      },
    });

    // Two `import type { Rating }` lines would not compile, so the clash is
    // reported where an author can act on it.
    const messages = refusalMessages(() =>
      new TypeGenerator().generateTypesFile([
        collection([
          { name: "a", type: "star-rating" },
          { name: "b", type: "other-rating" },
        ]),
      ])
    );

    expect(messages.join(" ")).toContain("'Rating'");
  });

  it("refuses a generator-owned name even from the same module", () => {
    // Merging would be wrong here: the generator emits its own import of this
    // binding, and two imports of it do not compile even naming one module.
    registerFieldType({
      type: "same-module-doc",
      storage: "json",
      component: "@acme/docs/admin#Input",
      codegen: {
        tsImports: [{ names: ["BlockDocument"], from: "nextly" }],
        tsType: () => "BlockDocument",
      },
    });

    const messages = refusalMessages(() =>
      new TypeGenerator().generateTypesFile([
        collection([{ name: "body", type: "same-module-doc" }]),
      ])
    );

    expect(messages.join(" ")).toContain("BlockDocument");
  });

  it("refuses an import that collides with a generated declaration", () => {
    registerFieldType({
      type: "user-ish",
      storage: "json",
      component: "@acme/u/admin#Input",
      codegen: {
        tsImports: [{ names: ["User"], from: "@acme/u" }],
        tsType: () => "User",
      },
    });

    // The file always declares `User`, so importing that name would be
    // TS2440 in the consuming app.
    const messages = refusalMessages(() =>
      new TypeGenerator().generateTypesFile([
        collection([{ name: "who", type: "user-ish" }]),
      ])
    );

    expect(messages.join(" ")).toContain("'User'");
  });

  it("refuses an import named after a generated entity interface", () => {
    registerFieldType({
      type: "posts-ish",
      storage: "json",
      component: "@acme/p/admin#Input",
      codegen: {
        tsImports: [{ names: ["Posts"], from: "@acme/p" }],
        tsType: () => "Posts",
      },
    });

    const messages = refusalMessages(() =>
      new TypeGenerator().generateTypesFile([
        collection([{ name: "p", type: "posts-ish" }]),
      ])
    );

    expect(messages.join(" ")).toContain("'Posts'");
  });

  it("refuses an import named after a generated input alias", () => {
    registerFieldType({
      type: "input-ish",
      storage: "json",
      component: "@acme/i/admin#Input",
      codegen: {
        tsImports: [{ names: ["PostsCreateInput"], from: "@acme/i" }],
        tsType: () => "PostsCreateInput",
      },
    });

    // Input types are generated by default, so this alias is declared in the
    // same file the import would land in.
    const messages = refusalMessages(() =>
      new TypeGenerator().generateTypesFile([
        collection([{ name: "p", type: "input-ish" }]),
      ])
    );

    expect(messages.join(" ")).toContain("'PostsCreateInput'");
  });

  it("allows that name when input types are not generated", () => {
    registerFieldType({
      type: "input-ish",
      storage: "json",
      component: "@acme/i/admin#Input",
      codegen: {
        tsImports: [{ names: ["PostsCreateInput"], from: "@acme/i" }],
        tsType: () => "PostsCreateInput",
      },
    });

    // Reserved only when the run actually declares it, so the set describes
    // this file rather than every file the generator could produce.
    const file = new TypeGenerator({
      generateInputTypes: false,
    }).generateTypesFile([collection([{ name: "p", type: "input-ish" }])]);

    expect(file.code).toContain('from "@acme/i"');
  });

  it("refuses a plugin claiming a name the generator emits itself", () => {
    registerFieldType({
      type: "doc-thing",
      storage: "json",
      component: "@acme/docs/admin#Input",
      codegen: {
        tsImports: [{ names: ["BlockDocument"], from: "@acme/docs" }],
        tsType: () => "BlockDocument",
      },
    });

    const messages = refusalMessages(() =>
      new TypeGenerator().generateTypesFile([
        collection([{ name: "body", type: "doc-thing" }]),
      ])
    );

    expect(messages.join(" ")).toContain("BlockDocument");
  });
});

describe("disabled plugins", () => {
  it("does not run codegen callbacks for a disabled plugin's type", () => {
    registerFieldType(withoutDisabledBehavior(RATING, { enabled: false }));
    const file = new TypeGenerator().generateTypesFile([
      collection([
        { name: "score", type: "star-rating", ratingScale: { max: 5 } },
      ]),
    ]);

    // Its callbacks are the plugin's code; a disabled plugin contributes none,
    // so generation falls back to what the type stores.
    expect(file.code).toContain("score?: number;");
    expect(file.code).not.toContain("@acme/ratings");
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

  it("emits only the import list belonging to this file's expression", () => {
    // Both expressions exist, but each names its own imports, so the type used
    // by only one of them appears in only that file.
    registerFieldType({
      type: "split-imports",
      storage: "number",
      component: "@acme/split/admin#Input",
      codegen: {
        tsImports: [{ names: ["TsOnly"], from: "@acme/split-ts" }],
        tsType: () => "TsOnly",
        zodSchema: () => "z.number()",
      },
    });

    const schema = new ZodGenerator().generateSchema(
      collection([{ name: "n", type: "split-imports" }])
    );

    expect(schema.code).not.toContain("@acme/split-ts");
  });

  it("refuses a Zod import colliding with a binding the file already holds", () => {
    registerFieldType({
      type: "z-ish",
      storage: "number",
      component: "@acme/z/admin#Input",
      codegen: {
        zodImports: [{ names: ["z"], from: "@acme/z" }],
        zodSchema: () => "z.number()",
      },
    });

    // The file imports `z` from zod at the top, so a second binding of that
    // name would not compile.
    let message = "";
    try {
      new ZodGenerator().generateSchema(
        collection([{ name: "n", type: "z-ish" }])
      );
    } catch (error) {
      if (!(error instanceof NextlyError)) throw error;
      const data = error.publicData as
        | { errors?: Array<{ message: string }> }
        | undefined;
      message = (data?.errors ?? []).map(i => i.message).join(" ");
    }

    expect(message).toContain("'z'");
  });

  it("omits an import the Zod expression does not need", () => {
    // Declared for the TypeScript expression only; the Zod file emitting it
    // would be an unused import under `noUnusedLocals`.
    registerFieldType({
      type: "ts-only",
      storage: "number",
      component: "@acme/tsonly/admin#Input",
      codegen: {
        tsImports: [{ names: ["OnlyTs"], from: "@acme/tsonly" }],
        tsType: () => "OnlyTs",
      },
    });

    const schema = new ZodGenerator().generateSchema(
      collection([{ name: "n", type: "ts-only" }])
    );

    expect(schema.code).not.toContain("@acme/tsonly");
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
