/**
 * An address in a written email is saved only when it is complete: http or
 * https with a host, and for a link a mailto address with a recipient too.
 */
import { describe, expect, it } from "vitest";

import { addressProblem } from "../addresses";

describe("an address a written email can save", () => {
  it("takes a complete web address for a link and for an image", () => {
    expect(addressProblem("https://shop.example/o/1", "link")).toBeNull();
    expect(addressProblem(" http://cdn.example/a.png ", "image")).toBeNull();
  });

  it("takes a mail address for a link, never for an image", () => {
    expect(addressProblem("mailto:help@shop.example", "link")).toBeNull();
    expect(addressProblem("mailto:help@shop.example", "image")).not.toBeNull();
  });

  it("refuses what points nowhere a reader can follow", () => {
    for (const value of [
      "there",
      "shop.example",
      "/uploads/a.png",
      "https://",
      "https:///path",
      "mailto:",
      "javascript:alert(1)",
      "data:text/html,hi",
    ]) {
      expect(addressProblem(value, "link")).not.toBeNull();
    }
  });
});
