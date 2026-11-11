/**
 * Whether the form has ever been live: what the site's pages and integrations
 * may have read it by. A form set back to draft has still been live, so this
 * never turns false; it is what fixes the form's ID.
 *
 * The stored form records it as `wentLiveAt`, stamped once by the server on
 * the first publish. A form live before that stamp existed is live as loaded,
 * and a save that stores Live makes it so here, where the server's stamp is
 * not read back.
 *
 * @module admin/context/use-been-live
 */
import { useCallback, useRef, useState } from "react";

import type { FormBuilderState } from "./FormBuilderContext";

type FormStatus = FormBuilderState["formData"]["status"];

export interface BeenLive {
  beenLive: boolean;
  /** A save began: the status it sends is the one it will store. */
  beginSave: () => void;
  /** The save that began stored the form. */
  markSaved: () => void;
}

/** Whether the form as loaded has been live. */
function liveAsLoaded(
  initialData: { status?: FormStatus; wentLiveAt?: unknown } | undefined
): boolean {
  const stamp = initialData?.wentLiveAt;
  const stamped = stamp !== undefined && stamp !== null && stamp !== "";
  return stamped || initialData?.status === "published";
}

/**
 * Kept in step with the change history's own save marks: the returned
 * `beginSave` and `markSaved` call the history's, so one save marks both.
 *
 * @param initialData - what the editor opened with; unset for a new form
 * @param currentDocument - the form as edited now
 * @param history - the change history's save marks
 */
export function useBeenLive(
  initialData: { status?: FormStatus; wentLiveAt?: unknown } | undefined,
  currentDocument: () => { formData: { status: FormStatus } },
  history: { beginSave: () => void; markSaved: () => void }
): BeenLive {
  const [beenLive, setBeenLive] = useState(() => liveAsLoaded(initialData));
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
    const stored = sending.current ?? currentDocument().formData.status;
    sending.current = undefined;
    // Only ever on: having been live is not undone by a later status.
    if (stored === "published") setBeenLive(true);
  }, [currentDocument, historyMarkSaved]);

  return { beenLive, beginSave, markSaved };
}
