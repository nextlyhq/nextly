/**
 * A variable or a shared style removed while a page saves its first use of
 * it: whichever of the two takes the composition graph lock first commits,
 * and the other is refused, so no page is left using something the site no
 * longer defines.
 *
 * Each validation judges before its write's transaction opens, so the race
 * is real: the page is judged while the variable still exists, the removal
 * while no page uses it. Only a database shows the lock closing it, and only
 * with the two writes interleaved on purpose: the first write is held inside
 * its transaction, after it has taken the lock and been judged, until the
 * second has passed its validation; then it is let go.
 *
 * - The removal first: the page write waits at the lock, reads the site's
 *   definitions after the removal committed, and is refused its first use.
 * - The page first: the removal waits at the lock, then finds the page the
 *   page write committed, and is refused; nothing is removed.
 *
 * The removal is a write of the Single as nobody, which the Single's own
 * guards before the transaction trust and do not judge: what refuses it here
 * is the judgement made under the lock and nothing else.
 *
 * Per dialect, because the lock is the dialect's own. On SQLite one writer is
 * let in at a time whatever this plugin does, and a read made while a write's
 * transaction is open runs inside it, so there the second write is refused
 * before it reaches its own transaction: the outcome is the same.
 *
 * A shared style naming a variable races its removal the same way, inside the
 * one Single: a shared-style save adding a `$token` is judged before its
 * transaction, against the variables as they then stand. Both are writes of
 * the same Single row, and every write of a Single locks its row before it
 * stores anything and before its in-transaction phase, so the second writer
 * waits at that row lock rather than at the graph lock; the gate still holds
 * the first inside its transaction until the second has passed validation,
 * so either order is produced.
 *
 * On a pool of one connection, the usual serverless PostgreSQL setting, a
 * write's own transaction holds the one connection, so whatever the
 * judgement under the lock reads must not need another.
 *
 * @module __tests__/site-style-removal-lock.integration.test
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { SITE_STYLE_SLUG } from "../site-style-storage";

/** How the in-transaction phase names the site style's writes. */
const SITE_STYLE_WRITE = `single:${SITE_STYLE_SLUG}`;

const variable = (id: string, label: string) => ({
  id,
  name: `color.${id.replace(/^t-/, "")}`,
  label,
  kind: "color",
  values: { light: "#123456" },
});
const accent = variable("t-accent", "Accent");
const spare = variable("t-spare", "Spare");

const sharedStyle = (id: string, orderIndex: number) => ({
  id,
  slug: id.replace(/^c-/, ""),
  orderIndex,
  styles: { base: { base: { color: "#111111" } } },
});
const card = sharedStyle("c-card", 0);
const spareStyle = sharedStyle("c-spare", 1);

/** `card` changed to colour with the variable `token`, labelled `label`. */
const cardUsing = (token: string, label: string) => ({
  ...card,
  label,
  styles: { base: { base: { color: { $token: token } } } },
});

/**
 * The pool size the run was started with, put back after each case: a case
 * booting on a pool of its own size must not leave it for the next one.
 */
const CALLERS_POOL_MAX = process.env.DB_POOL_MAX;

/**
 * A page whose one heading reads `text`, colours with `token` and applies
 * `classes`.
 */
const pageWith = (
  use: { text?: string; token?: string; classes?: string[] } = {}
) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "a",
      type: "core/heading",
      version: 1,
      props: { text: use.text ?? "a", level: 2 },
      ...(use.classes === undefined ? {} : { classes: use.classes }),
      ...(use.token === undefined
        ? {}
        : { styles: { base: { base: { color: { $token: use.token } } } } }),
    },
  ],
});

/** The issue codes a refused write carries, or its own code. */
function codesOf(error: unknown): string[] {
  const refusal = error as {
    code?: string;
    publicData?: { errors?: { code: string }[] };
  };
  const issues = refusal.publicData?.errors ?? [];
  return issues.length > 0
    ? issues.map(issue => issue.code)
    : [refusal.code ?? "none"];
}

const pause = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * Holds one write inside its transaction until let go, and says when a
 * marked write has passed its validation.
 */
function newGate() {
  let resolveHeld = () => {};
  let resolveValidated = () => {};
  let release = () => {};
  const held = new Promise<void>(resolve => {
    resolveHeld = resolve;
  });
  const validated = new Promise<void>(resolve => {
    resolveValidated = resolve;
  });
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    /** The write to hold: its collection, and for an entry its id. */
    hold: undefined as { collection: string; id?: string } | undefined,
    held,
    release,
    released,
    /** The text a write's data carries for `validated` to answer. */
    marker: undefined as string | undefined,
    validated,
    resolveHeld,
    resolveValidated,
  };
}

type Gate = ReturnType<typeof newGate>;

/**
 * The plugin holding the gate. It depends on the page builder, so each of its
 * in-transaction handlers runs after the page builder's under the same name:
 * the held write has taken the graph lock and been judged when it waits.
 * Registered under the site style's own name too, since the '*' handlers run
 * before a collection's own, and the removal's judgement is the site style's.
 */
function gatePlugin(gate: () => Gate): PluginDefinition {
  const holding = async (write: { collection: string; id: string }) => {
    const hold = gate().hold;
    if (hold === undefined || write.collection !== hold.collection) return;
    if (hold.id !== undefined && write.id !== hold.id) return;
    gate().hold = undefined;
    gate().resolveHeld();
    await gate().released;
  };
  const marking = (context: { data?: unknown }) => {
    const marker = gate().marker;
    if (
      marker !== undefined &&
      JSON.stringify(context.data ?? null).includes(marker)
    ) {
      gate().resolveValidated();
    }
    return undefined;
  };
  return definePlugin({
    name: "@test/removal-lock-gate",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      ctx.hooks.onInTransaction("*", async write => {
        // The site style's write is held under its own name, below.
        if (write.collection === SITE_STYLE_WRITE) return;
        await holding(write);
      });
      ctx.hooks.onInTransaction(SITE_STYLE_WRITE, holding);
      // `beforeChange` runs after validation and before the transaction opens.
      ctx.hooks.on("beforeChange", "*", marking);
      ctx.hooks.on("beforeChange", SITE_STYLE_WRITE, marking);
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "removing a variable or a shared style under the composition graph lock (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let gate = newGate();

    afterEach(async () => {
      gate.release();
      // Put back first, so a teardown that fails still leaves it as found.
      if (CALLERS_POOL_MAX === undefined) delete process.env.DB_POOL_MAX;
      else process.env.DB_POOL_MAX = CALLERS_POOL_MAX;
      await current?.destroy();
      current = undefined;
    });

    /**
     * A site storing `accent`, `spare`, `card` and `spare`'s style, and a page
     * using none. `poolMax` sizes the instance's connection pool: the adapter
     * reads `DB_POOL_MAX` when the boot creates it.
     */
    async function boot(
      options: { poolMax?: number } = {}
    ): Promise<{ t: TestNextly; pageId: string }> {
      gate = newGate();
      if (options.poolMax !== undefined) {
        process.env.DB_POOL_MAX = String(options.poolMax);
      }
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), gatePlugin(() => gate)],
      });
      const t = current;
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: {
          tokens: { tokens: [accent, spare] },
          classes: [card, spareStyle],
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const created = await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageWith() },
        overrideAccess: true,
      });
      return { t, pageId: String(created.item.id) };
    }

    /** A section of the site style as stored, read as the system. */
    async function storedIds(
      t: TestNextly,
      section: "tokens" | "classes"
    ): Promise<string[]> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown> | null;
      const raw = doc?.[section];
      const value = (typeof raw === "string" ? JSON.parse(raw) : raw) as
        | { tokens?: { id?: string }[] }
        | { id?: string }[]
        | undefined;
      const entries = Array.isArray(value) ? value : (value?.tokens ?? []);
      return entries.map(entry => String(entry.id));
    }

    /** The page's content as stored, its working draft included. */
    async function storedContent(t: TestNextly, id: string): Promise<string> {
      const row = await t.nextly.findByID({
        collection: "pages",
        id,
        depth: 0,
        status: "all",
        draft: true,
        overrideAccess: true,
      });
      return JSON.stringify((row as Record<string, unknown>).content);
    }

    /** A page's stored content, set past every check on the page's row. */
    async function plantContent(
      t: TestNextly,
      id: string,
      content: unknown
    ): Promise<void> {
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug("pages"))?.tableName;
      if (table === undefined) throw new Error("the pages table is missing");
      await t.adapter.update(
        table,
        // SQLite stores a JSON column as text; the others take the value.
        { content: dialect === "sqlite" ? JSON.stringify(content) : content },
        { and: [{ column: "id", op: "=", value: id }] }
      );
    }

    /** A save of the page's content, as an author's save makes it. */
    function savePage(t: TestNextly, id: string, content: unknown) {
      return t.nextly.update({
        collection: "pages",
        id,
        data: { content, _overwrite: true },
        overrideAccess: true,
      });
    }

    /** A write of the site style as nobody, which its guards do not judge. */
    function writeSiteStyle(t: TestNextly, data: Record<string, unknown>) {
      return t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { ...data, _overwrite: true },
        overrideAccess: true,
      });
    }

    /** A person stored on the site, by id: whom an author's save is made as. */
    async function author(t: TestNextly): Promise<string> {
      const created = await t.nextly.users.create({
        email: "author@example.com",
        password: "Password123!",
        data: { name: "author", isActive: true },
      });
      return created.item.id;
    }

    /**
     * A write of the site style as `userId`, as the Shared Styles panel's save
     * makes it: the Single's guards before the transaction judge it, so a
     * shared style adding a variable the site does not define is refused
     * there whenever that is already visible.
     */
    function writeSiteStyleAs(
      t: TestNextly,
      userId: string,
      data: Record<string, unknown>
    ) {
      return t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { ...data, _overwrite: true },
        overrideAccess: true,
        user: { id: userId },
      });
    }

    /** The stored shared styles, as text, read as the system. */
    async function storedClasses(t: TestNextly): Promise<string> {
      const doc = (await t.nextly.findSingle({
        slug: SITE_STYLE_SLUG,
        overrideAccess: true,
      })) as Record<string, unknown> | null;
      const raw = doc?.classes;
      return typeof raw === "string" ? raw : JSON.stringify(raw ?? null);
    }

    /**
     * Run `first` held inside its transaction until `second` (carrying
     * `marker`) has passed its validation, then let `first` commit; both
     * settled. On SQLite the second write is refused while the first holds
     * the one connection's transaction, or cannot begin its own, so the gate
     * lets go after a while instead.
     */
    async function interleaved(
      hold: { collection: string; id?: string },
      first: () => Promise<unknown>,
      marker: string,
      second: () => Promise<unknown>
    ) {
      gate.hold = hold;
      const one = first();
      await gate.held;
      // Only now: the first write's own hooks have run, so only the second
      // write's can match.
      gate.marker = marker;
      const two = second();
      await Promise.race([
        gate.validated,
        two.then(
          () => undefined,
          () => undefined
        ),
        pause(5_000),
      ]);
      // Long enough for the second write to reach the lock inside its own
      // transaction; were it later, it would only find the first committed.
      await pause(500);
      gate.release();
      return Promise.allSettled([one, two]);
    }

    /**
     * What a removal the page beat to the lock is refused with: in use, found
     * by the read under the lock. On MySQL a Single's write keeps the
     * dialect's REPEATABLE READ, so its reads answer from a snapshot taken
     * before the page committed, and the lock's compare-and-set refuses it as
     * a conflict to save again before it reads anything. Written directly, as
     * here, that refusal is the answer; the remove routes read the Single
     * again and retry it, and the retry is refused as in use.
     */
    const refusedRemoval = dialect === "mysql" ? ["CONFLICT"] : ["IN_USE"];

    it("refuses a page's first use of a variable a removal holding the lock takes out", async () => {
      const { t, pageId } = await boot();

      const [one, two] = await interleaved(
        { collection: SITE_STYLE_WRITE },
        () => writeSiteStyle(t, { tokens: { tokens: [accent] } }),
        "first-use-of-spare",
        () =>
          savePage(
            t,
            pageId,
            pageWith({ text: "first-use-of-spare", token: "t-spare" })
          )
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(
        codesOf(two.status === "rejected" ? two.reason : undefined)
      ).toEqual(["unknown-token"]);
      expect(await storedIds(t, "tokens")).toEqual(["t-accent"]);
      expect(await storedContent(t, pageId)).not.toContain("t-spare");
    });

    it("refuses removing a variable a page holding the lock starts using, and keeps it", async () => {
      const { t, pageId } = await boot();

      const [one, two] = await interleaved(
        { collection: "pages", id: pageId },
        () => savePage(t, pageId, pageWith({ token: "t-spare" })),
        "drops-spare",
        () =>
          writeSiteStyle(t, {
            tokens: { tokens: [{ ...accent, label: "drops-spare" }] },
          })
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(
        codesOf(two.status === "rejected" ? two.reason : undefined)
      ).toEqual(refusedRemoval);
      expect(await storedIds(t, "tokens")).toEqual(["t-accent", "t-spare"]);
      expect(await storedContent(t, pageId)).toContain("t-spare");
    });

    it("refuses a page's first use of a shared style a removal holding the lock takes out", async () => {
      const { t, pageId } = await boot();

      const [one, two] = await interleaved(
        { collection: SITE_STYLE_WRITE },
        () => writeSiteStyle(t, { classes: [card] }),
        "first-use-of-spare-style",
        () =>
          savePage(
            t,
            pageId,
            pageWith({ text: "first-use-of-spare-style", classes: ["c-spare"] })
          )
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(
        codesOf(two.status === "rejected" ? two.reason : undefined)
      ).toEqual(["unknown-class"]);
      expect(await storedIds(t, "classes")).toEqual(["c-card"]);
      expect(await storedContent(t, pageId)).not.toContain("c-spare");
    });

    it("refuses removing a shared style a page holding the lock starts applying, and keeps it", async () => {
      const { t, pageId } = await boot();

      const [one, two] = await interleaved(
        { collection: "pages", id: pageId },
        () => savePage(t, pageId, pageWith({ classes: ["c-spare"] })),
        "drops-spare-style",
        () =>
          writeSiteStyle(t, {
            classes: [{ ...card, label: "drops-spare-style" }],
          })
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(
        codesOf(two.status === "rejected" ? two.reason : undefined)
      ).toEqual(refusedRemoval);
      expect(await storedIds(t, "classes")).toEqual(["c-card", "c-spare"]);
      expect(await storedContent(t, pageId)).toContain("c-spare");
    });

    it("refuses removing a variable or a shared style a stored page already uses, made as nobody", async () => {
      // No race: the Single's guards before the transaction trust a write
      // made as nobody, so only the judgement under the lock refuses these.
      const { t, pageId } = await boot();
      await savePage(
        t,
        pageId,
        pageWith({ token: "t-spare", classes: ["c-spare"] })
      );

      await expect(
        writeSiteStyle(t, { tokens: { tokens: [accent] } })
      ).rejects.toMatchObject({
        publicData: { errors: [expect.objectContaining({ code: "IN_USE" })] },
      });
      await expect(
        writeSiteStyle(t, { classes: [card] })
      ).rejects.toMatchObject({
        publicData: { errors: [expect.objectContaining({ code: "IN_USE" })] },
      });
      expect(await storedIds(t, "tokens")).toEqual(["t-accent", "t-spare"]);
      expect(await storedIds(t, "classes")).toEqual(["c-card", "c-spare"]);
    });

    it("keeps a page savable that already holds references the site no longer defines", async () => {
      const { t, pageId } = await boot();
      // Planted past every check, as a page stored before the site dropped
      // what it names holds them.
      const held = { token: "t-gone", classes: ["c-gone"] };
      await plantContent(t, pageId, pageWith(held));

      const kept = await savePage(
        t,
        pageId,
        pageWith({ ...held, text: "edited" })
      );
      expect(kept.item).toBeDefined();
      expect(await storedContent(t, pageId)).toContain("edited");

      // CONTROL: the same save adding one more it does not define is refused,
      // so the save above was judged and kept what the page held.
      await expect(
        savePage(
          t,
          pageId,
          pageWith({ ...held, text: "edited", classes: ["c-gone", "c-other"] })
        )
      ).rejects.toMatchObject({
        publicData: {
          errors: [expect.objectContaining({ code: "unknown-class" })],
        },
      });
    });

    // The removal holds the Single's row lock and the graph lock; the shared
    // style's save passes its validation while `t-spare` is still stored,
    // then waits at the row lock. Once the removal commits, the save is
    // judged again inside its transaction and refused, with the code the
    // validation refuses a shared style's undefined variable with. On SQLite
    // the save's validation reads inside the removal's open transaction,
    // sees `t-spare` gone and is refused there: the outcome is the same.
    it("refuses a shared style's first use of a variable a removal holding the lock takes out", async () => {
      const { t } = await boot();
      const userId = await author(t);

      const [one, two] = await interleaved(
        { collection: SITE_STYLE_WRITE },
        () => writeSiteStyle(t, { tokens: { tokens: [accent] } }),
        "card-uses-spare",
        () =>
          writeSiteStyleAs(t, userId, {
            classes: [cardUsing("t-spare", "card-uses-spare"), spareStyle],
          })
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(
        codesOf(two.status === "rejected" ? two.reason : undefined)
      ).toEqual(["unknown-token"]);
      expect(await storedIds(t, "tokens")).toEqual(["t-accent"]);
      expect(await storedIds(t, "classes")).toEqual(["c-card", "c-spare"]);
      expect(await storedClasses(t)).not.toContain("t-spare");
    });

    // The shared style's save holds the Single's row lock, its `$token` to
    // `t-spare` stored; the removal, made as nobody, passes its validation
    // against the shared styles as committed, without it, and waits at the
    // row lock. Once the save commits, the removal stores its tokens on the
    // row as the save left it, so the document it leaves holds the shared
    // style naming `t-spare`, and it is refused whole as in use. That is
    // judged from the document in hand, before the graph lock, so on every
    // dialect alike: MySQL's snapshot never reaches the lock's
    // compare-and-set, which refuses a page write's race as a conflict.
    it("refuses removing a variable a shared style saved first starts using, and keeps it", async () => {
      const { t } = await boot();
      const userId = await author(t);

      const [one, two] = await interleaved(
        { collection: SITE_STYLE_WRITE },
        () =>
          writeSiteStyleAs(t, userId, {
            classes: [cardUsing("t-spare", "card-uses-spare"), spareStyle],
          }),
        "drops-spare-for-card",
        () =>
          writeSiteStyle(t, {
            tokens: { tokens: [{ ...accent, label: "drops-spare-for-card" }] },
          })
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(
        codesOf(two.status === "rejected" ? two.reason : undefined)
      ).toEqual(["IN_USE"]);
      expect(await storedIds(t, "tokens")).toEqual(["t-accent", "t-spare"]);
      expect(await storedClasses(t)).toContain("t-spare");
    });

    // SQLite has one connection already, so a pool of one changes nothing
    // there: these run on the pooled dialects only.
    describe.skipIf(dialect === "sqlite")("on a pool of one connection", () => {
      // The page write's transaction holds the one connection while it is
      // judged under the lock. A read of the site's definitions that asks the
      // pool for another waits out its bound and the save is refused, so the
      // save is timed: well under that bound tells success from a refusal.
      it("saves a page's first use of a variable and a shared style the site defines, without waiting for a connection", async () => {
        const { t, pageId } = await boot({ poolMax: 1 });

        const started = performance.now();
        const saved = await savePage(
          t,
          pageId,
          pageWith({ token: "t-spare", classes: ["c-spare"] })
        ).then(
          () => "saved",
          (error: unknown) => codesOf(error)
        );
        const took = performance.now() - started;

        expect(saved).toBe("saved");
        expect(took).toBeLessThan(4_000);
        const content = await storedContent(t, pageId);
        expect(content).toContain("t-spare");
        expect(content).toContain("c-spare");
      });

      // Likewise for the removal's read of the stored documents, whose bound
      // is longer: the case's own timeout is past it, so a removal refused
      // when the bound runs out fails on its code rather than on the clock.
      it("removes a variable and a shared style nothing uses, without waiting for a connection", async () => {
        const { t } = await boot({ poolMax: 1 });

        const removed = await writeSiteStyle(t, {
          tokens: { tokens: [accent] },
          classes: [card],
        }).then(
          () => "removed",
          (error: unknown) => codesOf(error)
        );

        expect(removed).toBe("removed");
        expect(await storedIds(t, "tokens")).toEqual(["t-accent"]);
        expect(await storedIds(t, "classes")).toEqual(["c-card"]);
      }, 60_000);
    });
  }
);
