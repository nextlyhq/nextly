/**
 * The words every own-design surface shares: a collection's name inside a
 * sentence, and when an own design was last edited.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({}));

const { editedWhen, inSentence, OWN_DESIGN_WORDS } = await import(
  "./entry-designs-client"
);

describe("inSentence", () => {
  it("lowercases an ordinary word, and keeps a name or an acronym", () => {
    expect(inSentence("Post")).toBe("post");
    expect(inSentence("Blog post")).toBe("blog post");
    expect(inSentence("FAQ")).toBe("FAQ");
    expect(inSentence("iPhone guide")).toBe("iPhone guide");
    expect(inSentence("")).toBe("");
  });

  it("is what the offer says", () => {
    expect(OWN_DESIGN_WORDS.give("FAQ")).toBe("Give this FAQ its own design");
    expect(OWN_DESIGN_WORDS.someHave(1, "Post", "Posts")).toBe(
      "1 post has its own design"
    );
    expect(OWN_DESIGN_WORDS.someHave(3, "Post", "Posts")).toBe(
      "3 posts have their own design"
    );
  });
});

describe("editedWhen", () => {
  const now = new Date(2026, 10, 7, 15, 0);

  it("says today and yesterday by the calendar day, not by 24 hours", () => {
    expect(editedWhen(new Date(2026, 10, 7, 0, 5).toISOString(), now)).toBe(
      "today"
    );
    expect(editedWhen(new Date(2026, 10, 6, 23, 55).toISOString(), now)).toBe(
      "yesterday"
    );
  });

  it("says the date further back, and nothing where the row says nothing", () => {
    expect(editedWhen(new Date(2026, 9, 30, 9).toISOString(), now)).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(2026, 9, 30, 9)
      )
    );
    expect(editedWhen(null, now)).toBeNull();
    expect(editedWhen("not a date", now)).toBeNull();
  });
});
