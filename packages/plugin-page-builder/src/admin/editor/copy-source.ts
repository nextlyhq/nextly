"use client";

/**
 * The stored entry the editor's document is, as the library writes name it
 * (Save as section, Turn into component).
 *
 * The server reads that entry as the author before it saves, so the custom
 * CSS the entry already holds is no change to the new library entry and an
 * author without the site settings permission may still save it. CSS the
 * entry does not hold (an unsaved edit, a pasted block) is judged as new.
 *
 * @module copy-source
 */
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

import type { CopySourceAddress } from "../../library-contract";

/**
 * The stored entry the document in `field` is, or `undefined` for a
 * document not stored yet (a new entry) or one in a Single.
 */
export function useCopySource(field: string): CopySourceAddress | undefined {
  const identity = useDocumentIdentity();
  const collection =
    identity?.kind === "collection" ? identity.slug : undefined;
  const id = identity?.documentId;
  return useMemo(
    () =>
      collection === undefined || id === undefined
        ? undefined
        : { collection, id, field },
    [collection, id, field]
  );
}
