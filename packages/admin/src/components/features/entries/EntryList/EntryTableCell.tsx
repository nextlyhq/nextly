/**
 * Entry Table Cell Renderer
 *
 * Renders cell content based on field type for the entry list table.
 * Each field type has a specialized renderer for optimal display.
 *
 * @module components/entries/EntryList/EntryTableCell
 * @since 1.0.0
 */

import type { FieldConfig } from "@revnixhq/nextly/config";
import { Avatar, AvatarFallback, AvatarImage, Badge } from "@revnixhq/ui";

import { Check, File, Image, X } from "@admin/components/icons";
import { formatDateTime } from "@admin/lib/dates/format";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the EntryTableCell component.
 */
export interface EntryTableCellProps {
  /** Field configuration defining the cell type */
  field: FieldConfig;
  /** Cell value to display */
  value: unknown;
  /** Full entry data for context */
  entry: Record<string, unknown>;
  /** Collection slug for relationship lookups */
  collectionSlug: string;
  /** Whether this field is the designated title field */
  isTitle?: boolean;
  /** Callback to trigger edit navigation */
  onEdit?: (id: string) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determines the badge variant based on common status values.
 * Maps status strings to appropriate visual styles.
 */
function getStatusVariant(
  value: string
): "default" | "primary" | "success" | "warning" | "destructive" | "outline" {
  const lowerValue = value.toLowerCase();

  // Success states
  if (
    [
      "published",
      "active",
      "approved",
      "completed",
      "enabled",
      "verified",
    ].includes(lowerValue)
  ) {
    return "success";
  }

  // Warning/pending states
  if (
    ["draft", "pending", "inactive", "paused", "review"].includes(lowerValue)
  ) {
    return "warning";
  }

  // Destructive states
  if (
    [
      "archived",
      "deleted",
      "rejected",
      "failed",
      "expired",
      "cancelled",
      "disabled",
    ].includes(lowerValue)
  ) {
    return "destructive";
  }

  // Primary states (featured, important)
  if (["featured", "important", "priority", "urgent"].includes(lowerValue)) {
    return "primary";
  }

  return "default";
}

/**
 * Extracts a display label from a relationship value.
 * Handles both populated objects and raw IDs.
 */
function getRelationshipLabel(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    // Try common title fields in order of preference
    const label = obj.title || obj.name || obj.label || obj.email || obj.id;
    if (label) {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(label);
    }
  }

  return "Related";
}

// ============================================================================
// Cell Renderer Components
// ============================================================================

/**
 * Renders truncated text with a title tooltip.
 */
function TextCell({
  value,
  maxLength = 80,
}: {
  value: string;
  maxLength?: number;
}) {
  const text = String(value);
  const needsTruncation = text.length > maxLength;
  const displayText = needsTruncation ? `${text.slice(0, maxLength)}...` : text;

  return (
    <span title={needsTruncation ? text : undefined} className="block truncate">
      {displayText}
    </span>
  );
}

/**
 * Renders a formatted date.
 */
function DateCell({ value }: { value: string }) {
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return <span className="text-muted-foreground">{String(value)}</span>;
    }

    return (
      <span className="text-sm whitespace-nowrap">{formatDateTime(value)}</span>
    );
  } catch {
    return <span className="text-muted-foreground">{String(value)}</span>;
  }
}

/**
 * Renders a select field value as a badge.
 */
function SelectCell({
  field,
  value,
}: {
  field: FieldConfig;
  value: string | string[];
}) {
  if (field.type !== "select" && field.type !== "radio") {
    return <span>{String(value)}</span>;
  }

  const selectField = field as FieldConfig & {
    options?: Array<{ label: string; value: string }>;
  };
  const options = selectField.options || [];

  // Handle multi-select (hasMany)
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.slice(0, 3).map((v, idx) => {
          const option = options.find(opt => opt.value === v);
          const label = option?.label || v;
          const variant = getStatusVariant(v);
          return (
            <Badge key={idx} variant={variant}>
              {label}
            </Badge>
          );
        })}
        {value.length > 3 && (
          <Badge variant="default">+{value.length - 3}</Badge>
        )}
      </div>
    );
  }

  // Single select
  const option = options.find(opt => opt.value === value);
  const label = option?.label || value;
  const variant = getStatusVariant(value);

  return <Badge variant={variant}>{label}</Badge>;
}

/**
 * Renders a relationship field value.
 */
function RelationshipCell({ value }: { value: unknown }) {
  // Handle array of relationships (hasMany)
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }

    return (
      <div className="flex flex-wrap gap-1">
        {value.slice(0, 3).map((item, idx) => (
          <Badge key={idx} variant="default">
            {getRelationshipLabel(item)}
          </Badge>
        ))}
        {value.length > 3 && (
          <Badge variant="default">+{value.length - 3}</Badge>
        )}
      </div>
    );
  }

  // Single relationship
  return <Badge variant="default">{getRelationshipLabel(value)}</Badge>;
}

/**
 * Renders an upload field value with image preview or file icon.
 */
function UploadCell({ value }: { value: unknown }) {
  const files = Array.isArray(value) ? value : [value];
  const validFiles = files.filter(f => f != null);

  if (validFiles.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  const firstFile = validFiles[0] as Record<string, unknown>;
  const mimeType = (firstFile.mimeType || firstFile.mime_type || "") as string;
  const isImage = mimeType.startsWith("image/");
  const thumbnailUrl = (firstFile.thumbnailUrl ||
    firstFile.thumbnail_url ||
    firstFile.url) as string | undefined;
  const filename = (firstFile.filename || firstFile.name || "File") as string;

  return (
    <div className="flex items-center gap-2">
      {isImage && thumbnailUrl ? (
        <Avatar size="md">
          <AvatarImage src={thumbnailUrl} alt={filename} />
          <AvatarFallback>
            <Image className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      ) : (
        <File className="h-4 w-4 text-muted-foreground" />
      )}
      {validFiles.length > 1 && (
        <Badge variant="default">+{validFiles.length - 1}</Badge>
      )}
    </div>
  );
}

/**
 * Renders an array field as an item count.
 */
function ArrayCell({ value }: { value: unknown[] }) {
  const count = value.length;
  return (
    <Badge variant="default">
      {count} {count === 1 ? "item" : "items"}
    </Badge>
  );
}

/**
 * Renders rich text by stripping HTML and truncating.
 */
function RichTextCell({ value }: { value: unknown }) {
  // Handle both string HTML and structured content (like Slate/ProseMirror JSON)
  let text: string;

  if (typeof value === "string") {
    // Strip HTML tags
    text = value.replace(/<[^>]*>/g, "");
  } else if (typeof value === "object" && value !== null) {
    // Try to extract text from structured content
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  const maxLength = 80;
  const truncated =
    text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;

  return (
    <span
      className="text-muted-foreground"
      title={text.length > maxLength ? text : undefined}
    >
      {truncated}
    </span>
  );
}

/**
 * Renders a JSON field as a truncated code preview.
 */
function JsonCell({ value }: { value: unknown }) {
  const jsonStr = JSON.stringify(value);
  const maxLength = 40;
  const truncated =
    jsonStr.length > maxLength ? `${jsonStr.slice(0, maxLength)}...` : jsonStr;

  return (
    <code className="text-xs bg-primary/5 px-1.5 py-0.5 rounded-none font-mono">
      {truncated}
    </code>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Renders a table cell based on field type.
 *
 * Handles all field types with appropriate formatting:
 * - Text fields: Truncated text with tooltip
 * - Number fields: Formatted numbers (monospace)
 * - Checkbox: Check/X icons
 * - Date: Formatted date strings
 * - Select/Radio: Badge with status-aware coloring
 * - Relationship: Badge with document label
 * - Upload: Image thumbnail or file icon
 * - Array: Item count badge
 * - Blocks: Block count badge
 * - Rich Text: Plain text excerpt
 * - JSON: Code preview
 * - Point: Coordinates display
 * - Slug: Monospace text
 * - Code: Monospace text
 * - Group: Group indicator
 *
 * @param props - Cell props with field config and value
 * @returns Rendered cell content
 *
 * @example
 * ```tsx
 * <EntryTableCell
 *   field={{ type: 'text', name: 'title' }}
 *   value="My Blog Post Title"
 *   entry={row.original}
 *   collectionSlug="posts"
 * />
 * ```
 */
export function EntryTableCell({
  field,
  value,
  isTitle,
  entry,
  onEdit,
}: EntryTableCellProps) {
  // Wrap content if it's a title
  const renderContent = (content: React.ReactNode) => {
    if (isTitle && onEdit) {
      return (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onEdit(String(entry.id));
          }}
          className="font-semibold text-foreground hover-unified transition-colors text-left w-fit cursor-pointer"
        >
          {content}
        </button>
      );
    }
    return content;
  };

  // Null/undefined/empty handling
  if (value === null || value === undefined || value === "") {
    return renderContent(<span className="text-muted-foreground">-</span>);
  }

  // Cast to string to allow legacy "string" type which isn't in the FieldConfig union
  const fieldType = field.type as string;
  switch (fieldType) {
    // Text-based fields
    case "text":
    case "string": // Legacy alias - some collections store 'string' instead of 'text'
    case "textarea":
    case "email":
    case "password": {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return renderContent(<TextCell value={String(value)} />);
    }

    case "slug":
    case "code": {
      // Monospace for technical fields
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const text = String(value);
      const maxLength = 50;
      const truncated =
        text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
      return renderContent(
        <code
          className="text-sm font-mono"
          title={text.length > maxLength ? text : undefined}
        >
          {truncated}
        </code>
      );
    }

    // Numeric field
    case "number": {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const num = typeof value === "number" ? value : parseFloat(String(value));
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const formatted = isNaN(num) ? String(value) : num.toLocaleString();
      return renderContent(
        <span className="font-mono tabular-nums">{formatted}</span>
      );
    }

    // Boolean field
    case "checkbox": {
      return (
        <span className="flex items-center justify-center">
          {value ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <X className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      );
    }

    // Date field
    case "date": {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return renderContent(<DateCell value={String(value)} />);
    }

    // Selection fields
    case "select":
    case "radio": {
      return renderContent(
        <SelectCell field={field} value={value as string | string[]} />
      );
    }

    // Relational field
    case "relationship": {
      return renderContent(<RelationshipCell value={value} />);
    }

    // Media field
    case "upload": {
      return <UploadCell value={value} />;
    }

    // Structured fields
    case "repeater": {
      if (Array.isArray(value)) {
        return <ArrayCell value={value} />;
      }
      return <span className="text-muted-foreground">-</span>;
    }

    case "blocks": {
      if (Array.isArray(value)) {
        const count = value.length;
        return (
          <Badge variant="default">
            {count} {count === 1 ? "block" : "blocks"}
          </Badge>
        );
      }
      return <span className="text-muted-foreground">-</span>;
    }

    case "group": {
      return <Badge variant="default">Group</Badge>;
    }

    // Rich content
    case "richText": {
      return renderContent(<RichTextCell value={value} />);
    }

    // JSON data
    case "json": {
      return renderContent(<JsonCell value={value} />);
    }

    // Geographic point
    case "point": {
      if (Array.isArray(value) && value.length === 2) {
        const [lng, lat] = value as [number, number];
        return (
          <span className="font-mono text-xs whitespace-nowrap">
            {lat.toFixed(4)}, {lng.toFixed(4)}
          </span>
        );
      }
      return <span className="text-muted-foreground">-</span>;
    }

    // Layout fields (should not appear in table, but handle gracefully)
    case "tabs":
    case "collapsible":
    case "row":
    case "ui": {
      return <span className="text-muted-foreground">-</span>;
    }

    // Fallback for unknown types
    default: {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return renderContent(<span>{String(value)}</span>);
    }
  }
}
