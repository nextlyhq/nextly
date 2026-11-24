/**
 * Another server copy of a site, as its own process, that writes one entry while the test's copy
 * saves the collection: started on the database the URL names, it prints `ready`, waits for a line
 * on its input, writes the entry through the Direct API (`direct`) or the REST API as a signed-in
 * editor (`rest`, the session cookie in `NEXTLY_TEST_COOKIE`), and prints what the write ended
 * with as one line of JSON: `{ "ok": true }`, or the refusal's `code` and issues. Its own lines
 * start with `@writer `, apart from what the app logs.
 *
 * Before it prints `ready`, it writes and deletes one entry the same way (`warm`, data that sets
 * none of the fields the test removes), so the write it is told to make runs on paths already
 * loaded: a first write that loads them as it goes can reach the collection only after a save
 * the test races it against is over, and look held when it was only slow.
 *
 * Run by `delete-hold.integration.test.ts` through `tsx`, so the copy runs this source, not a
 * build. Arguments: the dialect, the database URL, the app's folder (the copies are one app), the
 * collection's slug, the way to write, the entry's data as JSON, and the warm-up entry's data as
 * JSON.
 */
import { createAdapter } from "../../../../database/factory";
import { createTestNextly } from "../../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../../routeHandler";

const [dialect, url, basePath, slug, way, data, warm] = process.argv.slice(2);
if (!dialect || !url || !basePath || !slug || !way || !data || !warm) {
  throw new Error(
    "usage: <dialect> <url> <app folder> <slug> <direct|rest> <data> <warm-up data>"
  );
}

const adapter = await createAdapter({ type: dialect, url } as Parameters<
  typeof createAdapter
>[0]);
const copy = await createTestNextly({ adapter: adapter as never, basePath });
// Its own lines carry a mark, apart from what the app logs to the same output.
const say = (line: string) => process.stdout.write(`@writer ${line}\n`);

/** A REST request to the collection's entries, as the signed-in editor sends it. */
function rest(method: "POST" | "DELETE", path: string[], body?: string) {
  const handlers = createDynamicHandlers();
  return handlers[method](
    new Request(`http://localhost/admin/api/${path.join("/")}`, {
      method,
      headers: {
        origin: "http://localhost",
        cookie: process.env.NEXTLY_TEST_COOKIE ?? "",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body }),
    }),
    { params: Promise.resolve({ params: path }) }
  );
}

// The warm-up: one entry written and deleted the way the raced write goes.
if (way === "direct") {
  const made = (await copy.nextly.create({
    collection: slug,
    data: JSON.parse(warm) as Record<string, unknown>,
  } as never)) as unknown as { item: { id: unknown } };
  await copy.nextly.delete({
    collection: slug,
    id: String(made.item.id),
  } as never);
} else {
  const made = (await (
    await rest("POST", ["collections", slug, "entries"], warm)
  ).json()) as { item?: { id?: unknown } };
  if (made.item?.id === undefined) throw new Error("the warm-up write failed");
  await rest("DELETE", [
    "collections",
    slug,
    "entries",
    String(made.item.id),
  ]);
}
say("ready");
// Sent once the test's save holds the collection.
await new Promise<void>(resolve => {
  process.stdin.once("data", () => resolve());
});

type Outcome =
  | { ok: true }
  | { code?: unknown; message?: unknown; errors?: unknown };
let outcome: Outcome;
try {
  if (way === "direct") {
    await copy.nextly.create({
      collection: slug,
      data: JSON.parse(data) as Record<string, unknown>,
    } as never);
    outcome = { ok: true };
  } else {
    const response = await rest(
      "POST",
      ["collections", slug, "entries"],
      data
    );
    const body = (await response.json().catch(() => ({}))) as {
      error?: {
        code?: unknown;
        message?: unknown;
        data?: { errors?: unknown };
      };
    };
    outcome =
      response.status < 300
        ? { ok: true }
        : {
            code: body.error?.code,
            message: body.error?.message,
            errors: body.error?.data?.errors,
          };
  }
} catch (error) {
  const refused = error as {
    code?: unknown;
    publicData?: { errors?: unknown };
  };
  outcome = { code: refused.code, errors: refused.publicData?.errors };
}
say(JSON.stringify(outcome));
await copy.destroy();
process.exit(0);
