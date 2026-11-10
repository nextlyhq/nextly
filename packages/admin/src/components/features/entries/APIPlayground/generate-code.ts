/**
 * Turning the built request into code you can use.
 *
 * The playground could prove a call worked but not tell you how to make it, so
 * the last step — going from a request that returns 200 to a line in your app
 * — was left as an exercise. These are the three ways someone actually leaves
 * with the request: a terminal, the browser, and the server.
 *
 * Pure functions over the request state: no React, so they can be tested for
 * what they claim to produce.
 *
 * @module components/entries/APIPlayground/generate-code
 */

import type { EndpointAction, HttpMethod } from "./APIPlayground";

export interface CodeRequest {
  method: HttpMethod;
  /** Absolute URL, as sent. */
  url: string;
  /** Raw JSON body, when the action carries one. */
  body?: string;
  /** Collection slug, for the SDK call. */
  collection: string;
  /** Singles are addressed by slug, not queried, so they generate differently. */
  isSingle: boolean;
  /** Query params as built, for the SDK's typed arguments. */
  params: Record<string, string>;
  /**
   * Which operation this is.
   *
   * The SDK snippet used to be written from the collection and the params
   * alone, which is enough to describe a read and nothing else — so every
   * action produced a `find()`, and copying the one shown under "Create Entry"
   * ran a query instead.
   */
  action: EndpointAction;
  /** The entry the action addresses, for the calls that take one. */
  entryId?: string;
}

/** Single-quote a shell string, closing and reopening around embedded quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * curl, for a terminal or a CI job.
 *
 * Cookie auth is what the admin uses, and a copied curl has no cookie jar, so
 * it says so rather than emitting a command that returns 401 with no clue why.
 */
export function toCurl(req: CodeRequest): string {
  const lines = [`curl -X ${req.method} ${shellQuote(req.url)} \\`];
  lines.push(`  -H 'Content-Type: application/json' \\`);
  lines.push(`  -H 'Cookie: <your-session-cookie>'`);

  if (req.body?.trim()) {
    lines[lines.length - 1] += ` \\`;
    lines.push(`  -d ${shellQuote(req.body.trim())}`);
  }

  return lines.join("\n");
}

/**
 * fetch, for calling the REST API from the browser.
 *
 * `credentials: "include"` because this is the same session-cookie route the
 * admin itself takes; without it the call is anonymous.
 */
export function toFetch(req: CodeRequest): string {
  const opts: string[] = [`  method: ${JSON.stringify(req.method)},`];
  opts.push(`  headers: { "Content-Type": "application/json" },`);
  opts.push(`  credentials: "include",`);

  if (req.body?.trim()) {
    opts.push(`  body: JSON.stringify(${req.body.trim()}),`);
  }

  return [
    `const res = await fetch(${JSON.stringify(req.url)}, {`,
    ...opts,
    `});`,
    ``,
    `const data = await res.json();`,
  ].join("\n");
}

/** The SDK argument for a `where` param, which arrives as JSON text. */
function formatWhere(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
      .split("\n")
      .map((line, i) => (i === 0 ? line : `  ${line}`))
      .join("\n");
  } catch {
    return null;
  }
}

/**
 * The Nextly call, for server code.
 *
 * The one that matters: on a server this skips HTTP entirely and queries
 * directly, so it is what belongs in a page or a route handler rather than a
 * fetch back to your own app.
 *
 * Written against the real signature — `await getNextly({ config })` returning
 * `{ items, meta }` — not the package's own examples, which show
 * `getNextly()` with neither `await` nor config and do not compile.
 */
/**
 * A number the SDK will accept, or nothing.
 *
 * `Number("")`/`Number("abc")` are 0 and NaN, and a snippet reading
 * `limit: NaN` is worse than one with no limit at all — it looks like code.
 */
function numericArg(name: string, raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return `  ${name}: ${n},`;
}

/** The read arguments `find` shares with `count`. */
function whereArg(raw: string | undefined): string | null {
  if (!raw) return null;
  const where = formatWhere(raw);
  return where ? `  where: ${where},` : null;
}

/** The request body, as an object literal, or `{}` if it is not usable JSON. */
function dataArg(body: string | undefined): string {
  if (!body?.trim()) return "{}";
  try {
    return JSON.stringify(JSON.parse(body), null, 2).split("\n").join("\n  ");
  } catch {
    // Unparseable body: the fetch snippet sends it verbatim and the API
    // rejects it, so the SDK snippet should not pretend it is an object.
    return "{ /* the body above is not valid JSON */ }";
  }
}

/** The key an update sends the version of the read it was made from under. */
const VERSION_KEY = "_rev";
/** The key an update chooses to apply whatever the document holds under. */
const OVERWRITE_KEY = "_overwrite";

/** The body as an object, or `null` when it is not a JSON object. */
function bodyObject(body: string | undefined): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body?.trim() ? body : "{}");
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** An object as an object literal, indented to sit inside the call. */
function objectLiteral(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2).split("\n").join("\n  ");
}

/**
 * `data` as an object literal with `line`, the code that sends its version,
 * as its last entry: code rather than JSON, so it joins the literal as text.
 */
function withVersion(data: Record<string, unknown>, line: string): string {
  const literal =
    Object.keys(data).length === 0
      ? `{\n  ${line}\n}`
      : `${JSON.stringify(data, null, 2).slice(0, -2)},\n  ${line}\n}`;
  return literal.split("\n").join("\n  ");
}

/**
 * The data of an update made from a read: the body as typed when it already
 * names its version or chooses to overwrite, and otherwise the body with the
 * version of `current`, which the snippet reads first. An update that sends
 * a version is refused when the document changed since that read, rather
 * than writing over the change. The read answers `null` for a document it
 * cannot find, so the version is read through `?.`.
 */
function versionedData(
  body: string | undefined,
  /** The code that sends the version of `current`. */
  version = `"${VERSION_KEY}": current?.${VERSION_KEY}`
): {
  data: string;
  readsFirst: boolean;
} {
  const data = bodyObject(body);
  // Only `true` chooses to overwrite: `false` is the same as leaving it out.
  if (data === null || VERSION_KEY in data || data[OVERWRITE_KEY] === true) {
    return { data: dataArg(body), readsFirst: false };
  }
  return { data: withVersion(data, version), readsFirst: true };
}

/**
 * How a Single update sends the version of its read: a Single never stored
 * reads as `null`, with no version and nothing to overwrite, so its first
 * write sets it whatever is there.
 */
const SINGLE_VERSION = `...(current ? { ${VERSION_KEY}: current.${VERSION_KEY} } : { ${OVERWRITE_KEY}: true })`;

/**
 * The shape of a version a read returns: `7`, `7.es:3`, `7.en:2,es:3`. The
 * same shape the API judges a `_rev` by, with each language named once.
 */
const VERSION_SHAPE =
  /^(\d+)(?:\.([A-Za-z0-9_-]+:\d+(?:,[A-Za-z0-9_-]+:\d+)*))?$/;

function isVersion(raw: unknown): boolean {
  const match = typeof raw === "string" ? VERSION_SHAPE.exec(raw) : null;
  if (match === null || Number(match[1]) < 1) return false;
  const codes = (match[2]?.split(",") ?? []).map(part => part.split(":")[0]);
  return new Set(codes).size === codes.length;
}

/**
 * Why the API refuses a bulk body's `revs` whole, before writing anything,
 * or `null` when it takes them: the same checks, so the snippet never offers
 * calls that would write some ids of a request the API refuses.
 */
function revsRefusal(
  named: readonly string[],
  revs: Record<string, unknown>,
  data: Record<string, unknown>
): string | null {
  if (data[OVERWRITE_KEY] !== undefined && data[OVERWRITE_KEY] !== false) {
    return `\`revs\` and \`${OVERWRITE_KEY}\` say two different things`;
  }
  const extra = Object.keys(revs).filter(id => !named.includes(id));
  if (extra.length > 0) {
    return `\`revs\` gives a version for ${JSON.stringify(extra)}, which the update does not name`;
  }
  const missing = named.filter(id => !Object.hasOwn(revs, id));
  if (missing.length > 0) {
    return `\`revs\` gives no version for ${JSON.stringify(missing)}`;
  }
  const malformed = named.filter(id => !isVersion(revs[id]));
  if (malformed.length > 0) {
    return `\`revs\` gives ${JSON.stringify(malformed)} a value that is not a version a read returned`;
  }
  return null;
}

/** A bulk body's `revs`, the version it gives each id, when it gives any. */
function bulkRevs(
  body: Record<string, unknown> | null
): Record<string, unknown> | null {
  const revs = body?.revs;
  return revs !== null && typeof revs === "object" && !Array.isArray(revs)
    ? (revs as Record<string, unknown>)
    : null;
}

/** The ids a bulk action addresses, read out of its body. */
function bulkIds(body: string | undefined): string | null {
  if (!body?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    const ids = (parsed as { ids?: unknown }).ids;
    if (Array.isArray(ids)) return JSON.stringify(ids);
  } catch {
    // fall through
  }
  return null;
}

/**
 * The same operation, as the SDK call that performs it.
 *
 * Every action maps to the method that does its job, verified against the
 * direct API's own signatures. Bulk update has no `bulkUpdate` of its own —
 * `update` with a `where` is how the SDK expresses it, which is why the
 * snippet translates the REST body's ids into one.
 */
export function toSdk(req: CodeRequest): string {
  const head = [
    `import { getNextly } from "nextly";`,
    `import config from "@nextly-config";`,
    ``,
    `const nextly = await getNextly({ config });`,
    ``,
  ];

  const call = (body: string[]): string => [...head, ...body].join("\n");
  const slug = JSON.stringify(req.collection);
  const id = JSON.stringify(req.entryId || "entry-id");

  if (req.isSingle) return call(singleSdk(req, slug));

  switch (req.action) {
    case "create":
      return call([
        `const { item } = await nextly.create({`,
        `  collection: ${slug},`,
        `  data: ${dataArg(req.body)},`,
        `});`,
      ]);

    case "update":
      return call(updateSdk(req, slug, id));

    case "delete":
      return call([
        `await nextly.delete({`,
        `  collection: ${slug},`,
        `  id: ${id},`,
        `});`,
      ]);

    case "duplicate":
      return call([
        `const { item } = await nextly.duplicate({`,
        `  collection: ${slug},`,
        `  id: ${id},`,
        `});`,
      ]);

    case "count": {
      const where = whereArg(req.params.where);
      return call([
        `const { total } = await nextly.count({`,
        `  collection: ${slug},`,
        ...(where ? [where] : []),
        `});`,
      ]);
    }

    case "bulk-delete": {
      const ids = bulkIds(req.body);
      return call([
        `const result = await nextly.bulkDelete({`,
        `  collection: ${slug},`,
        `  ids: ${ids ?? '["id-1", "id-2"]'},`,
        `});`,
      ]);
    }

    case "bulk-update":
      return call(bulkUpdateSdk(req, slug));

    case "get":
      return call([
        `const item = await nextly.findByID({`,
        `  collection: ${slug},`,
        `  id: ${id},`,
        ...(numericArg("depth", req.params.depth)
          ? [numericArg("depth", req.params.depth) as string]
          : []),
        `});`,
      ]);

    case "list":
    default:
      return call(listSdk(req, slug));
  }
}

/** A Single's call: an update made from a read of it, or the read itself. */
function singleSdk(req: CodeRequest, slug: string): string[] {
  if (req.action === "update") {
    const { data, readsFirst } = versionedData(req.body, SINGLE_VERSION);
    return [
      // Read without creating it: a read that made the Single would leave
      // it behind if the update were then refused.
      ...(readsFirst
        ? [
            `const current = await nextly.findSingle({ slug: ${slug}, createIfMissing: false });`,
          ]
        : []),
      `const result = await nextly.updateSingle({`,
      `  slug: ${slug},`,
      `  data: ${data},`,
      `});`,
    ];
  }
  // `findSingle` takes slug, select and populate — not depth. Its own
  // JSDoc example shows `depth: 1`, which does not compile.
  return [
    `const result = await nextly.findSingle({`,
    `  slug: ${slug},`,
    `});`,
  ];
}

/** An entry's update, made from a read of it unless the body says otherwise. */
function updateSdk(req: CodeRequest, slug: string, id: string): string[] {
  const { data, readsFirst } = versionedData(req.body);
  return [
    ...(readsFirst
      ? [
          `const current = await nextly.findByID({ collection: ${slug}, id: ${id} });`,
        ]
      : []),
    `const { item } = await nextly.update({`,
    `  collection: ${slug},`,
    `  id: ${id},`,
    `  data: ${data},`,
    `});`,
  ];
}

/** A bulk update: one update per id with its version, or one by query. */
function bulkUpdateSdk(req: CodeRequest, slug: string): string[] {
  const ids = bulkIds(req.body);
  const body = bodyObject(req.body);
  const shared = body?.data;
  const data =
    shared !== null && typeof shared === "object" && !Array.isArray(shared)
      ? (shared as Record<string, unknown>)
      : {};
  const revs = bulkRevs(body);
  // A version for each id: the SDK's bulk form is an update by query,
  // which takes none, so each id is updated on its own with its version,
  // and refused alone if it changed since it was read, each answer kept
  // as the REST route reports each id's.
  if (revs !== null) {
    const named = Array.isArray(body?.ids)
      ? body.ids.map(String)
      : Object.keys(revs);
    // The REST route refuses the whole request, writing nothing, so no
    // call is offered that would write the ids it does give a version.
    const refused = revsRefusal(named, revs, data);
    if (refused !== null) {
      return [
        `// ${refused}, so the API refuses the whole request.`,
        `// Give each id it names the \`_rev\` a read of it returned.`,
      ];
    }
    return [
      `const revs: Record<string, string> = ${JSON.stringify(revs, null, 2)};`,
      `const results = await Promise.allSettled(`,
      `  ${ids ?? JSON.stringify(named)}.map(id =>`,
      `    nextly.update({`,
      `      collection: ${slug},`,
      `      id,`,
      `      data: ${withVersion(data, `"${VERSION_KEY}": revs[id]`).split("\n").join("\n    ")},`,
      `    })`,
      `  )`,
      `);`,
    ];
  }
  // No `bulkUpdate` on the SDK: `update` with a `where` is the bulk form,
  // so the ids the REST body carries become a `where` on id. An update by
  // query names no document whose version it could send, so it sets the
  // values over whatever each document holds, and says so.
  return [
    `const result = await nextly.update({`,
    `  collection: ${slug},`,
    `  where: { id: { in: ${ids ?? '["id-1", "id-2"]'} } },`,
    `  data: ${objectLiteral(OVERWRITE_KEY in data ? data : { ...data, [OVERWRITE_KEY]: true })},`,
    `});`,
  ];
}

/** A list read, with the filters, paging and sort the request gives. */
function listSdk(req: CodeRequest, slug: string): string[] {
  const args: string[] = [`  collection: ${slug},`];
  const where = whereArg(req.params.where);
  if (where) args.push(where);
  const limit = numericArg("limit", req.params.limit);
  if (limit) args.push(limit);
  const page = numericArg("page", req.params.page);
  if (page) args.push(page);
  if (req.params.sort) args.push(`  sort: ${JSON.stringify(req.params.sort)},`);
  const depth = numericArg("depth", req.params.depth);
  if (depth) args.push(depth);

  return [
    `const result = await nextly.find({`,
    ...args,
    `});`,
    ``,
    `result.items;      // the entries`,
    `result.meta.total; // how many there are in total`,
  ];
}

export interface CodeSnippets {
  curl: string;
  fetch: string;
  sdk: string;
}

/** Every flavour for the current request. */
export function generateCode(req: CodeRequest): CodeSnippets {
  return {
    curl: toCurl(req),
    fetch: toFetch(req),
    sdk: toSdk(req),
  };
}
