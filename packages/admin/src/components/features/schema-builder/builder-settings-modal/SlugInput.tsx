// Why: slug auto-derives from the singular name via toSnakeName. The AUTO
// badge tells the user the value is computed; clicking Edit lets them
// override. Once edited the badge disappears (the slug no longer auto-tracks
// the singular name — the parent form is responsible for resuming auto-derive
// if the user clears the override). Used inside BuilderSettingsModal's Basics
// tab for collections / singles / components.
import { Button, Input } from "@revnixhq/ui";
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
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="font-mono">{value}</span>
      <span className="text-[10px] border border-border rounded-sm px-1 py-0.5">
        AUTO
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setEditing(true)}
      >
        Edit
      </Button>
    </div>
  );
}
