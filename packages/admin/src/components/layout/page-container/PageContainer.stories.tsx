import { Card } from "@revnixhq/ui";
import type { Meta, StoryObj } from "@storybook/react";

import { PageContainer } from "./index";

/**
 * Page Container Component
 *
 * A responsive container component that provides consistent spacing and max-width
 * constraints for page content. Part of the layout primitives for building
 * consistent page layouts across the admin application.
 *
 * ## Features
 *
 * - Responsive max-width via Tailwind `container` utility
 * - Mobile-first horizontal padding (16px → 24px → 32px)
 * - Mobile-first vertical padding (24px → 32px)
 * - 8px grid spacing system
 * - Supports className overrides for flexibility
 *
 * ## Responsive Behavior
 *
 * - **Mobile (< 640px)**: 16px horizontal padding, 24px vertical padding
 * - **Tablet (640px-1023px)**: 24px horizontal padding, 32px vertical padding
 * - **Desktop (1024px+)**: 32px horizontal padding, 32px vertical padding
 *
 * ## Usage
 *
 * Use PageContainer to wrap page content for consistent spacing. Don't use it
 * for components that already have their own spacing (like modals, tooltips, etc.).
 */
const meta = {
  title: "Layout/PageContainer",
  component: PageContainer,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A responsive container component that provides consistent spacing and max-width constraints for page content.",
      },
    },
    viewport: {
      viewports: {
        mobile: {
          name: "Mobile (375px)",
          styles: { width: "375px", height: "667px" },
        },
        tablet: {
          name: "Tablet (768px)",
          styles: { width: "768px", height: "1024px" },
        },
        desktop: {
          name: "Desktop (1024px)",
          styles: { width: "1024px", height: "768px" },
        },
        wide: {
          name: "Wide Desktop (1440px)",
          styles: { width: "1440px", height: "900px" },
        },
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof PageContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default PageContainer with sample content.
 *
 * This demonstrates the basic usage with a heading, paragraph, and grid of cards.
 * Resize the viewport to see responsive padding in action.
 */
export const Default: Story = {
  args: {
    children: (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">
            Dashboard Page
          </h1>
          <p className="text-muted-foreground mt-2">
            Welcome to your dashboard. Here&apos;s an overview of your activity.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-2">Total Users</h3>
              <p className="text-3xl font-bold text-primary">1,234</p>
              <p className="text-sm text-muted-foreground mt-2">
                +12% from last month
              </p>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-2">Active Sessions</h3>
              <p className="text-3xl font-bold text-accent">45</p>
              <p className="text-sm text-muted-foreground mt-2">
                Currently online
              </p>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-2">Total Content</h3>
              <p className="text-3xl font-bold text-success">890</p>
              <p className="text-sm text-muted-foreground mt-2">
                +5% from last week
              </p>
            </div>
          </Card>
        </div>

        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">New user registered</p>
                  <p className="text-sm text-muted-foreground">
                    john.doe@example.com
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">2m ago</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Content published</p>
                  <p className="text-sm text-muted-foreground">
                    Blog post: Getting Started
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">15m ago</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Role updated</p>
                  <p className="text-sm text-muted-foreground">
                    Editor permissions modified
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">1h ago</span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    ),
  },
};

/**
 * PageContainer with custom className to remove vertical padding.
 *
 * Useful for pages where you want edge-to-edge vertical content but still
 * maintain horizontal padding and max-width.
 */
export const NoVerticalPadding: Story = {
  args: {
    className: "py-0",
    children: (
      <div className="space-y-6">
        <div className="bg-primary text-primary-foreground p-6 -mx-4 sm:-mx-6 lg:-mx-8">
          <h1 className="text-2xl font-semibold">Edge-to-Edge Header</h1>
          <p className="mt-2">
            This header spans the full width but maintains container alignment.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-4">Content Below</h2>
          <p className="text-muted-foreground">
            The content below has the standard horizontal padding but no
            vertical padding on the PageContainer.
          </p>
        </div>
      </div>
    ),
  },
};

/**
 * PageContainer with narrower max-width.
 *
 * Useful for form pages or content-focused pages where you want a narrower
 * reading width for better UX.
 */
export const NarrowWidth: Story = {
  args: {
    className: "max-w-4xl",
    children: (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Create New Post</h1>
          <p className="text-muted-foreground mt-2">
            Fill in the details below to create a new blog post.
          </p>
        </div>

        <Card>
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">Title</label>
              <input
                type="text"
                placeholder="Enter post title..."
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Content</label>
              <textarea
                placeholder="Write your content here..."
                rows={8}
                className="w-full px-3 py-2 rounded-md border border-input bg-background resize-none"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button className="h-10 px-4 rounded-md border border-input bg-background hover:bg-accent">
                Cancel
              </button>
              <button className="h-10 px-4 rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
                Publish
              </button>
            </div>
          </div>
        </Card>
      </div>
    ),
  },
};

/**
 * PageContainer with list/table layout.
 *
 * Demonstrates how PageContainer works with list-style layouts commonly
 * used in CRUD pages.
 */
export const ListLayout: Story = {
  args: {
    children: (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Users</h1>
            <p className="text-muted-foreground mt-1">
              Manage your users and permissions
            </p>
          </div>
          <button className="h-10 px-4 rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
            Add User
          </button>
        </div>

        <Card>
          <div className="divide-y divide-border">
            {[
              {
                name: "John Doe",
                email: "john@example.com",
                role: "Admin",
                status: "Active",
              },
              {
                name: "Jane Smith",
                email: "jane@example.com",
                role: "Editor",
                status: "Active",
              },
              {
                name: "Bob Johnson",
                email: "bob@example.com",
                role: "Viewer",
                status: "Inactive",
              },
            ].map((user, i) => (
              <div key={i} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm">{user.role}</span>
                  <span
                    className={`text-sm ${user.status === "Active" ? "text-success" : "text-muted-foreground"}`}
                  >
                    {user.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    ),
  },
};

/**
 * PageContainer responsive behavior demonstration.
 *
 * Use the viewport toolbar in Storybook to test different screen sizes:
 * - Mobile (375px): 16px padding
 * - Tablet (768px): 24px padding
 * - Desktop (1024px+): 32px padding
 */
export const ResponsiveBehavior: Story = {
  args: {
    children: (
      <div className="space-y-6">
        <Card>
          <div className="p-6 bg-primary/10 border-2 border-primary border-dashed">
            <h2 className="text-xl font-semibold mb-4">Resize Your Browser</h2>
            <div className="space-y-2 text-sm">
              <p>
                <strong>Mobile (&lt; 640px):</strong> 16px horizontal padding,
                24px vertical padding
              </p>
              <p>
                <strong>Tablet (640px-1023px):</strong> 24px horizontal padding,
                32px vertical padding
              </p>
              <p>
                <strong>Desktop (≥ 1024px):</strong> 32px horizontal padding,
                32px vertical padding
              </p>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <div className="p-6">
              <h3 className="font-semibold mb-2">Horizontal Padding</h3>
              <p className="text-sm text-muted-foreground">
                Watch the spacing between this card and the viewport edges as
                you resize.
              </p>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="font-semibold mb-2">Max Width</h3>
              <p className="text-sm text-muted-foreground">
                Container max-width increases at larger breakpoints for optimal
                reading.
              </p>
            </div>
          </Card>
        </div>
      </div>
    ),
  },
};
