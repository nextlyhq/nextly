/**
 * A set's own screen in the builder: its address, and the way back to the
 * page it was opened from, carried in it.
 */
import { describe, expect, it } from "vitest";

import { returnFromSearch, returnLabelFromSearch } from "./edit-component";
import { setBuilderAddress, setBuilderPath } from "./set-address";

describe("a set's address in the builder", () => {
  it("is under the set's own address", () => {
    expect(setBuilderPath("layouts", "a b")).toBe(
      "/admin/collections/layouts/a%20b/in-builder"
    );
  });

  it("carries the page it was opened from, without the section open there, and its name", () => {
    const address = setBuilderAddress(
      "layouts",
      "main",
      {
        pathname: "/admin/collections/pages/home/builder",
        search: "?field=content&section=s1",
      },
      "Home"
    );
    const search = address.slice(address.indexOf("?"));
    expect(
      address.startsWith("/admin/collections/layouts/main/in-builder?")
    ).toBe(true);
    expect(returnFromSearch(search)).toBe(
      "/admin/collections/pages/home/builder?field=content"
    );
    expect(returnLabelFromSearch(search)).toBe("Home");
  });
});
