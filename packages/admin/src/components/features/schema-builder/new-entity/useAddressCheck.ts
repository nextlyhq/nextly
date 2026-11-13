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

function stateOf(
  kind: BuilderKind,
  answer: AddressCheckAnswer
): AddressCheckState {
  if (!answer.refusal) return { status: "free" };
  if (answer.refusal.code === "DUPLICATE") {
    return { status: "refused", message: USED_BY[kind] };
  }
  return { status: "refused", message: answer.refusal.message };
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

  useEffect(() => {
    const ask = ++latest.current;
    const asked = `${kind}\n${address}\n${pending}`;
    const timer = setTimeout(() => {
      addressCheckApi
        .check(
          CHECK_KIND[kind],
          address,
          JSON.parse(pending) as PendingAddress[]
        )
        .then(answer => {
          if (ask === latest.current) {
            setAnswered({ key: asked, state: stateOf(kind, answer) });
          }
        })
        .catch(() => {
          if (ask === latest.current) {
            setAnswered({ key: asked, state: UNCHECKED });
          }
        });
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [kind, address, pending]);

  return answered?.key === key ? answered.state : { status: "checking" };
}
