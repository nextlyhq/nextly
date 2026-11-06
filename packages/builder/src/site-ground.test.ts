// @vitest-environment jsdom

/**
 * The scheme the page under the editor's marks is drawn in, read from what it
 * paints rather than from what it declares.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { pageSchemeOf } from "./site-ground";

/** A root inside a body, with the computed styles a browser would report. */
function page(styles: {
  root?: string;
  body?: string;
  html?: string;
  scheme?: string;
  prefersDark?: boolean;
}): HTMLElement {
  // A fresh spy each time: a second spy over the first would read its own
  // replacement as the real one.
  vi.restoreAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById("root");
  if (root === null) throw new Error("no root");
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
    const computed = real(element);
    const background =
      element === root
        ? styles.root
        : element === document.body
          ? styles.body
          : element === document.documentElement
            ? styles.html
            : undefined;
    return new Proxy(computed, {
      get(target, property) {
        if (property === "backgroundColor") {
          return background ?? "rgba(0, 0, 0, 0)";
        }
        if (property === "colorScheme") return styles.scheme ?? "normal";
        return Reflect.get(target, property);
      },
    });
  });
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("dark") && styles.prefersDark === true,
      }) as MediaQueryList
  );
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pageSchemeOf", () => {
  it("reads a light page as light although it declares light dark and dark is preferred", () => {
    // A site offering a dark set declares both schemes; the page in front of
    // the author is still light, and the marks over it want the deep hues.
    expect(
      pageSchemeOf(
        page({
          body: "rgb(241, 241, 241)",
          scheme: "light dark",
          prefersDark: true,
        })
      )
    ).toBe("light");
  });

  it("reads a dark page as dark from the ground the root paints", () => {
    expect(pageSchemeOf(page({ root: "rgb(17, 20, 24)" }))).toBe("dark");
  });

  it("looks past a translucent tint to the opaque ground beneath it", () => {
    expect(
      pageSchemeOf(
        page({ root: "rgba(0, 0, 0, 0.06)", body: "rgb(255, 255, 255)" })
      )
    ).toBe("light");
  });

  it("composites a heavy tint over the ground beneath, which can cross into dark", () => {
    // 80% black over white is rgb(51, 51, 51): a dark ground, which skipping
    // the tint would read as the white beneath it.
    expect(
      pageSchemeOf(
        page({ root: "rgba(0, 0, 0, 0.8)", body: "rgb(255, 255, 255)" })
      )
    ).toBe("dark");
    // And the other way: 80% white over a dark ground is light.
    expect(
      pageSchemeOf(
        page({ root: "rgba(255, 255, 255, 0.8)", body: "rgb(17, 20, 24)" })
      )
    ).toBe("light");
  });

  it("composites tints in paint order, the ancestor's first", () => {
    // The body's 90% black over the white html gives rgb(26, 26, 26), and the
    // root's 60% white over that gives rgb(163, 163, 163): light. Composited
    // the other way round, the black would land last and read dark.
    expect(
      pageSchemeOf(
        page({
          root: "rgba(255, 255, 255, 0.6)",
          body: "rgba(0, 0, 0, 0.9)",
          html: "rgb(255, 255, 255)",
        })
      )
    ).toBe("light");
  });

  it("composites a tint over the document's own canvas when nothing beneath paints", () => {
    expect(
      pageSchemeOf(page({ root: "rgba(0, 0, 0, 0.8)", scheme: "light" }))
    ).toBe("dark");
  });

  it("falls back to the scheme the document's canvas uses when nothing paints", () => {
    expect(pageSchemeOf(page({ scheme: "dark" }))).toBe("dark");
    expect(pageSchemeOf(page({ scheme: "light" }))).toBe("light");
    expect(
      pageSchemeOf(page({ scheme: "light dark", prefersDark: true }))
    ).toBe("dark");
    expect(
      pageSchemeOf(page({ scheme: "light dark", prefersDark: false }))
    ).toBe("light");
  });
});
