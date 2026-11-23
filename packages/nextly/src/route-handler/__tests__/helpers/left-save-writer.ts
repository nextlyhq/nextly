/**
 * Another process of a site, on the database the URL names, that sends entry writes and reads
 * while a Builder save is left part-way, and prints each outcome as one line of JSON.
 *
 * Each operation goes through REST, as the signed-in editor whose session cookie the environment
 * holds (`NEXTLY_TEST_COOKIE`), or through the Direct API. Run by
 * `left-save-holds-writes.integration.test.ts` through `tsx`, so this process runs the source,
 * not a build. Arguments: the dialect, the database URL, the app's folder, the collection's slug,
 * and the operations as JSON: `{ kind: "write" | "read"; via: "rest" | "api"; data? }`.
 */
import { createAdapter } from "../../../database/factory";
import { createTestNextly } from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

type Operation = {
  kind: "write" | "read";
  via: "rest" | "api";
  data?: Record<string, unknown>;
};

/** What one operation came to: whether it went through, and what it said. */
type Outcome = Operation & {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  items?: Array<Record<string, unknown>>;
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
const copy = await createTestNextly({ adapter: adapter as never, basePath });
const handlers = createDynamicHandlers();

/** A request to this process's admin API, as the signed-in editor. */
async function send(
  method: "GET" | "POST",
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
  };
}

/** The outcome of a Direct API call that threw: its code and its public message. */
function fromError(operation: Operation, error: unknown): Outcome {
  const e = error as { code?: string; publicMessage?: string; message?: string };
  return {
    ...operation,
    ok: false,
    ...(e.code === undefined ? {} : { code: e.code }),
    message: e.publicMessage ?? e.message ?? String(error),
  };
}

const outcomes: Outcome[] = [];
for (const operation of JSON.parse(operations) as Operation[]) {
  try {
    if (operation.via === "rest") {
      outcomes.push(
        await fromResponse(
          operation,
          operation.kind === "write"
            ? await send("POST", `/collections/${slug}/entries`, operation.data)
            : await send("GET", `/collections/${slug}/entries`)
        )
      );
    } else if (operation.kind === "write") {
      await copy.nextly.create({
        collection: slug,
        data: operation.data ?? {},
      } as never);
      outcomes.push({ ...operation, ok: true });
    } else {
      const found = (await copy.nextly.find({ collection: slug } as never)) as {
        items: Array<Record<string, unknown>>;
      };
      outcomes.push({ ...operation, ok: true, items: found.items });
    }
  } catch (error) {
    outcomes.push(fromError(operation, error));
  }
}
await copy.destroy();
process.stdout.write(`${JSON.stringify(outcomes)}\n`);
