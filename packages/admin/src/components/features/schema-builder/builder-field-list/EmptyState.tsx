// Why: shown when a collection has no user-defined fields yet (built-in
// title/slug still appear above this block). Nudges the first action via
// a primary "Add your first field" button. Hidden in readOnly mode since
// code-first locked collections always have fields and there's no add
// affordance to offer.
import { Button } from "@revnixhq/ui";

type Props = { onAdd: () => void; readOnly?: boolean };

export function EmptyState({ onAdd, readOnly = false }: Props) {
  if (readOnly) {
    return (
      <div className="border border-dashed border-border rounded-md p-8 text-center text-sm text-muted-foreground">
        No custom fields.
      </div>
    );
  }
  return (
    <div className="border border-dashed border-border rounded-md p-8 text-center space-y-3">
      <div className="text-sm text-muted-foreground">
        This collection has no custom fields yet.
      </div>
      <Button onClick={onAdd}>+ Add your first field</Button>
    </div>
  );
}
