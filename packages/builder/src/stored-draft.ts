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

import { beginFieldEdit } from "./field-edit";

/**
 * @param stored - the value the document holds, as the field shows it
 * @returns the draft and its setter, the draft reset whenever `stored` moves
 *
 * A draft that differs from `stored` is an edit in progress: Escape in the
 * field puts `stored` back and the field then writes nothing when it is
 * left (`field-edit.ts`). The edit begins in the element focus is in when
 * the draft first moves, which is the field being typed into.
 */
export function useStoredDraft(
  stored: string
): [string, (next: string) => void] {
  const [draft, setDraftState] = React.useState(stored);
  // Read when Escape lands, so the value put back is the one stored now.
  const latestStored = React.useRef(stored);
  latestStored.current = stored;
  // Ends the edit in progress, or `null` while there is none.
  const endEdit = React.useRef<(() => void) | null>(null);
  const end = React.useCallback(() => {
    endEdit.current?.();
    endEdit.current = null;
  }, []);
  React.useEffect(() => {
    setDraftState(stored);
    // A value stored underneath the field ends its edit: the draft was
    // written, or an undo or another surface replaced it.
    end();
  }, [stored, end]);
  // A field gone takes its edit with it.
  React.useEffect(() => end, [end]);
  const setDraft = React.useCallback(
    (next: string) => {
      setDraftState(next);
      if (next === latestStored.current) {
        end();
        return;
      }
      if (endEdit.current !== null) return;
      endEdit.current = beginFieldEdit({
        element:
          typeof document === "undefined" ? null : document.activeElement,
        cancel: () => {
          endEdit.current = null;
          setDraftState(latestStored.current);
        },
      });
    },
    [end]
  );
  return [draft, setDraft];
}
