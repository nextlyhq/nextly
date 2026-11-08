/**
 * An entry and a page contending for one address, through real saves: the
 * entries of `posts` are served at `/blog/<slug>` while its template is
 * published, and a page's slug can name the same path.
 *
 * What separates a correct wiring from a plausible broken one:
 * - an entry and a page published at `/blog/hello` at the same time: exactly
 *   one save succeeds, whichever reaches the claim first, the other is
 *   refused naming it, and one claim row is stored;
 * - a page published at, or renamed to, an address an entry holds is
 *   refused naming the entry, and nothing is stored for the page there;
 * - a page at `/blog` itself and the entries under `/blog` never meet: an
 *   entry holds `/blog/<slug>`, and a collection's own address claims no
 *   path (see `claim-key`), so both are published and served.
 *
 * @module __tests__/entry-page-address-clash.integration.test
 */
import {
  definePlugin,
  NextlyError,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { asOverwrite } from "../document-version";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

import {
  blogPageBuilder,
  held,
  idOf,
  pageContent,
  POSTS,
  postsCollection,
  publishPostsTemplate,
  refusalOf,
  savePage,
  savePost,
  startupSettled,
  stored,
} from "./entry-page-claims-harness";

/** The two saves of a race, by the collection each writes. */
type Side = typeof POSTS | "pages";
const SIDES: readonly Side[] = [POSTS, "pages"];

/** How long a gate waits before giving up, so a broken race fails, not hangs. */
const GATE_MS = 10_000;

/**
 * How long the save that claimed first stays open after letting the other
 * go, so the other's claim meets the first's while it is uncommitted.
 */
const HOLD_MS = 300;

/** A one-shot signal, and whether it has been given. */
interface Latch {
  readonly promise: Promise<void>;
  open(): void;
  readonly opened: boolean;
}

function latch(): Latch {
  let open = () => {};
  let opened = false;
  const promise = new Promise<void>(resolve => {
    open = () => {
      opened = true;
      resolve();
    };
  });
  return {
    promise,
    open: () => open(),
    get opened() {
      return opened;
    },
  };
}

/** True once `gate` opens, false when `ms` pass first. */
function openedWithin(gate: Latch, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    gate.promise.then(() => true),
    new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The race the gate plugin steers. Each save stops at `arrived` with its
 * document written and its transaction open, before the page builder claims
 * anything for it, until its `go` opens; once it has claimed, it opens its
 * `claimed`.
 */
interface Race {
  armed: boolean;
  /** The save let go first, held open a moment after it claims. */
  first: Side | null;
  arrived: Record<Side, Latch>;
  go: Record<Side, Latch>;
  claimed: Record<Side, Latch>;
}

function newRace(first: Side | null = null): Race {
  const each = (): Record<Side, Latch> => ({
    [POSTS]: latch(),
    pages: latch(),
  });
  return {
    armed: first !== null,
    first,
    arrived: each(),
    go: each(),
    claimed: each(),
  };
}

const sideOf = (collection: unknown): Side | null =>
  SIDES.find(side => side === collection) ?? null;

/**
 * The plugin holding the gates. It depends on the page builder, so it is
 * started after it: its handler on every collection runs after the page
 * builder's, and before any collection's own handlers, the page builder's
 * claims among them; its handlers on `pages` and `posts` run after the page
 * builder's claims there.
 */
function gatePlugin(race: () => Race): PluginDefinition {
  return definePlugin({
    name: "@test/address-race-gate",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      ctx.hooks.onInTransaction("*", async write => {
        const current = race();
        const side = sideOf(write.collection);
        if (!current.armed || side === null || current.arrived[side].opened) {
          return;
        }
        current.arrived[side].open();
        await openedWithin(current.go[side], GATE_MS);
      });
      for (const side of SIDES) {
        ctx.hooks.onInTransaction(side, async () => {
          const current = race();
          if (!current.armed || current.claimed[side].opened) return;
          current.claimed[side].open();
          if (current.first === side) {
            await new Promise(resolve => setTimeout(resolve, HOLD_MS));
          }
        });
      }
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "an entry and a page at one address (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let race = newRace();

    afterEach(async () => {
      // Every gate let go, so a case that failed mid-race leaves no save
      // waiting on one.
      race.armed = false;
      for (const side of SIDES) {
        race.go[side].open();
      }
      await current?.destroy();
      current = undefined;
      race = newRace();
    });

    /** The site, its start-up passes over, with the template of `posts` published. */
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [blogPageBuilder(), gatePlugin(() => race)],
        collections: [postsCollection()],
      });
      // Until the pass over existing pages ends, a save claims the pages in
      // its way first; settled here, so each save claims only its own.
      await startupSettled(current);
      await publishPostsTemplate(current);
      return current;
    }

    /**
     * Publish the post `hello` and a page at `blog/hello` at once, `first`
     * let through to its claim while the other waits with its transaction
     * open, and the other let go once the first has claimed, while the
     * first is still uncommitted.
     */
    async function publishAtOnce(t: TestNextly, first: Side) {
      race = newRace(first);
      const second: Side = first === POSTS ? "pages" : POSTS;
      const saves = Promise.allSettled([
        savePost(t, "hello"),
        savePage(t, "Hello", "blog/hello"),
      ]);
      const bothOpen =
        (await openedWithin(race.arrived[POSTS], GATE_MS)) &&
        (await openedWithin(race.arrived.pages, GATE_MS));
      race.go[first].open();
      const firstClaimed = await openedWithin(race.claimed[first], GATE_MS);
      race.go[second].open();
      const [entry, page] = await saves;
      race.armed = false;
      return { bothOpen, firstClaimed, entry, page };
    }

    /*
     * Concurrent saves. SQLite runs one writer at a time, so two saves there
     * cannot both be open at once and the race cannot happen; its cases
     * below run the two saves one after the other instead.
     */
    describe.skipIf(dialect === "sqlite")("published at once", () => {
      it("gives the address to the entry when it claims first, and refuses the page naming it", async () => {
        const t = await boot();
        const { bothOpen, firstClaimed, entry, page } = await publishAtOnce(
          t,
          POSTS
        );
        // The race happened: both saves were open before either claimed,
        // and the page claimed only after the entry had.
        expect(bothOpen).toBe(true);
        expect(firstClaimed).toBe(true);
        expect(entry.status).toBe("fulfilled");
        expect(page.status).toBe("rejected");
        if (entry.status !== "fulfilled" || page.status !== "rejected") return;
        const entryId = idOf(entry.value);
        expect(NextlyError.isCode(page.reason, "CONFLICT")).toBe(true);
        const words = refusalOf(page.reason);
        expect(words).toContain("/blog/hello is already the address of");
        expect(words).toContain(entryId);
        expect(await held(t)).toEqual([
          `address /blog/hello ${POSTS}:${entryId}`,
        ]);
        expect(await stored(t, "pages", "blog/hello")).toBe(false);
      });

      it("gives the address to the page when it claims first, and refuses the entry naming it", async () => {
        const t = await boot();
        const { bothOpen, firstClaimed, entry, page } = await publishAtOnce(
          t,
          "pages"
        );
        expect(bothOpen).toBe(true);
        expect(firstClaimed).toBe(true);
        expect(page.status).toBe("fulfilled");
        expect(entry.status).toBe("rejected");
        if (page.status !== "fulfilled" || entry.status !== "rejected") return;
        const pageId = idOf(page.value);
        expect(NextlyError.isCode(entry.reason, "CONFLICT")).toBe(true);
        const words = refusalOf(entry.reason);
        expect(words).toContain("/blog/hello is already the address of");
        expect(words).toContain(pageId);
        expect(await held(t)).toEqual([`address /blog/hello pages:${pageId}`]);
        expect(await stored(t, POSTS, "hello")).toBe(false);
      });
    });

    describe.runIf(dialect === "sqlite")(
      "published one after the other",
      () => {
        it("refuses the page published after the entry, naming the entry", async () => {
          const t = await boot();
          const entryId = idOf(await savePost(t, "hello"));
          const refused = await savePage(t, "Hello", "blog/hello").then(
            () => undefined,
            (error: unknown) => error
          );
          expect(NextlyError.isCode(refused, "CONFLICT")).toBe(true);
          const words = refusalOf(refused);
          expect(words).toContain("/blog/hello is already the address of");
          expect(words).toContain(entryId);
          expect(await held(t)).toEqual([
            `address /blog/hello ${POSTS}:${entryId}`,
          ]);
        });

        it("refuses the entry published after the page, naming the page", async () => {
          const t = await boot();
          const pageId = idOf(await savePage(t, "Hello", "blog/hello"));
          const refused = await savePost(t, "hello").then(
            () => undefined,
            (error: unknown) => error
          );
          expect(NextlyError.isCode(refused, "CONFLICT")).toBe(true);
          const words = refusalOf(refused);
          expect(words).toContain("/blog/hello is already the address of");
          expect(words).toContain(pageId);
          expect(await held(t)).toEqual([
            `address /blog/hello pages:${pageId}`,
          ]);
          expect(await stored(t, POSTS, "hello")).toBe(false);
        });
      }
    );

    it("refuses a page published at, or renamed to, an address an entry holds, naming the entry, and stores nothing for it there", async () => {
      const t = await boot();
      const entryId = idOf(await savePost(t, "hello"));

      const published = await savePage(t, "Hello", "blog/hello").then(
        () => undefined,
        (error: unknown) => error
      );
      expect(NextlyError.isCode(published, "CONFLICT")).toBe(true);
      expect(refusalOf(published)).toContain(
        `/blog/hello is already the address of a document (${entryId})`
      );
      expect(await stored(t, "pages", "blog/hello")).toBe(false);
      expect(await held(t)).toEqual([
        `address /blog/hello ${POSTS}:${entryId}`,
      ]);

      const other = idOf(await savePage(t, "Other", "blog/other"));
      const renamed = await t.nextly
        .update({
          collection: "pages",
          id: other,
          data: asOverwrite({ status: "published", slug: "blog/hello" }),
          overrideAccess: true,
        })
        .then(
          () => undefined,
          (error: unknown) => error
        );
      expect(NextlyError.isCode(renamed, "CONFLICT")).toBe(true);
      expect(refusalOf(renamed)).toContain(
        `/blog/hello is already the address of a document (${entryId})`
      );
      // The rename is rolled back whole: the page keeps its slug and its
      // address, and holds nothing at the entry's.
      expect(await stored(t, "pages", "blog/hello")).toBe(false);
      expect(await stored(t, "pages", "blog/other")).toBe(true);
      expect(await held(t)).toEqual([
        `address /blog/hello ${POSTS}:${entryId}`,
        `address /blog/other pages:${other}`,
      ]);
      expect(
        await pageContent(t).resolveAddress(undefined, "/blog/hello")
      ).toEqual({ collection: POSTS, id: entryId, kind: "address" });
    });

    it("publishes and serves a page at /blog beside the entries served under /blog, in either order", async () => {
      const t = await boot();
      const first = idOf(await savePost(t, "first"));
      const blog = idOf(await savePage(t, "Blog", "blog"));
      const second = idOf(await savePost(t, "second"));
      expect(await held(t)).toEqual([
        `address /blog pages:${blog}`,
        `address /blog/first ${POSTS}:${first}`,
        `address /blog/second ${POSTS}:${second}`,
      ]);
      const content = pageContent(t);
      expect(await content.resolveAddress(undefined, "/blog")).toEqual({
        collection: "pages",
        id: blog,
        kind: "address",
      });
      expect(await content.resolveAddress(undefined, "/blog/first")).toEqual({
        collection: POSTS,
        id: first,
        kind: "address",
      });
      expect(await content.resolveAddress(undefined, "/blog/second")).toEqual({
        collection: POSTS,
        id: second,
        kind: "address",
      });
    });
  }
);
