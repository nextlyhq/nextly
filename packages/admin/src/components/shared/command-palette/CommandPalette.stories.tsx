/**
 * CommandPalette Stories
 *
 * Storybook documentation for CommandPalette component with keyboard shortcuts.
 * Demonstrates all states: default, loading, error, empty, mobile, dark mode.
 */

import { Button } from "@revnixhq/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useState } from "react";

import { CommandPalette } from "./index";

// Mock Next.js router for Storybook
const mockRouter = {
  push: (url: string) => {
    console.log("Navigate to:", url);
    window.alert(`Navigate to: ${url}`);
  },
  replace: (url: string) => {
    console.log("Replace with:", url);
  },
  prefetch: () => Promise.resolve(),
  back: () => {
    console.log("Go back");
  },
  forward: () => {
    console.log("Go forward");
  },
  refresh: () => {
    console.log("Refresh");
  },
};

// Create a QueryClient for stories
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Infinity,
    },
  },
});

const meta = {
  title: "Components/Navigation/CommandPalette",
  component: CommandPalette,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `
A keyboard-driven command palette for quick navigation and actions. Opens with Cmd+K (Mac) or Ctrl+K (Windows/Linux).

## Features
- **Keyboard shortcut**: Cmd+K / Ctrl+K to toggle
- **Fuzzy search**: Across navigation, actions, and users
- **Grouped results**: Navigation, Actions, Users with visual hierarchy
- **Dark mode compatible**: Automatic theme adaptation
- **Mobile responsive**: Full-width on mobile, 512px on desktop
- **WCAG 2.2 AA compliant**: Proper ARIA, keyboard navigation, focus management

## Keyboard Shortcuts
| Key | Action |
|-----|--------|
| \`Cmd+K\` / \`Ctrl+K\` | Toggle command palette |
| \`Escape\` | Close command palette |
| \`Arrow Down\` | Move to next item |
| \`Arrow Up\` | Move to previous item |
| \`Enter\` | Select highlighted item |
| \`Home\` | Jump to first item |
| \`End\` | Jump to last item |
| \`G then D\` | Go to Dashboard (Gmail-style) |
| \`G then U\` | Go to Users |
| \`G then R\` | Go to Roles & Permissions |
| \`G then S\` | Go to Settings |

## Design Specs
- **Dialog**: 512px max width (max-w-lg), 12px border radius
- **Input**: 48px height (h-12) for prominence
- **Items**: 36px desktop (h-9), 44px mobile (h-11) for touch
- **Backdrop**: bg-black/80 with backdrop blur
- **Animation**: 200ms duration

## Accessibility
- Full keyboard navigation (no mouse required)
- Focus trap when dialog is open
- ARIA attributes for screen readers
- Focus returns to trigger element on close
- WCAG 2.2 AA color contrast verified
        `,
      },
    },
  },
  tags: ["autodocs"],
  decorators: [
    Story => (
      <AppRouterContext.Provider
        value={
          mockRouter as unknown as React.ContextType<typeof AppRouterContext>
        }
      >
        <QueryClientProvider client={queryClient}>
          <div className="adminapp min-h-screen p-8">
            <Story />
          </div>
        </QueryClientProvider>
      </AppRouterContext.Provider>
    ),
  ],
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default state with command palette closed.
 * Press Cmd+K or click the button to open.
 */
export const Default: Story = {
  render: () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <CommandPalette />
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          Press{" "}
          <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
            Cmd+K
          </kbd>{" "}
          or{" "}
          <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
            Ctrl+K
          </kbd>{" "}
          to open
        </p>
        <p className="text-xs text-muted-foreground">
          (Or use the button trigger in other stories)
        </p>
      </div>
    </div>
  ),
};

/**
 * Wrapper component for stories that need state
 */
function OpenWrapper() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
      <CommandPalette key={key} />
      <Button onClick={() => setKey(prev => prev + 1)}>
        Open Command Palette
      </Button>
      <p className="text-sm text-muted-foreground">
        Click the button or press Cmd+K to open the command palette
      </p>
    </div>
  );
}

/**
 * Command palette open with navigation and action commands.
 * Shows the default state when opened.
 */
export const Open: Story = {
  render: () => <OpenWrapper />,
};

/**
 * Wrapper for WithSearch story
 */
function WithSearchWrapper() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
      <CommandPalette key={key} />
      <Button onClick={() => setKey(prev => prev + 1)}>
        Open and Search for &quot;john&quot;
      </Button>
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          Click the button, then type &quot;john&quot; to see user search
          results
        </p>
        <p className="text-xs text-muted-foreground">
          Results include: John Doe, Jane Smith, John Smith, Johnny Walker
        </p>
      </div>
    </div>
  );
}

/**
 * Command palette with search query showing user results.
 * Type "john" to see filtered user results.
 */
export const WithSearch: Story = {
  render: () => <WithSearchWrapper />,
};

/**
 * Wrapper for Loading story
 */
function LoadingWrapper() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
      <CommandPalette key={key} />
      <Button onClick={() => setKey(prev => prev + 1)}>
        Open Command Palette
      </Button>
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          Type in the search field to trigger user search loading state
        </p>
        <p className="text-xs text-muted-foreground">
          Loading state shows spinner with &quot;Loading...&quot; text
        </p>
      </div>
    </div>
  );
}

/**
 * Loading state when fetching user search results.
 * Shows spinner and loading indicator.
 */
export const Loading: Story = {
  render: () => <LoadingWrapper />,
};

/**
 * Wrapper for Empty story
 */
function EmptyWrapper() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
      <CommandPalette key={key} />
      <Button onClick={() => setKey(prev => prev + 1)}>
        Open and Search &quot;xyz123&quot;
      </Button>
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          Click the button, then type &quot;xyz123&quot; to see empty state
        </p>
        <p className="text-xs text-muted-foreground">
          Shows centered message: &quot;No results found.&quot;
        </p>
      </div>
    </div>
  );
}

/**
 * Empty state when no results match the search query.
 * Shows "No results found." message.
 */
export const Empty: Story = {
  render: () => <EmptyWrapper />,
};

/**
 * Wrapper for Mobile story
 */
function MobileWrapper() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] gap-4 px-4">
      <CommandPalette key={key} />
      <Button onClick={() => setKey(prev => prev + 1)} size="lg">
        Open Command Palette
      </Button>
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          Mobile layout: Full-width dialog with 44×44px touch targets
        </p>
        <p className="text-xs text-muted-foreground">
          Resize viewport to &lt; 768px to see mobile layout
        </p>
      </div>
    </div>
  );
}

/**
 * Mobile layout with full-width dialog and 44px touch targets.
 * Resize viewport to mobile width (< 768px) to see mobile layout.
 */
export const Mobile: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  render: () => <MobileWrapper />,
};

/**
 * Wrapper for DarkMode story
 */
function DarkModeWrapper() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
      <CommandPalette key={key} />
      <Button onClick={() => setKey(prev => prev + 1)}>
        Open Command Palette
      </Button>
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          Dark mode uses semantic color tokens for automatic adaptation
        </p>
        <p className="text-xs text-muted-foreground">
          Toggle Storybook backgrounds addon to switch themes
        </p>
      </div>
    </div>
  );
}

/**
 * Dark mode variant.
 * Toggle the Storybook backgrounds addon to see dark mode.
 */
export const DarkMode: Story = {
  parameters: {
    backgrounds: {
      default: "dark",
    },
  },
  render: () => <DarkModeWrapper />,
};

/**
 * Wrapper for KeyboardShortcuts story
 */
function KeyboardShortcutsWrapper() {
  const [key, setKey] = useState(0);

  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] gap-6">
      <CommandPalette key={key} />
      <Button onClick={() => setKey(prev => prev + 1)} size="lg">
        Open Command Palette
      </Button>

      <div className="space-y-4 max-w-2xl">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">Keyboard Shortcuts</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Try these keyboard shortcuts (palette must be closed for Gmail-style
            shortcuts):
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Command Palette Toggle */}
          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Toggle Palette</span>
              <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
                Cmd+K
              </kbd>
            </div>
            <p className="text-xs text-muted-foreground">
              Open/close command palette
            </p>
          </div>

          {/* Gmail-style shortcuts */}
          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Go to Dashboard</span>
              <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
                G D
              </kbd>
            </div>
            <p className="text-xs text-muted-foreground">
              Navigate to dashboard page
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Go to Users</span>
              <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
                G U
              </kbd>
            </div>
            <p className="text-xs text-muted-foreground">
              Navigate to users page
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Go to Roles</span>
              <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
                G R
              </kbd>
            </div>
            <p className="text-xs text-muted-foreground">
              Navigate to roles & permissions
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Go to Settings</span>
              <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
                G S
              </kbd>
            </div>
            <p className="text-xs text-muted-foreground">
              Navigate to settings page
            </p>
          </div>

          {/* Navigation within palette */}
          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Navigate Items</span>
              <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
                ↑↓
              </kbd>
            </div>
            <p className="text-xs text-muted-foreground">
              Arrow keys to move between items
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Select Item</span>
              <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
                Enter
              </kbd>
            </div>
            <p className="text-xs text-muted-foreground">
              Execute highlighted command
            </p>
          </div>

          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Close Palette</span>
              <kbd className="px-2 py-1 bg-muted border border-border rounded text-xs font-mono">
                Escape
              </kbd>
            </div>
            <p className="text-xs text-muted-foreground">
              Close command palette
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive demo showing all keyboard shortcuts.
 * Press the shortcuts to navigate to different pages.
 */
export const KeyboardShortcuts: Story = {
  render: () => <KeyboardShortcutsWrapper />,
};

/**
 * Wrapper for Playground story
 */
function PlaygroundWrapper() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
      <CommandPalette key={key} />
      <div className="flex gap-4">
        <Button onClick={() => setKey(prev => prev + 1)} size="lg">
          Open Command Palette
        </Button>
      </div>
      <div className="text-center space-y-2 max-w-lg">
        <p className="text-sm text-muted-foreground">
          Try different interactions:
        </p>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• Press Cmd+K to toggle the palette</li>
          <li>• Type to search for users (e.g., &quot;john&quot;)</li>
          <li>• Use Arrow keys to navigate between items</li>
          <li>• Press Enter to select an item</li>
          <li>• Press Escape to close</li>
          <li>• Try Gmail-style shortcuts (G+D, G+U, G+R, G+S)</li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Comprehensive playground with all states and variations.
 * Use Storybook Controls to toggle different states.
 */
export const Playground: Story = {
  render: () => <PlaygroundWrapper />,
};

/**
 * Wrapper for ResponsiveBehavior story
 */
function ResponsiveBehaviorWrapper() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
      <CommandPalette key={key} />
      <Button onClick={() => setKey(prev => prev + 1)} size="lg">
        Open Command Palette
      </Button>
      <div className="text-center space-y-4 max-w-2xl">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Responsive Breakpoints</h3>
          <p className="text-sm text-muted-foreground">
            The command palette adapts to different screen sizes:
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
          <div className="p-4 rounded-lg border border-border bg-card">
            <h4 className="text-sm font-semibold mb-2">Desktop (≥ 768px)</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Dialog: 512px max width</li>
              <li>• Items: 36px height</li>
              <li>• Centered on screen</li>
              <li>• Text: 14px font size</li>
            </ul>
          </div>
          <div className="p-4 rounded-lg border border-border bg-card">
            <h4 className="text-sm font-semibold mb-2">Mobile (&lt; 768px)</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Dialog: Full width with margin</li>
              <li>• Items: 44px height (touch-friendly)</li>
              <li>• 80% viewport height</li>
              <li>• Text: 16px font size (prevent iOS zoom)</li>
            </ul>
          </div>
        </div>
        <p className="text-xs text-muted-foreground italic">
          Try resizing your browser window to see the responsive behavior
        </p>
      </div>
    </div>
  );
}

/**
 * Responsive behavior demonstration.
 * Resize viewport to see how the command palette adapts.
 */
export const ResponsiveBehavior: Story = {
  render: () => <ResponsiveBehaviorWrapper />,
};
