/**
 * The form's status as stored: what the site has read the form as, which an
 * edit in the bar does not change until a save stores it. The form's ID is
 * fixed once the stored status has been live, so it is this, not the status
 * as edited, that decides it.
 *
 * @module admin/context/use-stored-status
 */
import { useCallback, useRef, useState } from "react";

import type { FormBuilderState } from "./FormBuilderContext";

type FormStatus = FormBuilderState["formData"]["status"];

export interface StoredStatus {
  storedStatus: FormStatus;
  /** A save began: the status it sends is the one it will store. */
  beginSave: () => void;
  /** The save that began stored the form. */
  markSaved: () => void;
}

/**
 * The stored status, kept in step with the change history's own save marks:
 * the returned `beginSave` and `markSaved` call the history's, so one save
 * marks both.
 *
 * @param initialData - what the editor opened with; unset for a new form
 * @param currentDocument - the form as edited now
 * @param history - the change history's save marks
 */
export function useStoredStatus(
  initialData: { status?: FormStatus } | undefined,
  currentDocument: () => { formData: { status: FormStatus } },
  history: { beginSave: () => void; markSaved: () => void }
): StoredStatus {
  const [storedStatus, setStoredStatus] = useState<FormStatus>(
    initialData?.status ?? "draft"
  );
  // The status the save in flight sends: a status chosen while it runs is
  // not what it stores.
  const sending = useRef<FormStatus | undefined>(undefined);
  const { beginSave: historyBeginSave, markSaved: historyMarkSaved } = history;

  const beginSave = useCallback(() => {
    sending.current = currentDocument().formData.status;
    historyBeginSave();
  }, [currentDocument, historyBeginSave]);

  const markSaved = useCallback(() => {
    historyMarkSaved();
    setStoredStatus(sending.current ?? currentDocument().formData.status);
    sending.current = undefined;
  }, [currentDocument, historyMarkSaved]);

  return { storedStatus, beginSave, markSaved };
}
