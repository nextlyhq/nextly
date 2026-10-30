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

import { DATE_FIELDS, TRANSLATABLE_FIELDS, articleData, authorData, localesOf, siteFor, storageContractOf } from "./fixture.mjs";
import { pick, seededRandom, summarize } from "./stats.mjs";

const AUTHORS = 20;
export const PAGE_SIZE = 20;
/** The REST path the articles' entries are read under. */
const ENTRIES = ["collections", "articles", "entries"];
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
 * its own key, and its warm-up, content check and timed reads must fit under it.
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

/**
 * The site's content as the seed makes it: each author's values, then each article's, with its
 * author given as an index into the authors. Seeding writes exactly this, and the content check
 * compares every read against it, so what is written and what is expected cannot drift apart.
 */
export function seededContent(options) {
  const random = seededRandom(options.seed);
  const authors = Array.from({ length: AUTHORS }, () => authorData(random));
  const authorIndexes = authors.map((_, i) => i);
  const articles = Array.from({ length: options.docs }, (_, i) => articleData(random, i, authorIndexes));
  return { authors, articles };
}

/** What each seeded article must read back as, by its id: its values, with its author's values in place of the author. */
export function expectedArticles(content, articleIds) {
  return new Map(
    articleIds.map((id, i) => {
      const article = content.articles[i];
      return [id, { ...article, author: content.authors[article.author] }];
    })
  );
}

/** A value as a difference shows it, cut short. */
function shown(value) {
  return JSON.stringify(value)?.slice(0, 120);
}

/** The difference at `path` between two values that should have been the same. */
function mismatch(path, expected, actual) {
  return `${path}: expected ${shown(expected)}, got ${shown(actual)}`;
}

/** Whether two spellings of a date name the same time. */
function sameTime(expected, actual) {
  const time = new Date(actual).getTime();
  return !Number.isNaN(time) && time === new Date(expected).getTime();
}

/**
 * Where a read's `actual` departs from the `expected` content, as a path and the two values, or
 * null where it holds every seeded value: each key at every depth, the rich-text body included, a
 * list item for item and of the same length, and a date by the time it names. What a read adds
 * beside the seeded values, its ids, its created and updated times and any column of its own, is
 * not compared: it cannot make a read time less content than was seeded.
 */
function contentDifference(expected, actual, path = "") {
  if (Array.isArray(expected)) return listDifference(expected, actual, path);
  if (isRecord(expected)) return recordDifference(expected, actual, path);
  return Object.is(expected, actual) ? null : mismatch(path, expected, actual);
}

/** Where a list departs from the expected one: in its length, or at its first item that does. */
function listDifference(expected, actual, path) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return `${path}: expected ${expected.length} items, got ${shown(actual)}`;
  for (let i = 0; i < expected.length; i++) {
    const difference = contentDifference(expected[i], actual[i], `${path}[${i}]`);
    if (difference !== null) return difference;
  }
  return null;
}

/** Where a record departs from the expected one: at its first seeded field that does. */
function recordDifference(expected, actual, path) {
  if (!isRecord(actual)) return `${path}: expected a record, got ${shown(actual)}`;
  for (const [key, value] of Object.entries(expected)) {
    const difference = fieldDifference(key, value, actual[key], path ? `${path}.${key}` : key);
    if (difference !== null) return difference;
  }
  return null;
}

/** Where a field departs from its seeded value: a date by the time it names, any other by its content. */
function fieldDifference(key, expected, actual, path) {
  if (!DATE_FIELDS.has(key)) return contentDifference(expected, actual, path);
  return sameTime(expected, actual) ? null : mismatch(path, expected, actual);
}

/** Refuses an article that is not one the site seeded, or that reads back as other content than seeded. */
function checkArticle(name, item, expected) {
  const seeded = expected.get(item?.id);
  if (seeded === undefined) throw new Error(`${name} returned an article the site did not seed: ${JSON.stringify(item)?.slice(0, 300)}`);
  const difference = contentDifference(seeded, item);
  if (difference !== null) throw new Error(`${name} returned article ${item.id} with other content than seeded, at ${difference}`);
}

/**
 * What a read returns, checked against the seeded content once before timing: a list read gives
 * a full page and a detail read its article, each article, with its author and its card, exactly
 * as seeded. A read that lost, emptied or swapped a value would time less than it should, under
 * `e4` above all, which moves every translatable value.
 */
export function checkContent(name, result, expected) {
  for (const item of articlesOf(name, result)) checkArticle(name, item, expected);
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

/**
 * The seeded articles' ids in the order the list reads ask for, by `publishedOn`: read off the
 * seeded content, not assumed from the order the articles were created in.
 */
function listOrder(expected) {
  const time = id => new Date(expected.get(id).publishedOn).getTime();
  return [...expected.keys()].sort((a, b) => time(a) - time(b));
}

/**
 * Refuses a list page that is not the one asked for, as a whole: its ids, in order, must be
 * exactly the seeded articles at that page's place in `order`, so a page out of order, unsorted,
 * overlapping another or leaving a gap is refused, and its totals must be the whole site's.
 */
export function checkPage(name, result, page, order) {
  const first = (page - 1) * PAGE_SIZE;
  const totalPages = Math.ceil(order.length / PAGE_SIZE);
  const expected = {
    ids: order.slice(first, first + PAGE_SIZE),
    meta: { total: order.length, page, limit: PAGE_SIZE, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
  const difference = contentDifference(expected, { ids: itemsOf(result).map(item => item?.id), meta: result?.meta });
  if (difference !== null) throw new Error(`${name} page ${page} is not the page asked for, at ${difference}`);
}

/**
 * Reads every page of each list read, before anything is timed, through the same calls the timed
 * reads make. Each page must be exactly its place in the seeded order (`checkPage`), and each
 * article on it must read back as seeded. Each timed read's first answer is checked as well,
 * through `checkContent`, so the detail reads are held to the same content.
 */
export async function checkEveryPage(lists, expected) {
  const order = listOrder(expected);
  for (const [name, list] of Object.entries(lists)) {
    for (let page = 1; page <= Math.ceil(order.length / PAGE_SIZE); page++) {
      const result = await list(page);
      checkPage(name, result, page, order);
      for (const item of itemsOf(result)) checkArticle(name, item, expected);
    }
  }
}

/** The Direct API list read the benchmark times: one page of articles in the seeded order, authors populated. */
function directList(nextly, page) {
  return nextly.find({ collection: "articles", limit: PAGE_SIZE, page, sort: LIST_SORT, depth: 1 });
}

/** The REST list read the benchmark times, the same page asked for as `directList` asks. */
function restList(handlers, key, page) {
  return restGet(handlers, key, ENTRIES, `limit=${PAGE_SIZE}&page=${page}&sort=${LIST_SORT}&depth=1`);
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

/** Creates the seeded authors and articles, each article pointing at its author's id. */
export async function seedSite(nextly, content) {
  const authorIds = [];
  for (const data of content.authors) authorIds.push(idOf(await nextly.create({ collection: "authors", data })));
  const articleIds = [];
  for (const data of content.articles) {
    articleIds.push(idOf(await nextly.create({ collection: "articles", data: { ...data, author: authorIds[data.author] } })));
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
 * What every table with translatable columns stores, whatever the mode: its
 * own columns, and its translation table's rows and columns. The evidence that
 * a mode stores what it says it does: a `per-language` run storing its values
 * where `main` does would compare a site with itself.
 */
export async function storageOf(adapter) {
  const storage = {};
  for (const table of Object.keys(TRANSLATABLE_FIELDS)) {
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
 * Refuses a site whose storage is not the mode's, holding every table with
 * translatable columns to the mode's contract (`storageContractOf`) both ways:
 * one the mode keeps per language has its translation table, of the right
 * size, and one it does not has none, its columns on the table itself. So a
 * build that leaves a table behind, or moves one it should not, is never
 * timed. A translation table holds one row per row of its table: one per
 * article, for the articles and their cards, and one per author.
 */
export function checkStorage(mode, docs, storage) {
  for (const [table, { columns, perLanguage }] of Object.entries(storageContractOf(mode))) {
    const stored = storage[table];
    if (stored === undefined) throw new Error(`${mode} mode: ${table} was not read`);
    const problem = perLanguage ? perLanguageProblem(columns, table === "dc_authors" ? AUTHORS : docs, stored) : mainProblem(columns, docs, stored);
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
  // The page walk has a key of its own, so the timed reads' keys keep their whole allowance.
  return { list: await mint("read benchmark: list"), detail: await mint("read benchmark: detail"), pages: await mint("read benchmark: pages") };
}

/** Refuses REST settings one key's hourly allowance could not carry. */
export function checkKeyBudget(options) {
  const requests = options.warmup + 1 + options.restIterations;
  if (requests > KEY_REQUESTS_PER_HOUR) {
    throw new RangeError(`a REST read makes ${requests} requests on one key, over its ${KEY_REQUESTS_PER_HOUR} an hour: lower --warmup or --rest-iterations`);
  }
  const pages = Math.ceil(options.docs / PAGE_SIZE);
  if (pages > KEY_REQUESTS_PER_HOUR) {
    throw new RangeError(`the REST page walk reads ${pages} pages on one key, over its ${KEY_REQUESTS_PER_HOUR} an hour: lower --docs`);
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
  const read = (offset, count, call) => {
    const random = seededRandom(options.seed + offset);
    return { iterations: count, next: () => call(random) };
  };
  return {
    "direct list": read(1, options.iterations, r => directList(nextly, page(r))),
    "direct detail": read(2, options.iterations, r => nextly.findByID({ collection: "articles", id: id(r), depth: 1 })),
    "rest list": read(3, options.restIterations, r => restList(handlers, keys.list, page(r))),
    "rest detail": read(4, options.restIterations, r => restGet(handlers, keys.detail, [...ENTRIES, id(r)], "depth=1")),
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
    const content = seededContent(options);
    const articleIds = await seedSite(handle.nextly, content);
    const expected = expectedArticles(content, articleIds);
    const storage = await storageOf(handle.adapter);
    checkStorage(options.mode, options.docs, storage);
    const { createDynamicHandlers } = await import(new URL("runtime.mjs", NEXTLY_DIST).href);
    const handlers = createDynamicHandlers();
    const keys = await readOnlyKeys(handle);
    await checkEveryPage({ "direct list": page => directList(handle.nextly, page), "rest list": page => restList(handlers, keys.pages, page) }, expected);
    const reads = readsFor({ nextly: handle.nextly, handlers, keys, articleIds, options });
    const results = {};
    for (const [name, read] of Object.entries(reads)) {
      checkContent(name, await read.next(), expected);
      results[name] = summarize(await time(read, options.warmup));
    }
    console.log(JSON.stringify({ mode: options.mode, dialect: options.dialect, docs: options.docs, seed: options.seed, translationRows: translationRows(storage), loadStart, loadEnd: loadavg()[0], results }));
  } finally {
    await teardown(handle, cleanup);
  }
}

if (isCliEntry(import.meta.url)) await main(process.argv.slice(2));
