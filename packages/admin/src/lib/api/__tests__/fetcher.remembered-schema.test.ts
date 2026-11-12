// @vitest-environment jsdom

/**
 * A schema read and the device memory: the answer is kept with its tag, the
 * next read asks "has it changed?" with that tag, and an "unchanged" (304) is
 * answered with the kept body. Any other read sends no tag and keeps nothing,
 * so an entry is never answered from the device.
 *
 * Observed through the shared fetcher's real calls with `fetch` stood in for,
 * so each case reads the headers that reached the network.
 *
 * A read belongs to the session it was sent in: its answer arriving after the
 * person signed out and the next one signed in is not kept under the next
 * person's labels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmLabels,
  DEVICE_MEMORY_PREFIX,
  forgetPerson,
  recallSchema,
  resetDeviceMemoryForTests,
} from "../../device-memory/device-memory";
import { fetcher } from "../fetcher";
import { resetStartupRequestForTests } from "../startup-request";

const fetchSpy = vi.fn();
const SCHEMA = { name: "posts", fields: [{ name: "title", type: "text" }] };

const tagged = (body: unknown, etag: string) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", etag },
  });

/** The `If-None-Match` each request sent, in order. */
const sentTags = () =>
  fetchSpy.mock.calls.map(
    ([, init]) =>
      (init?.headers as Record<string, string> | undefined)?.["If-None-Match"]
  );

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceMemoryForTests();
  resetStartupRequestForTests();
  confirmLabels({ user: "u1", schemaVersion: "3", permissionVersion: "p" });
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a schema read", () => {
  it("keeps the answer with its tag, and answers the next read's 304 with it", async () => {
    fetchSpy
      .mockResolvedValueOnce(tagged(SCHEMA, 'W/"one"'))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));

    expect(await fetcher("/collections/posts", {}, true)).toEqual(SCHEMA);
    expect(recallSchema("/collections/posts")?.etag).toBe('W/"one"');

    expect(await fetcher("/collections/posts", {}, true)).toEqual(SCHEMA);
    expect(sentTags()).toEqual([undefined, 'W/"one"']);
  });

  it("takes a changed answer in full, and keeps it in place of the old", async () => {
    const changed = { ...SCHEMA, fields: [] };
    fetchSpy
      .mockResolvedValueOnce(tagged(SCHEMA, 'W/"one"'))
      .mockResolvedValueOnce(tagged(changed, 'W/"two"'));

    await fetcher("/collections/posts", {}, true);
    expect(await fetcher("/collections/posts", {}, true)).toEqual(changed);
    expect(recallSchema("/collections/posts")).toEqual({
      etag: 'W/"two"',
      body: changed,
    });
  });
});

describe("any other read", () => {
  it("sends no tag and keeps nothing, an entry's above all", async () => {
    const entry = { id: "1", title: "Hello" };
    fetchSpy
      .mockResolvedValueOnce(tagged(entry, 'W/"e"'))
      .mockResolvedValueOnce(tagged(entry, 'W/"e"'));

    await fetcher("/collections/posts/entries/1", {}, true);
    await fetcher("/collections/posts/entries/1", {}, true);

    expect(sentTags()).toEqual([undefined, undefined]);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });
});

describe("a schema read answered after the person signed out", () => {
  it("is not kept under the labels of the person who signed in next", async () => {
    let answerNow: (response: Response) => void = () => {};
    fetchSpy.mockReturnValueOnce(
      new Promise<Response>(resolve => {
        answerNow = resolve;
      })
    );
    const reading = fetcher("/collections/posts", {}, true);
    forgetPerson();
    confirmLabels({ user: "u2", schemaVersion: "3", permissionVersion: "p" });
    answerNow(tagged(SCHEMA, 'W/"one"'));
    await reading;

    expect(recallSchema("/collections/posts")).toBeUndefined();
    expect(
      Object.keys(window.localStorage).filter(key =>
        key.startsWith(DEVICE_MEMORY_PREFIX)
      )
    ).toEqual([]);
  });
});
