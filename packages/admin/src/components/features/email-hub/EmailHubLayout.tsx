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
  EMAIL_DELIVERIES_READ_PERMISSION,
  EMAIL_HUB_TABS,
  visibleEmailHubTabs,
  type EmailHubTab,
} from "@admin/constants/email-hub";
import { ROUTES } from "@admin/constants/routes";
import { useQueuedEmailOverdue } from "@admin/hooks/queries/useEmailActivity";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useSettingsLanding } from "@admin/hooks/useSettingsLanding";
import { navigateTo } from "@admin/lib/navigation";

/**
 * The mark on the Activity tab while queued email is overdue because the
 * jobs trigger isn't running, so it is seen from every tab. Drawn only for a
 * reader who may read deliveries, so nobody else asks the server.
 */
function ActivityOverdueMarker(): React.JSX.Element | null {
  const overdue = useQueuedEmailOverdue();
  if (!overdue.data || overdue.data.overdue === 0) return null;
  return (
    <span
      className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning-solid px-1 text-[10px] font-semibold text-warning-foreground"
      aria-label="Queued email is overdue"
      title="Queued email is overdue"
    >
      !
    </span>
  );
}

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
}: EmailHubLayoutProps): React.JSX.Element {
  const { hasPermission, hasAnswer } = useCurrentUserPermissions();
  const settingsHref = useSettingsLanding();
  const tabs = hasAnswer
    ? visibleEmailHubTabs(hasPermission)
    : [...EMAIL_HUB_TABS];
  const readsDeliveries =
    hasAnswer && hasPermission(EMAIL_DELIVERIES_READ_PERMISSION);

  return (
    <PageContainer type="list">
      <PageHeader
        title="Email"
        description="Every email this site sends, how they look and how they're sent."
        actions={actions}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
              // The hub is a Settings destination, so its trail runs through
              // Settings, to the first page there this reader can open.
              { label: "Settings", href: settingsHref },
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
              {t.id === "activity" && readsDeliveries && (
                <ActivityOverdueMarker />
              )}
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
