"use client";

import { useEffect } from "react";

/** The icon links a browser picks a page's favicon from. */
const ICON_LINKS =
  'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]';

/** The `rel` a host icon carries while the admin's icon is shown in its place. */
const SWITCHED_OFF = "nextly-replaced-icon";

/**
 * Shows the admin's favicon in place of the host app's.
 *
 * The host's icon links belong to React: Next.js renders them from the root
 * layout's metadata. They are never removed or moved, because React then fails
 * with "Cannot read properties of null (reading 'removeChild')" the next time it
 * updates `<head>`, as a hot reload of the layout does. They are switched off
 * instead by renaming their `rel`, an attribute change React leaves alone, and
 * switched back when the admin's icon goes. The admin's own link is the only
 * node this adds or removes. A host icon React adds later, or a host link whose
 * `rel` React changes to an icon's, is switched off as it happens. The host's
 * original `rel` values are kept here, never written onto its nodes.
 */
export function useFaviconInjection(href: string): void {
  useEffect(() => {
    const own = document.createElement("link");
    own.rel = "icon";
    if (href.startsWith("data:image/svg+xml")) own.type = "image/svg+xml";
    own.href = href;

    // Each host icon switched off, with the `rel` it had: the latest one, if
    // React changed it while the admin's icon was shown.
    const originals = new Map<HTMLLinkElement, string>();
    const switchOff = (icon: HTMLLinkElement) => {
      if (icon === own) return;
      originals.set(icon, icon.rel);
      icon.rel = SWITCHED_OFF;
    };
    document.querySelectorAll<HTMLLinkElement>(ICON_LINKS).forEach(switchOff);
    document.head.appendChild(own);

    const changes = new MutationObserver(records =>
      records.flatMap(iconsIn).forEach(switchOff)
    );
    changes.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["rel"],
    });

    return () => {
      changes.disconnect();
      own.remove();
      originals.forEach(restoreHostIcon);
    };
  }, [href]);
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
