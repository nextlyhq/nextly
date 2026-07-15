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

import type { HttpMethod } from "./APIPlayground";

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
export function toSdk(req: CodeRequest): string {
  const head = [
    `import { getNextly } from "nextly";`,
    `import config from "@nextly-config";`,
    ``,
    `const nextly = await getNextly({ config });`,
    ``,
  ];

  if (req.isSingle) {
    return [
      ...head,
      `const result = await nextly.findSingle({`,
      `  slug: ${JSON.stringify(req.collection)},`,
      `});`,
    ].join("\n");
  }

  const args: string[] = [`  collection: ${JSON.stringify(req.collection)},`];

  if (req.params.where) {
    const where = formatWhere(req.params.where);
    if (where) args.push(`  where: ${where},`);
  }
  if (req.params.limit) args.push(`  limit: ${Number(req.params.limit)},`);
  if (req.params.page) args.push(`  page: ${Number(req.params.page)},`);
  if (req.params.sort) args.push(`  sort: ${JSON.stringify(req.params.sort)},`);
  if (req.params.depth) args.push(`  depth: ${Number(req.params.depth)},`);

  return [
    ...head,
    `const result = await nextly.find({`,
    ...args,
    `});`,
    ``,
    `result.items;      // the entries`,
    `result.meta.total; // how many there are in total`,
  ].join("\n");
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
