/**
 * The surface of `ctx.services.ownCollections`, against a stand-in facade so
 * each assertion is about what reaches the service rather than what a database
 * returns: the refusal comes before any call, the call runs as the system with
 * the grant attached, and nothing a caller passes at runtime widens it.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { currentPrincipal, runAsPrincipal } from "../auth/principal-scope";
import type { FieldConfig } from "../collections/fields/types";
import type { GetSingleOptions } from "../domains/singles/types";
import type {
  Collection,
  CollectionService,
} from "../services/collections/collection-service";
import type { RequestContext } from "../services/shared";
import { readHooksWaived } from "../services/collections/trust-grant";

import type { PluginSingleRecord } from "./plugin-singles";
import {
  HOST_TYPES_PAGE_SIZE,
  type HostSchemaSource,
  ownCollectionReads,
  type OwnCollectionReadOpts,
  type PluginCollectionTransaction,
  withWriteTransactionToken,
} from "./service-opts";
import type { Principal } from "./principals/types";

function standIn() {
  const seen: { method: string; context: RequestContext }[] = [];
  const principals: (Principal | null)[] = [];
  const record =
    (method: string, result: unknown) =>
    (...args: unknown[]): Promise<unknown> => {
      seen.push({ method, context: args[args.length - 1] as RequestContext });
      principals.push(currentPrincipal());
      return Promise.resolve(result);
    };
  const service = {
    listEntries: vi.fn(record("listEntries", { data: [], pagination: {} })),
    findEntryById: vi.fn(record("findEntryById", { id: "1" })),
    count: vi.fn(record("count", 0)),
    group: vi.fn(record("group", { buckets: [], truncated: false })),
  };
  return {
    service,
    seen,
    principals,
    facade: service as unknown as CollectionService,
  };
}

describe("ctx.services.ownCollections", () => {
  it("refuses a collection the plugin did not declare before calling the service", async () => {
    const { service, facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);

    await expect(reads.listEntries("posts")).rejects.toThrow(
      /not a collection this plugin declared/
    );
    await expect(reads.findEntryById("posts", "1")).rejects.toThrow(
      /not a collection this plugin declared/
    );
    await expect(reads.count("posts")).rejects.toThrow(
      /not a collection this plugin declared/
    );
    await expect(reads.group("posts", { groupBy: "kind" })).rejects.toThrow(
      /not a collection this plugin declared/
    );
    expect(service.listEntries).not.toHaveBeenCalled();
    expect(service.findEntryById).not.toHaveBeenCalled();
    expect(service.count).not.toHaveBeenCalled();
    expect(service.group).not.toHaveBeenCalled();
  });

  it("calls each read as the system, carrying a grant for exactly the declared collections", async () => {
    const { seen, facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);

    await reads.listEntries("ledger");
    await reads.findEntryById("ledger", "1");
    await reads.count("ledger");
    await reads.group("ledger", { groupBy: "kind" });

    expect(seen.map(call => call.method)).toEqual([
      "listEntries",
      "findEntryById",
      "count",
      "group",
    ]);
    for (const { context } of seen) {
      expect(context.overrideAccess).toBe(true);
      expect(context.user).toBeUndefined();
      expect(readHooksWaived(context.hookExemptRead, "ledger")).toBe(true);
      expect(readHooksWaived(context.hookExemptRead, "posts")).toBe(false);
    }
  });

  it("drops a person named at runtime past the published options", async () => {
    const { seen, principals, facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);
    // A caller ignoring the type: `as`, `user` and a principal must not travel.
    const smuggled = {
      as: "user",
      user: { id: "u1", email: "u1@example.com" },
      principal: { id: "p1" },
      locale: "en",
    } as unknown as OwnCollectionReadOpts;

    const person = { id: "p-outer" } as unknown as Principal;
    await runAsPrincipal(person, () =>
      reads.listEntries("ledger", {}, smuggled)
    );

    expect(seen[0]?.context.user).toBeUndefined();
    expect(seen[0]?.context.overrideAccess).toBe(true);
    expect(seen[0]?.context.locale).toBe("en");
    // The enclosing request's person is cleared for the read.
    expect(principals[0]).toBeNull();
  });

  it("is frozen, so no member can be swapped for one without the check", () => {
    const { facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);
    expect(Object.isFrozen(reads)).toBe(true);
  });

  it("refuses an in-transaction read of a collection it did not declare, or on a token no transaction handed out, before calling the service", async () => {
    const { service, facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);
    const forged = Object.freeze({}) as PluginCollectionTransaction;

    await expect(
      reads.listEntriesInTransaction(forged, "ledger")
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "plugin-transaction-token-unknown" },
    });
    await withWriteTransactionToken({} as TransactionContext, async token => {
      await expect(
        reads.listEntriesInTransaction(token, "posts")
      ).rejects.toThrow(/not a collection this plugin declared/);
      await expect(
        reads.findEntryByIdInTransaction(token, "posts", "1")
      ).rejects.toThrow(/not a collection this plugin declared/);
    });

    expect(service.listEntries).not.toHaveBeenCalled();
    expect(service.findEntryById).not.toHaveBeenCalled();
  });

  it("refuses a token once its transaction has settled", async () => {
    const { service, facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);
    let kept: PluginCollectionTransaction | undefined;
    await withWriteTransactionToken({} as TransactionContext, async token => {
      // The control: the same token reads while its transaction is open.
      await reads.findEntryByIdInTransaction(token, "ledger", "1");
      kept = token;
    });
    if (!kept) throw new Error("the transaction's work never ran");
    const settled = kept;

    await expect(
      reads.listEntriesInTransaction(settled, "ledger")
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "plugin-transaction-finished" },
    });
    expect(service.findEntryById).toHaveBeenCalledTimes(1);
    expect(service.listEntries).not.toHaveBeenCalled();
  });

  it("reads only its own Single, as the system with the Single grant, writing nothing", async () => {
    const { facade } = standIn();
    const asked: { slug: string; options: GetSingleOptions | undefined }[] = [];
    const reads = ownCollectionReads(facade, ["ledger"], {
      owned: ["settings"],
      service: () => ({
        get: (slug: string, options?: GetSingleOptions) => {
          asked.push({ slug, options });
          return Promise.resolve({
            success: true,
            statusCode: 200,
            data: { id: "s1", updatedAt: "2026-01-01T00:00:00.000Z" },
          });
        },
      }),
    });

    await withWriteTransactionToken({} as TransactionContext, async token => {
      // A collection's grant does not reach a Single of the same slug.
      await expect(
        reads.getSingleInTransaction(token, "ledger")
      ).rejects.toThrow(/not a Single this plugin declared/);
      expect(asked).toEqual([]);

      const doc = await reads.getSingleInTransaction(token, "settings");
      expect(doc.id).toBe("s1");
    });

    expect(asked.map(call => call.slug)).toEqual(["settings"]);
    const options = asked[0]?.options;
    expect(options?.overrideAccess).toBe(true);
    expect(options?.createIfMissing).toBe(false);
    expect(options?.whenAbsent).toBe("default");
    expect(readHooksWaived(options?.hookExemptRead, "settings")).toBe(true);
    expect(readHooksWaived(options?.hookExemptRead, "ledger")).toBe(false);
  });

  describe("host reads", () => {
    /** What a host schema was asked, beside the schema. */
    interface Asked {
      /** Each schema asked for, as `kind:slug`. */
      asked: string[];
      /** Each component whose fields were asked for. */
      components: string[];
      /** Each page of the collection listing asked for. */
      pages: number[];
      /** How many times the Singles were listed. */
      singleListings: number;
      /** The most questions ever outstanding at once. */
      mostAtOnce: number;
    }

    /** A listed collection, as the collection listing answers one. */
    function listedCollection(slug: string): Collection {
      return {
        id: `id-${slug}`,
        name: slug,
        label: slug,
        tableName: `dc_${slug}`,
        schemaDefinition: { fields: [] },
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
    }

    /** A listed Single, as the Singles listing answers one. */
    function listedSingle(slug: string): PluginSingleRecord {
      return {
        id: `id-${slug}`,
        slug,
        label: slug,
        fields: [],
        source: "code",
      };
    }

    /**
     * A host schema: `pages` holds the plugin's `doc` type inside a repeater's
     * group, `promo` and `banner` hold it inside the component `hero`,
     * `addons` names `cta` (holding none) and `hero` side by side, `posts`
     * and the Single `footer` hold none, `home` is a Single holding it at the
     * top level, and `ledger` is listed with no schema at all.
     *
     * Every question answers after a timer, so two asked together are
     * outstanding together, and `mostAtOnce` says whether any were.
     */
    function hostSchema(): HostSchemaSource & Asked {
      const state: Asked = {
        asked: [],
        components: [],
        pages: [],
        singleListings: 0,
        mostAtOnce: 0,
      };
      let outstanding = 0;
      const later = async <T>(value: T): Promise<T> => {
        outstanding++;
        state.mostAtOnce = Math.max(state.mostAtOnce, outstanding);
        await new Promise(resolve => setTimeout(resolve, 0));
        outstanding--;
        return value;
      };
      const fields: Record<string, readonly unknown[]> = {
        "collection:pages": [
          {
            name: "rows",
            type: "repeater",
            fields: [
              {
                name: "panel",
                type: "group",
                fields: [{ name: "body", type: "doc" }],
              },
            ],
          },
        ],
        "collection:promo": [
          { name: "hero", type: "component", component: "hero" },
        ],
        "collection:banner": [
          { name: "lead", type: "component", component: "hero" },
        ],
        "collection:addons": [
          { name: "action", type: "component", component: "cta" },
          { name: "hero", type: "component", component: "hero" },
        ],
        "collection:posts": [{ name: "title", type: "text" }],
        "Single:home": [{ name: "body", type: "doc" }],
        "Single:footer": [{ name: "note", type: "text" }],
      };
      // A contributed type is not in the built-in field union.
      const components: Record<string, FieldConfig[]> = {
        hero: [{ name: "intro", type: "doc" }] as unknown as FieldConfig[],
        cta: [{ name: "label", type: "text" }] as FieldConfig[],
      };
      const collectionSlugs = [
        ...Object.keys(fields)
          .filter(key => key.startsWith("collection:"))
          .map(key => key.slice("collection:".length)),
        "ledger",
      ].sort();
      return Object.assign(state, {
        fieldTypes: ["doc"],
        fieldsOf: (kind: "collection" | "Single", slug: string) => {
          state.asked.push(`${kind}:${slug}`);
          return later(fields[`${kind}:${slug}`] ?? null);
        },
        componentFields: (slug: string) => {
          state.components.push(slug);
          return later(components[slug] ?? null);
        },
        listCollections: (page: number, limit: number) => {
          state.pages.push(page);
          return later(
            collectionSlugs
              .slice((page - 1) * limit, page * limit)
              .map(listedCollection)
          );
        },
        listSingles: () => {
          state.singleListings++;
          return later(["home", "footer"].map(listedSingle));
        },
      });
    }

    it("reads a host collection holding the plugin's field type at any depth, under a grant for that slug alone", async () => {
      const { seen, facade } = standIn();
      const reads = ownCollectionReads(
        facade,
        ["ledger"],
        undefined,
        hostSchema()
      );

      await withWriteTransactionToken({} as TransactionContext, async tx => {
        await reads.listHostEntriesInTransaction(tx, "pages");
        await reads.findHostEntryByIdInTransaction(tx, "promo", "1", {
          lock: "update",
        });
      });

      expect(seen.map(call => call.method)).toEqual([
        "listEntries",
        "findEntryById",
      ]);
      const [pages, promo] = seen.map(call => call.context.hookExemptRead);
      expect(readHooksWaived(pages, "pages")).toBe(true);
      expect(readHooksWaived(promo, "promo")).toBe(true);
      // Each call's grant reaches its own slug and no other, the plugin's
      // own collections included.
      expect(readHooksWaived(pages, "promo")).toBe(false);
      expect(readHooksWaived(pages, "ledger")).toBe(false);
      expect(seen[0]?.context.overrideAccess).toBe(true);
    });

    it("refuses a host collection holding none of the plugin's types, or none at all, before calling the service", async () => {
      const { service, facade } = standIn();
      const schema = hostSchema();
      const reads = ownCollectionReads(facade, ["ledger"], undefined, schema);

      await withWriteTransactionToken({} as TransactionContext, async tx => {
        for (const slug of ["posts", "missing"]) {
          await expect(
            reads.listHostEntriesInTransaction(tx, slug)
          ).rejects.toMatchObject({
            code: "INVALID_INPUT",
            logContext: { reason: "host-collection-read-not-eligible" },
          });
        }
        // The plugin's own collection is not a host one unless it holds the
        // type: declaring it grants an own read, not a host read.
        await expect(
          reads.findHostEntryByIdInTransaction(tx, "ledger", "1")
        ).rejects.toMatchObject({
          logContext: { reason: "host-collection-read-not-eligible" },
        });
      });

      expect(schema.asked).toEqual([
        "collection:posts",
        "collection:missing",
        "collection:ledger",
      ]);
      expect(service.listEntries).not.toHaveBeenCalled();
      expect(service.findEntryById).not.toHaveBeenCalled();
    });

    it("refuses every host read of a plugin that registered no field type, asking no schema", async () => {
      const { service, facade } = standIn();
      const schema = { ...hostSchema(), fieldTypes: [] };
      const reads = ownCollectionReads(facade, [], undefined, schema);

      await withWriteTransactionToken({} as TransactionContext, async tx => {
        await expect(
          reads.listHostEntriesInTransaction(tx, "pages")
        ).rejects.toMatchObject({
          logContext: { reason: "host-collection-read-not-eligible" },
        });
      });

      expect(schema.asked).toEqual([]);
      expect(service.listEntries).not.toHaveBeenCalled();
    });

    it("refuses a settled token before asking the schema", async () => {
      const { facade } = standIn();
      const schema = hostSchema();
      const reads = ownCollectionReads(facade, [], undefined, schema);
      let kept: PluginCollectionTransaction | undefined;
      await withWriteTransactionToken({} as TransactionContext, async tx => {
        kept = tx;
      });
      if (!kept) throw new Error("the transaction's work never ran");
      const settled = kept;

      await expect(
        reads.listHostEntriesInTransaction(settled, "pages")
      ).rejects.toMatchObject({
        logContext: { reason: "plugin-transaction-finished" },
      });
      expect(schema.asked).toEqual([]);
    });

    it("reads a host Single holding the plugin's type and refuses one holding none", async () => {
      const { facade } = standIn();
      const asked: { slug: string; options: GetSingleOptions | undefined }[] =
        [];
      const reads = ownCollectionReads(
        facade,
        [],
        {
          owned: [],
          service: () => ({
            get: (slug: string, options?: GetSingleOptions) => {
              asked.push({ slug, options });
              return Promise.resolve({
                success: true,
                statusCode: 200,
                data: { id: "s1", updatedAt: "2026-01-01T00:00:00.000Z" },
              });
            },
          }),
        },
        hostSchema()
      );

      await withWriteTransactionToken({} as TransactionContext, async tx => {
        await expect(
          reads.getHostSingleInTransaction(tx, "footer")
        ).rejects.toMatchObject({
          logContext: { reason: "host-single-read-not-eligible" },
        });
        // A collection's eligibility does not make a Single of its slug one.
        await expect(
          reads.getHostSingleInTransaction(tx, "pages")
        ).rejects.toMatchObject({
          logContext: { reason: "host-single-read-not-eligible" },
        });
        expect((await reads.getHostSingleInTransaction(tx, "home")).id).toBe(
          "s1"
        );
      });

      expect(asked.map(call => call.slug)).toEqual(["home"]);
      const grant = asked[0]?.options?.hookExemptRead;
      expect(readHooksWaived(grant, "home")).toBe(true);
      expect(readHooksWaived(grant, "footer")).toBe(false);
      expect(asked[0]?.options?.createIfMissing).toBe(false);
    });

    describe("listHostTypesInTransaction", () => {
      it("lists each collection and Single holding the plugin's type at any depth, the plugin's own judged like the rest", async () => {
        const { service, facade } = standIn();
        const schema = hostSchema();
        // `pages` is the plugin's own and holds the type; `ledger` is its
        // own and holds nothing.
        const reads = ownCollectionReads(
          facade,
          ["ledger", "pages"],
          undefined,
          schema
        );

        const found = await withWriteTransactionToken(
          {} as TransactionContext,
          async tx => {
            const types = await reads.listHostTypesInTransaction(tx);
            // Every slug it lists is one a host read on the same
            // transaction accepts.
            for (const listed of types.collections) {
              await reads.listHostEntriesInTransaction(tx, listed.name);
            }
            return types;
          }
        );

        // In the listing's slug order: inside a component named beside
        // another, inside a component, inside a repeater's group, and inside
        // a component again.
        expect(found.collections.map(listed => listed.name)).toEqual([
          "addons",
          "banner",
          "pages",
          "promo",
        ]);
        // Answered as the listing answered them, not rebuilt.
        expect(found.collections[0]).toEqual(listedCollection("addons"));
        expect(found.singles).toEqual([listedSingle("home")]);
        expect(service.listEntries).toHaveBeenCalledTimes(4);
        // Each listed entry judged by its schema, as a host read judges it.
        expect(schema.asked).toEqual([
          "collection:addons",
          "collection:banner",
          "collection:ledger",
          "collection:pages",
          "collection:posts",
          "collection:promo",
          "Single:home",
          "Single:footer",
          // The host reads above, each judging its own slug again.
          "collection:addons",
          "collection:banner",
          "collection:pages",
          "collection:promo",
        ]);
      });

      it("asks each component once per walk, and never two questions at once", async () => {
        const { facade } = standIn();
        const schema = hostSchema();
        const reads = ownCollectionReads(facade, [], undefined, schema);

        await withWriteTransactionToken({} as TransactionContext, tx =>
          reads.listHostTypesInTransaction(tx)
        );

        // `hero` is named by three collections and asked for once; `addons`
        // names `cta` and `hero` together, the first time either is asked.
        expect(schema.components).toEqual(["cta", "hero"]);
        expect(schema.mostAtOnce).toBe(1);
        expect(schema.pages).toEqual([1]);
        expect(schema.singleListings).toBe(1);
      });

      it("pages through the collections until a short page", async () => {
        const { facade } = standIn();
        const pages: number[] = [];
        // One more collection than a page holds; the first and the last
        // hold the type, so the last is found only on the second page.
        const slugs = Array.from(
          { length: HOST_TYPES_PAGE_SIZE + 1 },
          (_, index) => `c${String(index).padStart(4, "0")}`
        );
        const first = slugs[0];
        const last = slugs[slugs.length - 1];
        const reads = ownCollectionReads(facade, [], undefined, {
          fieldTypes: ["doc"],
          fieldsOf: (_kind, slug) =>
            Promise.resolve([
              {
                name: "body",
                type: slug === first || slug === last ? "doc" : "text",
              },
            ]),
          componentFields: () => Promise.resolve(null),
          listCollections: (page, limit) => {
            pages.push(page);
            return Promise.resolve(
              slugs
                .slice((page - 1) * limit, page * limit)
                .map(listedCollection)
            );
          },
          listSingles: () => Promise.resolve([]),
        });

        const found = await withWriteTransactionToken(
          {} as TransactionContext,
          tx => reads.listHostTypesInTransaction(tx)
        );

        expect(pages).toEqual([1, 2]);
        expect(found.collections.map(listed => listed.name)).toEqual([
          first,
          last,
        ]);
      });

      it("answers empty for a plugin that registered no field type, reading nothing", async () => {
        const { facade } = standIn();
        const schema = { ...hostSchema(), fieldTypes: [] };
        const reads = ownCollectionReads(facade, ["ledger"], undefined, schema);
        const noSource = ownCollectionReads(facade, ["ledger"]);

        await withWriteTransactionToken({} as TransactionContext, async tx => {
          expect(await reads.listHostTypesInTransaction(tx)).toEqual({
            collections: [],
            singles: [],
          });
          expect(await noSource.listHostTypesInTransaction(tx)).toEqual({
            collections: [],
            singles: [],
          });
        });

        // The spread shares the fixture's arrays, so these see every call.
        expect(schema.pages).toEqual([]);
        expect(schema.asked).toEqual([]);
        expect(schema.components).toEqual([]);
      });

      it("refuses a settled token before listing anything", async () => {
        const { facade } = standIn();
        const schema = hostSchema();
        const reads = ownCollectionReads(facade, [], undefined, schema);
        let kept: PluginCollectionTransaction | undefined;
        await withWriteTransactionToken({} as TransactionContext, async tx => {
          kept = tx;
        });
        if (!kept) throw new Error("the transaction's work never ran");
        const settled = kept;

        await expect(
          reads.listHostTypesInTransaction(settled)
        ).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
          logContext: { reason: "plugin-transaction-finished" },
        });
        expect(schema.pages).toEqual([]);
        expect(schema.singleListings).toBe(0);
        expect(schema.asked).toEqual([]);
      });
    });
  });

  it("grants nothing when built for no collections", async () => {
    const { service, facade } = standIn();
    const reads = ownCollectionReads(facade, []);
    await expect(reads.count("ledger")).rejects.toThrow(
      /not a collection this plugin declared/
    );
    expect(service.count).not.toHaveBeenCalled();
  });
});
