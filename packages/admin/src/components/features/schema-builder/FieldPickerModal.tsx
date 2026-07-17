// Why: searchable single-scroll modal for picking a field type. Replaces the
// legacy FieldPalette accordion. Selecting a type closes the picker and the
// parent page is responsible for opening the FieldEditorSheet (so this
// component stays a pure picker — no knowledge of the editor below).
//
// Search filters across name, one-line hint, and category, so a user can
// type "json" or "media" and find the matching rows regardless of where
// they live.
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@nextlyhq/ui";
import { useMemo, useState } from "react";

import { usePluginFieldTypeEntries } from "@admin/components/field-ui";
import * as Icons from "@admin/components/icons";
import type { LucideIcon } from "@admin/components/icons";
import { UI_SCHEMA_FIELD_TYPES } from "@admin/lib/builder/ui-schema-mode";
import type { FieldTypeId } from "@admin/types/collection";

import {
  FIELD_TYPES_CATALOG,
  type FieldTypeCategory,
  type FieldTypeEntry,
} from "./field-picker-modal/field-types-catalog";

// Why: catalog stores Lucide icon names as strings; resolve them lazily
// here instead of importing each named icon at the top. Defaults to
// FileText if a name doesn't resolve (defensive -- the catalog test
// pins the icon column so this fallback shouldn't fire in practice).
const iconMap = Icons as unknown as Record<string, LucideIcon>;
function resolveIcon(name: string): LucideIcon {
  return iconMap[name] ?? Icons.FileText;
}

type Props = {
  open: boolean;
  excludedTypes: readonly FieldTypeId[];
  onCancel: () => void;
  onSelect: (type: FieldTypeId) => void;
  /** Title override — used when nesting (e.g., "Add field to author"). */
  title?: string;
};

const CATEGORY_ORDER: readonly FieldTypeCategory[] = [
  "Basic",
  "Advanced",
  "Media",
  "Relational",
  "Structured",
];

export function FieldPickerModal({
  open,
  excludedTypes,
  onCancel,
  onSelect,
  title = "Add field",
}: Props) {
  const [query, setQuery] = useState("");

  // Plugin field types that opted into the entry/single editing surface, merged
  // in below the built-ins. They are exempt from the ui-schema allowlist — a
  // plugin type persists as one of its own storage primitives, not as a
  // canonical ui-schema type, so gating it on that allowlist would hide every
  // plugin field.
  const pluginEntries = usePluginFieldTypeEntries("entries");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (e: FieldTypeEntry) =>
      q === "" ||
      e.label.toLowerCase().includes(q) ||
      e.hint.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q);

    // The manifest is always written now (both database and file mode), so the
    // picker offers only the canonical ui-schema-representable built-ins in
    // every mode — non-canonical catalog entries (e.g. toggle) are hidden.
    const supported = new Set<string>(UI_SCHEMA_FIELD_TYPES);
    const builtinMatches = (e: FieldTypeEntry) =>
      !excludedTypes.includes(e.type) &&
      supported.has(e.type) &&
      matchesQuery(e);

    const buckets = new Map<FieldTypeCategory, FieldTypeEntry[]>();
    for (const entry of FIELD_TYPES_CATALOG) {
      if (!builtinMatches(entry)) continue;
      const arr = buckets.get(entry.category) ?? [];
      arr.push(entry);
      buckets.set(entry.category, arr);
    }

    // Plugin entries: a built-in of the same type id wins, so a plugin that
    // reuses a built-in id never shadows it in the picker.
    const builtinTypes = new Set<string>(FIELD_TYPES_CATALOG.map(e => e.type));
    for (const entry of pluginEntries) {
      if (
        builtinTypes.has(entry.type) ||
        excludedTypes.includes(entry.type) ||
        !matchesQuery(entry)
      )
        continue;
      const arr = buckets.get(entry.category) ?? [];
      arr.push(entry);
      buckets.set(entry.category, arr);
    }

    return CATEGORY_ORDER.flatMap(cat => {
      const arr = buckets.get(cat);
      return arr ? [{ category: cat, entries: arr }] : [];
    });
  }, [query, excludedTypes, pluginEntries]);

  const handleClose = (next: boolean) => {
    if (!next) {
      // Reset search whenever the modal closes so the next open is fresh.
      setQuery("");
      onCancel();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Search or scroll to find the field type to add.
          </DialogDescription>
        </DialogHeader>

        <Input
          aria-label="Search field types"
          placeholder="Search field types..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />

        <div className="max-h-[400px] overflow-y-auto space-y-3 pr-1">
          {grouped.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No field types match &ldquo;{query}&rdquo;.
            </div>
          ) : (
            grouped.map(({ category, entries }) => (
              <div key={category}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  {category}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {entries.map(e => (
                    <FieldTypeRow
                      key={e.type}
                      entry={e}
                      onSelect={type => {
                        setQuery("");
                        onSelect(type);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldTypeRow({
  entry,
  onSelect,
}: {
  entry: FieldTypeEntry;
  onSelect: (type: FieldTypeId) => void;
}) {
  const Icon = resolveIcon(entry.icon);
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.type)}
      // Why: cursor-pointer + hover state so the row reads as actionable.
      // group/group-hover is used to fade the Add chip in on hover.
      className="group text-left flex items-center gap-3 p-2 rounded-md border border-border bg-background hover:bg-accent transition-colors cursor-pointer"
    >
      <span className="shrink-0 w-7 h-7 rounded-md bg-muted/50 flex items-center justify-center">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </span>
      <span className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{entry.label}</div>
        <div className="text-xs text-muted-foreground truncate">
          {entry.hint}
        </div>
      </span>
      <span
        // Why: small chip appears on row hover/focus so users see the
        // affordance. Whole row is the click target -- chip is visual
        // reinforcement only.
        className="shrink-0 text-[10px] uppercase tracking-wider bg-primary text-primary-foreground rounded-sm px-1.5 py-0.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
      >
        Add
      </span>
    </button>
  );
}
