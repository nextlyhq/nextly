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

  if (req.isSingle) {
    if (req.action === "update") {
      return call([
        `const result = await nextly.updateSingle({`,
        `  slug: ${slug},`,
        `  data: ${dataArg(req.body)},`,
        `});`,
      ]);
    }
    // `findSingle` takes slug, select and populate — not depth. Its own
    // JSDoc example shows `depth: 1`, which does not compile.
    return call([
      `const result = await nextly.findSingle({`,
      `  slug: ${slug},`,
      `});`,
    ]);
  }

  switch (req.action) {
    case "create":
      return call([
        `const { item } = await nextly.create({`,
        `  collection: ${slug},`,
        `  data: ${dataArg(req.body)},`,
        `});`,
      ]);

    case "update":
      return call([
        `const { item } = await nextly.update({`,
        `  collection: ${slug},`,
        `  id: ${id},`,
        `  data: ${dataArg(req.body)},`,
        `});`,
      ]);

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

    case "bulk-update": {
      // No `bulkUpdate` on the SDK: `update` with a `where` is the bulk form,
      // so the ids the REST body carries become a `where` on id.
      const ids = bulkIds(req.body);
      let data = "{}";
      try {
        const parsed = JSON.parse(req.body ?? "{}") as { data?: unknown };
        if (parsed.data)
          data = JSON.stringify(parsed.data, null, 2).split("\n").join("\n  ");
      } catch {
        // leave the empty object
      }
      return call([
        `const result = await nextly.update({`,
        `  collection: ${slug},`,
        `  where: { id: { in: ${ids ?? '["id-1", "id-2"]'} } },`,
        `  data: ${data},`,
        `});`,
      ]);
    }

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
    default: {
      const args: string[] = [`  collection: ${slug},`];
      const where = whereArg(req.params.where);
      if (where) args.push(where);
      const limit = numericArg("limit", req.params.limit);
      if (limit) args.push(limit);
      const page = numericArg("page", req.params.page);
      if (page) args.push(page);
      if (req.params.sort)
        args.push(`  sort: ${JSON.stringify(req.params.sort)},`);
      const depth = numericArg("depth", req.params.depth);
      if (depth) args.push(depth);

      return call([
        `const result = await nextly.find({`,
        ...args,
        `});`,
        ``,
        `result.items;      // the entries`,
        `result.meta.total; // how many there are in total`,
      ]);
    }
  }
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
