/**
 * The server's answer labels what the device kept, and an answer without a
 * permission version is no label at all: the menu and the schemas kept under
 * an earlier one are discarded and nothing labelled is kept on this page, as
 * nothing can say whether the person's access changed since.
 *
 * An answer belongs to the session it was asked for in: one that arrives
 * after the person was forgotten (they signed out while it was on its way)
 * labels nothing, so nothing of theirs is kept again. Each such case has a
 * twin where the answer arrives just as late with nobody forgotten, which
 * does label, so the held answer is seen to reach the labelling at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const answer = vi.hoisted(() => ({
  headers: null as Headers | null | Promise<Headers | null>,
}));
vi.mock("@admin/lib/api/startup-request", () => ({
  startupResponseHeaders: () => Promise.resolve(answer.headers),
  // The request a page without a startup answer sends for its headers: not
  // answered here, so only the startup answer's headers label anything.
  sendStartupRequest: () => Promise.reject(new TypeError("offline")),
}));

import {
  confirmLabels,
  DEVICE_MEMORY_PREFIX,
  forgetPerson,
  recallMenu,
  recallSchema,
  rememberMenu,
  rememberSchema,
  resetDeviceMemoryForTests,
  type RememberedMenu,
} from "../device-memory";
import { confirmDeviceMemory } from "../server-answer";

const MENU: RememberedMenu = {
  rail: [{ id: "dashboard", label: "Dashboard", href: "/admin" }],
  parts: { collections: true, singles: false },
  collections: [{ slug: "posts", label: "Posts" }],
  singles: [],
};

/** A menu and a schema kept by an earlier page, under these labels. */
function keptEarlier(): void {
  confirmLabels({ user: "u1", schemaVersion: "3", permissionVersion: "p1" });
  rememberMenu(MENU);
  rememberSchema("/collections/posts", 'W/"t"', { name: "posts" });
  resetDeviceMemoryForTests();
}

const memoryKeys = () =>
  Object.keys(window.localStorage).filter(key =>
    key.startsWith(DEVICE_MEMORY_PREFIX)
  );

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceMemoryForTests();
});

describe("the server's answer", () => {
  it("keeps what matches every label it gives", async () => {
    keptEarlier();
    answer.headers = new Headers({
      "X-Nextly-Device-Memory": "on",
      "X-Nextly-Schema-Version": "3",
      "X-Nextly-Permission-Version": "p1",
    });
    await confirmDeviceMemory("u1");
    expect(recallMenu()).toEqual(MENU);
    expect(recallSchema("/collections/posts")).toBeDefined();
  });

  it("discards the menu and schemas when it gives no permission version", async () => {
    keptEarlier();
    answer.headers = new Headers({
      "X-Nextly-Device-Memory": "on",
      "X-Nextly-Schema-Version": "3",
    });
    await confirmDeviceMemory("u1");

    expect(memoryKeys()).toEqual([]);
    expect(recallMenu()).toBeUndefined();
    expect(recallSchema("/collections/posts")).toBeUndefined();
    // And keeps nothing labelled on this page.
    expect(rememberMenu(MENU)).toBe(false);
    expect(memoryKeys()).toEqual([]);
  });
});

/** Headers giving every label, and remembering on. */
const fullAnswer = () =>
  new Headers({
    "X-Nextly-Device-Memory": "on",
    "X-Nextly-Schema-Version": "3",
    "X-Nextly-Permission-Version": "p1",
  });

/** A value the test hands over when it chooses. */
function held<T>(): { promise: Promise<T>; release: (value: T) => void } {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

describe("an answer that arrives late", () => {
  it("labels nothing once the person was forgotten while it was on its way", async () => {
    const headers = held<Headers | null>();
    answer.headers = headers.promise;
    const confirming = confirmDeviceMemory("u1");
    forgetPerson();
    headers.release(fullAnswer());
    await confirming;

    expect(rememberMenu(MENU)).toBe(false);
    expect(
      rememberSchema("/collections/posts", 'W/"t"', { name: "posts" })
    ).toBe(false);
    expect(memoryKeys()).toEqual([]);
  });

  it("labels nothing once the person was forgotten while their id was on its way", async () => {
    answer.headers = fullAnswer();
    const user = held<string>();
    const confirming = confirmDeviceMemory(user.promise);
    forgetPerson();
    user.release("u1");
    await confirming;

    expect(rememberMenu(MENU)).toBe(false);
    expect(memoryKeys()).toEqual([]);
  });

  it("labels the session it was asked for in when nobody was forgotten", async () => {
    const headers = held<Headers | null>();
    answer.headers = headers.promise;
    const user = held<string>();
    const confirming = confirmDeviceMemory(user.promise);
    user.release("u1");
    headers.release(fullAnswer());
    await confirming;

    expect(rememberMenu(MENU)).toBe(true);
    expect(recallMenu()).toEqual(MENU);
  });
});
