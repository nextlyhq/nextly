/**
 * The admin shows its own favicon inside a host app whose root layout has
 * icons of its own. Those icons belong to React: Next.js renders them from the
 * layout's metadata, and React updates them when the layout changes. If the
 * admin removes one, React later fails with "Cannot read properties of null
 * (reading 'removeChild')", which a hot reload of the layout turned into
 * hundreds of page errors. These tests render host icons through React, as
 * Next does, for each relation a browser takes a favicon from, and hold the
 * admin to switching them off rather than removing them.
 */
import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useFaviconInjection } from "../useFaviconInjection";

const ADMIN_ICON = "data:image/svg+xml;utf8,admin";
const ICON_RELATIONS = ["icon", "shortcut icon", "apple-touch-icon"] as const;

/** A host icon React renders and owns; React hoists it into <head>. */
function HostIcon({
  href,
  rel = "icon",
  ...data
}: {
  href: string;
  rel?: string;
  "data-nextly-rel"?: string;
}) {
  return <link rel={rel} href={href} sizes="any" {...data} />;
}

/** The icon links the browser would pick from now, under any of the three relations. */
const activeIcons = () =>
  Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(
      ICON_RELATIONS.map(rel => `link[rel="${rel}"]`).join(", ")
    )
  );
const hrefs = () => activeIcons().map(link => link.getAttribute("href"));

/** Lets the hook's observer see a change React just made to <head>. */
const observed = () => Promise.resolve();

afterEach(() => {
  // React unmounts its icons first; clearing <head> under it would be the very
  // removal these tests forbid.
  cleanup();
  document.head.innerHTML = "";
});

describe.each(ICON_RELATIONS)("a host %j link and the admin's favicon", rel => {
  it("lets React update and remove its own link after the admin replaced it", () => {
    const host = render(<HostIcon rel={rel} href="/favicon.ico" />);
    const hostLink = document.head.querySelector('link[href="/favicon.ico"]');
    expect(hostLink, "React hoists the host link into <head>").not.toBeNull();
    renderHook(() => useFaviconInjection(ADMIN_ICON));

    // What a hot reload of the layout does to the link React owns: React
    // updates its own node in place, which stays switched off.
    expect(() =>
      host.rerender(<HostIcon rel={rel} href="/favicon-2.ico" />)
    ).not.toThrow();
    expect(hostLink?.getAttribute("href")).toBe("/favicon-2.ico");
    expect(hrefs()).toEqual([ADMIN_ICON]);

    expect(() => host.unmount()).not.toThrow();
    expect(hostLink?.isConnected).toBe(false);
    expect(hrefs()).toEqual([ADMIN_ICON]);
  });

  it("shows only the admin's icon while mounted, and gives the host its link back after", () => {
    render(<HostIcon rel={rel} href="/favicon.ico" />);
    const hostLink = document.head.querySelector('link[href="/favicon.ico"]');

    const admin = renderHook(() => useFaviconInjection(ADMIN_ICON));
    expect(hrefs()).toEqual([ADMIN_ICON]);
    expect(hostLink?.isConnected).toBe(true);

    admin.unmount();
    expect(hrefs()).toEqual(["/favicon.ico"]);
    expect(hostLink?.getAttribute("rel")).toBe(rel);
  });

  it("switches off a host link React adds after the admin's icon is shown", async () => {
    const admin = renderHook(() => useFaviconInjection(ADMIN_ICON));

    render(<HostIcon rel={rel} href="/late.ico" />);
    await observed();

    expect(hrefs()).toEqual([ADMIN_ICON]);
    admin.unmount();
    expect(hrefs()).toEqual(["/late.ico"]);
  });
});

describe("the admin's favicon", () => {
  it("keeps a host link switched off when React changes its relation, and restores the new one", async () => {
    const host = render(<HostIcon rel="icon" href="/favicon.ico" />);
    const admin = renderHook(() => useFaviconInjection(ADMIN_ICON));

    host.rerender(<HostIcon rel="apple-touch-icon" href="/favicon.ico" />);
    await observed();

    expect(hrefs()).toEqual([ADMIN_ICON]);
    admin.unmount();
    expect(
      document.head
        .querySelector('link[href="/favicon.ico"]')
        ?.getAttribute("rel")
    ).toBe("apple-touch-icon");
  });

  it("leaves the host's own data on its links untouched", () => {
    render(
      <HostIcon href="/favicon.ico" data-nextly-rel="the host's own value" />
    );
    const hostLink = document.head.querySelector('link[href="/favicon.ico"]');

    const admin = renderHook(() => useFaviconInjection(ADMIN_ICON));
    admin.unmount();

    expect(hostLink?.getAttribute("data-nextly-rel")).toBe(
      "the host's own value"
    );
  });

  it("restores a link that arrived and changed its relation in one go", async () => {
    const admin = renderHook(() => useFaviconInjection(ADMIN_ICON));
    const late = document.createElement("link");
    late.rel = "icon";
    late.href = "/late.ico";
    document.head.appendChild(late);
    late.rel = "apple-touch-icon";
    await observed();

    expect(hrefs()).toEqual([ADMIN_ICON]);
    admin.unmount();
    expect(late.rel).toBe("apple-touch-icon");
  });

  it("leaves a second admin provider's icon on", async () => {
    renderHook(() => useFaviconInjection(ADMIN_ICON));
    renderHook(() => useFaviconInjection("/second-admin.png"));
    await observed();

    expect(hrefs().sort()).toEqual(["/second-admin.png", ADMIN_ICON].sort());
  });

  it("keeps the host's icon off until the last admin provider unmounts", async () => {
    render(<HostIcon href="/favicon.ico" />);
    const first = renderHook(() => useFaviconInjection(ADMIN_ICON));
    const second = renderHook(() => useFaviconInjection("/second-admin.png"));
    await observed();

    // The provider that switched the host's icon off goes first. Read before
    // any observer runs: the host's icon must not come back even for a moment,
    // since a browser may fetch and show it as soon as its `rel` names an icon.
    first.unmount();
    expect(hrefs()).toEqual(["/second-admin.png"]);

    second.unmount();
    expect(hrefs()).toEqual(["/favicon.ico"]);
  });

  it("keeps a single admin icon when the branding changes it", () => {
    render(<HostIcon href="/favicon.ico" />);
    const admin = renderHook(({ href }) => useFaviconInjection(href), {
      initialProps: { href: ADMIN_ICON },
    });

    admin.rerender({ href: "/brand.png" });

    expect(hrefs()).toEqual(["/brand.png"]);
  });

  it("leaves the host's icon off throughout a branding change", async () => {
    render(<HostIcon href="/favicon.ico" />);
    const admin = renderHook(({ href }) => useFaviconInjection(href), {
      initialProps: { href: ADMIN_ICON },
    });
    await observed();
    const hostLink = document.head.querySelector('link[href="/favicon.ico"]');
    // Every `rel` the host's link is given, even one undone in the same commit:
    // a browser may fetch the host's icon the moment its `rel` names one.
    const relsGiven: (string | null)[] = [];
    const watcher = new MutationObserver(records =>
      records.forEach(record => relsGiven.push(record.oldValue))
    );
    watcher.observe(hostLink as Node, {
      attributes: true,
      attributeFilter: ["rel"],
      attributeOldValue: true,
    });

    admin.rerender({ href: "/brand.png" });
    await observed();
    watcher.disconnect();

    expect(relsGiven).toEqual([]);
    expect(hrefs()).toEqual(["/brand.png"]);
  });

  it("shows one admin icon, then the host's again, under Strict Mode", () => {
    render(<HostIcon href="/favicon.ico" />);
    // Strict Mode runs every effect's setup and cleanup an extra time in
    // development, which the icon's effect and its `href` effect must survive.
    const admin = renderHook(({ href }) => useFaviconInjection(href), {
      initialProps: { href: ADMIN_ICON },
      reactStrictMode: true,
    });
    expect(hrefs()).toEqual([ADMIN_ICON]);

    admin.rerender({ href: "/brand.png" });
    expect(hrefs()).toEqual(["/brand.png"]);

    admin.unmount();
    expect(hrefs()).toEqual(["/favicon.ico"]);
  });

  it("drops the SVG type when the branding favicon is no longer an SVG", () => {
    const admin = renderHook(({ href }) => useFaviconInjection(href), {
      initialProps: { href: ADMIN_ICON },
    });

    admin.rerender({ href: "/brand.png" });

    expect(activeIcons()[0]?.getAttribute("type")).toBeNull();
  });
});
