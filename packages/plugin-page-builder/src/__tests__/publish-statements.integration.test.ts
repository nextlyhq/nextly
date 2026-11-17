/**
 * What publishing one text change of a page costs the database: the
 * statements one publish sends, held to a pin on each dialect, with the
 * components the page places read once per kind rather than once per
 * component.
 *
 * Each fixture is a page placing published components around a heading; the
 * publish changes the heading's text, through the Direct API and through the
 * REST route the admin saves by. Each statement is logged at the driver
 * (`statement-log`), from the moment the publish is sent until the database
 * has been quiet a while, so the work a write leaves running after it answers
 * is counted with it.
 *
 * The jobs pass is not the publish's: the bindings report's sweep, which a
 * write starts at most once a second, is held while a publish is counted and
 * run once the count is taken, so the count is the same on every run. The
 * REST route is counted on its second publish, the first paying for what the
 * setup left behind.
 *
 * The pins are the counts measured on each dialect, set in the change that
 * earned them: a change that lowers one lowers the pin with it, and one that
 * raises one says why, or reads less.
 *
 * @module __tests__/publish-statements.integration.test
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pageBuilder } from "../plugin";

import { startupSettled } from "./entry-page-claims-harness";
import { naming, openStatementLog } from "./statement-log";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

/** A page's components: how many distinct ones, each placed how often. */
interface Fixture {
  readonly distinct: number;
  readonly uses: (at: number) => number;
}

const TWO = "two components placed 20 and 10 times";
const TEN = "ten components placed 3 times each";

const FIXTURES: Readonly<Record<string, Fixture>> = {
  [TWO]: { distinct: 2, uses: at => (at === 0 ? 20 : 10) },
  [TEN]: { distinct: 10, uses: () => 3 },
};

/** How a publish is sent. */
type Route = "direct" | "rest";

/**
 * The statements one publish sends, by dialect and route, other than the
 * reads made at most once per interval ({@link TIMED_READS}): the counts
 * measured once the components a page places are read in one query per
 * form. The same for both fixtures, as nothing a publish reads grows with
 * the components the page places.
 */
const PINS: Readonly<Record<TestDialect, Readonly<Record<Route, number>>>> = {
  sqlite: { direct: 66, rest: 67 },
  postgresql: { direct: 69, rest: 71 },
  mysql: { direct: 69, rest: 70 },
};

/**
 * The reads the server makes at most once per interval rather than once per
 * request, by the table each reads: the stored languages (each second), the
 * stored schema version (each two) and the session's standing (each five).
 * Whether a publish pays one depends on how long ago the last was paid, so
 * they are held to a bound of their own rather than to the pin.
 */
const TIMED_READS = ["nextly_languages", "nextly_meta", "nextly_rbac_epoch"];

/**
 * Reads of the components the page places: one query per form, in the check
 * before the write and again in the one inside it, whatever their number.
 */
const COMPONENT_READS = 6;

/**
 * Reads of the version history: the components' working drafts in one query
 * per check, the page's own, and what recording the published version reads.
 */
const VERSION_READS = 12;

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

const placing = (id: string, componentId: string) => ({
  id,
  type: "nextly/component-instance",
  version: 1,
  props: { componentId },
});

const idOf = (created: unknown): string =>
  String((created as { item: { id: string | number } }).item.id);

function pageDocument(text: string, placed: readonly string[][]) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      heading("title", text),
      ...placed.flatMap((ids, at) =>
        ids.map((id, use) => placing(`c${String(at)}-${String(use)}`, id))
      ),
    ],
  };
}

/** The jobs service as the plugin's own context hands it over. */
type JobsService = { runSweepNow(...args: unknown[]): Promise<unknown> };

/**
 * The page builder, with each sweep it starts held until `release`: a sweep
 * is the jobs pass's work, started by a write at most once a second, so a
 * count it may or may not land in is a count no two runs agree on.
 */
function withSweepsHeld(): {
  plugin: ReturnType<typeof pageBuilder>;
  release: () => Promise<void>;
} {
  const plugin = pageBuilder();
  const held: (() => Promise<unknown>)[] = [];
  const init = plugin.init;
  if (init === undefined) throw new Error("the page builder has no init");
  plugin.init = ctx => {
    const services = ctx.services as unknown as { jobs: JobsService };
    const own = Object.getOwnPropertyDescriptor(services, "jobs");
    Object.defineProperty(services, "jobs", {
      configurable: true,
      get: () => {
        const jobs = (own?.get?.call(services) ?? own?.value) as JobsService;
        return {
          ...jobs,
          runSweepNow: (...args: unknown[]) => {
            held.push(() => jobs.runSweepNow(...args));
            return Promise.resolve({ claimed: 0 });
          },
        };
      },
    });
    return init(ctx);
  };
  return {
    plugin,
    release: async () => {
      while (held.length > 0) await held.shift()?.();
    },
  };
}

describe.each(getConfiguredTestDialects())(
  "publishing one text change of a page (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      vi.unstubAllEnvs();
      await current?.destroy();
      current = undefined;
    });

    async function component(t: TestNextly, slug: string): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: "components",
          data: {
            title: slug,
            slug,
            content: {
              formatVersion: 1,
              kind: "component",
              nodes: [heading(`${slug}-h`, slug)],
            },
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    /** The owner's session cookie, as a signed-in browser sends it. */
    async function ownerCookie(t: TestNextly): Promise<string> {
      const owner = await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const token = await signAccessToken(
        buildClaims({
          userId: owner.item.id,
          email: "owner@example.com",
          name: "Owner",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}; nextly_csrf=${CSRF}`;
    }

    async function send(
      cookie: string,
      method: "GET" | "PATCH",
      params: string[],
      body?: unknown
    ): Promise<{ status: number; json: Record<string, unknown> }> {
      const handlers = createDynamicHandlers();
      const response = await handlers[method](
        new Request(`${ORIGIN}/api/${params.join("/")}`, {
          method,
          headers: {
            cookie,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ params }) }
      );
      const text = await response.text();
      return {
        status: response.status,
        json: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
      };
    }

    it.each(Object.entries(FIXTURES))(
      "stays within its pins for %s",
      async (_name, fixture) => {
        const sweeps = withSweepsHeld();
        const t = (current = await createTestNextly({
          ...(dialect === "sqlite" ? {} : { dialect }),
          plugins: [sweeps.plugin],
          seedPublic: true,
        }));
        await startupSettled(t);
        const placed: string[][] = [];
        for (let at = 0; at < fixture.distinct; at += 1) {
          const id = await component(t, `part-${String(at)}`);
          placed.push(Array.from({ length: fixture.uses(at) }, () => id));
        }
        const pageId = idOf(
          await t.nextly.create({
            collection: "pages",
            data: {
              title: "Long page",
              slug: "long-page",
              content: pageDocument("Before", placed),
              status: "published",
            },
            overrideAccess: true,
          })
        );
        const cookie = await ownerCookie(t);
        const entry = ["collections", "pages", "entries", pageId];

        /** One publish of `text` by `route`, and the statements it sent. */
        const publish = async (route: Route, text: string) => {
          await t.events.settle();
          await sweeps.release();
          const read =
            route === "rest" ? (await send(cookie, "GET", entry)).json : {};
          const log = await openStatementLog(t.adapter, dialect);
          let status = 0;
          let from = 0;
          try {
            await log.quiet();
            from = log.statements.length;
            if (route === "direct") {
              await t.nextly.update({
                collection: "pages",
                id: pageId,
                data: {
                  content: pageDocument(text, placed),
                  status: "published",
                  _overwrite: true,
                },
                overrideAccess: true,
              });
              status = 200;
            } else {
              status = (
                await send(cookie, "PATCH", entry, {
                  title: read.title,
                  slug: read.slug,
                  content: pageDocument(text, placed),
                  status: "published",
                  _rev: read._rev,
                })
              ).status;
            }
            await t.events.settle();
            await log.quiet();
          } finally {
            log.close();
          }
          return { status, statements: log.statements.slice(from) };
        };

        const direct = await publish("direct", "After the Direct API");
        await publish("rest", "After a first save over REST");
        const rest = await publish("rest", "After a second save over REST");

        for (const [route, sent] of [
          ["direct", direct],
          ["rest", rest],
        ] as const) {
          expect(sent.status, route).toBe(200);
          const timed = TIMED_READS.flatMap(table =>
            naming(sent.statements, table)
          );
          expect(sent.statements.length - timed.length, route).toBe(
            PINS[dialect][route]
          );
          expect(timed.length, route).toBeLessThanOrEqual(TIMED_READS.length);
          expect(naming(sent.statements, "dc_components").length, route).toBe(
            COMPONENT_READS
          );
          expect(naming(sent.statements, "nextly_versions").length, route).toBe(
            VERSION_READS
          );
        }
        const stored = await t.nextly.findByID({
          collection: "pages",
          id: pageId,
          overrideAccess: true,
        });
        expect(JSON.stringify(stored)).toContain("After a second save");
      },
      120_000
    );
  }
);
