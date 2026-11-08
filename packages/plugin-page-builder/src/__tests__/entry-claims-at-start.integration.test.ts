/**
 * A site upgrading to entries' address claims: its entries and their
 * published template are stored, and the address store holds nothing for
 * them yet. The start-up pass (`settleEntryClaimsAtStart`, run once the pages'
 * pass has claimed every page) claims each published entry's address; an
 * entry whose address a page holds is left unserved, waiting on the page's
 * claim, and reported as waiting; and starting again writes nothing.
 *
 * The install is made by a first boot of the site as it is now: the entries
 * saved before their template was published, a page published at one of
 * their addresses, the template published, and then every row of the
 * address store deleted, which is what a site from before the store holds.
 * The site then starts again on the same database, as a deploy of the
 * upgrade does, and once more after that.
 *
 * The database is one of the test's own on PostgreSQL and MySQL (created
 * beside the integration database and dropped after), and a scratch file on
 * SQLite, since every boot of the harness otherwise gets a new one.
 *
 * @module __tests__/entry-claims-at-start.integration.test
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createAdapter } from "nextly/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADDRESS_WAITING_ROUTE_PATH } from "../address-claims/waiting-report-route";
import { ADDRESS_CLAIMS_SLUG } from "../collections/address-claims";

import {
  blogPageBuilder,
  claimRows,
  held,
  idOf,
  pageContent,
  POSTS,
  postsCollection,
  publishPostsTemplate,
  savePage,
  savePost,
  startupSettled,
} from "./entry-page-claims-harness";
import { call, grant, person, sessionOf } from "./transfer-harness";

type Adapter = Awaited<ReturnType<typeof createAdapter>>;

/** A database every boot of a case starts on, and how to remove it. */
interface SiteDatabase {
  readonly dialect: TestDialect;
  readonly url: string;
  drop(): Promise<void>;
}

/** A name this test generated, the only kind it builds DDL from. */
function scratchName(): string {
  const name = `pb_entry_start_${randomBytes(6).toString("hex")}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(name);
  return name;
}

/**
 * A database of the case's own: created beside the integration database on
 * PostgreSQL and MySQL, a file in a scratch folder on SQLite.
 */
async function siteDatabase(dialect: TestDialect): Promise<SiteDatabase> {
  if (dialect === "sqlite") {
    const folder = mkdtempSync(join(tmpdir(), "pb-entry-start-"));
    return {
      dialect,
      url: `file:${join(folder, "site.sqlite")}`,
      drop: async () => rmSync(folder, { recursive: true, force: true }),
    };
  }
  const serverUrl =
    dialect === "postgresql"
      ? process.env.TEST_POSTGRES_URL
      : process.env.TEST_MYSQL_URL;
  if (serverUrl === undefined) throw new Error(`no URL for ${dialect}`);
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  const name = scratchName();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  // Until it is handed back, nothing else can drop the database or close the
  // server connection: a setup that fails part way does both itself, the
  // drop only once the database exists, and then rethrows its own failure.
  let created = false;
  try {
    await server.executeQuery(`CREATE DATABASE ${name}`);
    created = true;
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    return {
      dialect,
      url: url.toString(),
      drop: async () => {
        try {
          await server.executeQuery(`DROP DATABASE IF EXISTS ${name}`);
        } finally {
          await server.disconnect();
        }
      },
    };
  } catch (error) {
    if (created) {
      await server
        .executeQuery(`DROP DATABASE IF EXISTS ${name}`)
        .catch(() => {});
    }
    await server.disconnect().catch(() => {});
    throw error;
  }
}

/**
 * An adapter on `database`, for one boot. Core reads its environment when an
 * adapter is made and when a site boots, so it names this database for the
 * whole case, and the boot is given no secret: the harness then makes one,
 * and reads the environment afresh at the boot and again once it is
 * destroyed, so no boot reads what an earlier one, on another dialect, left.
 */
async function adapterOn(database: SiteDatabase): Promise<Adapter> {
  vi.stubEnv("DATABASE_URL", database.url);
  vi.stubEnv("DB_DIALECT", database.dialect);
  vi.stubEnv("NEXTLY_SECRET", undefined);
  return createAdapter({ type: database.dialect, url: database.url });
}

/** Each stored claim and wait, with its row id: a rewrite changes the id. */
async function storedClaims(t: TestNextly): Promise<string[]> {
  return (await claimRows(t))
    .filter(row => row.kind !== "lock")
    .map(
      row =>
        `${String(row.id)} ${String(row.kind)} ${String(row.claimKey)} ${String(row.path)} ${String(row.holderCollection)}:${String(row.holderId)} ${String(row.blockedBy)}`
    )
    .sort();
}

describe.each(getConfiguredTestDialects())(
  "entries' address claims at start (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let database: SiteDatabase | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      await database?.drop();
      database = undefined;
      vi.unstubAllEnvs();
    });

    /** The site on `on`, its start-up passes over. */
    async function boot(on: SiteDatabase): Promise<TestNextly> {
      await current?.destroy();
      current = await createTestNextly({
        adapter: await adapterOn(on),
        plugins: [blogPageBuilder()],
        collections: [postsCollection()],
        seedPublic: true,
      });
      await startupSettled(current);
      return current;
    }

    it("claims every entry's address once the site starts, leaves the one a page holds waiting and reports it, and changes nothing when it starts again", async () => {
      database = await siteDatabase(dialect);

      // The install. Saved before their template is published, the entries
      // are served nowhere, and hold nothing.
      const before = await boot(database);
      const hello = idOf(await savePost(before, "hello"));
      const taken = idOf(await savePost(before, "taken"));
      const world = idOf(await savePost(before, "world"));
      const page = idOf(await savePage(before, "Taken", "blog/taken"));
      await publishPostsTemplate(before);
      for (const row of await claimRows(before)) {
        await before.nextly.delete({
          collection: ADDRESS_CLAIMS_SLUG,
          id: String(row.id),
          overrideAccess: true,
        });
      }
      expect(await claimRows(before)).toEqual([]);

      // The upgrade starts: pages first, then the entries.
      const t = await boot(database);
      expect(await held(t)).toEqual([
        `address /blog/hello ${POSTS}:${hello}`,
        `address /blog/taken pages:${page}`,
        `address /blog/world ${POSTS}:${world}`,
        `waiting /blog/taken ${POSTS}:${taken}`,
      ]);
      const content = pageContent(t);
      expect(await content.resolveAddress(undefined, "/blog/hello")).toEqual({
        collection: POSTS,
        id: hello,
        kind: "address",
      });
      // The entry in the page's way is left unserved: the path is the page's.
      expect(await content.resolveAddress(undefined, "/blog/taken")).toEqual({
        collection: "pages",
        id: page,
        kind: "address",
      });
      expect(await content.entryPath(POSTS, taken, undefined)).toBeNull();

      // And reported, naming the page in its way.
      await person(t, "owner");
      const author = await person(t, "author");
      await grant(t, author, ["read-pages", "update-pages", `read-${POSTS}`]);
      const report = await call(
        "GET",
        await sessionOf(t, author),
        ADDRESS_WAITING_ROUTE_PATH.split("/").filter(Boolean)
      );
      expect(report.status).toBe(200);
      expect(report.body.items).toEqual([
        {
          document: { collection: POSTS, id: taken, title: "Post taken" },
          address: { locale: "en", path: "/blog/taken" },
          blockedBy: { collection: "pages", id: page, title: "Taken" },
        },
      ]);

      // Starting again finds every entry holding what it should, or waiting
      // where it should, and writes none of it again.
      const settled = await storedClaims(t);
      const again = await boot(database);
      expect(await storedClaims(again)).toEqual(settled);
    });
  }
);
