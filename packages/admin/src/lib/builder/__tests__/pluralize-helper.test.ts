// Why: lock the public surface of our pluralize wrapper so we can swap
// the underlying library later without breaking call sites. Also pins
// the regular + irregular + uncountable behaviors we care about.
import { describe, expect, it } from "vitest";

import { pluralizeName } from "../pluralize-helper";

describe("pluralizeName", () => {
  it("handles regular nouns", () => {
    expect(pluralizeName("Post")).toBe("Posts");
    expect(pluralizeName("Article")).toBe("Articles");
  });

  it("handles -y -> -ies", () => {
    expect(pluralizeName("Category")).toBe("Categories");
    expect(pluralizeName("Story")).toBe("Stories");
  });

  it("handles -s / -x / -ch / -sh -> -es", () => {
    expect(pluralizeName("Bus")).toBe("Buses");
    expect(pluralizeName("Box")).toBe("Boxes");
    expect(pluralizeName("Branch")).toBe("Branches");
    expect(pluralizeName("Brush")).toBe("Brushes");
  });

  it("handles irregular nouns", () => {
    expect(pluralizeName("Person")).toBe("People");
    expect(pluralizeName("Child")).toBe("Children");
    expect(pluralizeName("Mouse")).toBe("Mice");
  });

  it("handles uncountables (returns same word)", () => {
    expect(pluralizeName("Information")).toBe("Information");
    expect(pluralizeName("Series")).toBe("Series");
  });

  it("preserves capitalisation of the input", () => {
    expect(pluralizeName("BLOG")).toBe("BLOGS");
    expect(pluralizeName("blog")).toBe("blogs");
  });

  it("returns empty string for empty input", () => {
    expect(pluralizeName("")).toBe("");
  });

  it("handles whitespace-only input as empty", () => {
    expect(pluralizeName("   ")).toBe("");
  });
});
