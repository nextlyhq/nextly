import { Button, toast } from "@revnixhq/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { MediaUploadDropzone } from "./index";

/**
 * MediaUploadDropzone Component Stories
 *
 * Drag-and-drop file upload area with react-dropzone for media library.
 * Supports multi-file upload with progress tracking, file validation, and error handling.
 *
 * ## Features
 *
 * - **Multi-file upload**: Upload up to 10 files at once
 * - **File type validation**: Images (PNG, JPG, GIF, WebP), Videos (MP4, MOV, AVI), Documents (PDF)
 * - **Size validation**: Maximum 5MB per file
 * - **Progress tracking**: Individual progress bars for each file
 * - **Visual feedback**: Different states (default, hover, active, uploading, success, error)
 * - **Collapsible**: Can be collapsed to save space
 * - **Accessible**: WCAG 2.2 AA compliant with keyboard navigation and screen reader support
 *
 * ## Keyboard Shortcuts
 *
 * | Key | Action |
 * |-----|--------|
 * | `Tab` | Focus the dropzone |
 * | `Enter` or `Space` | Open file browser |
 * | `Escape` | Close file browser |
 *
 */
const meta = {
  title: "Components/Media Library/MediaUploadDropzone",
  component: MediaUploadDropzone,
  decorators: [
    Story => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });

      return (
        <QueryClientProvider client={queryClient}>
          <div className="min-h-[600px] w-full max-w-2xl">
            <Story />
          </div>
        </QueryClientProvider>
      );
    },
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Drag-and-drop file upload area with multi-file support, progress tracking, and comprehensive file validation. Features collapsible UI, visual state feedback, and full accessibility support.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MediaUploadDropzone>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default state - ready to accept file drops or clicks.
 * Shows supported file types and size limit in helper text.
 */
export const Default: Story = {
  render: () => {
    return (
      <MediaUploadDropzone
        onUploadComplete={media => {
          toast.success(`${media.length} file(s) uploaded successfully!`);
          console.log("Uploaded media:", media);
        }}
      />
    );
  },
};

/**
 * Collapsed state - compact 64px height to save space.
 * Useful when upload area should be minimized after initial use.
 * Click the chevron icon to toggle between expanded and collapsed states.
 */
export const Collapsed: Story = {
  render: () => {
    return (
      <MediaUploadDropzone
        onUploadComplete={media => {
          toast.success(`${media.length} file(s) uploaded successfully!`);
        }}
        isCollapsed={true}
      />
    );
  },
};

/**
 * Controlled collapse state - parent component controls the collapsed state.
 * Useful when you need to synchronize collapse state with other UI elements.
 */
export const ControlledCollapse: Story = {
  render: () => {
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? "Expand" : "Collapse"}
          </Button>
          <span className="text-sm text-muted-foreground">
            External control
          </span>
        </div>

        <MediaUploadDropzone
          onUploadComplete={media => {
            toast.success(`${media.length} file(s) uploaded successfully!`);
          }}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        />
      </div>
    );
  },
};

/**
 * With upload callback - demonstrates how to handle successful uploads.
 * The callback receives an array of uploaded Media objects.
 * Try uploading files to see the toast notification and console output.
 */
export const WithUploadCallback: Story = {
  render: () => {
    const [uploadedCount, setUploadedCount] = useState(0);

    return (
      <div className="space-y-4">
        <MediaUploadDropzone
          onUploadComplete={media => {
            setUploadedCount(prev => prev + media.length);
            toast.success(
              `${media.length} file(s) uploaded! Total: ${uploadedCount + media.length}`
            );
            console.log("Uploaded media:", media);
          }}
        />

        {uploadedCount > 0 && (
          <div className="rounded border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Total files uploaded this session:{" "}
              <strong className="text-foreground">{uploadedCount}</strong>
            </p>
          </div>
        )}
      </div>
    );
  },
};

/**
 * Mobile responsive - demonstrates responsive sizing.
 * Height changes from 256px (desktop) to 176px (mobile).
 * Touch targets are 44×44px minimum on mobile for WCAG 2.2 AA compliance.
 *
 * Use Storybook's viewport toolbar to test different screen sizes:
 * - Mobile: 375px (iPhone SE)
 * - Tablet: 768px (iPad)
 * - Desktop: 1024px and above
 */
export const Responsive: Story = {
  render: () => {
    return (
      <div className="w-full">
        <div className="mb-4 rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            📱 Use the viewport toolbar above to test responsive behavior
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
            <li>Mobile (375px): 176px height, 44×44px touch targets</li>
            <li>Tablet (768px): 256px height</li>
            <li>Desktop (1024px+): 256px height, compact controls</li>
          </ul>
        </div>

        <MediaUploadDropzone
          onUploadComplete={media => {
            toast.success(`${media.length} file(s) uploaded successfully!`);
          }}
        />
      </div>
    );
  },
};

/**
 * Dark mode - demonstrates dark mode styling.
 * All visual states (default, hover, active, success, error) adapt to dark mode.
 * Border colors, backgrounds, and text colors adjust automatically.
 *
 * Toggle dark mode using Storybook's theme toolbar to see the differences.
 */
export const DarkMode: Story = {
  render: () => {
    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            🌙 Toggle dark mode using the theme toolbar above to see adaptive
            styling
          </p>
        </div>

        <MediaUploadDropzone
          onUploadComplete={media => {
            toast.success(`${media.length} file(s) uploaded successfully!`);
          }}
        />
      </div>
    );
  },
  parameters: {
    backgrounds: { default: "dark" },
  },
};

/**
 * Interactive demo - showcases all interactive states and features.
 * Try these interactions:
 * - Drag files over the dropzone (hover state)
 * - Drop files to upload (uploading → success/error)
 * - Click to browse files
 * - Upload multiple files at once (up to 10)
 * - Try invalid files (wrong type or too large)
 * - Collapse/expand the dropzone
 */
export const InteractiveDemo: Story = {
  render: () => {
    const [uploadHistory, setUploadHistory] = useState<
      Array<{ timestamp: Date; count: number; success: boolean }>
    >([]);

    return (
      <div className="space-y-6">
        <div className="rounded border border-border bg-muted p-4">
          <h3 className="mb-2 text-sm font-semibold">
            Try these interactions:
          </h3>
          <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
            <li>Drag files over the dropzone (see hover state)</li>
            <li>Drop files to start upload (see progress bars)</li>
            <li>Click anywhere in the dropzone to browse files</li>
            <li>Upload multiple files at once (max 10)</li>
            <li>Try invalid files (wrong type or &gt;5MB)</li>
            <li>Click chevron icon to collapse/expand</li>
          </ul>
        </div>

        <MediaUploadDropzone
          onUploadComplete={media => {
            setUploadHistory(prev => [
              ...prev,
              {
                timestamp: new Date(),
                count: media.length,
                success: true,
              },
            ]);
            toast.success(`${media.length} file(s) uploaded successfully!`);
          }}
        />

        {uploadHistory.length > 0 && (
          <div className="rounded border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Upload History</h3>
            <div className="space-y-2">
              {uploadHistory.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-muted-foreground">
                    {item.timestamp.toLocaleTimeString()}
                  </span>
                  <span className="font-medium text-foreground">
                    {item.count} file(s)
                  </span>
                  <span
                    className={
                      item.success
                        ? "text-green-600 dark:text-green-400"
                        : "text-destructive"
                    }
                  >
                    {item.success ? "✓ Success" : "✗ Failed"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
};

/**
 * File validation errors - demonstrates error handling for invalid files.
 * The component shows user-friendly error messages for:
 * - Files that are too large (>5MB)
 * - Invalid file types (not in accepted list)
 * - Too many files (>10)
 *
 * Error messages appear in a red Alert box below the dropzone.
 */
export const ValidationErrors: Story = {
  render: () => {
    return (
      <div className="space-y-4">
        <div className="rounded border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm text-amber-900 dark:text-amber-100">
            ⚠️ Try uploading invalid files to see error handling:
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-amber-800 dark:text-amber-200">
            <li>Files larger than 5MB</li>
            <li>Invalid file types (e.g., .zip, .exe, .txt)</li>
            <li>More than 10 files at once</li>
          </ul>
        </div>

        <MediaUploadDropzone
          onUploadComplete={media => {
            toast.success(`${media.length} file(s) uploaded successfully!`);
          }}
        />

        <div className="rounded border border-border bg-muted p-4">
          <h3 className="mb-2 text-sm font-semibold">Validation Rules</h3>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="font-medium text-foreground">Max file size:</dt>
              <dd className="text-muted-foreground">5MB per file</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Max files:</dt>
              <dd className="text-muted-foreground">10 files per upload</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Accepted types:</dt>
              <dd className="text-muted-foreground">
                Images: PNG, JPG, JPEG, GIF, WebP
                <br />
                Videos: MP4, MOV, AVI
                <br />
                Documents: PDF
              </dd>
            </div>
          </dl>
        </div>
      </div>
    );
  },
};
