/**
 * The new-entity dialog's check of an address as it is typed.
 *
 * The server answers, by the rule its create applies (`addressCheckApi`), so
 * the dialog never accepts an address the create refuses, nor refuses one it
 * accepts. A pause in typing asks once; an answer that arrives for an address
 * no longer typed is dropped, so a slow answer about an earlier address never
 * speaks for the current one.
 *
 * @module components/features/schema-builder/new-entity/useAddressCheck
 */
import { useEffect, useRef, useState } from "react";

import { unsavedAddresses } from "@admin/lib/builder/unsaved-entities";
import {
  addressCheckApi,
  type AddressCheckAnswer,
  type AddressCheckKind,
  type PendingAddress,
} from "@admin/services/addressCheckApi";

import type { BuilderKind } from "../builder-config";

export type AddressCheckState =
  | { status: "checking" }
  | { status: "free" }
  | { status: "refused"; message: string }
  | { status: "unknown"; message: string };

/** How long typing must pause before the address is asked about. */
const CHECK_DELAY_MS = 250;

/**
 * How long an ask may go unanswered before the address is left to the create,
 * which checks it again; a request that never settles would otherwise hold
 * Create unavailable.
 */
const CHECK_TIMEOUT_MS = 8000;

const NO_PENDING_CREATES: readonly PendingAddress[] = [];

const CHECK_KIND: Record<BuilderKind, AddressCheckKind> = {
  collection: "collection",
  single: "single",
  "field-group": "fieldGroup",
};

/**
 * Who an address already used belongs among, in the words the dialog uses. The
 * server's own answer names no entity, so neither does this.
 */
const USED_BY: Record<BuilderKind, string> = {
  collection: "A collection or Single already uses this address.",
  single: "A collection or Single already uses this address.",
  "field-group": "Another field group already uses this address.",
};

const UNCHECKED: AddressCheckState = {
  status: "unknown",
  message: "This address could not be checked. Create checks it again.",
};

/** The words a refused address is shown with, or null when it is free. */
function refusalWords(
  kind: BuilderKind,
  answer: AddressCheckAnswer
): string | null {
  if (!answer.refusal) return null;
  if (answer.refusal.code === "DUPLICATE") return USED_BY[kind];
  return answer.refusal.message;
}

function stateOf(
  kind: BuilderKind,
  answer: AddressCheckAnswer
): AddressCheckState {
  const refused = refusalWords(kind, answer);
  return refused === null
    ? { status: "free" }
    : { status: "refused", message: refused };
}

/**
 * Asks once more, right before an unsaved entity's save creates it, whether
 * its address is still free: another tab may have saved an entity under it
 * since the dialog checked. Every other entity unsaved in this tab still holds
 * its address; this one's own does not count against it. Answers with the
 * words of the refusal, or null when the address is free.
 */
export async function checkAddressAgain(
  kind: BuilderKind,
  address: string
): Promise<string | null> {
  const others = unsavedAddresses().filter(
    held => !(held.kind === CHECK_KIND[kind] && held.address === address)
  );
  const answer = await addressCheckApi.check(CHECK_KIND[kind], address, others);
  return refusalWords(kind, answer);
}

export function useAddressCheck(
  kind: BuilderKind,
  address: string,
  pendingCreates: readonly PendingAddress[] = NO_PENDING_CREATES
): AddressCheckState {
  // What was asked about, as one key: an answer counts only for the key it
  // was asked for, so anything typed since reads as still being checked.
  const pending = JSON.stringify(pendingCreates);
  const key = `${kind}\n${address}\n${pending}`;
  const [answered, setAnswered] = useState<{
    key: string;
    state: AddressCheckState;
  } | null>(null);
  // The latest ask; an answer to any earlier one is dropped.
  const latest = useRef(0);
  // Whenever what is asked about changes, the answer on show goes with it, so
  // returning to an address answered before reads as checking until it is
  // answered again, not as that earlier answer.
  const [shownFor, setShownFor] = useState(key);
  if (shownFor !== key) {
    setShownFor(key);
    setAnswered(null);
  }

  useEffect(() => {
    const ask = ++latest.current;
    const asked = `${kind}\n${address}\n${pending}`;
    let limit: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      limit = setTimeout(() => {
        if (ask === latest.current) {
          setAnswered({ key: asked, state: UNCHECKED });
        }
      }, CHECK_TIMEOUT_MS);
      addressCheckApi
        .check(
          CHECK_KIND[kind],
          address,
          JSON.parse(pending) as PendingAddress[]
        )
        .then(answer => {
          clearTimeout(limit);
          if (ask === latest.current) {
            setAnswered({ key: asked, state: stateOf(kind, answer) });
          }
        })
        .catch(() => {
          clearTimeout(limit);
          if (ask === latest.current) {
            setAnswered({ key: asked, state: UNCHECKED });
          }
        });
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(limit);
    };
  }, [kind, address, pending]);

  return answered?.key === key ? answered.state : { status: "checking" };
}
