// @vitest-environment jsdom
/**
 * Everything the editor keeps of an author's choices in the browser is kept
 * through the admin's preference store, never in the browser's storage
 * directly: the admin's store is what holds the site's off switch and forgets
 * the person on sign-out, so a store beside it would go on writing where the
 * site keeps nothing and keep the last author's choices after they left.
 *
 * The admin's store is stood in for by one held in memory that records the
 * keys it is opened under. Each case asserts both sides: the write reaches
 * that store, under the author's own key and the right lifetime, and nothing
 * reaches the browser's storage, which is where a store that bypassed the
 * admin's would write. The recent icons are held the same way in
 * `recent-icons-store.test.ts`.
 */
import { CHECKLIST_STORAGE_KEY } from "@nextlyhq/builder/shell";
import { beforeEach, describe, expect, it, vi } from "vitest";

const port = vi.hoisted(() => ({
  held: new Map<string, string>(),
  opened: [] as { key: string; lifetime: string }[],
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  devicePreferenceStore: (
    key: string,
    options: { lifetime?: "device" | "tab" } = {}
  ) => {
    port.opened.push({ key, lifetime: options.lifetime ?? "device" });
    return {
      read: () => port.held.get(key) ?? null,
      write: (value: string) => {
        port.held.set(key, value);
      },
      remove: () => {
        port.held.delete(key);
      },
    };
  },
}));

import {
  checklistStoreFor,
  shellPreferenceStore,
} from "./editor-preference-stores";
import { recentPagesStore } from "./recent-pages";
import { templatePreviewStore } from "./template-preview-memory";

/** Every key in the browser's storage, both kinds. */
function browserKeys(): string[] {
  return [
    ...Object.keys(window.localStorage),
    ...Object.keys(window.sessionStorage),
  ];
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  port.held.clear();
  port.opened.length = 0;
});

describe("the editor's kept choices", () => {
  it("keeps the recent pages through the admin's store, per author", () => {
    recentPagesStore("u1").write("[]");
    expect(port.held.get("nextly:page-builder:recent-pages:u1")).toBe("[]");
    expect(port.opened).toEqual([
      { key: "nextly:page-builder:recent-pages:u1", lifetime: "device" },
    ]);
    expect(browserKeys()).toEqual([]);
  });

  it("keeps the template previews for the tab, through the admin's store", () => {
    templatePreviewStore("u1").write("[]");
    expect(port.opened).toEqual([
      { key: "nextly:page-builder:template-preview:u1", lifetime: "tab" },
    ]);
    expect(port.held.get("nextly:page-builder:template-preview:u1")).toBe("[]");
    expect(browserKeys()).toEqual([]);
  });

  it("keeps the shell's panels through the admin's store, per author", () => {
    shellPreferenceStore("u1").write("{}");
    expect(port.held.get("nextly.builder.shell:u1")).toBe("{}");
    expect(browserKeys()).toEqual([]);
  });

  it("keeps the getting-started card's dismissal through the admin's store", () => {
    checklistStoreFor("u1")?.write("1");
    expect(port.held.get(`${CHECKLIST_STORAGE_KEY}:u1`)).toBe("1");
    expect(browserKeys()).toEqual([]);
  });

  it("keeps nothing for nobody where the store is per author", () => {
    recentPagesStore(null).write("[]");
    templatePreviewStore(null).write("[]");
    shellPreferenceStore(null).write("{}");
    // No author, no card: the editor turns it off rather than keep it for
    // nobody.
    expect(checklistStoreFor(null)).toBeUndefined();
    expect(port.held.size).toBe(0);
    expect(browserKeys()).toEqual([]);
  });
});
