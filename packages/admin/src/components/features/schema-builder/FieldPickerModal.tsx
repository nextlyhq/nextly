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
} from "@revnixhq/ui";
import { useMemo, useState } from "react";

import type { FieldPrimitiveType } from "@admin/types/collection";

import {
  FIELD_TYPES_CATALOG,
  type FieldTypeCategory,
  type FieldTypeEntry,
} from "./field-picker-modal/field-types-catalog";

type Props = {
  open: boolean;
  excludedTypes: readonly FieldPrimitiveType[];
  onCancel: () => void;
  onSelect: (type: FieldPrimitiveType) => void;
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

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (e: FieldTypeEntry) =>
      !excludedTypes.includes(e.type) &&
      (q === "" ||
        e.label.toLowerCase().includes(q) ||
        e.hint.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q));

    const buckets = new Map<FieldTypeCategory, FieldTypeEntry[]>();
    for (const entry of FIELD_TYPES_CATALOG) {
      if (!matches(entry)) continue;
      const arr = buckets.get(entry.category) ?? [];
      arr.push(entry);
      buckets.set(entry.category, arr);
    }
    return CATEGORY_ORDER.flatMap(cat => {
      const arr = buckets.get(cat);
      return arr ? [{ category: cat, entries: arr }] : [];
    });
  }, [query, excludedTypes]);

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
                    <button
                      key={e.type}
                      type="button"
                      onClick={() => {
                        setQuery("");
                        onSelect(e.type);
                      }}
                      className="text-left p-2 rounded-md border border-border bg-background hover:bg-accent transition-colors"
                    >
                      <div className="text-sm font-medium">{e.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.hint}
                      </div>
                    </button>
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
