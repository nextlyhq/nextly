/**
 * The asterisk after the label of a field the dialog will not go on without.
 *
 * Drawn the way the entry form draws it (`FieldWrapper`), so a required field
 * looks the same in the builder as in the content it shapes. Hidden from
 * assistive technology: the input's own `required` says it there, and a
 * spoken "star" after the name would only repeat it less clearly.
 *
 * @module components/features/schema-builder/builder-settings-modal/RequiredMark
 */
import type { JSX } from "react";

export function RequiredMark(): JSX.Element {
  return (
    <span className="text-danger-text ml-1" aria-hidden="true">
      *
    </span>
  );
}
