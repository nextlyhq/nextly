// @vitest-environment jsdom
/**
 * The collections and the custom sources the inspector asks for on every
 * selection, kept for the signed-in author's session: what is read, how
 * often, and when it is read again.
 *
 * The properties that fail quietly are the ACCESS ones: an answer read with
 * one author's access handed to the next person on the tab, or a collection
 * the author may no longer read still offered. Each is shown with the
 * route's answer changing underneath, so a kept answer would be caught. The
 * reads go through the SDK's `readPluginRoute`, and the schema version
 * through its `schemaVersion` and `onSchemaChange`, all stood in for here.
 *
 * @module admin/session-answers.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  readPluginRoute: vi.fn(),
  writePluginRoute: vi.fn(),
  version: undefined as number | undefined,
  listeners: new Set<(version: number) => void>(),
}));
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  readPluginRoute: sdk.readPluginRoute,
  writePluginRoute: sdk.writePluginRoute,
  schemaVersion: () => sdk.version,
  onSchemaChange: (listener: (version: number) => void) => {
    sdk.listeners.add(listener);
    return () => sdk.listeners.delete(listener);
  },
}));

type Clients = typeof import("./loop-collections-client") &
  typeof import("./named-queries-client");

/** The clients, fresh: nothing kept from another case. */
async function freshClients(): Promise<Clients> {
  vi.resetModules();
  return {
    ...(await import("./loop-collections-client")),
    ...(await import("./named-queries-client")),
  };
}

/** The schema moving to `version`, as the admin learns of it. */
function schemaMovesTo(version: number): void {
  sdk.version = version;
  for (const listener of [...sdk.listeners]) listener(version);
}

/** A collection as the loop collections route lists it. */
function collection(slug: string) {
  return { slug, label: slug, fields: [], relations: [] };
}

/** A custom source as the named queries route lists it. */
function source(name: string) {
  return {
    declaration: { name, label: name, reads: {}, rows: {} },
    readsHidden: [],
  };
}

/** The route answering `slugs` to a loop collections read, `names` to sources. */
function routeAnswers(slugs: string[], names: string[] = []): void {
  sdk.readPluginRoute.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(
      path.startsWith("/loop-collections")
        ? { items: slugs.map(collection), meta: {} }
        : { items: names.map(source), meta: {} }
    )
  );
}

/** How many reads of `route` the server was asked. */
function readsOf(route: string): number {
  return sdk.readPluginRoute.mock.calls.filter(([request]) =>
    (request as { path: string }).path.startsWith(route)
  ).length;
}

/** The slugs a read answered. */
async function slugsOf(
  read: () => Promise<readonly { slug: string }[]>
): Promise<string[]> {
  return (await read()).map(each => each.slug);
}

beforeEach(() => {
  sdk.readPluginRoute.mockReset();
  sdk.version = 7;
  sdk.listeners.clear();
});

describe("selecting blocks asks the server nothing again", () => {
  it("two selections make one read of the collections and one of the custom sources", async () => {
    const { loopCollectionsIn, canvasNamedQueriesIn } = await freshClients();
    routeAnswers(["posts"], ["latest"]);
    // Each selection mounts the inspector's controls, which ask both reads.
    for (let selection = 0; selection < 2; selection += 1) {
      await loopCollectionsIn("en", "author-a")();
      await canvasNamedQueriesIn("en", "author-a").sources();
    }
    expect(readsOf("/loop-collections")).toBe(1);
    expect(readsOf("/named-queries")).toBe(1);
  });

  it("hands the same read again, so the builder shows its answer in the first frame", async () => {
    const { loopCollectionsIn } = await freshClients();
    routeAnswers(["posts"]);
    const first = loopCollectionsIn("en", "author-a")();
    await first;
    expect(loopCollectionsIn("en", "author-a")()).toBe(first);
  });

  it("shares a read still on its way", async () => {
    const { loopCollectionsIn } = await freshClients();
    routeAnswers(["posts"]);
    const read = loopCollectionsIn("en", "author-a");
    await Promise.all([read(), read()]);
    expect(readsOf("/loop-collections")).toBe(1);
  });

  it("keeps each language's answer apart", async () => {
    const { loopCollectionsIn } = await freshClients();
    routeAnswers(["posts"]);
    await loopCollectionsIn("en", "author-a")();
    await loopCollectionsIn("fr", "author-a")();
    expect(readsOf("/loop-collections")).toBe(2);
  });

  it("keeps no failure: the next selection reads again", async () => {
    const { loopCollectionsIn } = await freshClients();
    sdk.readPluginRoute.mockRejectedValueOnce(new Error("offline"));
    await expect(loopCollectionsIn("en", "author-a")()).rejects.toThrow();
    routeAnswers(["posts"]);
    expect(await slugsOf(loopCollectionsIn("en", "author-a"))).toEqual([
      "posts",
    ]);
    expect(readsOf("/loop-collections")).toBe(2);
  });
});

describe("one author's answer is never another's", () => {
  it("another author signed in reads again, and sees only their own collections", async () => {
    const { loopCollectionsIn } = await freshClients();
    routeAnswers(["posts", "salaries"]);
    expect(await slugsOf(loopCollectionsIn("en", "author-a"))).toEqual([
      "posts",
      "salaries",
    ]);
    // The second author may read fewer collections.
    routeAnswers(["posts"]);
    expect(await slugsOf(loopCollectionsIn("en", "author-b"))).toEqual([
      "posts",
    ]);
    expect(readsOf("/loop-collections")).toBe(2);
  });

  it("an identity change drops the first author's answers, the custom sources too", async () => {
    const { loopCollectionsIn, canvasNamedQueriesIn } = await freshClients();
    routeAnswers(["posts"], ["latest"]);
    await loopCollectionsIn("en", "author-a")();
    await canvasNamedQueriesIn("en", "author-a").sources();
    await loopCollectionsIn("en", "author-b")();
    // Back to the first author: what was kept for them went with the change.
    await loopCollectionsIn("en", "author-a")();
    await canvasNamedQueriesIn("en", "author-a").sources();
    expect(readsOf("/loop-collections")).toBe(3);
    expect(readsOf("/named-queries")).toBe(2);
  });

  it("a sign-out drops what was kept, and the next selection reads again", async () => {
    const { loopCollectionsIn, canvasNamedQueriesIn } = await freshClients();
    routeAnswers(["posts", "salaries"], ["latest"]);
    await loopCollectionsIn("en", "author-a")();
    await canvasNamedQueriesIn("en", "author-a").sources();
    // Signed out: nobody is known.
    await loopCollectionsIn("en", null)();
    // Signed in again, with a collection since taken away.
    routeAnswers(["posts"], []);
    expect(await slugsOf(loopCollectionsIn("en", "author-a"))).toEqual([
      "posts",
    ]);
    expect(await canvasNamedQueriesIn("en", "author-a").sources()).toEqual([]);
  });

  it("keeps nothing while nobody is known", async () => {
    const { loopCollectionsIn, canvasNamedQueriesIn } = await freshClients();
    routeAnswers(["posts"], ["latest"]);
    for (let selection = 0; selection < 2; selection += 1) {
      await loopCollectionsIn("en", null)();
      await canvasNamedQueriesIn("en", null).sources();
    }
    expect(readsOf("/loop-collections")).toBe(2);
    expect(readsOf("/named-queries")).toBe(2);
  });

  it("never hands a read on its way under one author to the next", async () => {
    const { loopCollectionsIn } = await freshClients();
    let answerFirst: (body: unknown) => void = () => {};
    sdk.readPluginRoute.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          answerFirst = resolve;
        })
    );
    const first = loopCollectionsIn("en", "author-a")();
    routeAnswers(["posts"]);
    const second = loopCollectionsIn("en", "author-b")();
    expect(second).not.toBe(first);
    answerFirst({ items: [collection("salaries")], meta: {} });
    expect((await second).map(each => each.slug)).toEqual(["posts"]);
  });
});

describe("a schema change reads again", () => {
  it("a collection created after the answer is offered on the next selection", async () => {
    const { loopCollectionsIn, canvasNamedQueriesIn } = await freshClients();
    routeAnswers(["posts"], ["latest"]);
    await loopCollectionsIn("en", "author-a")();
    await canvasNamedQueriesIn("en", "author-a").sources();
    routeAnswers(["posts", "events"], ["latest"]);
    schemaMovesTo(8);
    expect(await slugsOf(loopCollectionsIn("en", "author-a"))).toEqual([
      "posts",
      "events",
    ]);
    await canvasNamedQueriesIn("en", "author-a").sources();
    expect(readsOf("/loop-collections")).toBe(2);
    expect(readsOf("/named-queries")).toBe(2);
  });

  it("a removed collection disappears on the next selection", async () => {
    const { loopCollectionsIn } = await freshClients();
    routeAnswers(["posts", "salaries"]);
    await loopCollectionsIn("en", "author-a")();
    routeAnswers(["posts"]);
    schemaMovesTo(8);
    expect(await slugsOf(loopCollectionsIn("en", "author-a"))).toEqual([
      "posts",
    ]);
  });

  it("reads again on a version it was not told of, by the answer's label", async () => {
    const { loopCollectionsIn } = await freshClients();
    routeAnswers(["posts"]);
    await loopCollectionsIn("en", "author-a")();
    // The version moved with no word: the label alone says the answer is old.
    sdk.version = 9;
    await loopCollectionsIn("en", "author-a")();
    expect(readsOf("/loop-collections")).toBe(2);
  });

  it("keeps an answer whose read crossed the change, labelled with the new version", async () => {
    const { loopCollectionsIn } = await freshClients();
    sdk.readPluginRoute.mockImplementationOnce(() => {
      // The response that carries the answer announces the new version.
      schemaMovesTo(8);
      return Promise.resolve({ items: [collection("posts")], meta: {} });
    });
    await loopCollectionsIn("en", "author-a")();
    await loopCollectionsIn("en", "author-a")();
    expect(readsOf("/loop-collections")).toBe(1);
  });
});
