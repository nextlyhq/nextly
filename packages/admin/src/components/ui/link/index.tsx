import React, { forwardRef } from "react";

import { RouteValue } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: RouteValue | string; // Accept RouteValue or any string for dynamic routes
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
      navigateTo(href as RouteValue);
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
