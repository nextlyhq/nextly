import type React from "react";
import { forwardRef } from "react";

import { navigateTo } from "@admin/lib/navigation";

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string; // Accept any string (RouteValue is a string subset — TypeScript collapses the union)
  children: React.ReactNode;
}

// SPA Link component that prevents default navigation and uses client-side routing
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, children, className, onClick, ...props }, ref) => {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();

      // Call custom onClick handler if provided
      onClick?.(e);

      // Navigate using SPA routing
      navigateTo(href);
    };

    return (
      <a
        ref={ref}
        href={href}
        className={className}
        onClick={handleClick}
        {...props}
      >
        {children}
      </a>
    );
  }
);

Link.displayName = "Link";
