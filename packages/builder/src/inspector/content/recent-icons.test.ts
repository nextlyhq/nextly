import { describe, expect, it } from "vitest";

import { readRecentIcons, rememberIcon } from "./recent-icons";

/** A store over one value, as the host's browser store is. */
function memory(initial: string | null = null) {
  let value = initial;
  return {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
    get value() {
      return value;
    },
  };
}

describe("the icons an author chose last", () => {
  it("reads nothing from no store, an empty one, or one holding anything else", () => {
    expect(readRecentIcons(undefined)).toEqual([]);
    expect(readRecentIcons(memory())).toEqual([]);
    expect(readRecentIcons(memory("not json"))).toEqual([]);
    expect(readRecentIcons(memory('{"a":1}'))).toEqual([]);
    // Only the strings of a list count.
    expect(readRecentIcons(memory('["lucide:star", 4, null]'))).toEqual([
      "lucide:star",
    ]);
  });

  it("remembers a choice first, once, and keeps eight", () => {
    const store = memory();
    let list = readRecentIcons(store);
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) {
      list = rememberIcon(store, list, `lucide:${name}`);
    }
    list = rememberIcon(store, list, "lucide:e");
    expect(list).toEqual([
      "lucide:e",
      "lucide:i",
      "lucide:h",
      "lucide:g",
      "lucide:f",
      "lucide:d",
      "lucide:c",
      "lucide:b",
    ]);
    expect(readRecentIcons(store)).toEqual(list);
  });

  it("still answers the list when the store refuses to write", () => {
    const refusing = {
      read: () => null,
      write: () => {
        throw new Error("quota");
      },
    };
    expect(rememberIcon(refusing, [], "lucide:star")).toEqual(["lucide:star"]);
  });
});
