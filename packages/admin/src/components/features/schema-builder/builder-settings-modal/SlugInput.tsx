// Why: slug auto-derives from the singular name via toSnakeName. PR B
// dropped the loud "AUTO" badge + "Edit" text button in favor of a
// quieter, more dev-focused presentation: bold value + Lucide Pencil
// icon button. PR G (feedback 2) removed the dim "Slug:" prefix --
// the parent Label already says "Slug" so the prefix was redundant.
// Once the user clicks the pencil, the value becomes an inline
// editable input with a "Done" button.
import { Button, Input } from "@revnixhq/ui";
import { Pencil } from "lucide-react";
import { useState } from "react";

type Props = {
  /** The singular name the slug was derived from (kept for future "Reset to auto" affordance). */
  singular: string;
  value: string;
  onChange: (next: string) => void;
};

export function SlugInput({ value, onChange }: Props) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          aria-label="Slug"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="font-mono"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(false)}
        >
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm font-medium text-foreground flex-1 truncate">
        {value || <span className="text-muted-foreground italic">none</span>}
      </span>
      <button
        type="button"
        aria-label="Edit slug"
        className="text-muted-foreground hover:text-foreground p-1 rounded-sm"
        onClick={() => setEditing(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
