"use client";

/**
 * The breadcrumb of the Page Builder's own admin pages, drawn as the admin
 * draws its own: Dashboard, then Page Builder, then the page.
 *
 * @module admin/page-breadcrumb
 */
import { navigateTo } from "@nextlyhq/plugin-sdk/admin";
import { ChevronRight } from "lucide-react";
import type { JSX } from "react";

import { navigateWithin } from "./plain-click";

/**
 * The trail to one of the plugin's pages.
 *
 * @param props.page - The page's own name, the trail's last step
 * @returns The breadcrumb
 */
export function PageBuilderBreadcrumb({ page }: { page: string }): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex items-center gap-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <a
            href="/admin"
            onClick={navigateWithin("/admin", navigateTo).onClick}
            className="hover:text-foreground hover:underline"
          >
            Dashboard
          </a>
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </li>
        <li className="flex items-center gap-2">
          <span>Page Builder</span>
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </li>
        <li>
          <span aria-current="page" className="font-medium text-foreground">
            {page}
          </span>
        </li>
      </ol>
    </nav>
  );
}
