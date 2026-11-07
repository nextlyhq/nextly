/**
 * The address store against a real database: who holds each served address,
 * refused in either order and under concurrent saves, held per language, a
 * paginated list's later pages held as one space, and a waiting document
 * served once what held its address lets it go. Then the report of those
 * waits, read through the API as the person asking may see it.
 *
 * The store's calls run inside a transaction the test opens, as a save's own
 * transaction will run them.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  definePlugin,
  NextlyError,
  type PluginCollectionTransaction,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { defineCollection, text, type CollectionConfig } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { servedAddress, type ServedAddress } from "../address-claims/claim-key";
import {
  claimAddress,
  claimOrWait,
  claimSpace,
  claimSpaceOrWait,
  committedClaims,
  reconcileHolder,
  releaseClaims,
  storedKey,
  type Claims,
  type Holder,
} from "../address-claims/claim-store";
import { ADDRESS_WAITING_ROUTE_PATH } from "../address-claims/waiting-report-route";
import {
  ADDRESS_CLAIMS_SLUG,
  addressClaimsCollection,
} from "../collections/address-claims";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

const at = (path: string, locale = "en"): ServedAddress => {
  const address = servedAddress(locale, path);
  if (address === null) throw new Error(`${path} names no address`);
  return address;
};
const page = (id: string): Holder => ({ collection: "pages", id });
const post = (id: string): Holder => ({ collection: "posts", id });
const describeHolder = async (holder: Holder) =>
  `${holder.collection} ${holder.id}`;

describe.each(getConfiguredTestDialects())(
  "the address store (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** A plugin holding only the claims collection, and its context. */
    async function boot(): Promise<PluginContext> {
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          definePlugin({
            name: "@t/address-claims",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { collections: [addressClaimsCollection()] },
            init(ctx) {
              captured = ctx;
            },
          }),
        ],
      });
      if (captured === undefined) throw new Error("the plugin never started");
      return captured;
    }

    const claimsOf = (ctx: PluginContext): Claims => ({
      services: ctx.services,
      slug: ADDRESS_CLAIMS_SLUG,
      dialect: ctx.dialect,
    });

    /** Run `work` in one transaction, as a save does. */
    function saving<R>(
      claims: Claims,
      work: (tx: PluginCollectionTransaction) => Promise<R>
    ): Promise<R> {
      return claims.services.collections.withTransaction(work);
    }

    const claim = (
      claims: Claims,
      path: string,
      holder: Holder,
      locale?: string
    ) =>
      saving(claims, tx =>
        claimAddress(claims, tx, {
          address: at(path, locale),
          holder,
          describe: describeHolder,
        })
      );

    const paginate = (claims: Claims, path: string, holder: Holder) =>
      saving(claims, tx =>
        claimSpace(claims, tx, {
          list: at(path),
          holder,
          describe: describeHolder,
        })
      );

    const release = (claims: Claims, holder: Holder) =>
      saving(claims, tx => releaseClaims(claims, tx, holder));

    /** The stored claims of `kind`, as `[path, holder id]` pairs. */
    async function stored(claims: Claims, kind: string) {
      const { rows } = await committedClaims(
        claims,
        { kind: { equals: kind } },
        { limit: 100 }
      );
      // Sorted: rows come back in stored-key order, which is a digest's.
      return rows
        .map(row => [
          row.address === null ? null : `/${row.address.segments.join("/")}`,
          row.holder?.id ?? null,
        ])
        .sort();
    }

    it("refuses a second document at an address, naming the first, in either order", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/about", page("p1"));
      await expect(claim(claims, "/about/", post("e1"))).rejects.toThrow(
        "/about is already the address of pages p1."
      );

      await claim(claims, "/contact", post("e1"));
      await expect(claim(claims, "/contact", page("p1"))).rejects.toThrow(
        "/contact is already the address of posts e1."
      );
      expect(await stored(claims, "address")).toEqual([
        ["/about", "p1"],
        ["/contact", "e1"],
      ]);
    });

    it("refuses as a conflict, so the save says why", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/about", page("p1"));
      const refused = await claim(claims, "/about", page("p2")).catch(
        (error: unknown) => error
      );
      expect(NextlyError.isCode(refused, "CONFLICT")).toBe(true);
    });

    it("holds nothing for a save that is rolled back", async () => {
      const claims = claimsOf(await boot());
      await expect(
        saving(claims, async tx => {
          await claimAddress(claims, tx, {
            address: at("/about"),
            holder: page("p1"),
            describe: describeHolder,
          });
          throw new Error("the save failed after claiming");
        })
      ).rejects.toThrow("the save failed after claiming");
      await claim(claims, "/about", page("p2"));
      expect(await stored(claims, "address")).toEqual([["/about", "p2"]]);
    });

    it("changes nothing when a document claims the address it holds", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/about", page("p1"));
      await claim(claims, "/about", page("p1"));
      expect(await stored(claims, "address")).toEqual([["/about", "p1"]]);
    });

    it("holds one slug once per language, and releases each on its own", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/about", page("p1"), "en");
      await claim(claims, "/about", page("p2"), "fr");
      await release(claims, page("p2"));
      await expect(claim(claims, "/about", page("p3"), "en")).rejects.toThrow(
        "pages p1"
      );
      await claim(claims, "/about", page("p3"), "fr");
    });

    it("refuses a page among a list's later pages, and a list paginating over a page, in either order", async () => {
      const claims = claimsOf(await boot());
      await paginate(claims, "/news", page("list"));
      await expect(claim(claims, "/news/page/2", page("p1"))).rejects.toThrow(
        "/news/page/2 is one of the later pages of the list at /news, on pages list."
      );

      await claim(claims, "/events/page/3", page("p1"));
      await expect(paginate(claims, "/events", page("list"))).rejects.toThrow(
        "/events/page/3 is already the address of pages p1."
      );
      // The list's own address is not one of its later pages.
      await claim(claims, "/news", page("list"));
    });

    it("holds a list's later pages as one claim however many there are, until it stops paginating", async () => {
      const claims = claimsOf(await boot());
      await paginate(claims, "/news", page("list"));
      // Paginated again, as a list that grew is saved again: nothing new.
      await paginate(claims, "/news", page("list"));
      expect(await stored(claims, "space")).toEqual([["/news", "list"]]);
      expect(await stored(claims, "address")).toEqual([]);

      await release(claims, page("list"));
      await claim(claims, "/news/page/2", page("p1"));
      expect(await stored(claims, "space")).toEqual([]);
    });

    it("serves a waiting document once the claim in its way is released", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/blog/hello", page("p1"));
      expect(
        await saving(claims, tx =>
          claimOrWait(claims, tx, {
            address: at("/blog/hello"),
            holder: post("e1"),
          })
        )
      ).toBe("waiting");
      expect(await stored(claims, "waiting")).toEqual([["/blog/hello", "e1"]]);

      await release(claims, page("p1"));
      expect(await stored(claims, "address")).toEqual([["/blog/hello", "e1"]]);
      expect(await stored(claims, "waiting")).toEqual([]);
      await expect(claim(claims, "/blog/hello", page("p1"))).rejects.toThrow(
        "posts e1"
      );
    });

    it("leaves a document waiting on one claim waiting after another of its kind is released", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/blog/hello", page("p1"));
      await claim(claims, "/blog/bye", page("p2"));
      for (const path of ["/blog/hello", "/blog/bye"]) {
        await saving(claims, tx =>
          claimOrWait(claims, tx, { address: at(path), holder: post("e1") })
        );
      }
      await release(claims, page("p2"));
      expect(await stored(claims, "address")).toEqual([
        ["/blog/bye", "e1"],
        ["/blog/hello", "p1"],
      ]);
      expect(await stored(claims, "waiting")).toEqual([["/blog/hello", "e1"]]);
    });

    it("holds addresses differing only in case apart, and one longer than a column", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/About", page("p1"));
      await claim(claims, "/about", page("p2"));
      const long = `/${"a".repeat(300)}`;
      await claim(claims, long, page("p3"));
      await expect(claim(claims, long, page("p4"))).rejects.toThrow("pages p3");
    });

    it("moves one language's address and keeps the others", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/about", page("p1"), "en");
      await claim(claims, "/a-propos", page("p1"), "fr");
      await saving(claims, async tx => {
        await claimAddress(claims, tx, {
          address: at("/qui-sommes-nous", "fr"),
          holder: page("p1"),
          describe: describeHolder,
        });
        await releaseClaims(claims, tx, page("p1"), {
          address: at("/a-propos", "fr"),
        });
      });
      expect(await stored(claims, "address")).toEqual([
        ["/about", "p1"],
        ["/qui-sommes-nous", "p1"],
      ]);
      await claim(claims, "/a-propos", page("p2"), "fr");
      await expect(claim(claims, "/about", page("p2"), "en")).rejects.toThrow(
        "pages p1"
      );
    });

    it("serves one of two documents waiting on a released space, and keeps the other waiting", async () => {
      const claims = claimsOf(await boot());
      await paginate(claims, "/news", page("list"));
      for (const id of ["e1", "e2"]) {
        await saving(claims, tx =>
          claimOrWait(claims, tx, {
            address: at("/news/page/2"),
            holder: post(id),
          })
        );
      }
      await release(claims, page("list"));
      const [served] = await stored(claims, "address");
      const [waiting] = await stored(claims, "waiting");
      expect([served?.[1], waiting?.[1]].sort()).toEqual(["e1", "e2"]);
      expect(waiting?.[0]).toBe("/news/page/2");

      await release(claims, post(String(served?.[1])));
      expect(await stored(claims, "address")).toEqual([
        ["/news/page/2", waiting?.[1] ?? null],
      ]);
      expect(await stored(claims, "waiting")).toEqual([]);
    });

    const waitForSpace = (claims: Claims, path: string, holder: Holder) =>
      saving(claims, tx =>
        claimSpaceOrWait(claims, tx, { list: at(path), holder })
      );

    it("gives a waiting list its later pages once every page among them is released", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/news/page/2", page("p2"));
      await claim(claims, "/news/page/3", page("p3"));
      expect(await waitForSpace(claims, "/news", page("list"))).toBe("waiting");
      expect(await stored(claims, "waiting")).toEqual([
        ["/news", "list"],
        ["/news", "list"],
      ]);

      await release(claims, page("p2"));
      expect(await stored(claims, "space")).toEqual([]);
      expect(await stored(claims, "waiting")).toEqual([["/news", "list"]]);

      await release(claims, page("p3"));
      expect(await stored(claims, "space")).toEqual([["/news", "list"]]);
      expect(await stored(claims, "waiting")).toEqual([]);
      await expect(claim(claims, "/news/page/2", page("p2"))).rejects.toThrow(
        "pages list"
      );
    });

    it("settles a list's wait for its later pages apart from its wait for its address", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/news", post("e1"));
      await claim(claims, "/news/page/2", page("p2"));
      await saving(claims, tx =>
        claimOrWait(claims, tx, { address: at("/news"), holder: page("list") })
      );
      await waitForSpace(claims, "/news", page("list"));

      // Its address is still held by another, but nothing is left among its
      // later pages: it takes them, and keeps waiting for its address.
      await release(claims, page("p2"));
      expect(await stored(claims, "space")).toEqual([["/news", "list"]]);
      expect(await stored(claims, "waiting")).toEqual([["/news", "list"]]);
      expect(await stored(claims, "address")).toEqual([["/news", "e1"]]);
    });

    it("drops a list's wait for its later pages once it stops paginating", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/news/page/2", page("p2"));
      await waitForSpace(claims, "/news", page("list"));
      await saving(claims, tx =>
        reconcileHolder(
          claims,
          tx,
          page("list"),
          { addresses: [at("/news")], spaces: [] },
          describeHolder
        )
      );
      expect(await stored(claims, "waiting")).toEqual([]);

      await release(claims, page("p2"));
      expect(await stored(claims, "space")).toEqual([]);
      expect(await stored(claims, "address")).toEqual([["/news", "list"]]);
    });

    it("keeps a document waiting when it moves to another address the same claim blocks", async () => {
      const claims = claimsOf(await boot());
      await paginate(claims, "/news", page("list"));
      await saving(claims, tx =>
        claimOrWait(claims, tx, {
          address: at("/news/page/2"),
          holder: post("e1"),
        })
      );
      // Moved in one transaction: wait for the new address, then let the
      // old one go.
      await saving(claims, async tx => {
        await claimOrWait(claims, tx, {
          address: at("/news/page/3"),
          holder: post("e1"),
        });
        await releaseClaims(claims, tx, post("e1"), {
          address: at("/news/page/2"),
        });
      });
      expect(await stored(claims, "waiting")).toEqual([["/news/page/3", "e1"]]);

      await release(claims, page("list"));
      expect(await stored(claims, "address")).toEqual([["/news/page/3", "e1"]]);
    });

    it("stops a list paginating while it keeps its own address", async () => {
      const claims = claimsOf(await boot());
      await claim(claims, "/news", page("list"));
      await paginate(claims, "/news", page("list"));
      await saving(claims, tx =>
        releaseClaims(claims, tx, page("list"), {
          address: at("/news"),
          kind: "space",
        })
      );
      expect(await stored(claims, "address")).toEqual([["/news", "list"]]);
      expect(await stored(claims, "space")).toEqual([]);
      await claim(claims, "/news/page/2", page("p1"));
    });

    it("releases every claim a holder has, however many reads that takes", async () => {
      const claims = claimsOf(await boot());
      await saving(claims, async tx => {
        for (let i = 0; i < 501; i++) {
          await claims.services.collections.createEntryInTransaction(
            tx,
            ADDRESS_CLAIMS_SLUG,
            {
              claimKey: storedKey(`addr:en|/bulk/${String(i)}`),
              kind: "address",
              locale: "en",
              path: `/bulk/${String(i)}`,
              holderCollection: "pages",
              holderId: "many",
            }
          );
        }
      });
      await release(claims, page("many"));
      const { total } = await committedClaims(
        claims,
        { holderId: { equals: "many" } },
        { limit: 1 }
      );
      expect(total).toBe(0);
    }, 120_000);

    /*
     * Concurrent saves. SQLite runs one writer at a time, so the race below
     * cannot happen there; PostgreSQL and MySQL run both at once.
     */
    describe.skipIf(dialect === "sqlite")("under concurrent saves", () => {
      /**
       * The claims, with each claim's write held until the other save reaches
       * its own or a moment passes: two saves that both got past their checks
       * then write together.
       */
      function racing(ctx: PluginContext): Claims {
        let arrived = 0;
        let bothArrived: () => void = () => undefined;
        const together = new Promise<void>(resolve => {
          bothArrived = resolve;
        });
        const meet = async () => {
          arrived += 1;
          if (arrived === 2) bothArrived();
          await Promise.race([
            together,
            new Promise(resolve => setTimeout(resolve, 500)),
          ]);
        };
        const real = ctx.services.collections;
        // The service with one method replaced. Its methods are frozen own
        // properties, which a proxy may not hand back changed, so the copy
        // inherits them and defines its own in its place.
        const collections: typeof real = Object.create(real);
        const create: typeof real.createEntryInTransaction = async (
          tx,
          collection,
          data,
          opts
        ) => {
          if (data.kind === "address" || data.kind === "space") await meet();
          return real.createEntryInTransaction(tx, collection, data, opts);
        };
        Object.defineProperty(collections, "createEntryInTransaction", {
          value: create,
        });
        return {
          services: { ...ctx.services, collections },
          slug: ADDRESS_CLAIMS_SLUG,
          dialect: ctx.dialect,
        };
      }

      it("gives an address to one of two saves claiming it at once", async () => {
        const claims = racing(await boot());
        const settled = await Promise.allSettled([
          claim(claims, "/about", page("p1")),
          claim(claims, "/about", page("p2")),
        ]);
        expect(settled.map(outcome => outcome.status).sort()).toEqual([
          "fulfilled",
          "rejected",
        ]);
        expect(await stored(claims, "address")).toHaveLength(1);
      });

      it("gives a list's later pages or a page among them to one of two saves at once", async () => {
        const claims = racing(await boot());
        const settled = await Promise.allSettled([
          paginate(claims, "/news", page("list")),
          claim(claims, "/news/page/2", page("p1")),
        ]);
        expect(settled.map(outcome => outcome.status).sort()).toEqual([
          "fulfilled",
          "rejected",
        ]);
        const held = [
          ...(await stored(claims, "space")),
          ...(await stored(claims, "address")),
        ];
        expect(held).toHaveLength(1);
      });

      it("serves a document that starts waiting for an address while it is released", async () => {
        const ctx = await boot();
        await claim(claimsOf(ctx), "/x", page("p1"));
        // Forces the one order that loses the waiter: the wait reads the old
        // claim, the release then deletes it and finds no one waiting, and
        // only after the release commits is the wait written. Each side gives
        // up waiting for the other after a second, which is what happens when
        // the other is held behind a lock instead.
        let waiterRead: () => void = () => undefined;
        const read = new Promise<void>(resolve => {
          waiterRead = resolve;
        });
        let releaseDone: () => void = () => undefined;
        const released = new Promise<void>(resolve => {
          releaseDone = resolve;
        });
        const within = (gate: Promise<void>) =>
          Promise.race([
            gate,
            new Promise<void>(resolve => setTimeout(resolve, 1000)),
          ]);
        const real = ctx.services.collections;
        const collections: typeof real = Object.create(real);
        const create: typeof real.createEntryInTransaction = async (
          tx,
          collection,
          data,
          opts
        ) => {
          if (data.kind === "waiting") {
            waiterRead();
            await within(released);
          }
          return real.createEntryInTransaction(tx, collection, data, opts);
        };
        const remove: typeof real.deleteEntryInTransaction = async (
          tx,
          collection,
          id,
          opts
        ) => {
          await within(read);
          return real.deleteEntryInTransaction(tx, collection, id, opts);
        };
        Object.defineProperty(collections, "createEntryInTransaction", {
          value: create,
        });
        Object.defineProperty(collections, "deleteEntryInTransaction", {
          value: remove,
        });
        const claims: Claims = {
          services: { ...ctx.services, collections },
          slug: ADDRESS_CLAIMS_SLUG,
          dialect: ctx.dialect,
        };
        const [releaseOutcome, waitOutcome] = await Promise.allSettled([
          release(claims, page("p1")).finally(releaseDone),
          saving(claims, tx =>
            claimOrWait(claims, tx, { address: at("/x"), holder: post("e1") })
          ),
        ]);
        expect(waitOutcome.status).toBe("fulfilled");
        if (releaseOutcome.status === "rejected") {
          // MySQL reads a transaction's rows from its snapshot, so a release
          // that met a wait committed after it began is refused, as a
          // conflict to retry, with nothing done. Retried, it sees the wait.
          expect(dialect).toBe("mysql");
          expect(NextlyError.isCode(releaseOutcome.reason, "CONFLICT")).toBe(
            true
          );
          await release(claimsOf(ctx), page("p1"));
        }
        // Either way the waiter is never lost: it holds the address.
        expect(await stored(claims, "address")).toEqual([["/x", "e1"]]);
        expect(await stored(claims, "waiting")).toEqual([]);
      });
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the waiting report (%s)",
  (dialect: TestDialect) => {
    const ORIGIN = "http://localhost";
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(
      collections: readonly CollectionConfig[] = []
    ): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        ...(collections.length === 0 ? {} : { collections: [...collections] }),
        seedPublic: true,
      });
      // The first user is the super admin, made here so no one below is.
      await person(current, "owner");
      return current;
    }

    async function person(t: TestNextly, name: string): Promise<string> {
      const created = await t.nextly.users.create({
        email: `${name}-${Date.now()}@example.com`,
        password: "Password123!",
        data: { name, isActive: true },
      });
      return created.item.id;
    }

    let roles = 0;

    async function grant(t: TestNextly, userId: string, slugs: string[]) {
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      roles += 1;
      const role = await t.nextly.roles.create({
        data: { name: `Role ${roles}`, slug: `r-${roles}`, permissionIds: ids },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
    }

    async function sessionOf(t: TestNextly, userId: string): Promise<string> {
      const user = await t.nextly.users.findByID({ id: userId });
      if (user === null) throw new Error(`no user ${userId}`);
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: user.email,
          name: user.name ?? "",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    async function get(
      cookie: string,
      params: string[],
      search = ""
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const response = await createDynamicHandlers().GET(
        new Request(`${ORIGIN}/api/${params.join("/")}${search}`, {
          headers: { cookie },
        }),
        { params: Promise.resolve({ params }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    const report = (cookie: string, search = "") =>
      get(
        cookie,
        [
          "plugins",
          ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
          ...ADDRESS_WAITING_ROUTE_PATH.split("/").filter(Boolean),
        ],
        search
      );

    async function create(
      t: TestNextly,
      collection: string,
      data: Record<string, unknown>
    ): Promise<string> {
      const created = await t.nextly.create({
        collection,
        data,
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    /** A page `waiting` for `/hello`, held by `holder`. */
    async function seedWait(t: TestNextly, waiting: string, holder: Holder) {
      const addressKey = storedKey("addr:en|/hello");
      await create(t, ADDRESS_CLAIMS_SLUG, {
        claimKey: addressKey,
        kind: "address",
        locale: "en",
        path: "/hello",
        holderCollection: holder.collection,
        holderId: holder.id,
      });
      await create(t, ADDRESS_CLAIMS_SLUG, {
        claimKey: storedKey(`wait:pages:${waiting}|${addressKey}`),
        kind: "waiting",
        locale: "en",
        path: "/hello",
        holderCollection: "pages",
        holderId: waiting,
        blockedBy: addressKey,
      });
    }

    const pageData = (title: string) => ({
      title,
      slug: `${title.toLowerCase().replaceAll(" ", "-")}-${Date.now()}`,
      content: { formatVersion: 1, kind: "page", nodes: [] },
    });

    it("lists who waits for an address and who holds it, by title", async () => {
      const t = await boot();
      const author = await person(t, "author");
      await grant(t, author, ["read-pages", "update-pages"]);
      const waiting = await create(t, "pages", pageData("Waiting page"));
      const holder = await create(t, "pages", pageData("Holder page"));
      await seedWait(t, waiting, page(holder));

      const answered = await report(await sessionOf(t, author));
      expect(answered.status).toBe(200);
      expect(answered.body.items).toEqual([
        {
          document: { collection: "pages", id: waiting, title: "Waiting page" },
          address: { locale: "en", path: "/hello" },
          blockedBy: { collection: "pages", id: holder, title: "Holder page" },
        },
      ]);
      expect(answered.body.meta).toMatchObject({
        total: 1,
        page: 1,
        hasNext: false,
      });
    });

    it("lists a list waiting for its later pages at the later page in its way", async () => {
      const t = await boot();
      const author = await person(t, "author");
      await grant(t, author, ["read-pages", "update-pages"]);
      const waiting = await create(t, "pages", pageData("News page"));
      const holder = await create(t, "pages", pageData("Second page"));
      const spaceKey = storedKey("space:en|/news");
      const addressKey = storedKey("addr:en|/news/page/2");
      await create(t, ADDRESS_CLAIMS_SLUG, {
        claimKey: addressKey,
        kind: "address",
        locale: "en",
        path: "/news/page/2",
        holderCollection: "pages",
        holderId: holder,
        space: spaceKey,
      });
      await create(t, ADDRESS_CLAIMS_SLUG, {
        claimKey: storedKey(`wait:space:pages:${waiting}|${addressKey}`),
        kind: "waiting",
        locale: "en",
        path: "/news",
        holderCollection: "pages",
        holderId: waiting,
        space: spaceKey,
        blockedBy: addressKey,
      });

      const answered = await report(await sessionOf(t, author));
      expect(answered.body.items).toEqual([
        {
          document: { collection: "pages", id: waiting, title: "News page" },
          address: { locale: "en", path: "/news/page/2" },
          blockedBy: { collection: "pages", id: holder, title: "Second page" },
        },
      ]);
    });

    it("names a holder the caller may not read by its id alone", async () => {
      const t = await boot();
      const author = await person(t, "author");
      await grant(t, author, ["read-pages", "update-pages"]);
      const waiting = await create(t, "pages", pageData("Waiting page"));
      const hidden = await create(t, "components", {
        title: "Secret card",
        slug: `secret-${Date.now()}`,
        content: { formatVersion: 1, kind: "component", nodes: [] },
      });
      await seedWait(t, waiting, { collection: "components", id: hidden });

      const answered = await report(await sessionOf(t, author));
      expect(answered.status).toBe(200);
      expect(
        (answered.body.items as { blockedBy: unknown }[])[0]?.blockedBy
      ).toEqual({ collection: "components", id: hidden, title: null });
    });

    it("names a holder by the field its collection names entries by", async () => {
      const t = await boot([
        defineCollection({
          slug: "ac_articles",
          admin: { useAsTitle: "headline" },
          access: { read: () => true },
          fields: [text({ name: "headline" })],
        }),
      ]);
      const author = await person(t, "author");
      await grant(t, author, [
        "read-pages",
        "update-pages",
        "read-ac_articles",
      ]);
      const waiting = await create(t, "pages", pageData("Waiting page"));
      const article = await create(t, "ac_articles", { headline: "Big news" });
      await seedWait(t, waiting, { collection: "ac_articles", id: article });

      const answered = await report(await sessionOf(t, author));
      expect(
        (answered.body.items as { blockedBy: unknown }[])[0]?.blockedBy
      ).toEqual({ collection: "ac_articles", id: article, title: "Big news" });
    });

    it("names a holder in a collection the site no longer has by its id", async () => {
      const t = await boot();
      const author = await person(t, "author");
      await grant(t, author, ["read-pages", "update-pages"]);
      const waiting = await create(t, "pages", pageData("Waiting page"));
      await seedWait(t, waiting, { collection: "removed_things", id: "x1" });

      const answered = await report(await sessionOf(t, author));
      expect(answered.status).toBe(200);
      expect(
        (answered.body.items as { blockedBy: unknown }[])[0]?.blockedBy
      ).toEqual({ collection: "removed_things", id: "x1", title: null });
    });

    it("refuses a malformed page as the caller's mistake", async () => {
      const t = await boot();
      const author = await person(t, "author");
      await grant(t, author, ["read-pages", "update-pages"]);
      const cookie = await sessionOf(t, author);
      for (const page of ["0", "two", "1.5"]) {
        expect((await report(cookie, `?page=${page}`)).status).toBe(400);
      }
    });

    it("is refused to someone who may not update pages", async () => {
      const t = await boot();
      const reader = await person(t, "reader");
      await grant(t, reader, ["read-pages"]);
      expect((await report(await sessionOf(t, reader))).status).toBe(403);
    });

    it("keeps the claims themselves off the wire", async () => {
      const t = await boot();
      const author = await person(t, "author");
      await grant(t, author, ["read-pages", "update-pages"]);
      await seedWait(
        t,
        await create(t, "pages", pageData("Waiting page")),
        page("p1")
      );
      const listed = await get(await sessionOf(t, author), [
        "collections",
        ADDRESS_CLAIMS_SLUG,
        "entries",
      ]);
      expect(listed.status).toBe(403);
    });
  }
);
