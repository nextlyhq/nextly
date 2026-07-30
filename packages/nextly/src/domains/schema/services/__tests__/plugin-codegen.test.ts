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
import { convertToUserFieldRecords } from "../../../../cli/commands/generate-types";
import { TypeGenerator } from "../type-generator";
import { ZodGenerator } from "../zod-generator";

/** A type whose generated shape narrows to the options the field declares. */
const RATING: PluginFieldType = {
  type: "star-rating",
  storage: "number",
  component: "@acme/ratings/admin#StarRating",
  codegen: {
    tsImports: [{ names: ["Rating"], from: "@acme/ratings" }],
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

  it("gives a user field its declared option under the declared name", () => {
    registerFieldType({
      type: "scaled",
      storage: "number",
      component: "@acme/s/admin#Input",
      codegen: { tsType: f => `Scaled<${(f as { min?: number }).min ?? 0}>` },
    });

    // The user-field record renames `min` to `minValue`, so a callback reading
    // it by the declared name would find nothing.
    const records = convertToUserFieldRecords([
      { name: "score", type: "scaled", min: 3 },
    ] as unknown as Parameters<typeof convertToUserFieldRecords>[0]);
    const file = new TypeGenerator().generateTypesFile([], [], [], records);

    expect(file.code).toContain("Scaled<3>");
  });

  it("returns the imports the User interface on its own relies on", () => {
    registerFieldType({
      type: "badge",
      storage: "json",
      component: "@acme/bg/admin#Badge",
      surfaces: ["users"],
      codegen: {
        tsImports: [{ names: ["Badge"], from: "@acme/bg" }],
        tsType: () => "Badge",
      },
    });

    // Called on its own, the caller assembles the file itself and has nowhere
    // else to learn that `Badge` has to be brought into scope.
    const records = convertToUserFieldRecords([
      { name: "badge", type: "badge" },
    ] as unknown as Parameters<typeof convertToUserFieldRecords>[0]);
    const iface = new TypeGenerator().generateUserInterface(records);

    expect(iface.code).toContain("Badge");
    expect(iface.imports).toContain('import type { Badge } from "@acme/bg";');
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

describe("standalone interface generation", () => {
  it("returns the imports its plugin fields rely on", () => {
    registerFieldType(RATING);
    const iface = new TypeGenerator().generateInterface(
      collection([
        { name: "score", type: "star-rating", ratingScale: { max: 5 } },
      ])
    );

    // A bare interface cannot carry its own imports without becoming
    // unconcatenable, so a caller assembling a file gets them alongside.
    expect(iface.code).toContain("Rating<5>");
    expect(iface.imports).toContain(
      'import type { Rating } from "@acme/ratings";'
    );
  });

  it("returns the imports again when the same generator is reused", () => {
    registerFieldType(RATING);
    const generator = new TypeGenerator();
    const field = {
      name: "score",
      type: "star-rating",
      ratingScale: { max: 5 },
    };

    generator.generateInterface(collection([field]));
    const second = generator.generateInterface(collection([field]));

    // The field object is already recorded by the first call, so a check for
    // "what was added since" would report nothing the second time.
    expect(second.imports).toContain(
      'import type { Rating } from "@acme/ratings";'
    );
  });

  it("refuses an import that collides with the interface's own name", () => {
    registerFieldType({
      type: "self-named",
      storage: "json",
      component: "@acme/sn/admin#Input",
      codegen: {
        tsImports: [{ names: ["Posts"], from: "@acme/sn" }],
        tsType: () => "Posts",
      },
    });

    // `export interface Posts` is the one binding a lone interface declares.
    let message = "";
    try {
      new TypeGenerator().generateInterface(
        collection([{ name: "p", type: "self-named" }])
      );
    } catch (error) {
      if (!(error instanceof NextlyError)) throw error;
      const data = error.publicData as
        | { errors?: Array<{ message: string }> }
        | undefined;
      message = (data?.errors ?? []).map(i => i.message).join(" ");
    }

    expect(message).toContain("'Posts'");
  });

  it("refuses a global the standalone interface itself relies on", () => {
    registerFieldType({
      type: "shadows-array",
      storage: "json",
      component: "@acme/sa/admin#Input",
      codegen: {
        tsImports: [{ names: ["Array"], from: "@acme/sa" }],
        tsType: () => "Array<string>",
      },
    });

    // A lone interface writes `Array<...>` for a non-empty repeater, and an
    // import landing beside it shadows the global for that source just as it
    // would in the whole file.
    let message = "";
    try {
      new TypeGenerator().generateInterface(
        collection([
          {
            name: "rows",
            type: "repeater",
            fields: [{ name: "t", type: "text" }],
          },
          { name: "s", type: "shadows-array" },
        ])
      );
    } catch (error) {
      if (!(error instanceof NextlyError)) throw error;
      const data = error.publicData as
        | { errors?: Array<{ message: string }> }
        | undefined;
      message = (data?.errors ?? []).map(i => i.message).join(" ");
    }

    expect(message).toContain("'Array'");
  });

  it("leaves a global only the plugin itself writes free", () => {
    registerFieldType({
      type: "own-array",
      storage: "json",
      component: "@acme/oa/admin#Input",
      codegen: {
        tsImports: [{ names: ["Array"], from: "@acme/oa" }],
        tsType: () => "Array<string>",
      },
    });

    // Every `Array<` in this interface came from the plugin's own expression,
    // so nothing of the generator's would be shadowed by its import.
    const iface = new TypeGenerator().generateInterface(
      collection([{ name: "s", type: "own-array" }])
    );

    expect(iface.imports).toContain('import type { Array } from "@acme/oa";');
  });

  it("returns none for an interface with no plugin fields", () => {
    registerFieldType(RATING);
    const iface = new TypeGenerator().generateInterface(
      collection([{ name: "title", type: "text" }])
    );

    expect(iface.imports).toEqual([]);
  });

  it("collects across every entity for the whole file", () => {
    registerFieldType(RATING);
    // The file generator drives the same per-interface methods, so this pins
    // that going through them entity by entity still yields one import block
    // covering all of them.
    const file = new TypeGenerator().generateTypesFile(
      [
        collection([
          { name: "a", type: "star-rating", ratingScale: { max: 2 } },
        ]),
        {
          ...collection([
            { name: "b", type: "star-rating", ratingScale: { max: 3 } },
          ]),
          slug: "notes",
          labels: { singular: "Note", plural: "Notes" },
        },
      ].map(c => c)
    );

    expect(file.code).toContain('import type { Rating } from "@acme/ratings";');
    expect(file.code).toContain("Rating<2>");
    expect(file.code).toContain("Rating<3>");
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

  it("does not refuse a colliding name the output never references", () => {
    registerFieldType({
      type: "maybe-posts",
      storage: "text",
      component: "@acme/mp/admin#Input",
      codegen: {
        tsImports: [{ names: ["Posts"], from: "@acme/mp" }],
        // Declared for a branch this collection never takes, so nothing is
        // imported and there is nothing to collide with.
        tsType: field =>
          (field as { fancy?: unknown }).fancy === true ? "Posts" : "string",
      },
    });

    const file = new TypeGenerator().generateTypesFile([
      collection([{ name: "p", type: "maybe-posts" }]),
    ]);

    expect(file.code).not.toContain("@acme/mp");
  });

  it("refuses an import that would shadow a utility the output relies on", () => {
    registerFieldType({
      type: "partial-named",
      storage: "json",
      component: "@acme/pn/admin#Input",
      codegen: {
        tsImports: [{ names: ["Partial"], from: "@acme/pn" }],
        tsType: () => "Partial",
      },
    });

    // The generated input aliases emit `Partial<Post>`; a local import of that
    // name shadows the global for the whole file.
    const messages = refusalMessages(() =>
      new TypeGenerator().generateTypesFile([
        collection([{ name: "p", type: "partial-named" }]),
      ])
    );

    expect(messages.join(" ")).toContain("'Partial'");
  });

  it("allows a global name no emitted construct uses", () => {
    registerFieldType({
      type: "pick-named",
      storage: "json",
      component: "@acme/pk/admin#Input",
      codegen: {
        tsImports: [{ names: ["Pick"], from: "@acme/pk" }],
        tsType: () => "Pick",
      },
    });

    // Nothing this run emits writes `Pick<...>`, so the global is not at risk
    // of being shadowed and the import is legitimate.
    const file = new TypeGenerator().generateTypesFile([
      collection([{ name: "p", type: "pick-named" }]),
    ]);

    expect(file.code).toContain('from "@acme/pk"');
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

  it("allows an import named GeneratedTypes", () => {
    registerFieldType({
      type: "gt-ish",
      storage: "json",
      component: "@acme/gt/admin#Input",
      codegen: {
        tsImports: [{ names: ["GeneratedTypes"], from: "@acme/gt" }],
        tsType: () => "GeneratedTypes",
      },
    });

    // Only ever declared inside `declare module`, which creates no top-level
    // binding, so an import of that name coexists with it.
    const file = new TypeGenerator().generateTypesFile([
      collection([{ name: "g", type: "gt-ish" }]),
    ]);

    expect(file.code).toContain('from "@acme/gt"');
  });

  it("allows BlockDocument when no blocks field makes core import it", () => {
    registerFieldType({
      type: "doc-free",
      storage: "json",
      component: "@acme/df/admin#Input",
      codegen: {
        tsImports: [{ names: ["BlockDocument"], from: "@acme/df" }],
        tsType: () => "BlockDocument",
      },
    });

    // Core emits its own import only when a blocks field is present, so with
    // none there is nothing for this to collide with.
    const file = new TypeGenerator().generateTypesFile([
      collection([{ name: "d", type: "doc-free" }]),
    ]);

    expect(file.code).toContain('from "@acme/df"');
  });

  it("allows an import named Config when no config interface is generated", () => {
    registerFieldType({
      type: "config-ish",
      storage: "json",
      component: "@acme/c/admin#Input",
      codegen: {
        tsImports: [{ names: ["Config"], from: "@acme/c" }],
        tsType: () => "Config",
      },
    });

    const file = new TypeGenerator({
      generateConfig: false,
    }).generateTypesFile([collection([{ name: "c", type: "config-ish" }])]);

    expect(file.code).toContain('from "@acme/c"');
  });

  it("omits an import no emitted expression ended up naming", () => {
    registerFieldType({
      type: "conditional",
      storage: "number",
      component: "@acme/cond/admin#Input",
      codegen: {
        tsImports: [{ names: ["Scaled"], from: "@acme/cond" }],
        // Uses the import only for a field that declares no scale; this
        // collection has one, so nothing references it.
        tsType: field =>
          (field as { scale?: unknown }).scale === undefined
            ? "Scaled"
            : "number",
      },
    });

    const file = new TypeGenerator().generateTypesFile([
      collection([{ name: "n", type: "conditional", scale: 5 }]),
    ]);

    expect(file.code).not.toContain("@acme/cond");
  });

  it("reuses the generator's own import instead of refusing it", () => {
    registerFieldType({
      type: "same-binding",
      storage: "json",
      component: "@acme/sb/admin#Input",
      codegen: {
        tsImports: [{ names: ["BlockDocument"], from: "nextly" }],
        tsType: () => "BlockDocument",
      },
    });

    // The plugin wants exactly the binding the blocks field already imports,
    // and cannot know whether another field caused that import to be emitted.
    const file = new TypeGenerator().generateTypesFile([
      collection([
        { name: "page", type: "blocks" },
        { name: "body", type: "same-binding" },
      ]),
    ]);

    expect(
      file.code.match(/import type \{ BlockDocument \} from "nextly";/g)
    ).toHaveLength(1);
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
        collection([
          { name: "page", type: "blocks" },
          { name: "body", type: "doc-thing" },
        ]),
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
    registerFieldType({
      type: "opaque-rating",
      storage: "json",
      component: "@acme/ratings/admin#Input",
      codegen: {
        zodImports: [{ names: ["Rating"], from: "@acme/ratings" }],
        zodSchema: () => "z.custom<Rating>()",
      },
    });

    const schema = new ZodGenerator().generateSchema(
      collection([{ name: "score", type: "opaque-rating" }])
    );

    // The expression names a type, and the file would otherwise reference an
    // identifier it never imported.
    expect(schema.code).toContain(
      'import type { Rating } from "@acme/ratings";'
    );
  });

  it("allows a Zod import named after a type only the TS file imports", () => {
    registerFieldType({
      type: "doc-zod",
      storage: "json",
      component: "@acme/dz/admin#Input",
      codegen: {
        zodImports: [{ names: ["BlockDocument"], from: "@acme/dz" }],
        zodSchema: () => "z.custom<BlockDocument>()",
      },
    });

    // `ZodGenerator` never emits its own `BlockDocument`, so reserving it here
    // would refuse a valid schema.
    const schema = new ZodGenerator().generateSchema(
      collection([{ name: "d", type: "doc-zod" }])
    );

    expect(schema.code).toContain('from "@acme/dz"');
  });

  it("allows an inferred-type name when type exports are off", () => {
    registerFieldType({
      type: "posts-zod",
      storage: "json",
      component: "@acme/pz/admin#Input",
      codegen: {
        zodImports: [{ names: ["Posts"], from: "@acme/pz" }],
        zodSchema: () => "z.custom<Posts>()",
      },
    });

    const schema = new ZodGenerator({ generateTypes: false }).generateSchema(
      collection([{ name: "p", type: "posts-zod" }])
    );

    expect(schema.code).toContain('from "@acme/pz"');
  });

  it("omits an import a nested field's expression does not use", () => {
    registerFieldType({
      type: "nested-maybe",
      storage: "number",
      component: "@acme/nm/admin#Input",
      codegen: {
        zodImports: [{ names: ["Maybe"], from: "@acme/nm" }],
        zodSchema: () => "z.number()",
      },
    });

    // An unrecorded field is treated as using its imports, so the filtering
    // only reaches nested fields once their expression is recorded too.
    const schema = new ZodGenerator().generateSchema(
      collection([
        {
          name: "rows",
          type: "repeater",
          fields: [{ name: "m", type: "nested-maybe" }],
        },
      ])
    );

    expect(schema.code).not.toContain("@acme/nm");
  });

  it("emits an import a nested field's expression relies on", () => {
    registerFieldType({
      type: "nested-doc",
      storage: "json",
      component: "@acme/nd/admin#Input",
      codegen: {
        zodImports: [{ names: ["Nested"], from: "@acme/nd" }],
        zodSchema: () => "z.custom<Nested>()",
      },
    });

    // The nested branch emits its own expression; not recording it would drop
    // the import and leave the schema naming an identifier it never imported.
    const schema = new ZodGenerator().generateSchema(
      collection([
        {
          name: "rows",
          type: "repeater",
          fields: [{ name: "d", type: "nested-doc" }],
        },
      ])
    );

    expect(schema.code).toContain('import type { Nested } from "@acme/nd";');
  });

  it("does not let one field's usage activate another's same-named import", () => {
    registerFieldType({
      type: "uses-shared",
      storage: "json",
      component: "@acme/a/admin#Input",
      codegen: {
        zodImports: [{ names: ["Shared"], from: "@acme/a" }],
        zodSchema: () => "z.custom<Shared>()",
      },
    });
    registerFieldType({
      type: "skips-shared",
      storage: "number",
      component: "@acme/b/admin#Input",
      codegen: {
        zodImports: [{ names: ["Shared"], from: "@acme/b" }],
        zodSchema: () => "z.number()",
      },
    });

    // The second type never names `Shared`, so it must not be treated as
    // imported — otherwise the two modules look like a cross-module clash.
    const schema = new ZodGenerator().generateSchema(
      collection([
        { name: "a", type: "uses-shared" },
        { name: "b", type: "skips-shared" },
      ])
    );

    expect(schema.code).toContain('import type { Shared } from "@acme/a";');
    expect(schema.code).not.toContain("@acme/b");
  });

  it("recognizes an identifier that begins with a dollar sign", () => {
    registerFieldType({
      type: "dollar-named",
      storage: "json",
      component: "@acme/dn/admin#Input",
      codegen: {
        zodImports: [{ names: ["$Rating"], from: "@acme/dn" }],
        zodSchema: () => "z.custom<$Rating>()",
      },
    });

    // `\b` cannot match before `$` — both are non-word characters — so a word
    // boundary would classify this legal export as unused and drop it.
    const schema = new ZodGenerator().generateSchema(
      collection([{ name: "r", type: "dollar-named" }])
    );

    expect(schema.code).toContain('import type { $Rating } from "@acme/dn";');
  });

  it("still rejects a name that only appears inside a longer identifier", () => {
    registerFieldType({
      type: "substring-named",
      storage: "json",
      component: "@acme/sn/admin#Input",
      codegen: {
        zodImports: [{ names: ["Rate"], from: "@acme/sn" }],
        zodSchema: () => "z.custom<RateLimiter>()",
      },
    });

    expect(
      new ZodGenerator().generateSchema(
        collection([{ name: "r", type: "substring-named" }])
      ).code
    ).not.toContain("@acme/sn");
  });

  it("does not count a name that only appears in a string literal", () => {
    registerFieldType({
      type: "literal-named",
      storage: "json",
      component: "@acme/ln/admin#Input",
      codegen: {
        zodImports: [{ names: ["Rating"], from: "@acme/ln" }],
        zodSchema: () => 'z.literal("Rating")',
      },
    });

    // Text, not a reference to the binding — emitting the import would be
    // unused under `noUnusedLocals`.
    expect(
      new ZodGenerator().generateSchema(
        collection([{ name: "r", type: "literal-named" }])
      ).code
    ).not.toContain("@acme/ln");
  });

  it("counts a reference inside a template interpolation", () => {
    registerFieldType({
      type: "templated",
      storage: "json",
      component: "@acme/tp/admin#Input",
      codegen: {
        zodImports: [{ names: ["Prefix"], from: "@acme/tp" }],
        zodSchema: () => "z.custom<`${Prefix}-id`>()",
      },
    });

    // The literal text around it is not a reference, but the interpolation is —
    // dropping the whole template would leave the schema naming an identifier
    // it never imported.
    expect(
      new ZodGenerator().generateSchema(
        collection([{ name: "t", type: "templated" }])
      ).code
    ).toContain('import type { Prefix } from "@acme/tp";');
  });

  it("does not make a validator for a list out of a hasMany plugin field", () => {
    registerFieldType({
      type: "tagish",
      storage: "text",
      component: "@acme/tags/admin#Tags",
    });

    // The storage primitive is one column holding one value. The built-in text
    // builder wraps on `hasMany`, so carrying the flag through the fallback
    // would emit an array schema for a field the table stores a string in, and
    // every write of that field would be refused.
    const code = new ZodGenerator().generateSchema(
      collection([{ name: "tags", type: "tagish", hasMany: true }])
    ).code;

    expect(code).toMatch(/tags:\s*z\.string\(\)/);
    expect(code).not.toMatch(/tags:\s*z\.array/);
  });

  it("does not count a name used only as a property key", () => {
    registerFieldType({
      type: "keyed",
      storage: "json",
      component: "@acme/kd/admin#Input",
      codegen: {
        zodImports: [{ names: ["Rating"], from: "@acme/kd" }],
        zodSchema: () => "z.object({ Rating: z.string() })",
      },
    });

    expect(
      new ZodGenerator().generateSchema(
        collection([{ name: "k", type: "keyed" }])
      ).code
    ).not.toContain("@acme/kd");
  });

  it("still counts a name used as a property value", () => {
    registerFieldType({
      type: "valued",
      storage: "json",
      component: "@acme/vl/admin#Input",
      codegen: {
        zodImports: [{ names: ["Rating"], from: "@acme/vl" }],
        zodSchema: () => "z.custom<{ score: Rating }>()",
      },
    });

    expect(
      new ZodGenerator().generateSchema(
        collection([{ name: "v", type: "valued" }])
      ).code
    ).toContain('import type { Rating } from "@acme/vl";');
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
