/**
 * What Page settings show of a page's own code: the Code tab for someone who
 * may change the site's settings, General's line for anyone else where the
 * page holds code, and nothing where the builder's field can't hold any.
 */
import { describe, expect, it } from "vitest";

import { holdsPageCode, pageCodeShown } from "./page-code-shown";

const CODE = { head: "<meta name=a content=b>" };

describe("what Page settings show of a page's own code", () => {
  it("holds code only on a page's own top-level field", () => {
    expect(holdsPageCode("body")).toBe(true);
    expect(holdsPageCode("hero.body")).toBe(false);
    expect(holdsPageCode("sections[0].body")).toBe(false);
  });

  it("shows the tab to someone who may change the site's settings", () => {
    expect(pageCodeShown({ held: undefined, mayManageSite: true })).toBe("tab");
    expect(pageCodeShown({ held: CODE, mayManageSite: true })).toBe("tab");
  });

  it("tells anyone else only that the page adds code, where it does", () => {
    expect(pageCodeShown({ held: CODE, mayManageSite: false })).toBe("line");
    expect(
      pageCodeShown({ held: { body: "<p>a</p>" }, mayManageSite: false })
    ).toBe("line");
    expect(pageCodeShown({ held: undefined, mayManageSite: false })).toBe(
      "none"
    );
    expect(
      pageCodeShown({ held: { head: "", body: "" }, mayManageSite: false })
    ).toBe("none");
  });

  it("tells anyone else the page adds CSS of its own too, where it does", () => {
    expect(
      pageCodeShown({
        held: undefined,
        css: "h1 { color: teal; }",
        mayManageSite: false,
      })
    ).toBe("line");
    expect(
      pageCodeShown({ held: undefined, css: "", mayManageSite: false })
    ).toBe("none");
  });
});
