// Why: slug auto-derives from the singular name via toSnakeName. PR B
// dropped the loud "AUTO" badge + "Edit" text button in favor of a
// quieter, more dev-focused presentation: bold value + Lucide Pencil
// icon button. PR G (feedback 2) removed the dim "Slug:" prefix --
// the parent Label already says "Slug" so the prefix was redundant.
// Once the user clicks the pencil, the value becomes an inline
// editable input with a "Done" button.
import { Input } from "@nextlyhq/ui";

type Props = {
  /** The singular name the slug was derived from (kept for future "Reset to auto" affordance). */
  singular: string;
  value: string;
  onChange: (next: string) => void;
};

export function SlugInput({ value, onChange }: Props) {
  return (
    <Input
      aria-label="Slug"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="font-mono"
    />
  );
}
