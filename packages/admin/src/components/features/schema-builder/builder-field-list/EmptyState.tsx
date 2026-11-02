// Why: shown when an entity has no user-defined fields yet (built-in
// title/slug still appear above this block). Nudges the first action via
// a primary "Add your first field" button. In readOnly mode there is no add
// affordance to offer, so it only states that there are none. Both sentences
// name the entity's kind, since the same list serves collections, Singles and
// field groups.
import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { BUILDER_KIND_NOUN, type BuilderKind } from "../builder-config";

type Props = {
  /** Which kind of entity the list belongs to, named in the message. */
  kind: BuilderKind;
  onAdd: () => void;
  readOnly?: boolean;
};

export function EmptyState({
  kind,
  onAdd,
  readOnly = false,
}: Props): JSX.Element {
  const noun = BUILDER_KIND_NOUN[kind];
  if (readOnly) {
    return (
      <div className="border border-dashed border-border rounded-md p-8 text-center text-sm text-muted-foreground">
        This {noun} has no custom fields.
      </div>
    );
  }
  return (
    <div className="border border-dashed border-border rounded-md p-8 text-center space-y-3">
      <div className="text-sm text-muted-foreground">
        This {noun} has no custom fields yet.
      </div>
      <Button onClick={onAdd}>+ Add your first field</Button>
    </div>
  );
}
