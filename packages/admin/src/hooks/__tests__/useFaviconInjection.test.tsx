/**
 * The admin shows its own favicon inside a host app whose root layout has
 * icons of its own. Those icons belong to React: Next.js renders them from the
 * layout's metadata, and React updates them when the layout changes. If the
 * admin removes one, React later fails with "Cannot read properties of null
 * (reading 'removeChild')", which a hot reload of the layout turned into
 * hundreds of page errors. These tests render a host icon through React, as
 * Next does, and hold the admin to switching it off rather than removing it.
 */
import { cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useFaviconInjection } from "../useFaviconInjection";

const ADMIN_ICON = "data:image/svg+xml;utf8,admin";

/** A host icon React renders and owns; React hoists it into <head>. */
function HostIcon({ href }: { href: string }) {
  return <link rel="icon" href={href} sizes="any" />;
}

/** The icon links the browser would pick from now. */
const activeIcons = () =>
  Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')
  );

afterEach(() => {
  // React unmounts its icons first; clearing <head> under it would be the very
  // removal these tests forbid.
  cleanup();
  document.head.innerHTML = "";
});

describe("the admin's favicon", () => {
  it("lets React update and remove its own icon after the admin has replaced it", () => {
    const host = render(<HostIcon href="/favicon.ico" />);
    const hostLink = document.head.querySelector('link[href="/favicon.ico"]');
    expect(hostLink, "React hoists the host icon into <head>").not.toBeNull();
    renderHook(() => useFaviconInjection(ADMIN_ICON));

    // What a hot reload of the layout does to the icon React owns.
    expect(() =>
      host.rerender(<HostIcon href="/favicon-2.ico" />)
    ).not.toThrow();
    expect(() => host.unmount()).not.toThrow();
  });

  it("shows only the admin's icon while it is mounted, keeping the host's node in place", () => {
    render(<HostIcon href="/favicon.ico" />);
    const hostLink = document.head.querySelector('link[href="/favicon.ico"]');

    renderHook(() => useFaviconInjection(ADMIN_ICON));

    expect(activeIcons().map(link => link.href)).toEqual([ADMIN_ICON]);
    expect(hostLink?.isConnected).toBe(true);
  });

  it("gives the host its icon back when the admin's goes", () => {
    render(<HostIcon href="/favicon.ico" />);
    const admin = renderHook(() => useFaviconInjection(ADMIN_ICON));

    admin.unmount();

    expect(activeIcons().map(link => link.getAttribute("href"))).toEqual([
      "/favicon.ico",
    ]);
  });

  it("keeps a single admin icon when the branding changes it", () => {
    render(<HostIcon href="/favicon.ico" />);
    const admin = renderHook(({ href }) => useFaviconInjection(href), {
      initialProps: { href: ADMIN_ICON },
    });

    admin.rerender({ href: "/brand.png" });

    expect(activeIcons().map(link => link.getAttribute("href"))).toEqual([
      "/brand.png",
    ]);
  });
});
