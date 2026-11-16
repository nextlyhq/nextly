/**
 * The admin's one way of saying how many of something there are: a count
 * reads "1 draft" and "2 drafts", never "1 drafts".
 */
import { describe, expect, it } from "vitest";

import { countWord, plural } from "../count-words";

describe("plural", () => {
  it("says the singular for exactly one", () => {
    expect(plural(1, "draft")).toBe("1 draft");
  });

  it("says the plural for none and for more than one", () => {
    expect(plural(0, "draft")).toBe("0 drafts");
    expect(plural(2, "draft")).toBe("2 drafts");
  });

  it("takes an irregular plural", () => {
    expect(plural(1, "entry", "entries")).toBe("1 entry");
    expect(plural(3, "entry", "entries")).toBe("3 entries");
  });
});

describe("countWord", () => {
  it("is the word alone, for a count drawn apart from it", () => {
    expect(countWord(1, "draft")).toBe("draft");
    expect(countWord(0, "draft")).toBe("drafts");
    expect(countWord(2, "entry", "entries")).toBe("entries");
  });
});
