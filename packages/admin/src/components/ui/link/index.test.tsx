/**
 * The SPA Link intercepts clicks to route client-side, so it has to be careful
 * about which clicks it takes over: a modifier or middle click, another target,
 * a download, or an off-app href all mean the user asked for something the
 * router cannot do, and swallowing those silently breaks the link.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigateTo } from "@admin/lib/navigation";
import { preloadRoute } from "@admin/lib/route-preload";

import { Link } from "./index";

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/lib/route-preload", () => ({ preloadRoute: vi.fn() }));

function clickLink(init: Parameters<typeof fireEvent.click>[1] = {}) {
  const anchor = screen.getByRole("link");
  return fireEvent.click(anchor, { button: 0, ...init });
}

describe("Link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes a plain left click through the SPA router", () => {
    render(<Link href="/entries">Entries</Link>);

    const notCancelled = clickLink();

    expect(navigateTo).toHaveBeenCalledWith("/entries");
    // Returns false when preventDefault was called.
    expect(notCancelled).toBe(false);
  });

  it.each([
    ["meta (open in new tab)", { metaKey: true }],
    ["ctrl (open in new tab)", { ctrlKey: true }],
    ["shift (open in new window)", { shiftKey: true }],
    ["alt (download)", { altKey: true }],
    ["middle click", { button: 1 }],
  ])("leaves a %s click to the browser", (_label, init) => {
    render(<Link href="/entries">Entries</Link>);

    const notCancelled = clickLink(init);

    expect(navigateTo).not.toHaveBeenCalled();
    expect(notCancelled).toBe(true);
  });

  it("leaves a link targeting another context to the browser", () => {
    render(
      <Link href="/entries" target="_blank">
        Entries
      </Link>
    );

    clickLink();

    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("still routes when the target is explicitly _self", () => {
    render(
      <Link href="/entries" target="_self">
        Entries
      </Link>
    );

    clickLink();

    expect(navigateTo).toHaveBeenCalledWith("/entries");
  });

  it("leaves a download to the browser", () => {
    render(
      <Link href="/export.csv" download="export.csv">
        Export
      </Link>
    );

    clickLink();

    expect(navigateTo).not.toHaveBeenCalled();
  });

  it.each(["https://nextlyhq.com/docs", "//cdn.example.com/x", "mailto:a@b.c"])(
    "leaves the off-app href %s to the browser",
    href => {
      render(<Link href={href}>Docs</Link>);

      clickLink();

      expect(navigateTo).not.toHaveBeenCalled();
    }
  );

  it("runs the consumer's onClick and lets it cancel the navigation", () => {
    const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(
      <Link href="/entries" onClick={onClick}>
        Entries
      </Link>
    );

    clickLink();

    expect(onClick).toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("runs a non-cancelling onClick and still navigates", () => {
    const onClick = vi.fn();
    render(
      <Link href="/entries" onClick={onClick}>
        Entries
      </Link>
    );

    clickLink();

    expect(onClick).toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalledWith("/entries");
  });

  it.each([
    ["hovered", (a: HTMLElement) => fireEvent.mouseEnter(a)],
    ["focused", (a: HTMLElement) => fireEvent.focus(a)],
    ["touched", (a: HTMLElement) => fireEvent.touchStart(a)],
  ])("starts loading its page when %s", (_, act) => {
    render(<Link href="/admin/media">Media</Link>);
    act(screen.getByText("Media"));
    expect(preloadRoute).toHaveBeenCalledWith("/admin/media");
  });

  it("loads nothing ahead for a link out of the admin or a download", () => {
    render(
      <>
        <Link href="https://example.com">Out</Link>
        <Link href="/admin/export.csv" download>
          File
        </Link>
      </>
    );
    fireEvent.mouseEnter(screen.getByText("Out"));
    fireEvent.mouseEnter(screen.getByText("File"));
    expect(preloadRoute).not.toHaveBeenCalled();
  });
});
