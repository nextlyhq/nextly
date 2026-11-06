/**
 * Every fetch a stylesheet makes, wherever it is written: the rules hold each
 * to the URL policy and the CSP check judges each, so one missed here is one
 * neither sees.
 *
 * @module site-code/css-urls.test
 */
import { describe, expect, it } from "vitest";

import { cssFetches } from "./css-urls";

describe("what a stylesheet fetches", () => {
  it("reads an import written as a url or as a plain string", () => {
    expect(cssFetches('@import "https://a.example/a.css";')).toEqual([
      { via: "import", url: "https://a.example/a.css" },
    ]);
    expect(cssFetches("@import url(https://a.example/a.css);")).toEqual([
      { via: "import", url: "https://a.example/a.css" },
    ]);
  });

  it("reads an import with conditions the parser keeps as text, and not their strings", () => {
    expect(
      cssFetches(
        '@import url(https://a.example/x.css) supports(font-family: "x");'
      )
    ).toEqual([{ via: "import", url: "https://a.example/x.css" }]);
    expect(
      cssFetches("@import url(https://a.example/x.css) layer(base) screen;")
    ).toEqual([{ via: "import", url: "https://a.example/x.css" }]);
  });

  it("reads fonts in @font-face and images everywhere else", () => {
    expect(
      cssFetches(
        "@font-face{font-family:x;src:url(https://f.example/x.woff2)} .a{background:url(https://i.example/a.png)}"
      )
    ).toEqual([
      { via: "font", url: "https://f.example/x.woff2" },
      { via: "image", url: "https://i.example/a.png" },
    ]);
  });

  it("reads image-set strings as images", () => {
    expect(
      cssFetches('.a{background:image-set("//i.example/a.png" 1x)}')
    ).toEqual([{ via: "image", url: "//i.example/a.png" }]);
  });

  it("reads a url inside text the parser does not model", () => {
    // A custom property, which var() can carry into a fetch.
    expect(cssFetches(".a{--x: url(//v.example/a.png)}")).toEqual([
      { via: "image", url: "//v.example/a.png" },
    ]);
    // An unknown function.
    expect(cssFetches(".a{width: expression(url(//e.example))}")).toEqual([
      { via: "image", url: "//e.example" },
    ]);
  });

  it("reads an escaped url as the browser decodes it", () => {
    expect(
      cssFetches(".a{background:url(\\2f\\2f esc.example/a.png)}")
    ).toEqual([{ via: "image", url: "//esc.example/a.png" }]);
  });

  it("finds nothing in a sheet that loads nothing", () => {
    expect(cssFetches('.a{color:red;content:"url(x)"}')).toEqual([]);
  });
});
