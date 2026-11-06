/**
 * "Recent" in the title switcher: newest first, one entry per page, the page
 * being edited left out, and a store that refuses never breaking the editor.
 */
import { describe, expect, it } from "vitest";

import {
  readRecentPages,
  recentToOffer,
  rememberPage,
  RECENT_PAGES_SHOWN,
  withRecentPage,
  type RecentPage,
} from "./recent-pages";

function page(id: string, collection = "pages"): RecentPage {
  return { collection, id, field: "content", title: `Page ${id}` };
}

/** A store held in memory, as a browser's would be. */
function memory(initial: string | null = null) {
  let value = initial;
  return {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
  };
}

describe("recent pages", () => {
  it("puts the page opened last first, once, whatever it was before", () => {
    const list = [page("a"), page("b"), page("c")];
    expect(withRecentPage(list, page("b")).map(p => p.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("tells pages in different collections apart", () => {
    const list = withRecentPage([page("a", "pages")], page("a", "landing"));
    expect(list).toHaveLength(2);
  });

  it("keeps enough to offer a full list without the page being edited", () => {
    let list: RecentPage[] = [];
    for (const id of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      list = withRecentPage(list, page(id));
    }
    // The current page is first; leaving it out still leaves a full list.
    const offered = recentToOffer(list, page("8"));
    expect(offered).toHaveLength(RECENT_PAGES_SHOWN);
    expect(offered.map(p => p.id)).toEqual(["7", "6", "5", "4", "3"]);
  });

  it("remembers through the store, and reads nothing from a damaged one", () => {
    const store = memory();
    rememberPage(store, page("a"));
    rememberPage(store, page("b"));
    expect(readRecentPages(store).map(p => p.id)).toEqual(["b", "a"]);

    expect(readRecentPages(memory("not json"))).toEqual([]);
    expect(readRecentPages(memory('[{"id":1}]'))).toEqual([]);
  });

  it("never throws when the store refuses to write", () => {
    const refusing = {
      read: () => null,
      write: () => {
        throw new Error("quota");
      },
    };
    expect(() => rememberPage(refusing, page("a"))).not.toThrow();
  });
});
