/**
 * Publishing or unpublishing every language of an entry at once runs the
 * collection's hooks as a status change of one language does.
 *
 * `POST .../publish-all` and `.../unpublish-all` move every language's status
 * in one write. A plugin guard on `beforeUpdate` or `beforeChange` (a Layout
 * that pages still use, the site's default Layout) refuses a status change of
 * one language, so it must be able to refuse the same change made to every
 * language at once: otherwise the route that moves more is the one the guard
 * cannot see.
 *
 * The baseline is measured, not restated: each case first sends the status
 * change of one language through `PATCH`, records the hooks it ran, and then
 * holds the every-language route to the same list, the same refusal and the
 * same statuses afterwards. The plausible broken implementations run no
 * `before*` hook (the write goes through a guard that refused the `PATCH`),
 * run them but write anyway, or run `afterUpdate` a second time for a
 * language whose pending change the publish already reported.
 *
 * Asserted through the real REST route handlers on each configured dialect.
 *
 * @module domains/collections/__tests__/every-language-lifecycle-runs-hooks.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { NextlyError } from "../../../errors/nextly-error";
import { StoredHookExecutor } from "../../../hooks/stored-hook-executor";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { ApiKeyService } from "../../auth/services/api-key-service";

type Doc = Record<string, unknown>;

/** Localized, with a per-language status. */
const PAGES = "lh_pages";
/** One language only, with a status. */
const NOTES = "lh_notes";
/** Localized and keeping pending changes, so a publish promotes one. */
const DRAFTS = "lh_drafts";
const SLUGS: readonly string[] = [PAGES, NOTES, DRAFTS];
const ADMIN_ID = "user-lh-admin";
const REFUSAL = "This Layout is in use and cannot change its status now.";

/** One hook as it ran: which, and what it was handed. */
interface Call {
  hook: string;
  collection: string;
  operation: unknown;
  status: unknown;
  originalStatus: unknown;
  /** What `plugin:beforeUpdate` left in the shared context, as this hook saw it. */
  mark: unknown;
}

const calls: Call[] = [];
/** The one hook that refuses the write, by the name it is recorded under. */
let refuseAt: string | null = null;
/** A status `plugin:beforeChange` writes into the data it is handed, if any. */
let statusSetByHook: string | null = null;

/** Whether `value` is a document carrying `key`. */
function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Doc)[key]
    : undefined;
}

/** Record one hook, and refuse the write where this is the hook told to. */
function observe(hook: string, context: unknown): void {
  const collection = String(fieldOf(context, "collection"));
  if (!SLUGS.includes(collection)) return;
  calls.push({
    hook,
    collection,
    operation: fieldOf(context, "operation"),
    status: fieldOf(fieldOf(context, "data"), "status"),
    originalStatus: fieldOf(fieldOf(context, "originalData"), "status"),
    mark: fieldOf(fieldOf(context, "context"), "mark"),
  });
  if (refuseAt === hook) {
    throw NextlyError.conflict({ reason: "state", message: REFUSAL });
  }
}

/** A plugin guarding every lifecycle write, as the page builder's guards do. */
const guard = definePlugin({
  name: "@test/lifecycle-guard",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init: ctx => {
    for (const slug of SLUGS) {
      ctx.hooks.on("beforeUpdate", slug, context => {
        // Left for the hooks after it, as a guard leaves what it decided.
        context.context.mark = "set-before";
        observe("plugin:beforeUpdate", context);
      });
      ctx.hooks.on("beforeChange", slug, context => {
        observe("plugin:beforeChange", context);
        if (statusSetByHook !== null && context.data) {
          (context.data as Doc).status = statusSetByHook;
        }
      });
      ctx.hooks.on("afterUpdate", slug, context => {
        observe("plugin:afterUpdate", context);
      });
    }
  },
});

/** A collection carrying a hook in every phase the config declares. */
function collection(
  slug: string,
  shape: { localized: boolean; drafts?: boolean }
): ReturnType<typeof defineCollection> {
  return defineCollection({
    slug,
    status: true,
    localized: shape.localized,
    ...(shape.drafts ? { versions: { drafts: true } } : {}),
    hooks: {
      beforeOperation: [
        context => {
          observe("config:beforeOperation", {
            collection: context.collection,
            operation: context.operation,
            data: context.args.data,
            context: context.context,
          });
        },
      ],
      beforeChange: [
        context => {
          observe("config:beforeChange", context);
        },
      ],
      // Config `afterChange` maps to the runtime `afterUpdate` phase.
      afterChange: [
        context => {
          observe("config:afterChange", context);
        },
      ],
    },
    fields: [
      text({
        name: "title",
        localized: shape.localized,
        hooks: {
          afterChange: [
            ({ value }: { value: unknown }) => {
              calls.push({
                hook: "field:afterChange",
                collection: slug,
                operation: "update",
                status: undefined,
                originalStatus: undefined,
                mark: undefined,
              });
              return value;
            },
          ],
        },
      }),
    ],
  });
}

const DIRECTIONS = [
  { route: "unpublish-all", from: "published", to: "draft" },
  { route: "publish-all", from: "draft", to: "published" },
] as const;

/** Each hook that can refuse a status change, by where it was declared. */
const REFUSERS = [
  "plugin:beforeUpdate",
  "plugin:beforeChange",
  "config:beforeChange",
  "stored:beforeUpdate",
  "stored:beforeChange",
] as const;

describe.each(getConfiguredTestDialects())(
  "publishing or unpublishing every language runs the hooks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let key = "";

    beforeAll(async () => {
      // The stored (admin-configured) hooks, observed where the core asks
      // for them: what each phase is asked, and a refusal from one.
      const execute = StoredHookExecutor.prototype.execute;
      vi.spyOn(StoredHookExecutor.prototype, "execute").mockImplementation(
        function (this: StoredHookExecutor, ...args) {
          const [phase, , context] = args;
          observe(`stored:${phase}`, {
            collection: context.collection,
            operation: context.operation,
            data: context.data,
            context: context.context,
          });
          return execute.apply(this, args);
        }
      );
      t = await createTestNextly({
        dialect,
        collections: [
          collection(PAGES, { localized: true }),
          collection(NOTES, { localized: false }),
          collection(DRAFTS, { localized: true, drafts: true }),
        ],
        plugins: [guard],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      // A PostgreSQL or MySQL leg that silently booted SQLite would prove
      // nothing about those databases.
      expect(t.adapter.dialect).toBe(dialect);
      const admin = await superAdminUser(t, ADMIN_ID);
      const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
      ({ key } = await keys.createApiKey(admin, {
        name: "lifecycle-hooks",
        tokenType: "full-access",
        expiresIn: "unlimited",
      }));
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      await t?.destroy();
    });

    beforeEach(() => {
      calls.length = 0;
      refuseAt = null;
      statusSetByHook = null;
    });

    const handler = (): CollectionsHandler =>
      t.getService("collectionsHandler") as CollectionsHandler;

    async function rest(
      method: "POST" | "PATCH",
      path: string[],
      body: Doc
    ): Promise<{ status: number; json: Doc }> {
      const handlers = createDynamicHandlers();
      const res = await handlers[method](
        new Request(`http://localhost/api/${path.join("/")}`, {
          method,
          headers: {
            origin: "http://localhost",
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      return { status: res.status, json: (await res.json()) as Doc };
    }

    const languagesOf = (slug: string): (string | undefined)[] =>
      slug === NOTES ? [undefined] : ["en", "es"];

    /** An entry at `status` in every language it has, with no hook armed. */
    async function seed(slug: string, status: string): Promise<string> {
      // Seeded with no hook refusing, whatever the case has armed.
      const armed = refuseAt;
      refuseAt = null;
      const created = await handler().createEntry(
        {
          collectionName: slug,
          overrideAccess: true,
          ...(slug === NOTES ? {} : { locale: "en" }),
        },
        { title: "Home", status }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = String((created.data as Doc).id);
      if (slug !== NOTES) {
        const es = await handler().updateEntry(
          {
            collectionName: slug,
            entryId: id,
            overrideAccess: true,
            locale: "es",
          },
          { title: "Inicio", status, _overwrite: true }
        );
        expect(es.success, JSON.stringify(es)).toBe(true);
      }
      calls.length = 0;
      refuseAt = armed;
      return id;
    }

    /** Each language's status, as a trusted read of it returns it. */
    async function statuses(slug: string, id: string): Promise<unknown[]> {
      const out: unknown[] = [];
      for (const locale of languagesOf(slug)) {
        const read = await handler().getEntry({
          collectionName: slug,
          entryId: id,
          overrideAccess: true,
          ...(locale ? { locale } : {}),
        });
        out.push(fieldOf(read.data, "status"));
      }
      return out;
    }

    /** The hooks a status change of one language runs: measured through `PATCH`. */
    async function oneLanguageChange(
      slug: string,
      from: string,
      to: string
    ): Promise<{ status: number; json: Doc; hooks: string[] }> {
      const id = await seed(slug, from);
      const answer = await rest("PATCH", ["collections", slug, "entries", id], {
        status: to,
      });
      const hooks = calls.map(call => call.hook);
      calls.length = 0;
      return { ...answer, hooks };
    }

    for (const slug of [PAGES, NOTES]) {
      for (const direction of DIRECTIONS) {
        it(`${direction.route} of ${slug} runs the hooks a status change of one language runs`, async () => {
          const baseline = await oneLanguageChange(
            slug,
            direction.from,
            direction.to
          );
          expect(baseline.status, JSON.stringify(baseline.json)).toBe(200);
          // The positive control: the baseline reached every kind of hook,
          // so an empty list below cannot pass by nothing being registered.
          expect(baseline.hooks).toEqual(
            expect.arrayContaining([
              "config:beforeOperation",
              "plugin:beforeUpdate",
              "stored:beforeUpdate",
              "config:beforeChange",
              "plugin:beforeChange",
              "stored:beforeChange",
              "plugin:afterUpdate",
              "config:afterChange",
              "stored:afterUpdate",
            ])
          );
          // A translated collection's update runs a field's `afterChange`
          // only for the fields it wrote, so only the one-language
          // collection's status change reaches the title's.
          if (slug === NOTES) {
            expect(baseline.hooks).toContain("field:afterChange");
          }

          const id = await seed(slug, direction.from);
          const moved = await rest(
            "POST",
            ["collections", slug, "entries", id, direction.route],
            {}
          );
          expect(moved.status, JSON.stringify(moved.json)).toBe(200);
          expect(calls.map(call => call.hook)).toEqual(baseline.hooks);
          for (const call of calls) {
            if (call.hook === "field:afterChange") continue;
            expect(call.operation, call.hook).toBe("update");
            expect(call.status, call.hook).toBe(direction.to);
          }
          // The stored row the change starts from, as the guard reads it.
          for (const hook of ["plugin:beforeUpdate", "plugin:beforeChange"]) {
            expect(
              calls.find(call => call.hook === hook)?.originalStatus,
              hook
            ).toBe(direction.from);
          }
          // One context for the whole write, before and after.
          expect(
            calls.find(call => call.hook === "plugin:afterUpdate")?.mark
          ).toBe("set-before");
          expect(await statuses(slug, id)).toEqual(
            languagesOf(slug).map(() => direction.to)
          );
        });

        for (const refuser of REFUSERS) {
          it(`a refusal by ${refuser} stops ${direction.route} of ${slug}, and every language keeps its status`, async () => {
            refuseAt = refuser;
            const baseline = await oneLanguageChange(
              slug,
              direction.from,
              direction.to
            );
            // The guard refuses a status change of one language: that is the
            // answer the every-language route owes too.
            expect(baseline.status, JSON.stringify(baseline.json)).toBe(409);
            expect(fieldOf(baseline.json.error, "message")).toBe(REFUSAL);

            const id = await seed(slug, direction.from);
            const refused = await rest(
              "POST",
              ["collections", slug, "entries", id, direction.route],
              {}
            );
            expect(refused.status, JSON.stringify(refused.json)).toBe(
              baseline.status
            );
            expect(fieldOf(refused.json.error, "code")).toBe(
              fieldOf(baseline.json.error, "code")
            );
            expect(fieldOf(refused.json.error, "message")).toBe(REFUSAL);
            expect(calls.map(call => call.hook)).toContain(refuser);
            // Refused before anything was written, so nothing reports a write.
            expect(
              calls.filter(call => call.hook.includes("after")).map(c => c.hook)
            ).toEqual([]);
            expect(await statuses(slug, id)).toEqual(
              languagesOf(slug).map(() => direction.from)
            );
          });
        }
      }
    }

    for (const direction of DIRECTIONS) {
      it(`a hook that names another status refuses ${direction.route}, and nothing changes`, async () => {
        const id = await seed(PAGES, direction.from);
        // The move writes each language's status and nothing else, so a hook
        // that decides on another status cannot be honoured and is not
        // silently overruled either.
        statusSetByHook = direction.from;
        const refused = await rest(
          "POST",
          ["collections", PAGES, "entries", id, direction.route],
          {}
        );
        expect(refused.status, JSON.stringify(refused.json)).toBe(409);
        expect(fieldOf(refused.json.error, "code")).toBe("CONFLICT");
        expect(
          calls.filter(call => call.hook.includes("after")).map(c => c.hook)
        ).toEqual([]);
        expect(await statuses(PAGES, id)).toEqual(
          ["en", "es"].map(() => direction.from)
        );
      });
    }

    it("a publish that puts a pending change live runs each before hook once and reports that language once", async () => {
      const id = await seed(DRAFTS, "published");
      const held = await handler().updateEntry(
        {
          collectionName: DRAFTS,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { title: "Home again", _overwrite: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);
      calls.length = 0;

      const published = await rest(
        "POST",
        ["collections", DRAFTS, "entries", id, "publish-all"],
        {}
      );
      expect(published.status, JSON.stringify(published.json)).toBe(200);
      const count = (hook: string) =>
        calls.filter(call => call.hook === hook).length;
      expect(count("plugin:beforeUpdate")).toBe(1);
      expect(count("plugin:beforeChange")).toBe(1);
      // English's change went live and is reported as its publish alone
      // reports it; the write adds no second report on top of it.
      expect(count("plugin:afterUpdate")).toBe(1);
      expect(count("config:afterChange")).toBe(1);
      expect(
        calls.find(call => call.hook === "plugin:afterUpdate")?.status
      ).toBe("published");
    });
  }
);
