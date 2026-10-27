/**
 * A public plugin route writing for an anonymous visitor needs a rule that
 * allows the write.
 *
 * `public: true` waives the route's own authentication, and `{ as: "public" }`
 * keeps the collection's rules in force for a caller with no session. With no
 * rule naming a create, an update or a delete, that write is refused and the
 * table is left as it was; where the collection's author wrote a rule that
 * answers `true`, as a public form's submissions do with `create`, the write
 * goes through. A visitor's read keeps the public default, and the admin's
 * REST route still asks an anonymous caller to sign in before anything else.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { NextlyError } from "../../errors/nextly-error";
import { createDynamicHandlers } from "../../routeHandler";
import { definePlugin } from "../plugin-context";
import type { PluginRouteContext } from "../routes/route-types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

const ORIGIN = "http://localhost";

/** Declares no access at all, so every write has no rule naming it. */
const OPEN = "anon_writes_ruleless";
/**
 * Lets anyone create, as a public form's submissions do, and names no
 * update or delete, so the rule opens only the write it names.
 */
const FORM = "anon_writes_form";

type Write = "create" | "update" | "delete";

/** What the probe route reports: the call's result, or the refusal's status. */
type Reply = { ok: true } | { ok: false; status: number };

/** The anonymous service call each write is, on `slug` and entry `id`. */
async function anonymousWrite(
  ctx: PluginRouteContext,
  write: Write,
  slug: string,
  id: string
): Promise<void> {
  const asPublic = { as: "public" } as const;
  const collections = ctx.services.collections;
  if (write === "create") {
    await collections.createEntry(slug, { title: "from a visitor" }, asPublic);
  } else if (write === "update") {
    await collections.updateEntry(slug, id, { title: "changed" }, asPublic);
  } else {
    await collections.deleteEntry(slug, id, asPublic);
  }
}

/** The plugin's collection service, as its `init` receives it. */
let services: PluginRouteContext["services"]["collections"] | undefined;

const probe = definePlugin({
  name: "anon-writes",
  version: "1.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    services = ctx.services.collections;
  },
  contributes: {
    routes: [
      {
        method: "POST",
        path: "/:slug/:write",
        public: true,
        handler: async (req: Request, ctx: PluginRouteContext) => {
          const id = new URL(req.url).searchParams.get("id") ?? "";
          try {
            await anonymousWrite(
              ctx,
              ctx.params.write as Write,
              ctx.params.slug,
              id
            );
            return Response.json({ ok: true } satisfies Reply);
          } catch (error) {
            // A refusal is reported by its status, so the test can tell a
            // refused write from one that failed for another reason.
            if (!NextlyError.is(error)) throw error;
            return Response.json({
              ok: false,
              status: error.statusCode,
            } satisfies Reply);
          }
        },
      },
    ],
  },
});

function post(segments: string[], search = "", body?: unknown) {
  const handlers = createDynamicHandlers();
  const req = new Request(`${ORIGIN}/api/${segments.join("/")}${search}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return handlers.POST(req, {
    params: Promise.resolve({ params: segments }),
  });
}

describe.each(getConfiguredTestDialects())(
  "a public plugin route writing as an anonymous visitor (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [probe],
        collections: [
          defineCollection({ slug: OPEN, fields: [text({ name: "title" })] }),
          defineCollection({
            slug: FORM,
            fields: [text({ name: "title" })],
            access: { create: () => true },
          }),
        ],
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** The probe route asked to make `write` on `slug`, and its reply. */
    async function ask(slug: string, write: Write, id = ""): Promise<Reply> {
      const search = id ? `?id=${encodeURIComponent(id)}` : "";
      const res = await post(["plugins", "anon-writes", slug, write], search);
      // The route itself is public: it answers, and the write's refusal is
      // in its reply rather than in the route's status.
      expect(res.status).toBe(200);
      return (await res.json()) as Reply;
    }

    /** Every title stored in `slug`, read as trusted server code. */
    async function titles(slug: string): Promise<string[]> {
      const found = await t.nextly.find({ collection: slug, limit: 100 });
      return found.items.map(item => String(item.title));
    }

    /** One entry written as trusted server code, for an update or delete. */
    async function seeded(slug: string, title: string): Promise<string> {
      const made = await t.nextly.create({ collection: slug, data: { title } });
      return String(made.item.id);
    }

    it("refuses a create on a collection with no rule naming it, and writes nothing", async () => {
      const before = await titles(OPEN);
      expect(await ask(OPEN, "create")).toEqual({ ok: false, status: 403 });
      expect(await titles(OPEN)).toEqual(before);
    });

    it("refuses an update and a delete with no rule naming them, and leaves the entry", async () => {
      const id = await seeded(OPEN, "kept");
      expect(await ask(OPEN, "update", id)).toEqual({ ok: false, status: 403 });
      expect(await ask(OPEN, "delete", id)).toEqual({ ok: false, status: 403 });
      expect(await titles(OPEN)).toContain("kept");
    });

    it("allows a create where the collection's rule answers true, and the entry is stored", async () => {
      // The control for the refusals above: the same route and the same
      // anonymous caller, so only the rule differs.
      expect(await ask(FORM, "create")).toEqual({ ok: true });
      expect(await titles(FORM)).toContain("from a visitor");
    });

    it("refuses the writes that collection's rule does not name", async () => {
      const id = await seeded(FORM, "submitted");
      expect(await ask(FORM, "update", id)).toEqual({ ok: false, status: 403 });
      expect(await ask(FORM, "delete", id)).toEqual({ ok: false, status: 403 });
      expect(await titles(FORM)).toContain("submitted");
    });

    it("keeps a visitor's read on the public default", async () => {
      const id = await seeded(OPEN, "readable");
      const found = await t.nextly.findByID({
        collection: OPEN,
        id,
        overrideAccess: false,
      });
      expect(found?.title).toBe("readable");
    });

    it("lets the plugin acting as itself write a rule-less collection through every write method", async () => {
      // Trusted work names no user, which is how an anonymous caller looks
      // too: each write must be judged trusted, not anonymous, or this
      // change would refuse a plugin's own writes.
      const c = services!;
      const sys = { as: "system" } as const;
      const made = await c.createEntry(OPEN, { title: "sys-made" }, sys);
      const id = String(made.item.id);
      await c.updateEntry(OPEN, id, { title: "sys-changed" }, sys);
      const many = await c.createMany(OPEN, [{ title: "sys-many" }], sys);
      expect(many.successful).toBe(1);
      const updated = await c.updateMany(
        OPEN,
        [{ id: String(many.ids[0]), data: { title: "sys-many-2" } }],
        sys
      );
      expect(updated.successful).toBe(1);
      await c.withTransaction(async tx => {
        const row = await c.createEntryInTransaction(
          tx,
          OPEN,
          { title: "sys-tx" },
          sys
        );
        await c.updateEntryInTransaction(
          tx,
          OPEN,
          String(row.id),
          { title: "sys-tx-2" },
          sys
        );
        await c.deleteEntryInTransaction(tx, OPEN, String(row.id), sys);
      });
      await c.deleteEntry(OPEN, id, sys);
      const stored = await titles(OPEN);
      expect(stored).toContain("sys-many-2");
      expect(stored).not.toContain("sys-changed");
      expect(stored).not.toContain("sys-tx-2");
    });

    it("refuses the plugin's anonymous writes inside a transaction where no rule names them", async () => {
      const c = services!;
      const asPublic = { as: "public" } as const;
      const id = await seeded(OPEN, "kept in a transaction");
      const refusal = async (work: () => Promise<unknown>) => {
        try {
          await work();
        } catch (error) {
          return NextlyError.is(error) ? error.statusCode : error;
        }
        return "allowed";
      };
      expect(
        await refusal(() =>
          c.withTransaction(tx =>
            c.createEntryInTransaction(tx, OPEN, { title: "tx" }, asPublic)
          )
        )
      ).toBe(403);
      expect(
        await refusal(() =>
          c.withTransaction(tx =>
            c.deleteEntryInTransaction(tx, OPEN, id, asPublic)
          )
        )
      ).toBe(403);
      expect(await titles(OPEN)).toContain("kept in a transaction");
    });

    it("asks an anonymous caller at the admin's REST route to sign in first", async () => {
      const before = await titles(OPEN);
      const res = await post(["collections", OPEN, "entries"], "", {
        title: "through rest",
      });
      expect(res.status).toBe(401);
      expect(await titles(OPEN)).toEqual(before);
    });
  }
);
