/**
 * Two many-to-many fields may not store their links in one junction table.
 *
 * A link row carries the two collections' ids and nothing that says which
 * field made it, so two fields on one table would read each other's links,
 * and removing either would take the other's table with it. The rule is asked
 * of the name each field RESOLVES to — its `junctionTable`, or the generated
 * name — so an author-named table that happens to spell another field's
 * generated name collides too.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";
import { DynamicCollectionService } from "../services/dynamic-collection-service";
import { DynamicCollectionValidationService } from "../services/dynamic-collection-validation-service";

const relationship = (
  name: string,
  relationType: "manyToMany" | "manyToOne",
  junctionTable?: string
): FieldDefinition => ({
  name,
  type: "relationship",
  options: { relationType, target: "tags", junctionTable },
});

/** The generated junction name for `dc_posts.tags -> dc_tags`. */
const GENERATED = "dc_posts_dc_tags_tags";

function refusal(run: () => unknown): { code: string; message: string } {
  let refused: unknown;
  try {
    run();
  } catch (error) {
    refused = error;
  }
  expect(refused).toBeInstanceOf(NextlyError);
  const { errors } = (refused as NextlyError).publicData as {
    errors: Array<{ code: string; message: string }>;
  };
  expect(errors).toHaveLength(1);
  return errors[0];
}

describe("junction ownership is exclusive", () => {
  const validation = new DynamicCollectionValidationService();
  const schema = new DynamicCollectionSchemaService(undefined, "sqlite");
  const check = (fields: FieldDefinition[]) => () =>
    validation.validateJunctionOwnership(fields, field =>
      schema.junctionTableNameFor("dc_posts", field)
    );

  it("refuses two fields that name the same junction table, naming both", () => {
    const error = refusal(
      check([
        relationship("tags", "manyToMany", "post_tag_links"),
        { name: "summary", type: "text" },
        relationship("labels", "manyToMany", "post_tag_links"),
      ])
    );
    expect(error.code).toBe("JUNCTION_TABLE_SHARED");
    expect(error.message).toContain(
      'Fields "tags" and "labels" both store their links in junction table "post_tag_links"'
    );
  });

  it("refuses a named table that spells another field's generated name", () => {
    const error = refusal(
      check([
        relationship("tags", "manyToMany"),
        relationship("labels", "manyToMany", GENERATED),
      ])
    );
    expect(error.code).toBe("JUNCTION_TABLE_SHARED");
    expect(error.message).toContain(`junction table "${GENERATED}"`);
  });

  it("accepts fields with junction tables of their own, named or generated", () => {
    expect(
      check([
        relationship("tags", "manyToMany", "post_tag_links"),
        relationship("labels", "manyToMany", "post_label_links"),
        relationship("topics", "manyToMany"),
        relationship("themes", "manyToMany"),
      ])
    ).not.toThrow();
  });

  it("ignores a junctionTable on a field that has no junction", () => {
    // A many-to-one stores a column, not a table; the option is inert on it
    // and claims nothing.
    expect(
      check([
        relationship("tags", "manyToMany", "post_tag_links"),
        relationship("author", "manyToOne", "post_tag_links"),
      ])
    ).not.toThrow();
  });
});

describe("the Builder's save paths ask the ownership rule", () => {
  beforeAll(() => {
    // The schema service reads the dialect at construction; these cases are
    // refused before any query is attempted.
    process.env.DB_DIALECT ??= "sqlite";
    process.env.DATABASE_URL ??= "file::memory:";
  });

  // Colliding only through the generated name, so a save path that asked the
  // option alone, or asked nothing, would let it through.
  const colliding = [
    relationship("tags", "manyToMany"),
    relationship("labels", "manyToMany", GENERATED),
  ];

  function builder(
    registry: Record<string, unknown>,
    liveTables: string[] = []
  ): DynamicCollectionService {
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    const adapter = {
      getCapabilities: () => ({ dialect: "sqlite" as const }),
      // The only database question these cases reach: whether a junction's
      // destination name is already taken.
      tableExists: (name: string) => Promise.resolve(liveTables.includes(name)),
    } as unknown as ConstructorParameters<typeof DynamicCollectionService>[0];
    const service = new DynamicCollectionService(adapter, logger);
    (service as unknown as { registryService: unknown }).registryService =
      registry;
    return service;
  }

  async function codeOf(save: Promise<unknown>): Promise<string | undefined> {
    const error = await save.catch((e: unknown) => e);
    expect(NextlyError.is(error)).toBe(true);
    const { errors } = (error as NextlyError).publicData as {
      errors: Array<{ code: string }>;
    };
    return errors[0]?.code;
  }

  it("refuses the collision when a collection is created", async () => {
    const service = builder({ collectionExists: async () => false });
    const code = await codeOf(
      service.generateCollection({ name: "posts", fields: colliding } as never)
    );
    expect(code).toBe("JUNCTION_TABLE_SHARED");
  });

  it("refuses moving a junction onto a table the database already holds", async () => {
    // The generator can only see the tables this collection's own fields
    // name; a junction left by an older migration is invisible to it, and the
    // rename would fail at apply time.
    const service = builder(
      {
        getCollection: async () => ({
          name: "posts",
          tableName: "dc_posts",
          fields: [relationship("tags", "manyToMany", "old_links")],
        }),
      },
      ["taken_links"]
    );
    const code = await codeOf(
      service.generateCollectionUpdate("posts", {
        fields: [relationship("tags", "manyToMany", "taken_links")],
      } as never)
    );
    expect(code).toBe("JUNCTION_TABLE_IN_USE");
  });

  it("allows the move when that name is free", async () => {
    // The control: the same edit, with nothing at the destination. It gets
    // past the refusal (and fails later for want of a real database), so the
    // case above cannot be passing because every update is refused.
    const service = builder(
      {
        getCollection: async () => ({
          name: "posts",
          tableName: "dc_posts",
          fields: [relationship("tags", "manyToMany", "old_links")],
        }),
      },
      []
    );
    const error = await service
      .generateCollectionUpdate("posts", {
        fields: [relationship("tags", "manyToMany", "free_links")],
      } as never)
      .catch((e: unknown) => e);
    const code =
      NextlyError.is(error) &&
      (
        (error as NextlyError).publicData as
          | { errors?: Array<{ code: string }> }
          | undefined
      )?.errors?.[0]?.code;
    expect(code).not.toBe("JUNCTION_TABLE_IN_USE");
  });

  it("refuses the collision when a collection is updated", async () => {
    const service = builder({
      getCollection: async () => ({
        name: "posts",
        tableName: "dc_posts",
        fields: [{ name: "summary", type: "text" }],
      }),
    });
    const code = await codeOf(
      service.generateCollectionUpdate("posts", { fields: colliding } as never)
    );
    expect(code).toBe("JUNCTION_TABLE_SHARED");
  });
});
