import type React from "react";
import { forwardRef } from "react";

import { navigateTo } from "@admin/lib/navigation";

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string; // Accept any string (RouteValue is a string subset — TypeScript collapses the union)
  children: React.ReactNode;
}

/**
 * True for hrefs that leave the app entirely — an absolute URL, a
 * protocol-relative one, or a scheme like `mailto:`. The SPA router only
 * understands admin paths and would prefix these into a dead route.
 */
function isExternalHref(href: string): boolean {
  return href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(href);
}

/**
 * True when the browser should handle the click itself instead of the SPA
 * router: a modifier click or a non-primary button (open in a new tab or
 * window), or a link aimed at another browsing context. Intercepting these
 * would swallow navigation the user explicitly asked for.
 */
function prefersNativeNavigation(
  event: React.MouseEvent<HTMLAnchorElement>,
  target: string | undefined
): boolean {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0 ||
    (target !== undefined && target !== "" && target !== "_self")
  );
}

// SPA Link: client-side routing for plain left clicks, and the browser's own
// behavior for modifier/middle clicks, other targets, and downloads.
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, children, className, onClick, target, download, ...props }, ref) => {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Run the consumer's handler first so it can cancel the navigation, and
      // so it still sees the clicks that fall through to the browser.
      onClick?.(e);
      if (e.defaultPrevented) return;

      // A download is a file transfer, not a route change.
      if (download !== undefined) return;

      if (isExternalHref(href) || prefersNativeNavigation(e, target)) return;

      e.preventDefault();
      navigateTo(href);
    };

    return (
      <a
        ref={ref}
        href={href}
        className={className}
        target={target}
        download={download}
        onClick={handleClick}
        {...props}
      >
        {children}
      </a>
    );
  }
);

Link.displayName = "Link";
