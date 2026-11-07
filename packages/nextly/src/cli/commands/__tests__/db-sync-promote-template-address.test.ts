/**
 * Promoting a Schema Builder collection whose page builder template stores an
 * address prints the `pageBuilder()` declaration of that address beside the
 * collection's code, so its entries stay where they are served once it is
 * defined in code. One with no stored address prints none, and a read that
 * fails costs the promote nothing.
 */
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections";
import { createLogger } from "../../utils/logger";
import { promoteCollection } from "../db-sync-promote";
import {
  storedTemplateAddress,
  templateAddressDeclaration,
} from "../db-sync-promote-template-address";

const templatesRecord = {
  slug: "templates",
  tableName: "dc_templates",
  fields: [{ name: "collection" }, { name: "address" }],
} as unknown as DynamicCollectionRecord;

describe("the promoted collection's template address", () => {
  it("declares it in the page builder's own option", () => {
    expect(templateAddressDeclaration("posts", "/blog")).toBe(
      'pageBuilder({ templates: { addresses: { posts: "/blog" } } })'
    );
    expect(templateAddressDeclaration("blog-posts", "/blog")).toBe(
      'pageBuilder({ templates: { addresses: { "blog-posts": "/blog" } } })'
    );
  });

  it("reads the address the collection's template stores", async () => {
    const asked: SQL[] = [];
    const address = await storedTemplateAddress(
      {
        getCollectionBySlug: async slug =>
          slug === "templates" ? templatesRecord : null,
        queryStatement: async statement => {
          asked.push(statement);
          return [{ address: "/blog" }];
        },
      },
      "posts"
    );
    expect(address).toBe("/blog");
    expect(asked).toHaveLength(1);
  });

  it.each([
    ["no stored address", [{ address: null }]],
    ["an emptied one", [{ address: "" }]],
    ["no template", []],
  ])("answers none for %s", async (_case, rows) => {
    expect(
      await storedTemplateAddress(
        {
          getCollectionBySlug: async () => templatesRecord,
          queryStatement: async () => rows,
        },
        "posts"
      )
    ).toBeNull();
  });

  it("answers none, reading nothing, where templates have no address field or do not exist", async () => {
    let reads = 0;
    const queryStatement = async () => {
      reads += 1;
      return [{ address: "/blog" }];
    };
    expect(
      await storedTemplateAddress(
        {
          getCollectionBySlug: async () =>
            ({
              ...templatesRecord,
              fields: [{ name: "collection" }],
            }) as unknown as DynamicCollectionRecord,
          queryStatement,
        },
        "posts"
      )
    ).toBeNull();
    expect(
      await storedTemplateAddress(
        { getCollectionBySlug: async () => null, queryStatement },
        "posts"
      )
    ).toBeNull();
    expect(reads).toBe(0);
  });

  it("answers none when the read fails", async () => {
    expect(
      await storedTemplateAddress(
        {
          getCollectionBySlug: async () => templatesRecord,
          queryStatement: async () => {
            throw new Error("connection lost");
          },
        },
        "posts"
      )
    ).toBeNull();
  });
});

describe("promoting a collection", () => {
  const registry = {
    getCollectionBySlug: async () =>
      ({
        slug: "posts",
        fields: [{ name: "slug", type: "text" }],
      }) as unknown as DynamicCollectionRecord,
  };

  async function preview(address: string | null): Promise<string> {
    let shown = "";
    await promoteCollection({
      slug: "posts",
      logger: createLogger({ quiet: true }),
      cwd: "/nowhere",
      registry: registry as never,
      adapter: {} as never,
      // Declined, so nothing is written: the preview is what is judged.
      confirm: async code => {
        shown = code;
        return false;
      },
      templateAddress: async () => address,
    });
    return shown;
  }

  it("prints the template address's declaration beside the collection's code", async () => {
    const shown = await preview("/blog");
    expect(shown).toContain(
      '//   pageBuilder({ templates: { addresses: { posts: "/blog" } } })'
    );
    expect(shown).toContain("Its entries are served at /blog");
  });

  it("prints no declaration for a collection whose template stores none", async () => {
    expect(await preview(null)).not.toContain("pageBuilder(");
  });
});
