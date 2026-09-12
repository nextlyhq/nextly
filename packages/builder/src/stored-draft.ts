/**
 * A field's draft, which follows the stored value whenever that changes
 * underneath it.
 *
 * Every text field in the inspectors holds its own value while focused so
 * typing is responsive, and reports it on blur so one undo takes back one
 * edit. Each also has to give way to the document: an undo, an edit from the
 * canvas, a reset, or a different node selected into the same slot replaces
 * the stored value, and a field that kept its draft would go on showing a
 * value the document no longer has.
 *
 * One hook rather than the same three lines in every field, because the
 * three lines were drifting: one copy's comment listed the reasons a value
 * changes underneath a field and another's listed different ones, and the
 * next copy would have carried whichever it was pasted from.
 *
 * @module stored-draft
 */

import * as React from "react";

/**
 * @param stored - the value the document holds, as the field shows it
 * @returns the draft and its setter, the draft reset whenever `stored` moves
 */
export function useStoredDraft(
  stored: string
): [string, (next: string) => void] {
  const [draft, setDraft] = React.useState(stored);
  React.useEffect(() => {
    setDraft(stored);
  }, [stored]);
  return [draft, setDraft];
}
