/**
 * Another process of a site, on the database the URL names, that sends entry writes and reads
 * while a Builder save is left part-way, and prints each outcome as one line of JSON.
 *
 * Each operation goes through REST, as the signed-in editor whose session cookie the environment
 * holds (`NEXTLY_TEST_COOKIE`), or through the Direct API. Run by
 * `left-save-holds-writes.integration.test.ts` through `tsx`, so this process runs the source,
 * not a build. Arguments: the dialect, the database URL, the app's folder, the collection's slug,
 * and the operations as JSON: `{ kind: "write" | "read" | "update" | "single-write" |
 * "single-read"; via: "rest" | "api"; data?; id?; slug?; depth? }`, an update naming the entry it
 * changes, `slug` another collection or a Single to send it to, a read's `depth` how far it
 * populates relationships, and `locale` the language it is sent in. The site's languages are the
 * environment's (`NEXTLY_TEST_LOCALES`, the default one first). A read may filter: `query` as REST
 * takes it, `where` as the Direct API does. `registry-moved` moves the stored schema version, as a registry write
 * anywhere does, so the next request loads every definition again from the registry rows. `request`
 * makes its `within` operations in one request, and `pause` stops until the test lets it go on.
 * `settle` settles the Builder saves left part-way, as this process's development start does; the
 * environment then names the project's migration folder and definition (`NEXTLY_TEST_MIGRATIONS`,
 * `NEXTLY_TEST_DEFINITION`).
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runWithAccessMemo } from "../../../auth/access/request-memo";
import { createAdapter } from "../../../database/factory";
import { settleLeftSaves } from "../../../domains/schema/builder-save/settle-left-save";
import { settleRegistryWriter } from "../../../domains/schema/builder-save/settle-registry";
import { writeRegistryRows } from "../../../domains/schema/schema-version";
import { createTestNextly } from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

type Operation = {
  kind:
    | "write"
    | "read"
    | "update"
    | "single-write"
    | "single-read"
    | "delete"
    | "registry-moved"
    | "pause"
    | "settle"
    | "request";
  via: "rest" | "api";
  data?: Record<string, unknown>;
  /** A pause's files: the one it writes once reached, and the one it waits for. */
  reached?: string;
  until?: string;
  /** What a request does, one after the other, all in the one request. */
  within?: Operation[];
  /** The entry an update changes. */
  id?: string;
  /** The collection, or the Single, the operation goes to, where not the one named on the line. */
  slug?: string;
  /** How far a read populates relationships. */
  depth?: number;
  /** The language the operation is sent in. */
  locale?: string;
  /** What a read filters by: REST's query as written, and the same as the Direct API takes it. */
  query?: string;
  where?: Record<string, unknown>;
};

/** What one operation came to: whether it went through, and what it said. */
type Outcome = Operation & {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  /** A thrown error's message with each cause it carries, for a case to name when it fails. */
  detail?: string;
  items?: Array<Record<string, unknown>>;
  /** What a Single read answered. */
  item?: Record<string, unknown>;
};

const ORIGIN = "http://localhost";

const [dialect, url, basePath, slug, operations] = process.argv.slice(2);
if (!dialect || !url || !basePath || !slug || !operations) {
  throw new Error(
    "usage: <dialect> <url> <app folder> <slug> <operations as JSON>"
  );
}

const adapter = await createAdapter({ type: dialect, url } as Parameters<
  typeof createAdapter
>[0]);
const locales = (process.env.NEXTLY_TEST_LOCALES ?? "")
  .split(",")
  .filter(Boolean);
const migrationsDir = process.env.NEXTLY_TEST_MIGRATIONS;
const uiSchemaFile = process.env.NEXTLY_TEST_DEFINITION;
const copy = await createTestNextly({
  adapter: adapter as never,
  basePath,
  ...(migrationsDir === undefined || uiSchemaFile === undefined
    ? {}
    : { db: { migrationsDir, uiSchemaFile } }),
  ...(locales.length === 0
    ? {}
    : { localization: { locales, defaultLocale: locales[0] as string } }),
});
const handlers = createDynamicHandlers();

/** A request to this process's admin API, as the signed-in editor. */
async function send(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<Response> {
  const target = new URL(`${ORIGIN}/admin/api${path}`);
  const params = target.pathname
    .slice("/admin/api/".length)
    .split("/")
    .filter(Boolean);
  return handlers[method](
    new Request(target, {
      method,
      headers: {
        origin: ORIGIN,
        cookie: process.env.NEXTLY_TEST_COOKIE ?? "",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params }) }
  );
}

/** The outcome of a REST response: its status, and its error's code and message where it failed. */
async function fromResponse(
  operation: Operation,
  response: Response
): Promise<Outcome> {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { message: text };
  }
  const error = (body.error ?? {}) as { code?: string; message?: string };
  return {
    ...operation,
    ok: response.status < 300,
    status: response.status,
    ...(error.code === undefined ? {} : { code: error.code }),
    message: error.message ?? String(body.message ?? ""),
    ...(Array.isArray(body.items)
      ? { items: body.items as Array<Record<string, unknown>> }
      : {}),
    // A Single's document comes back bare.
    ...(operation.kind === "single-read" && response.status < 300
      ? { item: body }
      : {}),
  };
}

/** An error's message with each cause it carries. */
function causesOf(error: unknown): string {
  const chain: string[] = [];
  for (
    let cause = error, depth = 0;
    cause !== undefined && depth < 6;
    depth++
  ) {
    const { message, sqlMessage, logContext } = (cause ?? {}) as {
      message?: string;
      sqlMessage?: string;
      logContext?: unknown;
    };
    chain.push(
      [message, sqlMessage, logContext && JSON.stringify(logContext)]
        .filter(Boolean)
        .join(" / ")
    );
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return chain.join(" <- ");
}

/** The outcome of a Direct API call that threw: its code, its public message and its causes. */
function fromError(operation: Operation, error: unknown): Outcome {
  const e = error as {
    code?: string;
    publicMessage?: string;
    message?: string;
  };
  return {
    ...operation,
    ok: false,
    ...(e.code === undefined ? {} : { code: e.code }),
    message: e.publicMessage ?? e.message ?? String(error),
    detail: causesOf(error),
  };
}

/** The REST request an operation makes, to `target`. */
function restOf(operation: Operation, target: string): Promise<Response> {
  const inLanguage =
    operation.locale === undefined ? "" : `?locale=${operation.locale}`;
  switch (operation.kind) {
    case "write":
      return send(
        "POST",
        `/collections/${target}/entries${inLanguage}`,
        operation.data
      );
    case "update":
      return send(
        "PATCH",
        `/collections/${target}/entries/${operation.id ?? ""}${inLanguage}`,
        operation.data
      );
    case "single-write":
      return send("PATCH", `/singles/${target}`, operation.data);
    case "single-read":
      return send("GET", `/singles/${target}`);
    case "delete":
      return send(
        "DELETE",
        `/collections/${target}/entries/${operation.id ?? ""}`
      );
    default:
      return send(
        "GET",
        `/collections/${target}/entries?${[
          ...(operation.depth === undefined
            ? []
            : [`depth=${operation.depth}`]),
          ...(operation.locale === undefined
            ? []
            : [`locale=${operation.locale}`]),
          ...(operation.query === undefined ? [] : [operation.query]),
        ].join("&")}`
      );
  }
}

/** The language an operation is sent in, as the Direct API takes it. */
const languageOf = (operation: Operation) =>
  operation.locale === undefined ? {} : { locale: operation.locale };

/** The Direct API call an operation makes, to `target`, and what it answered. */
async function apiOf(operation: Operation, target: string): Promise<Outcome> {
  const data = operation.data ?? {};
  switch (operation.kind) {
    case "update":
      await copy.nextly.update({
        collection: target,
        id: operation.id,
        data,
        ...languageOf(operation),
      } as never);
      return { ...operation, ok: true };
    case "write":
      await copy.nextly.create({
        collection: target,
        data,
        ...languageOf(operation),
      } as never);
      return { ...operation, ok: true };
    case "pause": {
      writeFileSync(operation.reached ?? "", "reached");
      const giveUp = Date.now() + 120_000;
      while (!existsSync(operation.until ?? "") && Date.now() < giveUp) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return { ...operation, ok: existsSync(operation.until ?? "") };
    }
    case "settle": {
      const settled = await settleLeftSaves({
        adapter: copy.adapter,
        projectRoot: basePath as string,
        migrationsDir: join(basePath as string, migrationsDir ?? ""),
        logger: { info: () => undefined, warn: () => undefined },
        writeRegistry: settleRegistryWriter(copy.adapter),
      });
      return {
        ...operation,
        ok: settled.length > 0 && settled.every(one => one.outcome !== "left"),
        message: settled.map(one => one.outcome).join(","),
      };
    }
    case "registry-moved":
      await writeRegistryRows(copy.adapter, () => Promise.resolve());
      return { ...operation, ok: true };
    case "delete":
      await copy.nextly.delete({
        collection: target,
        id: operation.id,
      } as never);
      return { ...operation, ok: true };
    case "single-write":
      await copy.nextly.updateSingle({ slug: target, data } as never);
      return { ...operation, ok: true };
    case "single-read":
      return {
        ...operation,
        ok: true,
        item: (await copy.nextly.findSingle({
          slug: target,
        } as never)) as Record<string, unknown>,
      };
    default: {
      const found = (await copy.nextly.find({
        collection: target,
        ...(operation.depth === undefined ? {} : { depth: operation.depth }),
        ...(operation.where === undefined ? {} : { where: operation.where }),
        ...languageOf(operation),
      } as never)) as { items: Array<Record<string, unknown>> };
      return { ...operation, ok: true, items: found.items };
    }
  }
}

/** Make one operation and keep what it came to; a request's own, each after the other within it. */
async function make(operation: Operation, outcomes: Outcome[]): Promise<void> {
  if (operation.kind === "request") {
    await runWithAccessMemo(async () => {
      for (const each of operation.within ?? []) await make(each, outcomes);
    });
    return;
  }
  const target = operation.slug ?? slug ?? "";
  try {
    outcomes.push(
      operation.via === "rest"
        ? await fromResponse(operation, await restOf(operation, target))
        : await apiOf(operation, target)
    );
  } catch (error) {
    outcomes.push(fromError(operation, error));
  }
}

const outcomes: Outcome[] = [];
for (const operation of JSON.parse(operations) as Operation[]) {
  await make(operation, outcomes);
}
await copy.destroy();
process.stdout.write(`${JSON.stringify(outcomes)}\n`);
