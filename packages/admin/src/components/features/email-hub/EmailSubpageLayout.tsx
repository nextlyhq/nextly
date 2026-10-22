"use client";

import { PageHeader } from "@nextlyhq/ui";
import type React from "react";

import { Breadcrumbs } from "@admin/components/shared";
import { ROUTES } from "@admin/constants/routes";

interface EmailSubpageLayoutProps {
  /** The page's name, rendered as its `h1`. */
  title: string;
  /** A sentence under the title. */
  description?: React.ReactNode;
  /** This page's own crumb, last in the trail. */
  crumb: string;
  /** The hub tab this page belongs under, between "Email" and the crumb. */
  parentCrumb: { label: string; href: string };
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The chrome for a page inside the Email hub that is not a tab itself, such
 * as adding a provider: its trail runs Dashboard › Email › the tab › the page.
 */
export function EmailSubpageLayout({
  title,
  description,
  crumb,
  parentCrumb,
  actions,
  children,
}: EmailSubpageLayoutProps) {
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
              { label: "Email", href: ROUTES.EMAIL },
              { label: parentCrumb.label, href: parentCrumb.href },
              { label: crumb },
            ]}
          />
        }
      />

      <div className="pt-2">{children}</div>
    </div>
  );
}
