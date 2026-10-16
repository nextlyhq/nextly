"use client";

import { useEffect, useRef } from "react";

/**
 * Marks an icon an admin provider added. Every admin icon is left alone, so two
 * providers on one page (a host wrapping the admin's root layout in its own)
 * never switch each other's icon off.
 */
const ADMIN_ICON = "data-nextly-admin-icon";

/** The host's icon links: those a browser picks a favicon from, other than the admin's. */
const ICON_LINKS = ["icon", "shortcut icon", "apple-touch-icon"]
  .map(rel => `link[rel="${rel}"]:not([${ADMIN_ICON}])`)
  .join(", ");

/** The `rel` a host icon carries while the admin's icon is shown in its place. */
const SWITCHED_OFF = "nextly-replaced-icon";

/**
 * The page's host icons are switched off once for every admin provider on it,
 * and switched back only when the last admin icon goes. A provider that left
 * them to the others' observers would turn them on for a moment, long enough
 * for a browser to fetch and show the host's icon.
 */
const adminIcons = new Set<HTMLLinkElement>();

/**
 * Each host icon switched off, with the `rel` it had: the latest one, if React
 * changed it while an admin icon was shown.
 */
const originals = new Map<HTMLLinkElement, string>();

/** Switches off host icons React adds or renames while an admin icon is shown. */
let hostIconChanges: MutationObserver | undefined;

/**
 * Shows the admin's favicon in place of the host app's.
 *
 * The host's icon links belong to React: Next.js renders them from the root
 * layout's metadata. They are never removed or moved, because React then fails
 * with "Cannot read properties of null (reading 'removeChild')" the next time it
 * updates `<head>`, as a hot reload of the layout does. They are switched off
 * instead by renaming their `rel`, an attribute change React leaves alone, and
 * switched back when the last admin icon goes. The admin's own link is the only
 * node this adds or removes. A host icon React adds later, or a host link whose
 * `rel` React changes to an icon's, is switched off as it happens. The host's
 * original `rel` values are kept here, never written onto its nodes.
 */
export function useFaviconInjection(href: string): void {
  const own = useRef<HTMLLinkElement | null>(null);

  // The admin's icon lives as long as the provider, not as long as one
  // `href`: a branding change that went through a remove and an add would
  // switch the host's icons on for that moment.
  useEffect(() => {
    const icon = document.createElement("link");
    icon.setAttribute(ADMIN_ICON, "");
    icon.rel = "icon";
    own.current = icon;

    if (adminIcons.size === 0) hideHostIcons();
    adminIcons.add(icon);
    document.head.appendChild(icon);

    return () => {
      icon.remove();
      adminIcons.delete(icon);
      own.current = null;
      if (adminIcons.size === 0) showHostIcons();
    };
  }, []);

  // Runs after the effect above on mount, so the icon exists; a branding
  // change only points it somewhere else.
  useEffect(() => {
    const icon = own.current;
    if (!icon) return;
    if (href.startsWith("data:image/svg+xml")) icon.type = "image/svg+xml";
    else icon.removeAttribute("type");
    icon.href = href;
  }, [href]);
}

function hideHostIcons(): void {
  document.querySelectorAll<HTMLLinkElement>(ICON_LINKS).forEach(switchOff);
  hostIconChanges = new MutationObserver(records =>
    records.flatMap(iconsIn).forEach(switchOff)
  );
  hostIconChanges.observe(document.head, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["rel"],
  });
}

function showHostIcons(): void {
  hostIconChanges?.disconnect();
  hostIconChanges = undefined;
  originals.forEach(restoreHostIcon);
  originals.clear();
}

/**
 * A link can arrive in several records of one batch (added, then its `rel`
 * changed); once it is switched off, its `rel` is no longer the host's, so a
 * second record must not overwrite the saved one.
 */
function switchOff(icon: HTMLLinkElement): void {
  if (icon.rel === SWITCHED_OFF) return;
  originals.set(icon, icon.rel);
  icon.rel = SWITCHED_OFF;
}

/**
 * The icon links a change to `<head>` brought: links added, or a link whose
 * `rel` now names an icon. A switched-off link no longer matches, so this
 * hook's own changes bring none.
 */
function iconsIn(record: MutationRecord): HTMLLinkElement[] {
  const nodes =
    record.type === "attributes"
      ? [record.target]
      : Array.from(record.addedNodes);
  return nodes.filter(
    (node): node is HTMLLinkElement =>
      node instanceof HTMLLinkElement && node.matches(ICON_LINKS)
  );
}

/**
 * Gives a host icon back its `rel`, unless React has since given it another
 * one of its own, which then stands.
 */
function restoreHostIcon(rel: string, icon: HTMLLinkElement): void {
  if (icon.rel === SWITCHED_OFF) icon.rel = rel;
}
