import { toast } from "@revnixhq/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import type { Media } from "@admin/types/media";

import { MediaGrid } from "./index";

/**
 * MediaGrid Component Stories
 *
 * Responsive grid container for displaying media cards in a 2-6 column layout.
 * Handles loading, empty, and error states with appropriate UI feedback.
 *
 * ## Features
 *
 * - **Responsive grid**: 2 columns (mobile), 4 columns (tablet), 6 columns (desktop)
 * - **Loading state**: Shows skeleton placeholders while fetching
 * - **Empty state**: Friendly message when no media items exist
 * - **Error state**: Retry button for failed requests
 * - **Selection management**: Tracks selected items across the grid
 * - **Action handlers**: Click, select, edit, delete, copy URL, download
 * - **Accessible**: WCAG 2.2 AA compliant with keyboard navigation
 *
 * ## Responsive Breakpoints
 *
 * | Breakpoint | Columns | Width |
 * |------------|---------|-------|
 * | Mobile | 2 | < 768px |
 * | Tablet | 4 | 768px - 1024px |
 * | Desktop | 6 | ≥ 1024px |
 *
 */
const meta = {
  title: "Components/Media Library/MediaGrid",
  component: MediaGrid,
  decorators: [
    Story => (
      <div className="w-full max-w-6xl">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Responsive grid container displaying media cards with 2-6 column layout. Handles loading, empty, and error states with appropriate visual feedback and user actions.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MediaGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock media data
const mockMediaItems: Media[] = [
  {
    id: "1",
    filename: "beach-sunset.jpg",
    originalFilename: "beach-sunset.jpg",
    mimeType: "image/jpeg",
    size: 2458624,
    width: 1920,
    height: 1080,
    duration: null,
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=400&fit=crop",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=400&fit=crop",
    altText: "Beautiful beach sunset",
    caption: null,
    tags: ["nature", "beach"],
    folderId: null,
    uploadedBy: "user-1",
    uploadedAt: new Date("2024-01-15T10:30:00Z"),
    updatedAt: new Date("2024-01-15T10:30:00Z"),
  },
  {
    id: "2",
    filename: "mountain-landscape.jpg",
    originalFilename: "mountain-landscape.jpg",
    mimeType: "image/jpeg",
    size: 3145728,
    width: 2560,
    height: 1440,
    duration: null,
    url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop",
    altText: "Mountain landscape",
    caption: null,
    tags: ["nature", "mountain"],
    folderId: null,
    uploadedBy: "user-1",
    uploadedAt: new Date("2024-01-14T14:20:00Z"),
    updatedAt: new Date("2024-01-14T14:20:00Z"),
  },
  {
    id: "3",
    filename: "city-night.jpg",
    originalFilename: "city-night.jpg",
    mimeType: "image/jpeg",
    size: 1835008,
    width: 1920,
    height: 1080,
    duration: null,
    url: "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400&h=400&fit=crop",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400&h=400&fit=crop",
    altText: "City at night",
    caption: null,
    tags: ["city", "night"],
    folderId: null,
    uploadedBy: "user-2",
    uploadedAt: new Date("2024-01-13T09:15:00Z"),
    updatedAt: new Date("2024-01-13T09:15:00Z"),
  },
  {
    id: "4",
    filename: "intro-video.mp4",
    originalFilename: "intro-video.mp4",
    mimeType: "video/mp4",
    size: 4892160,
    width: 1280,
    height: 720,
    duration: 30,
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&h=400&fit=crop",
    altText: null,
    caption: "Product intro",
    tags: ["video", "intro"],
    folderId: null,
    uploadedBy: "user-1",
    uploadedAt: new Date("2024-01-12T16:45:00Z"),
    updatedAt: new Date("2024-01-12T16:45:00Z"),
  },
  {
    id: "5",
    filename: "annual-report.pdf",
    originalFilename: "annual-report-2024.pdf",
    mimeType: "application/pdf",
    size: 1572864,
    width: null,
    height: null,
    duration: null,
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    thumbnailUrl: null,
    altText: null,
    caption: null,
    tags: ["report"],
    folderId: null,
    uploadedBy: "user-2",
    uploadedAt: new Date("2024-01-11T11:00:00Z"),
    updatedAt: new Date("2024-01-11T11:00:00Z"),
  },
  {
    id: "6",
    filename: "forest-path.jpg",
    originalFilename: "forest-path.jpg",
    mimeType: "image/jpeg",
    size: 2097152,
    width: 1920,
    height: 1080,
    duration: null,
    url: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&h=400&fit=crop",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&h=400&fit=crop",
    altText: "Forest path",
    caption: null,
    tags: ["nature", "forest"],
    folderId: null,
    uploadedBy: "user-3",
    uploadedAt: new Date("2024-01-10T08:30:00Z"),
    updatedAt: new Date("2024-01-10T08:30:00Z"),
  },
];

/**
 * Loading state - shows skeleton placeholders while fetching media.
 * Displays 12 skeleton cards by default in responsive grid.
 * Screen readers announce "Loading media items..." via aria-busy.
 */
export const Loading: Story = {
  args: {
    media: [],
    isLoading: true,
    error: null,
    selectedIds: new Set(),
    onSelectionChange: () => {},
    onItemClick: () => {},
    onRetry: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: async () => {},
    onDownload: () => {},
  },
};

/**
 * With media items - displays grid with 6 media items.
 * Shows images, videos, and documents with type-specific icons and badges.
 * Try selecting items to see selection state.
 */
export const WithMedia: Story = {
  args: {
    media: mockMediaItems,
    isLoading: false,
    error: null,
    selectedIds: new Set(),
    onSelectionChange: () => {},
    onItemClick: () => {},
    onRetry: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: async () => {},
    onDownload: () => {},
  },
};

/**
 * Empty state - friendly message when no media items exist.
 * Shows folder icon, clear message, and role="status" for screen readers.
 */
export const Empty: Story = {
  args: {
    media: [],
    isLoading: false,
    error: null,
    selectedIds: new Set(),
    onSelectionChange: () => {},
    onItemClick: () => {},
    onRetry: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: async () => {},
    onDownload: () => {},
  },
};

/**
 * Error state - shows error alert with retry button.
 * Uses destructive Alert variant with AlertTriangle icon.
 * Retry button triggers onRetry callback.
 */
export const ErrorState: Story = {
  args: {
    media: [],
    isLoading: false,
    error: new Error("Failed to load media items. Please try again."),
    selectedIds: new Set(),
    onSelectionChange: () => {},
    onItemClick: () => {},
    onRetry: () => {
      toast.success("Retrying...");
    },
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: async () => {},
    onDownload: () => {},
  },
};

/**
 * With selection - demonstrates selection state management.
 * Try:
 * - Click cards or checkboxes to select items
 * - See selection count update
 * - Selected cards have blue border and ring
 */
export const WithSelection: Story = {
  args: {
    media: mockMediaItems,
    isLoading: false,
    error: null,
    selectedIds: new Set(),
    onSelectionChange: () => {},
    onItemClick: () => {},
    onRetry: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: async () => {},
    onDownload: () => {},
  },
  render: function WithSelectionStory() {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const handleSelectionChange = (mediaId: string) => {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (prev.has(mediaId)) {
          next.delete(mediaId);
        } else {
          next.add(mediaId);
        }
        return next;
      });
    };

    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            Selected: {selectedIds.size} / {mockMediaItems.length} items
          </p>
          {selectedIds.size > 0 && (
            <button
              className="mt-2 text-xs text-primary-500 hover:underline"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </button>
          )}
        </div>

        <MediaGrid
          media={mockMediaItems}
          isLoading={false}
          error={null}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
          onItemClick={media => {
            console.log("Item clicked:", media.filename);
          }}
          onRetry={() => {}}
          onEdit={media => {
            toast.success(`Edit: ${media.filename}`);
          }}
          onDelete={media => {
            toast.error(`Delete: ${media.filename}`);
          }}
          onCopyUrl={async url => {
            await navigator.clipboard.writeText(url);
            toast.success("URL copied!");
          }}
          onDownload={media => {
            toast.success(`Download: ${media.filename}`);
          }}
        />
      </div>
    );
  },
};

/**
 * Interactive demo - full feature demonstration with all handlers.
 * Try:
 * - Select/deselect items
 * - Click action menu items (Edit, Delete, Copy URL, Download)
 * - See toast notifications for actions
 */
export const Interactive: Story = {
  args: {
    media: mockMediaItems,
    isLoading: false,
    error: null,
    selectedIds: new Set(),
    onSelectionChange: () => {},
    onItemClick: () => {},
    onRetry: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: async () => {},
    onDownload: () => {},
  },
  render: function InteractiveStory() {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [media, setMedia] = useState(mockMediaItems);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<globalThis.Error | null>(null);

    const handleSelectionChange = (mediaId: string) => {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (prev.has(mediaId)) {
          next.delete(mediaId);
        } else {
          next.add(mediaId);
        }
        return next;
      });
    };

    const handleDelete = (mediaToDelete: Media) => {
      setMedia(prev => prev.filter(item => item.id !== mediaToDelete.id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(mediaToDelete.id);
        return next;
      });
      toast.success(`Deleted: ${mediaToDelete.filename}`);
    };

    const handleRetry = () => {
      setIsLoading(true);
      setError(null);
      setTimeout(() => {
        setIsLoading(false);
        setMedia(mockMediaItems);
        toast.success("Media loaded successfully!");
      }, 1000);
    };

    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {media.length} items • {selectedIds.size} selected
            </p>
            <div className="flex gap-2">
              <button
                className="text-xs text-primary-500 hover:underline"
                onClick={() =>
                  setError(new globalThis.Error("Simulated error"))
                }
              >
                Simulate error
              </button>
              {selectedIds.size > 0 && (
                <button
                  className="text-xs text-primary-500 hover:underline"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear selection
                </button>
              )}
            </div>
          </div>
        </div>

        <MediaGrid
          media={media}
          isLoading={isLoading}
          error={error}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
          onItemClick={item => {
            console.log("Item clicked:", item.filename);
          }}
          onRetry={handleRetry}
          onEdit={item => {
            toast.success(`Edit: ${item.filename}`);
            console.log("Edit:", item);
          }}
          onDelete={handleDelete}
          onCopyUrl={async url => {
            await navigator.clipboard.writeText(url);
            toast.success("URL copied!");
          }}
          onDownload={item => {
            toast.success(`Download: ${item.filename}`);
            console.log("Download:", item);
          }}
        />
      </div>
    );
  },
};

/**
 * Responsive behavior - demonstrates responsive grid columns.
 * Use Storybook's viewport toolbar to test:
 * - Mobile (375px): 2 columns
 * - Tablet (768px): 4 columns
 * - Desktop (1024px+): 6 columns
 */
export const Responsive: Story = {
  args: {
    media: mockMediaItems,
    isLoading: false,
    error: null,
    selectedIds: new Set(),
    onSelectionChange: () => {},
    onItemClick: () => {},
    onRetry: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: async () => {},
    onDownload: () => {},
  },
  render: function ResponsiveStory() {
    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            📱 Use the viewport toolbar to test responsive columns
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
            <li>Mobile (&lt;768px): 2 columns</li>
            <li>Tablet (768px-1024px): 4 columns</li>
            <li>Desktop (≥1024px): 6 columns</li>
          </ul>
        </div>

        <MediaGrid
          media={mockMediaItems}
          isLoading={false}
          error={null}
          selectedIds={new Set()}
          onSelectionChange={() => {}}
          onItemClick={() => {}}
          onRetry={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
          onCopyUrl={async () => {}}
          onDownload={() => {}}
        />
      </div>
    );
  },
};

/**
 * Dark mode - demonstrates dark mode styling.
 * Grid, cards, borders, and backgrounds adapt to dark mode.
 * Toggle dark mode using Storybook's theme toolbar.
 */
export const DarkMode: Story = {
  args: {
    media: mockMediaItems,
    isLoading: false,
    error: null,
    selectedIds: new Set(["1", "3"]),
    onSelectionChange: () => {},
    onItemClick: () => {},
    onRetry: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: async () => {},
    onDownload: () => {},
  },
  render: function DarkModeStory() {
    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            🌙 Toggle dark mode using the theme toolbar above
          </p>
        </div>

        <MediaGrid
          media={mockMediaItems}
          isLoading={false}
          error={null}
          selectedIds={new Set(["1", "3"])}
          onSelectionChange={() => {}}
          onItemClick={() => {}}
          onRetry={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
          onCopyUrl={async () => {}}
          onDownload={() => {}}
        />
      </div>
    );
  },
  parameters: {
    backgrounds: { default: "dark" },
  },
};
