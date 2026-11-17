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

describe("a template named in a sentence", () => {
  it("is named once, whether or not its title ends in the word", () => {
    expect(OWN_DESIGN_WORDS.openTemplate("Blog post")).toBe(
      "Open the Blog post template"
    );
    // A new template's own title, "<Singular> template".
    expect(OWN_DESIGN_WORDS.openTemplate("Post template")).toBe(
      "Open the Post template"
    );
    // Only the word itself: a title merely ending in the letters keeps it.
    expect(OWN_DESIGN_WORDS.openTemplate("Stenciltemplate")).toBe(
      "Open the Stenciltemplate template"
    );
  });

  it("is how every sentence naming the template says it", () => {
    expect(OWN_DESIGN_WORDS.openTemplate("Post template")).toBe(
      "Open the Post template"
    );
    expect(OWN_DESIGN_WORDS.unpublishedWarning("Post template")).toBe(
      "Visitors still see the Post template until you publish this design."
    );
    expect(
      OWN_DESIGN_WORDS.noPublishedTemplate("Post", "Posts", "Post template")
    ).toBe(
      "The Post template isn't published yet, so this post isn't shown as a page on the site."
    );
    expect(OWN_DESIGN_WORDS.publishedSays("Post", "Post template")).toBe(
      "Visitors see this post's own design. Changes to the Post template don't reach it."
    );
    expect(
      OWN_DESIGN_WORDS.removeSays("Field notes", "Post template", "Posts")
    ).toBe(
      '"Field notes" will be shown with the Post template again. The own design and its history are deleted.'
    );
    expect(OWN_DESIGN_WORDS.unpublishedExplained("Post template")).toBe(
      "Not published yet: visitors see the Post template"
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
