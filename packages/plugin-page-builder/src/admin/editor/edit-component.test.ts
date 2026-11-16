/**
 * "Edit component": the address of a component's own view, the way back, and
 * the check that keeps the way back inside the admin.
 *
 * The property a plausible implementation gets wrong is the way back: it
 * arrives in an address anyone can write, so a check that only looks at the
 * prefix lets `/admin/../` or a protocol-relative address through, and Back
 * becomes an open redirect.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  backAddress,
  checkedAdminPath,
  componentEditorAddress,
  hereAddress,
  isStoreRow,
  openDocument,
  returnFromSearch,
  returnLabelFromSearch,
} from "./edit-component";

describe("the component's own view", () => {
  it("is the builder view of its row, carrying where to go back to", () => {
    const address = componentEditorAddress(
      "components",
      "c 1",
      "/admin/collections/pages/p1/builder?field=content&section=placed"
    );
    expect(address).toBe(
      "/admin/collections/components/c%201/builder?return=%2Fadmin%2Fcollections%2Fpages%2Fp1%2Fbuilder%3Ffield%3Dcontent%26section%3Dplaced"
    );
    expect(returnFromSearch(address.slice(address.indexOf("?")))).toBe(
      "/admin/collections/pages/p1/builder?field=content&section=placed"
    );
  });

  it("names the field the definition lives in, so the view opens that one", () => {
    expect(componentEditorAddress("defs", "c1", undefined, "definition")).toBe(
      "/admin/collections/defs/c1/builder?field=definition"
    );
  });

  it("names no way back when there is none", () => {
    expect(componentEditorAddress("components", "c1", undefined)).toBe(
      "/admin/collections/components/c1/builder"
    );
    expect(returnFromSearch("")).toBeUndefined();
  });
});

describe("where Back says it goes", () => {
  it("is the name of the document left, carried beside the address", () => {
    const address = componentEditorAddress(
      "components",
      "c1",
      "/admin/collections/pages/p1/builder",
      "content",
      "Home page"
    );
    expect(address).toBe(
      "/admin/collections/components/c1/builder?field=content&return=%2Fadmin%2Fcollections%2Fpages%2Fp1%2Fbuilder&from=Home+page"
    );
    expect(returnLabelFromSearch(address.slice(address.indexOf("?")))).toBe(
      "Home page"
    );
  });

  it("is not carried without a way back, or with a blank name", () => {
    expect(
      componentEditorAddress("components", "c1", undefined, undefined, "Home")
    ).toBe("/admin/collections/components/c1/builder");
    expect(
      componentEditorAddress("components", "c1", "/admin/x", undefined, "  ")
    ).toBe("/admin/collections/components/c1/builder?return=%2Fadmin%2Fx");
  });

  it("is read as plain words: trimmed, one line, and bounded", () => {
    expect(returnLabelFromSearch("?from=%20%20About%0A%0Aus%20")).toBe(
      "About us"
    );
    expect(returnLabelFromSearch("?from=")).toBeUndefined();
    expect(returnLabelFromSearch("")).toBeUndefined();
    const long = returnLabelFromSearch(`?from=${"a".repeat(200)}`);
    expect(long?.length).toBeLessThanOrEqual(80);
    expect(long?.endsWith("…")).toBe(true);
  });
});

describe("the way back", () => {
  it("is taken only as a path of this admin", () => {
    expect(checkedAdminPath("/admin/collections/pages/p1/builder")).toBe(
      "/admin/collections/pages/p1/builder"
    );
    for (const outside of [
      "https://evil.example/admin/",
      "//evil.example/admin/",
      "/admin/../logout",
      "/admin/%2e%2e/logout",
      "/admin\\\\evil",
      "/admin/x\u0000y",
      "javascript:alert(1)",
      "/elsewhere",
    ]) {
      expect(checkedAdminPath(outside), outside).toBeUndefined();
    }
    expect(checkedAdminPath(null)).toBeUndefined();
  });

  it("returns to the placement when it is a section of the page", () => {
    const here = {
      pathname: "/admin/collections/pages/p1/builder",
      search: "?field=content",
    };
    expect(hereAddress(here, "placed")).toBe(
      "/admin/collections/pages/p1/builder?field=content&section=placed"
    );
    expect(hereAddress(here, undefined)).toBe(
      "/admin/collections/pages/p1/builder?field=content"
    );
  });

  it("drops a section the address already named, for a placement that is not one", () => {
    expect(
      hereAddress(
        {
          pathname: "/admin/collections/pages/p1/builder",
          search: "?field=content&section=old",
        },
        undefined
      )
    ).toBe("/admin/collections/pages/p1/builder?field=content");
  });
});

describe("Back from a component's view", () => {
  const here = {
    pathname: "/admin/collections/pages/p1/builder",
    search: "?field=content&section=hero",
  };

  it("keeps the address as it stands when no placement opened it", () => {
    // From the Components panel: the editor is open at the section its
    // address names, and Back returns there.
    expect(backAddress(here, undefined, () => false)).toBe(
      "/admin/collections/pages/p1/builder?field=content&section=hero"
    );
  });

  it("returns to a placement that is a section, and drops one that is not", () => {
    expect(backAddress(here, "placed", () => true)).toBe(
      "/admin/collections/pages/p1/builder?field=content&section=placed"
    );
    expect(backAddress(here, "inner", () => false)).toBe(
      "/admin/collections/pages/p1/builder?field=content"
    );
  });
});

describe("opening another document", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads an admin path afresh, and nothing else", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    openDocument("/admin/collections/components/c1/builder");
    openDocument("https://evil.example/admin/");
    expect(assign.mock.calls).toEqual([
      ["/admin/collections/components/c1/builder"],
    ]);
  });
});

describe("a row of the component store", () => {
  const store = { collection: "components", field: "content" };
  const row = { kind: "collection", slug: "components" };

  it("is an entry of the collection definitions live in, in their field", () => {
    expect(isStoreRow(row, store, "content")).toBe(true);
  });

  it("is not another field of the same entry", () => {
    expect(isStoreRow(row, store, "draftContent")).toBe(false);
  });

  it("is not an entry of another collection, a Single, or anything unknown", () => {
    expect(
      isStoreRow({ kind: "collection", slug: "widgets" }, store, "content")
    ).toBe(false);
    expect(
      isStoreRow({ kind: "single", slug: "components" }, store, "content")
    ).toBe(false);
    expect(isStoreRow(null, store, "content")).toBe(false);
    expect(isStoreRow(row, undefined, "content")).toBe(false);
  });
});
