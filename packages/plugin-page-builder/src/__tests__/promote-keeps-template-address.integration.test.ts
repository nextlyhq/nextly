/**
 * Promoting a Schema Builder collection to code with the command a site runs,
 * `nextly db:sync --promote <slug> --yes`, keeps what its entries are served
 * as: its Draft/Published lifecycle and its template address.
 *
 * The collection is made as the Schema Builder makes it, through Nextly's own
 * request handler in development, with Draft/Published on. Its published
 * template stores an address, and one published entry and one draft are saved.
 * The real command then runs as a child process against the same database
 * file, and what it appends to the project's config is read back. The printed
 * code must carry the lifecycle and the printed note the `pageBuilder()`
 * address declaration; the entry's address claim and the template's stored
 * address must outlive the promote. Then the site starts again on the same
 * file with the printed collection and the declared address as its code: the
 * published entry is still served at its address, the draft still is not, and
 * each entry still has its state.
 *
 * SQLite alone: the command reads a database file the test can hand it, and
 * what is printed does not depend on the dialect.
 *
 * @module __tests__/promote-keeps-template-address.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { execFile } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection } from "nextly/config";
import { createAdapter } from "nextly/database";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TEMPLATES_SLUG } from "../collections/templates";
import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";

import { person, sessionOf } from "./transfer-harness";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

/** The collection made in the Schema Builder, and where its entries are served. */
const HOST = "pk_articles";
const ADDRESS = "/articles";

const TEMPLATE = { formatVersion: 1, kind: "template", nodes: [] };

const idOf = (created: unknown): string =>
  String((created as { item: { id: unknown } }).item.id);

/** A scratch project: a config file, and a SQLite database file beside it. */
function project(): { folder: string; url: string; close: () => void } {
  const folder = mkdtempSync(join(tmpdir(), "pb-promote-"));
  symlinkSync(join(packageRoot, "node_modules"), join(folder, "node_modules"));
  writeFileSync(join(folder, "nextly.config.ts"), "export default {};\n", {
    flag: "wx",
  });
  return {
    folder,
    url: `file:${join(folder, "site.db")}`,
    close: () => rmSync(folder, { recursive: true, force: true }),
  };
}

/**
 * An adapter on the project's database, with core's environment naming it for
 * the rest of the case, as a site's own environment names its database.
 *
 * Making the adapter reads only the pool settings, so it no longer validates
 * the environment, and a booted site reads `DB_DIALECT` and `DATABASE_URL`
 * later (the schema services' dialect, the settings secrets). Named only
 * while the adapter was made, they were gone by then, and on a run with
 * neither set the site refused to boot for want of a PostgreSQL URL. Stubbed,
 * so `afterEach` puts back what was there.
 */
async function adapterOn(url: string) {
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("DB_DIALECT", "sqlite");
  return createAdapter({ type: "sqlite", url });
}

/** A call to Nextly's own API, as the admin makes it. */
async function api(
  cookie: string,
  path: readonly string[],
  body: unknown
): Promise<{ status: number; body: unknown }> {
  const request = new Request(`${ORIGIN}/api/${path.join("/")}`, {
    method: "POST",
    headers: {
      cookie: `${cookie}; nextly_csrf=${CSRF}`,
      "x-csrf-token": CSRF,
      origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const response = await createDynamicHandlers().POST(request, {
    params: Promise.resolve({ params: [...path] }),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : JSON.parse(text) };
}

/**
 * The collection's code from the snippet the command appended: the commented
 * object literal after its "Move this entry" line, and the note after it.
 */
function appended(config: string): { code: string; note: string } {
  const lines = config.split("\n");
  const start = lines.findIndex(line => line === "// {");
  const end = lines.findIndex((line, at) => at > start && line === "// }");
  if (start < 0 || end < 0) throw new Error(`no snippet in:\n${config}`);
  const strip = (line: string) => line.replace(/^\/\/ ?/, "");
  return {
    code: lines
      .slice(start, end + 1)
      .map(strip)
      .join("\n"),
    note: lines
      .slice(end + 1)
      .map(strip)
      .join("\n"),
  };
}

describe("db:sync --promote of a collection with a template address (sqlite)", () => {
  let site: TestNextly | undefined;
  let scratch: ReturnType<typeof project> | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    await site?.destroy();
    site = undefined;
    scratch?.close();
    scratch = undefined;
  });

  it("prints the lifecycle and the address, keeps the claim, and serves the same after a restart", async () => {
    scratch = project();
    const { folder, url } = scratch;

    // 1. The collection, as the Schema Builder makes it in development.
    site = await createTestNextly({
      adapter: await adapterOn(url),
      plugins: [pageBuilder()],
      seedPublic: true,
    });
    const cookie = await sessionOf(site, await person(site, "owner"));
    // Put back by itself below: undoing every stub would also drop the
    // database the environment names for the rest of the case.
    const nodeEnv = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "development");
    const made = await api(cookie, ["collections"], {
      name: HOST,
      label: "Article",
      status: true,
      // `title` and `slug` are every collection's own; a field of its own
      // besides, as a collection defined in code needs one.
      fields: [{ name: "summary", type: "text" }],
    });
    vi.stubEnv("NODE_ENV", nodeEnv);
    expect(made.status, JSON.stringify(made.body)).toBe(201);

    // 2. Its template, published at an address, and two entries.
    const templateId = idOf(
      await site.nextly.create({
        collection: TEMPLATES_SLUG,
        data: {
          title: "Article page",
          collection: HOST,
          content: TEMPLATE,
          status: "published",
          address: ADDRESS,
        },
        overrideAccess: true,
      })
    );
    const entry = (slug: string, status: "published" | "draft") =>
      site!.nextly.create({
        collection: HOST,
        data: { title: slug, slug, status },
        overrideAccess: true,
      });
    const published = idOf(await entry("first", "published"));
    await entry("unready", "draft");
    const before = pageBuilderContent({ nextly: site.nextly as never });
    expect(await before.resolveAddress(undefined, `${ADDRESS}/first`)).toEqual({
      collection: HOST,
      id: published,
      kind: "address",
    });
    expect(await before.resolveAddress(undefined, `${ADDRESS}/unready`)).toBe(
      null
    );
    await site.destroy();
    site = undefined;

    // 3. The command, as a site runs it.
    await run(
      join(packageRoot, "node_modules/.bin/nextly"),
      ["db:sync", "--promote", HOST, "--yes"],
      {
        cwd: folder,
        env: { ...process.env, DATABASE_URL: url, DB_DIALECT: "sqlite" },
        timeout: 120_000,
      }
    );
    const { code, note } = appended(
      readFileSync(join(folder, "nextly.config.ts"), "utf8")
    );
    const printed = new Function(`return (${code});`)() as Record<
      string,
      unknown
    >;
    expect(printed).toMatchObject({ slug: HOST, status: true });
    expect(note).toContain(
      `pageBuilder({ templates: { addresses: { ${HOST}: "${ADDRESS}" } } })`
    );

    // 4. The site again, on the same file, with the printed code as its own.
    site = await createTestNextly({
      adapter: await adapterOn(url),
      plugins: [pageBuilder({ templates: { addresses: { [HOST]: ADDRESS } } })],
      collections: [
        defineCollection(printed as Parameters<typeof defineCollection>[0]),
      ],
      seedPublic: true,
    });
    const after = pageBuilderContent({ nextly: site.nextly as never });
    expect(await after.resolveAddress(undefined, `${ADDRESS}/first`)).toEqual({
      collection: HOST,
      id: published,
      kind: "address",
    });
    expect(await after.resolveAddress(undefined, `${ADDRESS}/unready`)).toBe(
      null
    );
    const template = (await site.nextly.findByID({
      collection: TEMPLATES_SLUG,
      id: templateId,
      overrideAccess: true,
      depth: 0,
    })) as unknown as Record<string, unknown>;
    expect(template.address).toBe(ADDRESS);
    // Each entry keeps its state: the lifecycle is the collection's still.
    const states = await site.nextly.find({
      collection: HOST,
      overrideAccess: true,
      status: "all",
      depth: 0,
      limit: 10,
    });
    expect(
      (states.items as Record<string, unknown>[])
        .map(row => `${String(row.slug)} ${String(row.status)}`)
        .sort()
    ).toEqual(["first published", "unready draft"]);
    // And a published read is held to published entries.
    const visible = await site.nextly.find({
      collection: HOST,
      overrideAccess: true,
      status: "published",
      depth: 0,
      limit: 10,
    });
    expect(
      (visible.items as Record<string, unknown>[]).map(row => row.slug)
    ).toEqual(["first"]);
  });
});
