// `setSearchParam` — the writer the admin did not have.
//
// The query was already read as state here (the entry list takes its filter
// from `?where=`), but nothing wrote one, so anything that belonged in the URL
// was kept in component state instead. These pin the properties that make it
// safe to put state there: the rest of the query survives, an unchanged write
// does nothing, and the default is a history entry the reader can undo.
import { describe, it, expect, beforeEach } from "vitest";

import { setSearchParam } from "../navigation";

const AT = "/admin/collections/posts/1";

describe("setSearchParam", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", AT);
  });

  it("adds a parameter without disturbing the path", () => {
    setSearchParam("locale", "de");
    expect(window.location.pathname).toBe(AT);
    expect(window.location.search).toBe("?locale=de");
  });

  it("keeps every other parameter", () => {
    // The list's filter and page live in the same query string, and losing them
    // on a language switch would silently reset what the reader was looking at.
    window.history.replaceState(null, "", `${AT}?where=%7B%7D&page=3`);
    setSearchParam("locale", "fr");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("where")).toBe("{}");
    expect(params.get("page")).toBe("3");
    expect(params.get("locale")).toBe("fr");
  });

  it("removes the parameter when given null", () => {
    window.history.replaceState(null, "", `${AT}?locale=de&page=2`);
    setSearchParam("locale", null);
    const params = new URLSearchParams(window.location.search);
    expect(params.get("locale")).toBeNull();
    expect(params.get("page")).toBe("2");
  });

  it("does nothing when the value is already set", () => {
    // A component that writes the parameter it just read would otherwise fill
    // the history with copies of one page, and the back button would appear
    // stuck.
    window.history.replaceState(null, "", `${AT}?locale=de`);
    const before = window.history.length;
    setSearchParam("locale", "de");
    expect(window.history.length).toBe(before);
    expect(window.location.search).toBe("?locale=de");
  });

  it("pushes by default, so the reader can go back", () => {
    const before = window.history.length;
    setSearchParam("locale", "de");
    expect(window.history.length).toBeGreaterThan(before);
  });

  it("replaces when asked, for a correction rather than a move", () => {
    const before = window.history.length;
    setSearchParam("locale", "de", { replace: true });
    expect(window.history.length).toBe(before);
    expect(window.location.search).toBe("?locale=de");
  });

  it("preserves the hash", () => {
    window.history.replaceState(null, "", `${AT}#section`);
    setSearchParam("locale", "de");
    expect(window.location.hash).toBe("#section");
  });
});
