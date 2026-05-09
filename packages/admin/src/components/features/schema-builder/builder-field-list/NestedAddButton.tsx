// Why: PR I (Q6 button B) -- the +Add affordance that lives at the bottom
// of each parent's nested area in the field list. Mirrors the top-level
// +Add (centered, dashed, bordered, muted) but at a smaller scale -- the
// size difference doubles as a hierarchy hint: smaller = inside, bigger
// = top-level. Style stays consistent so users learn one affordance for
// both contexts.
type Props = {
  parentLabel: string;
  onClick: () => void;
};

export function NestedAddButton({ parentLabel, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-xs text-muted-foreground border border-dashed border-border rounded-md py-2 px-3 mt-2 hover:bg-muted/30 hover:text-foreground transition-colors"
    >
      + Add field inside {parentLabel}
    </button>
  );
}
