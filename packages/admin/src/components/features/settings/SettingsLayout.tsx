"use client";

import { PageHeader } from "@nextlyhq/ui";
import type React from "react";

import { Breadcrumbs } from "@admin/components/shared";
import { ROUTES } from "@admin/constants/routes";

interface SettingsLayoutProps {
  /** The page's name, rendered as its `h1`. */
  title: string;
  /** A sentence under the title. */
  description?: React.ReactNode;
  /**
   * This page's own crumb, last in the trail. Omitted for the settings root,
   * whose crumb would repeat the "Settings" link immediately before it.
   */
  crumb?: string;
  /**
   * The listing a create/edit page belongs under, placed between "Settings"
   * and this page's own crumb.
   */
  parentCrumb?: { label: string; href: string };
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The shared chrome for a settings page: its breadcrumb trail and its header.
 *
 * Each page DECLARES its own identity through props. It previously derived
 * every title, description and crumb here by matching `window.location.pathname`
 * against a chain of sixteen branches — so a page's name lived in a file the
 * page did not import, adding a route meant editing a foreign `if`, and a
 * plugin could not contribute a settings page at all because it cannot add a
 * branch to a chain it does not ship. Reading the URL also made the header
 * wrong for any page reachable at more than one path.
 *
 * The registry already made this call for the sidebar: a private route must
 * declare the rail section it belongs to, so a missing declaration is a compile
 * error rather than a page that silently highlights the wrong entry. This is
 * the same decision applied to the page's own name.
 *
 * What stays shared is the TRAIL, not the identity. Every settings page hangs
 * off Dashboard › Settings, so composing that here keeps one implementation of
 * it; a page supplying its whole breadcrumb array would put sixteen copies of
 * the same two links in the tree.
 */
export function SettingsLayout({
  title,
  description,
  crumb,
  parentCrumb,
  actions,
  children,
}: SettingsLayoutProps) {
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={actions}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
              { label: "Settings", href: ROUTES.SETTINGS },
              ...(parentCrumb
                ? [{ label: parentCrumb.label, href: parentCrumb.href }]
                : []),
              ...(crumb ? [{ label: crumb }] : []),
            ]}
          />
        }
      />

      <div className="pt-2">{children}</div>
    </div>
  );
}
