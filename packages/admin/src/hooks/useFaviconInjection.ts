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
 * node this adds or removes. A host icon added later, as when a layout change
 * makes React render a new one, is switched off as it arrives.
 */
export function useFaviconInjection(href: string): void {
  useEffect(() => {
    const own = document.createElement("link");
    own.rel = "icon";
    if (href.startsWith("data:image/svg+xml")) own.type = "image/svg+xml";
    own.href = href;

    const switchedOff = new Set<HTMLLinkElement>();
    const switchOff = (icon: HTMLLinkElement) => {
      if (icon === own || switchedOff.has(icon)) return;
      icon.dataset.nextlyRel = icon.rel;
      icon.rel = SWITCHED_OFF;
      switchedOff.add(icon);
    };
    document.querySelectorAll<HTMLLinkElement>(ICON_LINKS).forEach(switchOff);
    document.head.appendChild(own);

    const arrivals = new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes.forEach(node => {
          if (node instanceof HTMLLinkElement && node.matches(ICON_LINKS))
            switchOff(node);
        });
      }
    });
    arrivals.observe(document.head, { childList: true });

    return () => {
      arrivals.disconnect();
      own.remove();
      switchedOff.forEach(restoreHostIcon);
    };
  }, [href]);
}

/** Gives a host icon back the `rel` it had before the admin's icon replaced it. */
function restoreHostIcon(icon: HTMLLinkElement): void {
  const rel = icon.dataset.nextlyRel;
  if (rel === undefined) return;
  icon.rel = rel;
  delete icon.dataset.nextlyRel;
}
