"use client";

/**
 * Start a document form again from the document each time a load of its
 * latest version reaches it, and hold the lock until it has.
 *
 * The forms reset to a new version on their own, but tell versions apart by
 * `updatedAt`, which two saves inside one timestamp unit share; and they keep
 * what the author typed when the version looks like their own. A document this
 * editor gained was loaded because what they had may be out of date, so the
 * load's arrival, counted by the lock surface's `reloads`, resets the whole
 * form to it whatever the timestamps say.
 *
 * 🔴 The lock comes back still withheld, with the count it carries held back,
 * until the reset has landed. The render that sees the load arrive is the one
 * the surface unlocks in, and the form still holds the copy from before then:
 * a view keyed on the count would mount over it, and the fields would be
 * editable with it. The reset runs as a layout effect and moves the count on,
 * so the render that unlocks is the one after, before anything is painted.
 *
 * @module components/features/entries/EntryForm/useResetOnReload
 */

import { useLayoutEffect, useState } from "react";

import type { DocumentLockSurface } from "./useDocumentLockSurface";

export function useResetOnReload<V>(
  form: { reset: (values: V) => void },
  lock: DocumentLockSurface,
  values: V
): DocumentLockSurface {
  const [applied, setApplied] = useState(lock.reloads);
  const { reloads } = lock;
  useLayoutEffect(() => {
    if (applied === reloads) return;
    form.reset(values);
    setApplied(reloads);
  }, [form, reloads, values, applied]);
  if (applied === reloads) return lock;
  return { ...lock, readOnly: true, actionsDisabled: true, reloads: applied };
}
