/**
 * Dashboard Stories
 *
 * Storybook documentation for dashboard components.
 */

import type { Meta, StoryObj } from "@storybook/react";

import { Users, Shield, Key, Activity } from "@admin/components/icons";

import { StatsGridSkeleton, ActivitySkeleton } from "./DashboardSkeleton";
import { StatsCard } from "./StatsCard";

// StatsCard Stories
const metaStatsCard: Meta<typeof StatsCard> = {
  title: "Dashboard/StatsCard",
  component: StatsCard,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Displays a statistic card with optional trend indicator and icon. Used on the dashboard to show metrics like total users, roles, etc.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    title: { control: "text" },
    value: { control: "text" },
    change: { control: "number" },
    trend: { control: "select", options: ["up", "down"] },
  },
};

export default metaStatsCard;

type Story = StoryObj<typeof StatsCard>;

export const Default: Story = {
  args: {
    title: "Total Users",
    value: 1247,
    change: 12.5,
    trend: "up",
    icon: <Users className="h-6 w-6 text-primary" />,
  },
};

export const TrendDown: Story = {
  args: {
    title: "Active Sessions",
    value: 23,
    change: -3.2,
    trend: "down",
    icon: <Activity className="h-6 w-6 text-primary" />,
  },
};

export const NoTrend: Story = {
  args: {
    title: "Permissions",
    value: 48,
    icon: <Key className="h-6 w-6 text-primary" />,
  },
};

export const NoIcon: Story = {
  args: {
    title: "Active Roles",
    value: 12,
    change: 8.3,
    trend: "up",
  },
};

export const FormattedValue: Story = {
  args: {
    title: "API Calls (24h)",
    value: "1.2M",
    change: 15.7,
    trend: "up",
    icon: <Shield className="h-6 w-6 text-primary" />,
  },
};

// Grid Layout Story
export const StatsGrid: Story = {
  render: () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 w-full max-w-7xl">
      <StatsCard
        title="Total Users"
        value={1247}
        change={12.5}
        trend="up"
        icon={<Users className="h-6 w-6 text-primary" />}
      />
      <StatsCard
        title="Active Roles"
        value={12}
        change={8.3}
        trend="up"
        icon={<Shield className="h-6 w-6 text-primary" />}
      />
      <StatsCard
        title="Permissions"
        value={48}
        icon={<Key className="h-6 w-6 text-primary" />}
      />
      <StatsCard
        title="Active Sessions"
        value={23}
        change={-3.2}
        trend="down"
        icon={<Activity className="h-6 w-6 text-primary" />}
      />
    </div>
  ),
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Responsive grid layout (1 → 2 → 4 columns). Mobile: 1 column, Tablet: 2 columns, Desktop: 4 columns.",
      },
    },
  },
};

// Skeleton Stories
export const LoadingSkeleton: Story = {
  render: () => <StatsGridSkeleton />,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Loading skeleton for stats grid. Used with Suspense boundaries for progressive loading.",
      },
    },
  },
};

export const ActivityLoadingSkeleton: Story = {
  render: () => <ActivitySkeleton />,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        story:
          "Loading skeleton for activity feed. Matches the layout of the RecentActivity component.",
      },
    },
  },
};
