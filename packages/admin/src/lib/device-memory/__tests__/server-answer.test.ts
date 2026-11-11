/**
 * The server's answer labels what the device kept, and an answer without a
 * permission version is no label at all: the menu and the schemas kept under
 * an earlier one are discarded and nothing labelled is kept on this page, as
 * nothing can say whether the person's access changed since.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const answer = vi.hoisted(() => ({ headers: null as Headers | null }));
vi.mock("@admin/lib/api/startup-request", () => ({
  startupResponseHeaders: () => Promise.resolve(answer.headers),
}));

import {
  confirmLabels,
  DEVICE_MEMORY_PREFIX,
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
