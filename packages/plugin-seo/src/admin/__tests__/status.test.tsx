// @vitest-environment jsdom
/**
 * The side panel's one read-only SEO line, as the SEO tab tells it what it
 * found: listed with a count to fix, hidden by the page, or hidden with its
 * whole type, and nothing until the tab has said.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { publishSeoStatus, SeoStatusSection, statusKeyOf } from "../status";

const CONTEXT = { userId: "u1", collection: "posts", entryId: "e1" };
const KEY = statusKeyOf(CONTEXT);

afterEach(() => {
  publishSeoStatus(KEY, null);
  cleanup();
});

function line() {
  return render(<SeoStatusSection context={CONTEXT} {...({} as never)} />);
}

describe("the side panel's SEO line", () => {
  it("says nothing until the tab has said what it found", () => {
    line();
    expect(screen.queryByTestId("seo-status")).toBeNull();
  });

  it("says what there is to check, and that a page with nothing to check is listed", () => {
    line();
    act(() =>
      publishSeoStatus(KEY, { listing: "listed", count: 2, typeLabel: "Post" })
    );
    expect(screen.getByTestId("seo-status")).toHaveTextContent(/^2 to check$/);
    act(() =>
      publishSeoStatus(KEY, { listing: "listed", count: 0, typeLabel: "Post" })
    );
    expect(screen.getByTestId("seo-status")).toHaveTextContent(/^Listed$/);
  });

  it("says the page is hidden, by itself or with its whole type", () => {
    line();
    act(() =>
      publishSeoStatus(KEY, { listing: "page", count: 0, typeLabel: "Tag" })
    );
    expect(screen.getByTestId("seo-status")).toHaveTextContent(
      "Hidden from search"
    );
    act(() =>
      publishSeoStatus(KEY, { listing: "type", count: 0, typeLabel: "Tag" })
    );
    expect(screen.getByTestId("seo-status")).toHaveTextContent(
      "Hidden · all tag pages"
    );
  });
});
