/**
 * The pages built in code each production build served, recorded in the
 * plugin's own table while `next build` renders the site, and read back by
 * the running site for its own build.
 *
 * The addresses a route with a variable part serves are named by the build
 * alone: Next.js lists them in `.next/prerender-manifest.json`. A host may
 * not ship that file with the server, and then the running site cannot
 * confirm a single such page. So the build writes down what it rendered, in
 * the database the site runs on, under the build's own id
 * (`.next/BUILD_ID`, which every Next.js server reads to start). The running
 * site reads the rows of the build it serves: no build file but that id is
 * needed, and a page prerendered once and never rendered again is listed
 * all the same.
 *
 * Two things are recorded during the build: each page whose route answered
 * its head through `seoMetadata`, and, once per build process, each address
 * a route wrapped in `seoStaticParams` declared. Both say the route calls
 * `seoMetadata`. A build with no database records nothing, which is right:
 * it is no build the site serves.
 *
 * @module code-pages/build-record
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { and, eq, inArray, lt, ne } from "@nextlyhq/plugin-sdk/db";
import { isUniqueViolation } from "@nextlyhq/plugin-sdk/schema";

import { sha256 } from "../address-record/rows";
import { isoOf } from "../content-dates/store";
import { codeAddresses } from "../schema/tables";

import { declaredAddresses } from "./static-params";

/** One address a build recorded. */
export interface RecordedAddress {
  path: string;
  /** The route that declared it, as Next.js names it, where one did. */
  route?: string;
  /** Declared through `seoStaticParams`, rather than rendered. */
  declared: boolean;
}

/** What the running site's build recorded, and when. */
export interface BuildRecord {
  buildId: string;
  addresses: RecordedAddress[];
  /** When the build first recorded an address, as ISO text; none where it recorded none. */
  recordedAt?: string;
}

/**
 * The id of the build in `buildDir`, as Next.js wrote it to `BUILD_ID`;
 * none where there is no such file, as in development, or while
 * `next build` has not yet written it.
 */
export function buildIdIn(buildDir: string): string | undefined {
  try {
    const id = readFileSync(
      join(/*turbopackIgnore: true*/ buildDir, "BUILD_ID"),
      "utf8"
    ).trim();
    return id === "" || id.length > 255 ? undefined : id;
  } catch {
    return undefined;
  }
}

/** The key one address of one build is kept under. */
const keyOf = (buildId: string, path: string) => sha256(`${buildId}|${path}`);

/** How many addresses one read or insert names. */
const BATCH = 100;

/**
 * How long the rows of a build other than the one recording are kept: a
 * production build is served long after the next preview build records.
 */
const KEPT_FOR_MS = 90 * 24 * 60 * 60 * 1000;

/** The keys of `keys` the table already holds: one read. */
async function keptKeys(
  ctx: PluginContext,
  keys: readonly string[]
): Promise<Set<string>> {
  const columns = ctx.db.table(codeAddresses);
  const rows = (await ctx.db
    .select(codeAddresses)
    .where(inArray(columns.addressKey, [...keys]))
    .all()) as unknown as { addressKey: unknown }[];
  return new Set(rows.map(row => String(row.addressKey)));
}

/** The row recording `address` for the build `buildId`. */
function rowOf(buildId: string, address: RecordedAddress) {
  return {
    addressKey: keyOf(buildId, address.path),
    buildId,
    path: address.path,
    route: address.route ?? null,
    declared: address.declared,
    recordedAt: new Date(),
  };
}

/**
 * Insert `rows`, as one statement where none is held yet; where another
 * build worker recorded some of them first, the rest one at a time, a row
 * already held changing nothing.
 */
async function insertNew(
  ctx: PluginContext,
  rows: readonly ReturnType<typeof rowOf>[]
): Promise<void> {
  const held = (error: unknown) => {
    if (!isUniqueViolation(ctx.dialect, error)) throw error;
  };
  try {
    await ctx.db.insert(codeAddresses, [...rows]);
  } catch (error) {
    held(error);
    for (const row of rows) {
      await ctx.db.insert(codeAddresses, row).catch(held);
    }
  }
}

/**
 * Record `addresses` for the build `buildId`: each address once, a second
 * record of it changing nothing, so build workers recording at once and a
 * build retried record one row per address.
 */
async function recordBuildAddresses(
  ctx: PluginContext,
  buildId: string,
  addresses: readonly RecordedAddress[]
): Promise<void> {
  const all = [...new Map(addresses.map(each => [each.path, each])).values()];
  for (let at = 0; at < all.length; at += BATCH) {
    const batch = all.slice(at, at + BATCH).map(each => rowOf(buildId, each));
    const kept = await keptKeys(
      ctx,
      batch.map(row => row.addressKey)
    );
    const rows = batch.filter(row => !kept.has(row.addressKey));
    if (rows.length > 0) await insertNew(ctx, rows);
  }
}

/** What the build `buildId` recorded. */
export async function readBuildRecord(
  ctx: PluginContext,
  buildId: string
): Promise<BuildRecord> {
  const columns = ctx.db.table(codeAddresses);
  const rows = (await ctx.db
    .select(codeAddresses)
    .where(eq(columns.buildId, buildId))
    .all()) as unknown as Record<string, unknown>[];
  let first: string | undefined;
  const addresses: RecordedAddress[] = [];
  for (const row of rows) {
    if (typeof row.path !== "string") continue;
    addresses.push({
      path: row.path,
      ...(typeof row.route === "string" ? { route: row.route } : {}),
      declared: row.declared === true || row.declared === 1,
    });
    const at = isoOf(row.recordedAt);
    if (at !== undefined && (first === undefined || at < first)) first = at;
  }
  return {
    buildId,
    addresses,
    ...(first === undefined ? {} : { recordedAt: first }),
  };
}

/**
 * Drop the rows of builds other than `buildId` recorded long ago: one
 * statement, so the table holds the builds a site may still serve.
 */
async function dropOldBuilds(
  ctx: PluginContext,
  buildId: string
): Promise<void> {
  const columns = ctx.db.table(codeAddresses);
  const before = new Date(Date.now() - KEPT_FOR_MS);
  const old = and(ne(columns.buildId, buildId), lt(columns.recordedAt, before));
  if (old !== undefined) await ctx.db.delete(codeAddresses).where(old);
}

/**
 * The builds whose declared addresses this process has recorded, by the
 * database they were recorded in, so each build process records them once
 * per database, however many pages it renders.
 */
const declaredRecorded = new WeakMap<object, Set<string>>();

/** The builds recorded in `ctx`'s database by this process. */
function recordedIn(ctx: PluginContext): Set<string> {
  let builds = declaredRecorded.get(ctx.db);
  if (builds === undefined) {
    builds = new Set();
    declaredRecorded.set(ctx.db, builds);
  }
  return builds;
}

/** Whether a failed record was warned of already: once says it for the build. */
let failureWarned = false;

/**
 * Record, while `next build` renders the site, that the page at `path` is
 * built in code and its route calls `seoMetadata`; the first time this
 * process records for the build, also every address a route declared
 * through `seoStaticParams`, and drop the rows of builds long replaced. Does
 * nothing where the build's id is not written yet. A failure warns once and
 * changes nothing the page is answered.
 */
export async function recordBuiltPage(
  ctx: PluginContext,
  buildDir: string,
  path: string
): Promise<void> {
  const buildId = buildIdIn(buildDir);
  if (buildId === undefined) return;
  try {
    const addresses: RecordedAddress[] = [{ path, declared: false }];
    const recorded = recordedIn(ctx);
    const first = !recorded.has(buildId);
    if (first) {
      for (const each of declaredAddresses(buildDir)) {
        addresses.push({
          path: each.path,
          ...(each.srcRoute === null ? {} : { route: each.srcRoute }),
          declared: true,
        });
      }
    }
    // The page's own address first: a declared one of the same address
    // then changes nothing.
    await recordBuildAddresses(ctx, buildId, addresses);
    if (first) {
      recorded.add(buildId);
      await dropOldBuilds(ctx, buildId);
    }
  } catch (error) {
    if (failureWarned) return;
    failureWarned = true;
    ctx.logger.warn(
      "The pages built in code this build rendered could not be recorded, so the running site lists only those its build files confirm",
      { path, buildId, error }
    );
  }
}
