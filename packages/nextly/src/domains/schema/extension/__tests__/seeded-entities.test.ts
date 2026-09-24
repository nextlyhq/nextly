/**
 * A hook may target any entity table, so every entity kind has to be seeded.
 *
 * The draft accepts `dc_*`, `single_*` and `comp_*` as entity targets, and the
 * desired-spec side carries contributed columns for all three. Only
 * collections were seeded, so a hook naming a single or a field group failed
 * at boot with "Table ... does not exist" — before any of that machinery could
 * run.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearActiveExtensionSchema } from "../active-schema";
import { compileAndPublishExtensionSchema } from "../publish";

const logger = { warn: () => {}, debug: () => {} };

/** Reach for a table by name from inside a hook, and report what happened. */
async function hookTargeting(name: string, config: Record<string, unknown>) {
  let found: boolean | undefined;
  await compileAndPublishExtensionSchema({
    dialect: "postgresql",
    plugins: [],
    config: {
      ...config,
      db: {
        schema: {
          extend: [
            ({ schema }: { schema: { getTable(n: string): unknown } }) => {
              found = schema.getTable(name) !== undefined;
            },
          ],
        },
      },
    },
    logger,
  } as never);
  return found;
}

afterEach(() => {
  clearActiveExtensionSchema();
});

describe("the entity tables a schema hook can see", () => {
  it("includes a COLLECTION", async () => {
    expect(
      await hookTargeting("dc_posts", { collections: [{ slug: "posts" }] })
    ).toBe(true);
  });

  it("includes a SINGLE", async () => {
    expect(
      await hookTargeting("single_homepage", {
        singles: [{ slug: "homepage" }],
      })
    ).toBe(true);
  });

  it("honours a single's dbName rather than its slug", async () => {
    // The reason the canonical resolver is used instead of a `single_` prefix
    // spelled here: an author may name the table, and a seed that guessed
    // would describe a table the pipeline never creates.
    expect(
      await hookTargeting("single_site_config", {
        singles: [{ slug: "settings", dbName: "site_config" }],
      })
    ).toBe(true);
  });

  it("includes a FIELD GROUP", async () => {
    expect(
      await hookTargeting("comp_hero", { fieldGroups: [{ slug: "hero" }] })
    ).toBe(true);
  });

  it("does not invent a table nothing declares", async () => {
    // The control. Seeding everything named would make `getTable` useless as
    // the existence check hooks use it for.
    expect(
      await hookTargeting("single_nope", { collections: [{ slug: "posts" }] })
    ).toBe(false);
  });
});
