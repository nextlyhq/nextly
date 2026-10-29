/**
 * One measurement: boots the benchmark site in one storage mode on one
 * database, seeds it, and times list and detail reads through the Direct API
 * and through REST. Prints one JSON line. Run by `run.mjs`, one process per
 * measurement, so no module state or warmed cache carries from one mode into
 * the next.
 *
 *   node measure.mjs --mode main|per-language|e4 --dialect sqlite|postgresql|mysql
 *     [--docs 1000] [--iterations 3000] [--warmup 300] [--rest-iterations 600] [--seed 1]
 *
 * PostgreSQL and MySQL boot on a database created for the run on the server in
 * TEST_POSTGRES_URL or TEST_MYSQL_URL, and dropped after it. SQLite runs on a
 * file in a temporary folder, as a site's database is, not in memory.
 *
 * Nextly is loaded from its build when `main` runs, not when this module is
 * imported, so its checks can be imported without one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import { isCliEntry } from "../cli-entry.mjs";

import { TRANSLATABLE_COLUMNS, articleData, authorData, localesOf, siteFor, storesPerLanguage } from "./fixture.mjs";
import { pick, seededRandom, summarize } from "./stats.mjs";

const AUTHORS = 20;
export const PAGE_SIZE = 20;
/**
 * The order list reads page in: a seeded field no two articles share, kept on
 * the main table in both modes, so a page number holds the same articles in
 * either and sorting costs both the same. Entries' ids are random, so without
 * a sort a page would be whichever rows the database reached first.
 */
const LIST_SORT = "publishedOn";
/**
 * The requests an API key may make in an hour unless the app configures more
 * (`apiKeys.rateLimit`), which a test boot does not: Nextly's
 * `DEFAULT_API_KEYS_CONFIG.requestsPerHour`, which the test holds this to. It
 * is not read from the build, which does not export it. Each REST read gets
 * its own key, and its warm-up, shape check and timed reads must fit under it.
 */
export const KEY_REQUESTS_PER_HOUR = 1000;
const NEXTLY_DIST = new URL("../../packages/nextly/dist/", import.meta.url);

/** What a Direct API create answered with: its item, or the record itself. */
function recordOf(created) {
  return created?.item ?? created ?? {};
}

/** The id a Direct API create answered with. */
export function idOf(created) {
  const { id } = recordOf(created);
  if (id === undefined) throw new Error(`a create answered with no id: ${JSON.stringify(created).slice(0, 200)}`);
  return id;
}

/** The items of a list read's answer, an empty list when it has none. */
function itemsOf(result) {
  return Array.isArray(result?.items) ? result.items : [];
}

/** Whether a value is a record: an object that is neither null nor a list. */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether an article came back with its translatable fields, its populated author and its card. */
export function isCompleteArticle(item) {
  const { headline, excerpt, body, author, card } = item ?? {};
  return [typeof headline === "string", typeof excerpt === "string", Boolean(body), isRecord(author), Boolean(card?.heading)].every(Boolean);
}

/**
 * What a read returns, checked once before timing: a list read gives a full
 * page, a detail read its article, each article complete. A read that came
 * back empty would time nothing.
 */
export function checkShape(name, result) {
  for (const item of articlesOf(name, result)) checkArticle(name, item);
}

/** The articles a read returned: every one of a list read's full page, or a detail read's one. */
function articlesOf(name, result) {
  return name.endsWith("list") ? fullPage(name, result) : [result?.item ?? result];
}

/** A list read's articles, once the read is known to have given a full page. */
function fullPage(name, result) {
  const items = itemsOf(result);
  if (items.length !== PAGE_SIZE) throw new Error(`${name} returned ${items.length} items, not ${PAGE_SIZE}`);
  return items;
}

/** Refuses an article that came back without its fields. */
function checkArticle(name, item) {
  if (!isCompleteArticle(item)) throw new Error(`${name} returned an article without its fields: ${JSON.stringify(item).slice(0, 300)}`);
}

/**
 * What `start` resolves to, with `folder` removed if it rejects instead: a
 * boot that fails part way would otherwise leave its database behind, and the
 * runner takes a failed measurement again.
 */
export async function removingOnFailure(folder, start) {
  try {
    return await start();
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

/** Boots the site on the requested database. */
async function boot(options) {
  const { createTestNextly } = await import(new URL("testing.mjs", NEXTLY_DIST).href);
  const site = siteFor(options.mode, await import(new URL("config.mjs", NEXTLY_DIST).href));
  if (options.dialect === "sqlite") {
    const { createAdapter } = await import(new URL("database/index.mjs", NEXTLY_DIST).href);
    const folder = mkdtempSync(join(tmpdir(), "nextly-read-benchmark-"));
    const url = `file:${join(folder, "site.db")}`;
    // What the environment reports agrees with the adapter, so nothing reading
    // it falls back to a default database file.
    process.env.DB_DIALECT = "sqlite";
    process.env.DATABASE_URL = url;
    const handle = await removingOnFailure(folder, async () => createTestNextly({ ...site, adapter: await createAdapter({ type: "sqlite", url }) }));
    return { handle, cleanup: () => rmSync(folder, { recursive: true, force: true }) };
  }
  if (options.dialect !== "postgresql" && options.dialect !== "mysql") throw new RangeError(`unknown dialect ${options.dialect}`);
  return { handle: await createTestNextly({ ...site, dialect: options.dialect }), cleanup: () => {} };
}

/** Seeds the authors and articles, all from the one seed. */
async function seedSite(nextly, options) {
  const random = seededRandom(options.seed);
  const authorIds = [];
  for (let i = 0; i < AUTHORS; i++) {
    authorIds.push(idOf(await nextly.create({ collection: "authors", data: authorData(random) })));
  }
  const articleIds = [];
  for (let i = 0; i < options.docs; i++) {
    articleIds.push(idOf(await nextly.create({ collection: "articles", data: articleData(random, i, authorIds) })));
  }
  return articleIds;
}

/** The columns a table's rows hold, read from its first row; none for an empty table. */
function columnsOf(rows) {
  return Object.keys(rows[0] ?? {});
}

/**
 * A translation table's row count and columns, `null` when it does not exist.
 *
 * Absence is asked of the database rather than read from a failed select: a
 * dropped connection would otherwise read as the absent tables a `main` site
 * has, and pass its check. Any such failure fails the attempt, which the runner
 * takes again.
 */
async function localesStorage(adapter, table) {
  if (!(await adapter.tableExists(table))) return null;
  const rows = await adapter.select(table);
  return { rows: rows.length, columns: columnsOf(rows) };
}

/**
 * What each table with translatable columns stores: its own columns, and its
 * translation table's rows and columns. The evidence that a mode stores what it
 * says it does: a `per-language` run storing its values where `main` does would
 * compare a site with itself.
 */
export async function storageOf(adapter) {
  const storage = {};
  for (const table of Object.keys(TRANSLATABLE_COLUMNS)) {
    storage[table] = { columns: columnsOf(await adapter.select(table)), locales: await localesStorage(adapter, localesOf(table)) };
  }
  return storage;
}

/** What is wrong with a `main` site's table: a translation table, or translatable columns missing. */
function mainProblem(translatable, _docs, { columns, locales }) {
  if (locales !== null) return `has a translation table, of ${locales.rows} rows`;
  const missing = translatable.filter(column => !columns.includes(column));
  return missing.length > 0 ? `lacks ${missing.join(", ")}` : undefined;
}

/**
 * What is wrong with the table of a site that stores per language: no
 * translation table, one row too few or many for the one language, or a
 * column on the wrong side.
 */
function perLanguageProblem(translatable, docs, { columns, locales }) {
  if (locales === null) return "has no translation table";
  if (locales.rows !== docs) return `has ${locales.rows} translation rows, expected ${docs}`;
  return misplaced(translatable, columns, locales.columns);
}

/**
 * The columns stored on the wrong side: a translatable one left on the main
 * table or missing from its translation table, or a shared one moved into it.
 * A translation table's own bookkeeping columns start with `_`.
 */
function misplaced(translatable, onMain, onLocales) {
  const wrong = [
    ...translatable.filter(column => onMain.includes(column) || !onLocales.includes(column)),
    ...onLocales.filter(column => !column.startsWith("_") && !translatable.includes(column)),
  ];
  return wrong.length > 0 ? `stores ${wrong.join(", ")} on the wrong side` : undefined;
}

/**
 * Refuses a site whose storage is not the mode's. `e4` is held to what
 * `per-language` stores, so a build that does not store it so is never timed.
 */
export function checkStorage(mode, docs, storage) {
  const problemOf = storesPerLanguage(mode) ? perLanguageProblem : mainProblem;
  for (const [table, stored] of Object.entries(storage)) {
    const problem = problemOf(TRANSLATABLE_COLUMNS[table], docs, stored);
    if (problem) throw new Error(`${mode} mode: ${table} ${problem}`);
  }
}

/** Each translation table's row count, `null` for one that does not exist, as a measurement reports them. */
function translationRows(storage) {
  return Object.fromEntries(Object.entries(storage).map(([table, { locales }]) => [localesOf(table), locales?.rows ?? null]));
}

/**
 * Read-only API keys, one per REST read, as a site's server reads its content
 * with: REST reads of collection entries require a caller. Minted by the
 * install's first user, who holds the seeded super-admin role, so they read
 * everything declared and write nothing. A key's lookup costs every REST read
 * the same in both modes.
 */
async function readOnlyKeys(handle) {
  const owner = idOf(
    await handle.nextly.users.create({
      data: { email: "reader@example.com", password: "Benchmark-Reader-1!", name: "Reader", isActive: true },
    })
  );
  const mint = async name => (await handle.getService("apiKeyService").createApiKey(owner, { name, tokenType: "read-only", expiresIn: "never" })).key;
  return { list: await mint("read benchmark: list"), detail: await mint("read benchmark: detail") };
}

/** Refuses REST settings one key's hourly allowance could not carry. */
export function checkKeyBudget(options) {
  const requests = options.warmup + 1 + options.restIterations;
  if (requests > KEY_REQUESTS_PER_HOUR) {
    throw new RangeError(`a REST read makes ${requests} requests on one key, over its ${KEY_REQUESTS_PER_HOUR} an hour: lower --warmup or --rest-iterations`);
  }
}

/** One REST GET through the route handlers a Next.js app mounts, read to the end. */
async function restGet(handlers, key, segments, query) {
  const request = new Request(`http://localhost/api/${segments.join("/")}?${query}`, { headers: { authorization: `Bearer ${key}` } });
  const response = await handlers.GET(request, { params: Promise.resolve({ params: segments }) });
  if (response.status !== 200) throw new Error(`GET /api/${segments.join("/")} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

/** The four reads, each drawing its page or id from its own seeded sequence. */
export function readsFor({ nextly, handlers, keys, articleIds, options }) {
  const pages = Math.floor(articleIds.length / PAGE_SIZE);
  const page = random => 1 + pick(random, pages);
  const id = random => articleIds[pick(random, articleIds.length)];
  const entries = ["collections", "articles", "entries"];
  const read = (offset, count, call) => {
    const random = seededRandom(options.seed + offset);
    return { iterations: count, next: () => call(random) };
  };
  return {
    "direct list": read(1, options.iterations, r => nextly.find({ collection: "articles", limit: PAGE_SIZE, page: page(r), sort: LIST_SORT, depth: 1 })),
    "direct detail": read(2, options.iterations, r => nextly.findByID({ collection: "articles", id: id(r), depth: 1 })),
    "rest list": read(3, options.restIterations, r => restGet(handlers, keys.list, entries, `limit=${PAGE_SIZE}&page=${page(r)}&sort=${LIST_SORT}&depth=1`)),
    "rest detail": read(4, options.restIterations, r => restGet(handlers, keys.detail, [...entries, id(r)], "depth=1")),
  };
}

/** Times `read.iterations` calls after `warmup` untimed ones; milliseconds per call. */
async function time(read, warmup) {
  for (let i = 0; i < warmup; i++) await read.next();
  const samples = new Array(read.iterations);
  for (let i = 0; i < read.iterations; i++) {
    const start = performance.now();
    await read.next();
    samples[i] = performance.now() - start;
  }
  return samples;
}

/** The measurement's options, from its command line. */
export function optionsFrom(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string" },
      dialect: { type: "string" },
      docs: { type: "string", default: "1000" },
      iterations: { type: "string", default: "3000" },
      warmup: { type: "string", default: "300" },
      "rest-iterations": { type: "string", default: "600" },
      seed: { type: "string", default: "1" },
    },
  });
  return {
    mode: values.mode,
    dialect: values.dialect,
    docs: Number(values.docs),
    iterations: Number(values.iterations),
    warmup: Number(values.warmup),
    restIterations: Number(values["rest-iterations"]),
    seed: Number(values.seed),
  };
}

/** Shuts the site down, then removes its folder, whether or not the shutdown succeeded. */
export async function teardown(handle, cleanup) {
  try {
    await handle.destroy();
  } finally {
    cleanup();
  }
}

/** Runs one measurement and prints its JSON line. */
async function main(argv) {
  const options = optionsFrom(argv);
  checkKeyBudget(options);
  const loadStart = loadavg()[0];
  const { handle, cleanup } = await boot(options);
  try {
    const articleIds = await seedSite(handle.nextly, options);
    const storage = await storageOf(handle.adapter);
    checkStorage(options.mode, options.docs, storage);
    const { createDynamicHandlers } = await import(new URL("runtime.mjs", NEXTLY_DIST).href);
    const reads = readsFor({ nextly: handle.nextly, handlers: createDynamicHandlers(), keys: await readOnlyKeys(handle), articleIds, options });
    const results = {};
    for (const [name, read] of Object.entries(reads)) {
      checkShape(name, await read.next());
      results[name] = summarize(await time(read, options.warmup));
    }
    console.log(JSON.stringify({ mode: options.mode, dialect: options.dialect, docs: options.docs, seed: options.seed, translationRows: translationRows(storage), loadStart, loadEnd: loadavg()[0], results }));
  } finally {
    await teardown(handle, cleanup);
  }
}

if (isCliEntry(import.meta.url)) await main(process.argv.slice(2));
