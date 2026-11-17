// @vitest-environment jsdom

/**
 * The notice above the canvas when the site's own layout and a header &
 * footer set both draw around the page: said once a session, with a link to
 * the docs, and never on a site that says it draws its header in code.
 *
 * @module admin/editor/double-header-notice.test
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DoubleHeaderNotice,
  readSiteHeaderFooter,
  SITE_HEADER_FOOTER_DOCS_HREF,
} from "./double-header-notice";

const WORDS =
  "This site also draws a header in its code, so visitors may see two. Set the site to draw its header in code, or remove the code header.";

const BOTH = { before: true, after: true } as const;
const NOTHING = { before: false, after: false } as const;

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function notice(): HTMLElement | null {
  return screen.queryByText(WORDS, { exact: false });
}

describe("the double-header notice", () => {
  it("says so once, with a link to the docs, when the site and a set both draw", () => {
    render(
      <DoubleHeaderNotice
        siteChrome={BOTH}
        setDrawn={true}
        siteHeaderFooter="page-builder"
      />
    );
    const shown = screen.getByRole("status");
    expect(shown.textContent).toContain(WORDS);
    const link = screen.getByRole("link", {
      name: "Details about a site that draws its header in code (opens in a new tab)",
    });
    expect(link.getAttribute("href")).toBe(SITE_HEADER_FOOTER_DOCS_HREF);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("counts a site footer alone as the site drawing its own", () => {
    render(
      <DoubleHeaderNotice
        siteChrome={{ before: false, after: true }}
        setDrawn={true}
        siteHeaderFooter="page-builder"
      />
    );
    expect(notice()).not.toBeNull();
  });

  it("says nothing when only one of them draws", () => {
    const { rerender } = render(
      <DoubleHeaderNotice
        siteChrome={NOTHING}
        setDrawn={true}
        siteHeaderFooter="page-builder"
      />
    );
    expect(notice()).toBeNull();
    rerender(
      <DoubleHeaderNotice
        siteChrome={BOTH}
        setDrawn={false}
        siteHeaderFooter="page-builder"
      />
    );
    expect(notice()).toBeNull();
    // Nothing shown, so nothing was used up: the first double still says so.
    rerender(
      <DoubleHeaderNotice
        siteChrome={BOTH}
        setDrawn={true}
        siteHeaderFooter="page-builder"
      />
    );
    expect(notice()).not.toBeNull();
  });

  it("says nothing on a site that draws its header and footer in code", () => {
    render(
      <DoubleHeaderNotice
        siteChrome={BOTH}
        setDrawn={true}
        siteHeaderFooter="code"
      />
    );
    expect(notice()).toBeNull();
  });

  it("is said once a session: another page opened later says nothing", () => {
    const first = render(
      <DoubleHeaderNotice
        siteChrome={BOTH}
        setDrawn={true}
        siteHeaderFooter="page-builder"
      />
    );
    expect(notice()).not.toBeNull();
    first.unmount();
    render(
      <DoubleHeaderNotice
        siteChrome={BOTH}
        setDrawn={true}
        siteHeaderFooter="page-builder"
      />
    );
    expect(notice()).toBeNull();
  });

  it("still says so where the browser keeps no session storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(
      <DoubleHeaderNotice
        siteChrome={BOTH}
        setDrawn={true}
        siteHeaderFooter="page-builder"
      />
    );
    expect(notice()).not.toBeNull();
  });
});

describe("who draws the header and footer, as the editor reads it", () => {
  it("is the site's code only when the config says so", () => {
    expect(readSiteHeaderFooter({ siteHeaderFooter: "code" })).toBe("code");
    expect(readSiteHeaderFooter({ siteHeaderFooter: "page-builder" })).toBe(
      "page-builder"
    );
    expect(readSiteHeaderFooter({})).toBe("page-builder");
    expect(readSiteHeaderFooter(undefined)).toBe("page-builder");
  });
});
