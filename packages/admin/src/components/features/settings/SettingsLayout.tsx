import type React from "react";
import { useMemo } from "react";

import { ChevronRight, Home } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

interface SettingsLayoutProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * SettingsLayout Component
 *
 * Shared layout wrapper for all Settings pages. Renders the page header
 * and breadcrumbs. Tabs are removed as they are redundant with the inner sidebar.
 */
export function SettingsLayout({ children, actions }: SettingsLayoutProps) {
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "";

  // Map of routes to their display labels for breadcrumbs and titles
  const pageInfo = useMemo(() => {
    if (pathname === ROUTES.SETTINGS) {
      return {
        title: "General Settings",
        description: "Manage your application and configuration",
        crumb: "General",
      };
    }
    if (pathname.includes("user-fields")) {
      return {
        title: "User Fields",
        description: "Manage custom fields and attributes for users",
        crumb: "User Fields",
      };
    }
    if (pathname.includes("email-providers")) {
      return {
        title: "Email Providers",
        description: "Configure your SMTP and email delivery services",
        crumb: "Email Providers",
      };
    }
    if (pathname.includes("email-templates")) {
      return {
        title: "Email Templates",
        description: "Manage and customize system email content",
        crumb: "Email Templates",
      };
    }
    if (pathname.includes("api-keys")) {
      return {
        title: "API Keys",
        description: "Manage secure access keys for API integrations",
        crumb: "API Keys",
      };
    }
    if (pathname.includes("permissions")) {
      return {
        title: "Permissions",
        description: "Define user roles and access control levels",
        crumb: "Permissions",
      };
    }
    if (pathname.includes("image-sizes")) {
      return {
        title: "Image Sizes",
        description: "Configure image sizes generated for uploaded images",
        crumb: "Image Sizes",
      };
    }
    return {
      title: "General Settings",
      description: "Manage your application and configuration",
      crumb: null,
    };
  }, [pathname]);

  return (
    <div className="space-y-8">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="flex items-center gap-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <Link
              href={ROUTES.DASHBOARD}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Home className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
            <ChevronRight className="h-4 w-4" />
          </li>
          <li>
            <Link
              href={ROUTES.SETTINGS}
              className="hover:text-foreground transition-colors"
            >
              Settings
            </Link>
          </li>
          {pageInfo.crumb && pageInfo.crumb !== "General" && (
            <>
              <li className="flex items-center gap-2">
                <ChevronRight className="h-4 w-4" />
              </li>
              <li className="text-foreground font-medium">{pageInfo.crumb}</li>
            </>
          )}
        </ol>
      </nav>

      {/* Page Header */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-[-0.04em] text-foreground leading-tight">
            {pageInfo.title}
          </h1>
          <p className="text-base text-muted-foreground">
            {pageInfo.description}
          </p>
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>

      {/* Content Area */}
      <div className="pt-2">{children}</div>
    </div>
  );
}
