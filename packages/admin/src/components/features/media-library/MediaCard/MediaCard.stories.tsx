import { toast } from "@revnixhq/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import type { Media } from "@admin/types/media";

import { MediaCard } from "./index";

/**
 * MediaCard Component Stories
 *
 * Individual media card component displaying a single media item with thumbnail,
 * filename, type badge, selection checkbox, and action menu.
 *
 * ## Features
 *
 * - **Aspect-square layout**: Consistent 1:1 aspect ratio for grid alignment
 * - **Selection checkbox**: Top-left overlay for bulk operations
 * - **Action menu**: Top-right dropdown with Edit, Copy URL, Download, Delete
 * - **Type badge**: Color-coded badge based on MIME type (image/video/document/audio)
 * - **Visual states**: Default, hover, selected, focus
 * - **Responsive**: Touch targets scale from 44×44px (mobile) to 20×20px/32×32px (desktop)
 * - **Accessible**: WCAG 2.2 AA compliant with keyboard navigation
 *
 * ## Keyboard Shortcuts
 *
 * | Key | Action |
 * |-----|--------|
 * | `Tab` | Focus the card |
 * | `Enter` or `Space` | Toggle selection |
 * | `Arrow keys` | Navigate between cards |
 *
 */
const meta = {
  title: "Components/Media Library/MediaCard",
  component: MediaCard,
  decorators: [
    Story => (
      <div className="w-full max-w-sm">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Individual media card displaying thumbnail, metadata, selection checkbox, and action menu. Supports all media types (images, videos, documents, audio) with type-specific icons and badges.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MediaCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock media data
const mockImageMedia: Media = {
  id: "1",
  filename: "beach-sunset.jpg",
  originalFilename: "beach-sunset.jpg",
  mimeType: "image/jpeg",
  size: 2458624, // ~2.4 MB
  width: 1920,
  height: 1080,
  duration: null,
  url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=400&fit=crop",
  thumbnailUrl:
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=400&fit=crop",
  altText: "Beautiful beach sunset with orange sky",
  caption: null,
  tags: ["nature", "beach", "sunset"],
  folderId: null,
  uploadedBy: "user-1",
  uploadedAt: new Date("2024-01-15T10:30:00Z"),
  updatedAt: new Date("2024-01-15T10:30:00Z"),
};

const mockVideoMedia: Media = {
  id: "2",
  filename: "intro-animation.mp4",
  originalFilename: "intro-animation.mp4",
  mimeType: "video/mp4",
  size: 4892160, // ~4.7 MB
  width: 1280,
  height: 720,
  duration: 30,
  url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  thumbnailUrl:
    "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&h=400&fit=crop",
  altText: null,
  caption: "Product intro animation",
  tags: ["animation", "intro"],
  folderId: null,
  uploadedBy: "user-1",
  uploadedAt: new Date("2024-01-14T14:20:00Z"),
  updatedAt: new Date("2024-01-14T14:20:00Z"),
};

const mockPdfMedia: Media = {
  id: "3",
  filename: "annual-report-2024.pdf",
  originalFilename: "annual-report-2024.pdf",
  mimeType: "application/pdf",
  size: 1572864, // ~1.5 MB
  width: null,
  height: null,
  duration: null,
  url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
  thumbnailUrl: null,
  altText: null,
  caption: null,
  tags: ["report", "2024"],
  folderId: null,
  uploadedBy: "user-2",
  uploadedAt: new Date("2024-01-13T09:15:00Z"),
  updatedAt: new Date("2024-01-13T09:15:00Z"),
};

const mockAudioMedia: Media = {
  id: "4",
  filename: "podcast-episode-42.mp3",
  originalFilename: "podcast-episode-42.mp3",
  mimeType: "audio/mpeg",
  size: 3145728, // ~3 MB
  width: null,
  height: null,
  duration: 1800, // 30 minutes
  url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  thumbnailUrl: null,
  altText: null,
  caption: "Episode 42: Building Modern Web Apps",
  tags: ["podcast", "web-development"],
  folderId: null,
  uploadedBy: "user-3",
  uploadedAt: new Date("2024-01-12T16:45:00Z"),
  updatedAt: new Date("2024-01-12T16:45:00Z"),
};

/**
 * Default state - image media card with thumbnail.
 * Shows filename, type badge (green "Image"), checkbox, and action menu.
 * Hover to see scale-up animation and shadow.
 */
export const ImageMedia: Story = {
  args: {
    media: mockImageMedia,
    isSelected: false,
    onSelectionChange: () => {},
    onClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: () => {},
    onDownload: () => {},
  },
};

/**
 * Video media card - displays video thumbnail with play icon overlay.
 * Type badge shows "Video" in blue (primary variant).
 */
export const VideoMedia: Story = {
  args: {
    media: mockVideoMedia,
    isSelected: false,
    onSelectionChange: () => {},
    onClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: () => {},
    onDownload: () => {},
  },
};

/**
 * Document media (PDF) - displays document icon fallback (no thumbnail).
 * Type badge shows "Document" in default variant.
 */
export const DocumentMedia: Story = {
  args: {
    media: mockPdfMedia,
    isSelected: false,
    onSelectionChange: () => {},
    onClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: () => {},
    onDownload: () => {},
  },
};

/**
 * Audio media card - displays music icon fallback.
 * Type badge shows "Audio" in amber (warning variant).
 */
export const AudioMedia: Story = {
  args: {
    media: mockAudioMedia,
    isSelected: false,
    onSelectionChange: () => {},
    onClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: () => {},
    onDownload: () => {},
  },
};

/**
 * Selected state - card with blue border and ring.
 * Checkbox is checked, no hover scale animation.
 * Border is 2px solid primary-500 with ring-2 ring-primary-500.
 */
export const Selected: Story = {
  args: {
    media: mockImageMedia,
    isSelected: true,
    onSelectionChange: () => {},
    onClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: () => {},
    onDownload: () => {},
  },
};

/**
 * With action handlers - demonstrates all interactive features.
 * Try:
 * - Click card to select/deselect
 * - Click checkbox to toggle selection
 * - Open action menu (⋮ icon) and try actions
 * - Hover to see scale-up animation
 */
export const Interactive: Story = {
  args: {
    media: mockImageMedia,
    isSelected: false,
    onSelectionChange: () => {},
    onClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: () => {},
    onDownload: () => {},
  },
  render: function InteractiveStory() {
    const [isSelected, setIsSelected] = useState(false);

    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            Try these interactions:
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
            <li>Click card or checkbox to select</li>
            <li>Open action menu (⋮ icon) to try actions</li>
            <li>Hover to see scale-up animation</li>
          </ul>
        </div>

        <MediaCard
          media={mockImageMedia}
          isSelected={isSelected}
          onSelectionChange={() => setIsSelected(!isSelected)}
          onClick={() => setIsSelected(!isSelected)}
          onEdit={media => {
            toast.success(`Edit: ${media.filename}`);
            console.log("Edit:", media);
          }}
          onDelete={media => {
            toast.error(`Delete: ${media.filename}`);
            console.log("Delete:", media);
          }}
          onCopyUrl={async url => {
            await navigator.clipboard.writeText(url);
            toast.success("URL copied to clipboard");
            console.log("Copy URL:", url);
          }}
          onDownload={media => {
            toast.success(`Download: ${media.filename}`);
            console.log("Download:", media);
          }}
        />

        <div className="rounded border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Selection state:{" "}
            <strong className="text-foreground">
              {isSelected ? "Selected" : "Not selected"}
            </strong>
          </p>
        </div>
      </div>
    );
  },
};

/**
 * Grid layout - demonstrates multiple cards in grid.
 * Shows how cards align in the 2-6 column responsive grid.
 */
export const InGrid: Story = {
  args: {
    media: mockImageMedia,
    isSelected: false,
    onSelectionChange: () => {},
    onClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: () => {},
    onDownload: () => {},
  },
  render: function InGridStory() {
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
      <div className="w-full max-w-4xl space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            Selected: {selectedIds.size} item(s)
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MediaCard
            media={mockImageMedia}
            isSelected={selectedIds.has(mockImageMedia.id)}
            onSelectionChange={() => handleSelectionChange(mockImageMedia.id)}
            onClick={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onCopyUrl={async () => {}}
            onDownload={() => {}}
          />
          <MediaCard
            media={mockVideoMedia}
            isSelected={selectedIds.has(mockVideoMedia.id)}
            onSelectionChange={() => handleSelectionChange(mockVideoMedia.id)}
            onClick={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onCopyUrl={async () => {}}
            onDownload={() => {}}
          />
          <MediaCard
            media={mockPdfMedia}
            isSelected={selectedIds.has(mockPdfMedia.id)}
            onSelectionChange={() => handleSelectionChange(mockPdfMedia.id)}
            onClick={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onCopyUrl={async () => {}}
            onDownload={() => {}}
          />
          <MediaCard
            media={mockAudioMedia}
            isSelected={selectedIds.has(mockAudioMedia.id)}
            onSelectionChange={() => handleSelectionChange(mockAudioMedia.id)}
            onClick={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onCopyUrl={async () => {}}
            onDownload={() => {}}
          />
        </div>
      </div>
    );
  },
};

/**
 * Responsive behavior - demonstrates responsive touch targets.
 * Checkbox: 44×44px mobile → 20×20px desktop
 * Action menu: 44×44px mobile → 32×32px desktop
 *
 * Use Storybook's viewport toolbar to test different screen sizes.
 */
export const Responsive: Story = {
  args: {
    media: mockImageMedia,
    isSelected: false,
    onSelectionChange: () => {},
    onClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: () => {},
    onDownload: () => {},
  },
  render: function ResponsiveStory() {
    return (
      <div className="w-full max-w-2xl space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            📱 Use the viewport toolbar to test responsive touch targets
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
            <li>Mobile (&lt;768px): Checkbox 44×44px, Menu 44×44px</li>
            <li>Desktop (≥768px): Checkbox 20×20px, Menu 32×32px</li>
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <MediaCard
            media={mockImageMedia}
            isSelected={false}
            onSelectionChange={() => {}}
            onClick={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onCopyUrl={async () => {}}
            onDownload={() => {}}
          />
          <MediaCard
            media={mockVideoMedia}
            isSelected={true}
            onSelectionChange={() => {}}
            onClick={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onCopyUrl={async () => {}}
            onDownload={() => {}}
          />
        </div>
      </div>
    );
  },
};

/**
 * Dark mode - demonstrates dark mode styling.
 * Border, background, text colors, and badge colors adapt to dark mode.
 *
 * Toggle dark mode using Storybook's theme toolbar.
 */
export const DarkMode: Story = {
  args: {
    media: mockImageMedia,
    isSelected: false,
    onSelectionChange: () => {},
    onClick: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onCopyUrl: () => {},
    onDownload: () => {},
  },
  render: function DarkModeStory() {
    return (
      <div className="w-full max-w-2xl space-y-4">
        <div className="rounded border border-border bg-muted p-4">
          <p className="text-sm text-muted-foreground">
            🌙 Toggle dark mode using the theme toolbar above
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <MediaCard
            media={mockImageMedia}
            isSelected={false}
            onSelectionChange={() => {}}
            onClick={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onCopyUrl={async () => {}}
            onDownload={() => {}}
          />
          <MediaCard
            media={mockVideoMedia}
            isSelected={true}
            onSelectionChange={() => {}}
            onClick={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onCopyUrl={async () => {}}
            onDownload={() => {}}
          />
        </div>
      </div>
    );
  },
  parameters: {
    backgrounds: { default: "dark" },
  },
};
