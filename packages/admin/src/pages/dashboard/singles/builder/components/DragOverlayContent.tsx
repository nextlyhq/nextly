
import type {
  PaletteDragData,
  FieldListDragData,
} from "@admin/components/features/schema-builder";
import type { LucideIcon } from "@admin/components/icons";
import * as Icons from "@admin/components/icons";

// Icon mapping for DragOverlay
const iconMap = Icons as unknown as Record<string, LucideIcon>;

const OVERLAY_FIELD_TYPE_ICONS: Record<string, string> = {
  text: "Type",
  textarea: "AlignLeft",
  richText: "Edit",
  email: "Mail",
  password: "Lock",
  code: "Code",
  number: "Hash",
  checkbox: "CheckSquare",
  date: "Calendar",
  select: "List",
  radio: "Circle",
  upload: "Upload",
  relationship: "Link2",
  array: "Layers",
  group: "FolderOpen",
  blocks: "LayoutGrid",
  json: "Braces",
  tabs: "PanelTop",
  collapsible: "ChevronsUpDown",
  row: "Columns",
  point: "MapPin",
  slug: "Link",
};

/**
 * Drag Overlay Content
 *
 * Shows a full-fidelity preview of the item being dragged,
 * matching the actual field row appearance.
 */
interface DragOverlayContentProps {
  data: PaletteDragData | FieldListDragData;
}

export function DragOverlayContent({ data }: DragOverlayContentProps) {
  if (data.source === "palette") {
    const IconComponent = iconMap[data.icon] || Icons.FileText;
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/60 bg-background shadow-lg">
        <IconComponent className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-medium text-foreground">
          {data.label}
        </span>
      </div>
    );
  }

  // Field list item — render FULL field row identical to the actual SortableFieldItem
  const field = data.field;
  const iconName = OVERLAY_FIELD_TYPE_ICONS[field.type] || "FileText";
  const IconComponent = iconMap[iconName] || Icons.FileText;
  const isRequired = field.validation?.required;

  return (
    <div
      className="flex items-center gap-4 py-3 px-4 bg-background border border-border/60 rounded-xl shadow-lg cursor-grabbing"
      style={{ minWidth: 320 }}
    >
      {/* Drag handle */}
      <div className="p-1.5 shrink-0">
        <Icons.GripVertical className="h-4 w-4 text-primary" />
      </div>

      {/* Field type icon */}
      <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-md bg-muted/60 mr-1">
        <IconComponent className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Field info */}
      <div className="flex-1 flex flex-col items-start gap-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">
            {field.label || field.name || "Unnamed Field"}
          </span>
          {isRequired && (
            <span className="text-[10px] px-2 py-0 bg-red-50 text-red-600 font-normal rounded-full border border-red-200">
              Required
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <span>{field.name || "unnamed"}</span>
          <span className="text-[10px]">•</span>
          <span className="capitalize">{field.type}</span>
        </div>
      </div>
    </div>
  );
}
