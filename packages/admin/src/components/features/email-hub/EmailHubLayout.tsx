"use client";

import {
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import type React from "react";

import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import {
  EMAIL_HUB_TABS,
  visibleEmailHubTabs,
  type EmailHubTab,
} from "@admin/constants/email-hub";
import { ROUTES } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { navigateTo } from "@admin/lib/navigation";

interface EmailHubLayoutProps {
  /** The tab this page is. */
  tab: EmailHubTab;
  /** The tab's own actions, trailing the hub's heading. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The Email hub's frame: its heading, and its tabs across the top.
 *
 * Each tab is a route of its own, so a tab can be bookmarked, linked to from a
 * plugin's screen and reached with Back; choosing one navigates. A tab shows
 * only to someone holding a grant that reads what it shows, and the route
 * behind it is guarded by the same grants. While the grants are loading every
 * tab shows, as the rail does, rather than the strip changing its mind.
 */
export function EmailHubLayout({
  tab,
  actions,
  children,
}: EmailHubLayoutProps) {
  const { hasPermission, hasAnswer } = useCurrentUserPermissions();
  const tabs = hasAnswer
    ? visibleEmailHubTabs(hasPermission)
    : [...EMAIL_HUB_TABS];

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Email"
        description="Every email this site sends, how they look and how they're sent."
        actions={actions}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
              { label: "Email" },
            ]}
          />
        }
      />
      <Tabs
        value={tab}
        onValueChange={next => {
          const target = tabs.find(t => t.id === next);
          if (target) navigateTo(target.href);
        }}
        className="pt-2"
      >
        <TabsList scrollable aria-label="Email" className="justify-start">
          {tabs.map(t => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="pt-4">
          {children}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
