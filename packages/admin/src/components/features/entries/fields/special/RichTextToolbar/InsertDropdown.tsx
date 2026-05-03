/**
 * Insert Dropdown Component
 *
 * Dropdown for inserting media and interactive elements (links, images, videos,
 * tables, buttons, collapsibles, galleries) in the rich text editor toolbar.
 *
 * @module components/entries/fields/special/RichTextToolbar/InsertDropdown
 * @since 1.0.0
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@revnixhq/ui";

import {
  ChevronDown,
  ChevronDownSquare,
  Columns,
  GalleryHorizontalEnd,
  Image,
  Link,
  MousePointerClick,
  Plus,
  Table,
  Video,
} from "@admin/components/icons";

// ============================================================
// Types
// ============================================================

export interface InsertDropdownProps {
  disabled: boolean;
  isLink: boolean;
  hasFeature: (feature: string) => boolean;
  toggleLink: () => void;
  insertImage: () => void;
  insertVideo: () => void;
  insertButtonLink: () => void;
  insertButtonGroup: () => void;
  insertTable: () => void;
  insertCollapsible: () => void;
  insertGallery: () => void;
}

// ============================================================
// Component
// ============================================================

export function InsertDropdown({
  disabled,
  isLink,
  hasFeature,
  toggleLink,
  insertImage,
  insertVideo,
  insertButtonLink,
  insertButtonGroup,
  insertTable,
  insertCollapsible,
  insertGallery,
}: InsertDropdownProps) {
  const hasMediaItems = hasFeature("upload") || hasFeature("video");
  const hasInteractiveItems =
    hasFeature("table") ||
    hasFeature("buttonLink") ||
    hasFeature("buttonGroup");
  const hasLayoutItems = hasFeature("collapsible") || hasFeature("gallery");

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="h-8 gap-1 px-2 text-xs"
          disabled={disabled}
        >
          <Plus className="h-4 w-4" />
          <span>Insert</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {hasFeature("link") && (
          <DropdownMenuItem className="gap-2" onSelect={toggleLink}>
            <Link className="h-4 w-4" />
            <span>Link</span>
            {isLink && (
              <span className="ml-auto text-xs text-muted-foreground">✓</span>
            )}
            {!isLink && (
              <span className="ml-auto text-xs tracking-widest opacity-60">
                Ctrl+K
              </span>
            )}
          </DropdownMenuItem>
        )}

        {hasFeature("link") && hasMediaItems && <DropdownMenuSeparator />}
        {hasFeature("upload") && (
          <DropdownMenuItem className="gap-2" onSelect={insertImage}>
            <Image className="h-4 w-4" />
            <span>Image</span>
          </DropdownMenuItem>
        )}
        {hasFeature("video") && (
          <DropdownMenuItem className="gap-2" onSelect={insertVideo}>
            <Video className="h-4 w-4" />
            <span>Video</span>
          </DropdownMenuItem>
        )}

        {(hasFeature("link") || hasMediaItems) && hasInteractiveItems && (
          <DropdownMenuSeparator />
        )}
        {hasFeature("table") && (
          <DropdownMenuItem className="gap-2" onSelect={insertTable}>
            <Table className="h-4 w-4" />
            <span>Table</span>
          </DropdownMenuItem>
        )}
        {hasFeature("buttonLink") && (
          <DropdownMenuItem className="gap-2" onSelect={insertButtonLink}>
            <MousePointerClick className="h-4 w-4" />
            <span>Button Link</span>
          </DropdownMenuItem>
        )}
        {hasFeature("buttonGroup") && (
          <DropdownMenuItem className="gap-2" onSelect={insertButtonGroup}>
            <Columns className="h-4 w-4" />
            <span>Button Group</span>
          </DropdownMenuItem>
        )}

        {(hasFeature("link") || hasMediaItems || hasInteractiveItems) &&
          hasLayoutItems && <DropdownMenuSeparator />}
        {hasFeature("collapsible") && (
          <DropdownMenuItem className="gap-2" onSelect={insertCollapsible}>
            <ChevronDownSquare className="h-4 w-4" />
            <span>Collapsible</span>
          </DropdownMenuItem>
        )}
        {hasFeature("gallery") && (
          <DropdownMenuItem className="gap-2" onSelect={insertGallery}>
            <GalleryHorizontalEnd className="h-4 w-4" />
            <span>Gallery</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
