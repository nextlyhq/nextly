/**
 * UserDeleteDialog Stories
 *
 * Storybook documentation for UserDeleteDialog component.
 */

import { Button } from "@revnixhq/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { fn } from "storybook/test";

import { UserDeleteDialog } from "./index";

/**
 * UserDeleteDialog component
 *
 * A confirmation dialog for deleting users with:
 * - User name display in confirmation message
 * - Warning about irreversible action
 * - Loading state during deletion
 * - Error state with Alert component
 * - Cancel and Delete actions
 * - Toast notifications on success/error
 *
 * ## Accessibility
 * - role="alertdialog" for screen readers
 * - aria-describedby for dialog description
 * - Focus trap inside dialog
 * - Keyboard navigation (Escape closes, Tab cycles)
 *
 * ## Usage
 * Used in UserTable component to confirm user deletion before calling API.
 */
const meta = {
  title: "Components/Dialogs/UserDeleteDialog",
  component: UserDeleteDialog,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A confirmation dialog for deleting users. Displays user name, warning message, and action buttons with loading/error states. Includes toast notifications for success/error feedback.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    open: {
      control: "boolean",
      description: "Whether the dialog is open",
      table: {
        type: { summary: "boolean" },
      },
    },
    isLoading: {
      control: "boolean",
      description: "Loading state (shows spinner on Delete button)",
      table: {
        type: { summary: "boolean" },
        defaultValue: { summary: "false" },
      },
    },
    user: {
      control: "object",
      description: "User to delete (id and name)",
      table: {
        type: { summary: "{ id: string; name: string } | null" },
      },
    },
    onOpenChange: {
      action: "onOpenChange",
      description: "Callback when dialog open state changes",
      table: {
        type: { summary: "(open: boolean) => void" },
      },
    },
    onConfirm: {
      action: "onConfirm",
      description: "Callback when Delete button is clicked",
      table: {
        type: { summary: "() => void | Promise<void>" },
      },
    },
  },
} satisfies Meta<typeof UserDeleteDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock user data
const mockUser = {
  id: "1",
  name: "John Doe",
};

// ========================================
// Default Story
// ========================================

export const Default: Story = {
  args: {
    open: true,
    user: mockUser,
    isLoading: false,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Default delete confirmation dialog. Shows user name "John Doe" in the confirmation message with warning about irreversible action. Cancel and Delete buttons enabled.',
      },
    },
  },
};

// ========================================
// States
// ========================================

export const Loading: Story = {
  args: {
    open: true,
    user: mockUser,
    isLoading: true,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Loading state during deletion. Delete button shows "Deleting..." with animated Loader2 spinner. Cancel button disabled. Dialog cannot be closed during deletion.',
      },
    },
  },
};

export const Closed: Story = {
  args: {
    open: false,
    user: mockUser,
    isLoading: false,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Closed state. Dialog is not visible. Used for documentation purposes to show the default hidden state.",
      },
    },
  },
};

export const NoUser: Story = {
  args: {
    open: true,
    user: null,
    isLoading: false,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          "No user provided. Dialog returns null and does not render. This is a safeguard for invalid states.",
      },
    },
  },
};

// ========================================
// User Variants
// ========================================

export const LongUserName: Story = {
  args: {
    open: true,
    user: {
      id: "2",
      name: "Christopher Alexander Montgomery-Williamson III",
    },
    isLoading: false,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Dialog with very long user name. Tests text wrapping and dialog width (max-width: 28rem / 448px). User name wraps to multiple lines if needed.",
      },
    },
  },
};

export const ShortUserName: Story = {
  args: {
    open: true,
    user: {
      id: "3",
      name: "Li",
    },
    isLoading: false,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Dialog with very short user name. Tests minimum content display. Dialog maintains readable width.",
      },
    },
  },
};

// ========================================
// Interactive Demos
// ========================================

export const InteractiveDefault: Story = {
  args: {
    open: false,
    user: mockUser,
    isLoading: false,
    onOpenChange: () => {},
    onConfirm: () => {},
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleConfirm = async () => {
      setIsDeleting(true);
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      setIsDeleting(false);
      setOpen(false);
      // Toast notification handled by component
    };

    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted p-4 max-w-md">
          <h3 className="text-sm font-semibold mb-2">Interactive Demo</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Click "Open Dialog" to test the delete confirmation flow. Click
            "Delete" to simulate deletion (1.5s delay). Watch for toast
            notification on success.
          </p>
          <Button onClick={() => setOpen(true)} variant="destructive">
            Open Dialog
          </Button>
        </div>

        <UserDeleteDialog
          open={open}
          onOpenChange={setOpen}
          user={mockUser}
          onConfirm={handleConfirm}
          isLoading={isDeleting}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Fully interactive demo. Click 'Open Dialog' button to open the dialog. Click 'Delete' to simulate deletion with 1.5s delay. Toast notification appears on success. Click 'Cancel' or press Escape to close without deleting.",
      },
    },
    actions: {
      handles: ["click button"],
    },
  },
};

export const InteractiveWithError: Story = {
  args: {
    open: false,
    user: mockUser,
    isLoading: false,
    onOpenChange: () => {},
    onConfirm: () => {},
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleConfirm = async () => {
      setIsDeleting(true);
      // Simulate API call that fails
      await new Promise(resolve => setTimeout(resolve, 1500));
      setIsDeleting(false);
      // Throw error to trigger error state
      throw new Error("Network error: Unable to connect to server");
    };

    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted p-4 max-w-md">
          <h3 className="text-sm font-semibold mb-2">
            Interactive Demo (Error)
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Click "Open Dialog" to test error handling. Click "Delete" to
            simulate failed deletion (1.5s delay). Error Alert appears in dialog
            and error toast notification is shown.
          </p>
          <Button onClick={() => setOpen(true)} variant="destructive">
            Open Dialog
          </Button>
        </div>

        <UserDeleteDialog
          open={open}
          onOpenChange={setOpen}
          user={mockUser}
          onConfirm={handleConfirm}
          isLoading={isDeleting}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Interactive demo with error simulation. Click 'Delete' to trigger simulated network error after 1.5s. Error Alert component (destructive variant) appears inside dialog with error message. Error toast notification also shown. Dialog remains open so user can retry or cancel.",
      },
    },
    actions: {
      handles: ["click button"],
    },
  },
};

export const MultipleUsers: Story = {
  args: {
    open: false,
    user: null,
    isLoading: false,
    onOpenChange: () => {},
    onConfirm: () => {},
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [currentUser, setCurrentUser] = useState<{
      id: string;
      name: string;
    } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const users = [
      { id: "1", name: "John Doe" },
      { id: "2", name: "Jane Smith" },
      { id: "3", name: "Robert Johnson" },
    ];

    const handleDelete = (user: { id: string; name: string }) => {
      setCurrentUser(user);
      setOpen(true);
    };

    const handleConfirm = async () => {
      setIsDeleting(true);
      await new Promise(resolve => setTimeout(resolve, 1000));
      setIsDeleting(false);
      setOpen(false);
      setCurrentUser(null);
    };

    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted p-4 max-w-md">
          <h3 className="text-sm font-semibold mb-2">Multiple Users Demo</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Click any "Delete" button to open dialog for that user. Notice how
            the user name changes in the dialog based on which user you're
            deleting.
          </p>
          <div className="space-y-2">
            {users.map(user => (
              <div
                key={user.id}
                className="flex items-center justify-between p-2 rounded-md border border-border"
              >
                <span className="text-sm font-medium">{user.name}</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleDelete(user)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        </div>

        <UserDeleteDialog
          open={open}
          onOpenChange={setOpen}
          user={currentUser}
          onConfirm={handleConfirm}
          isLoading={isDeleting}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Demo with multiple users. Shows how dialog displays different user names dynamically. Click any Delete button to open dialog for that specific user. Used to demonstrate real-world usage pattern where multiple users can be deleted from a list.",
      },
    },
    actions: {
      handles: ["click button"],
    },
  },
};

// ========================================
// Dark Mode
// ========================================

export const DarkMode: Story = {
  args: {
    open: true,
    user: mockUser,
    isLoading: false,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  parameters: {
    backgrounds: { default: "dark" },
    docs: {
      description: {
        story:
          "Dialog in dark mode. Uses design system color tokens (bg-background, text-foreground, border-border) that automatically adapt to dark theme. Backdrop darkens (bg-black/80). All elements remain WCAG 2.2 AA compliant.",
      },
    },
  },
};

export const DarkModeLoading: Story = {
  args: {
    open: true,
    user: mockUser,
    isLoading: true,
    onOpenChange: fn(),
    onConfirm: fn(),
  },
  parameters: {
    backgrounds: { default: "dark" },
    docs: {
      description: {
        story:
          "Dialog loading state in dark mode. Loader2 spinner (white/light color) visible against dark button background. Cancel button disabled with reduced opacity.",
      },
    },
  },
};
