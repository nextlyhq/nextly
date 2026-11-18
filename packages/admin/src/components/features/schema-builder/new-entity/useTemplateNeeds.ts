/**
 * What the picked template needs to exist, and whether each is there: a
 * collection a link of its points at, a field group a field of its uses.
 *
 * A target is there when it waits unsaved in this tab, or when the server
 * holds it under its address: for a link, the Users collection, a collection
 * or a Single, as the link editor offers them; for a field-group field, a
 * field group. A target not there is asked of the server's own address check,
 * counting as pending everything this tab will create (its unsaved entities,
 * the new entity, and the template's other targets), which says whether it can
 * be made too or is refused. A link to the very entity being created needs
 * nothing made, and a target that cannot be checked is named as such.
 *
 * Each missing target is made too unless the person says not; one not made
 * too, refused, or not checked holds Create until the fields needing it are
 * left out.
 *
 * @module components/features/schema-builder/new-entity/useTemplateNeeds
 */
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiErrorMessage, isApiError } from "@admin/lib/api/parseApiError";
import type { TemplateNeed } from "@admin/lib/builder/template-check";
import type { UnsavedEntity } from "@admin/lib/builder/unsaved-entities";
import {
  addressCheckApi,
  type AddressCheckKind,
  type PendingAddress,
} from "@admin/services/addressCheckApi";
import { collectionApi } from "@admin/services/collectionApi";
import { fieldGroupApi } from "@admin/services/fieldGroupApi";
import { singleApi } from "@admin/services/singleApi";

import { BUILDER_KIND_NOUN, type BuilderKind } from "../builder-config";

import { neededEntity, type NeededKind } from "./needed-entities";

/** The Builder's kind for each kind a template needs. */
const NEED_KIND: Record<TemplateNeed["kind"], NeededKind> = {
  collection: "collection",
  fieldGroup: "field-group",
};

/** One target a template needs, and whether it is there. */
export interface NeedState {
  kind: NeededKind;
  address: string;
  /** "kind:address": what the person makes too, or not. */
  key: string;
  status: "checking" | "met" | "missing" | "refused" | "unchecked";
  /** Why the server would refuse it, or why it could not be checked. */
  refusal?: string;
}

export interface TemplateNeeds {
  /** Each target not met, in the order the template's fields name them. */
  open: readonly NeedState[];
  /** Whether a missing target is made too. */
  makesToo: (key: string) => boolean;
  toggleMakeToo: (key: string) => void;
  /** Why Create waits, for what the template needs, or null. */
  blockedBy: string | null;
  /** The entities made too, each owned by the entity being created. */
  needed: (owner: {
    kind: BuilderKind;
    address: string;
  }) => Omit<UnsavedEntity, "token">[];
}

/** The address check's name for each kind. */
const CHECK_KIND: Record<BuilderKind, AddressCheckKind> = {
  collection: "collection",
  single: "single",
  "field-group": "fieldGroup",
};

/**
 * The collections a link may name though no create could take their
 * addresses, as the link editor offers them: the Users collection.
 */
const SYSTEM_LINK_TARGETS: ReadonlySet<string> = new Set(["users"]);

/** One target, keyed "kind:address". */
type Target = { key: string; kind: NeededKind; address: string };

/** What the server answers about a target not held in this tab. */
type TargetAnswer = Pick<NeedState, "status" | "refusal">;

/** Whether the server holds the entity: a not-found says no; any other failure is no answer. */
async function held(read: () => Promise<unknown>): Promise<boolean> {
  try {
    await read();
    return true;
  } catch (error) {
    if (isApiError(error) && error.code === "NOT_FOUND") return false;
    throw error;
  }
}

/**
 * Whether the server holds the target under its address, as what it is
 * linked to or used as.
 */
async function serverHolds(target: Target): Promise<boolean> {
  if (target.kind === "field-group") {
    return held(() => fieldGroupApi.get(target.address));
  }
  if (SYSTEM_LINK_TARGETS.has(target.address)) return true;
  return (
    (await held(() => collectionApi.get(target.address))) ||
    held(() => singleApi.get(target.address))
  );
}

/** The server's answer for a target: there, missing, or refused. */
async function answerFor(
  target: Target,
  pending: readonly PendingAddress[]
): Promise<TargetAnswer> {
  if (await serverHolds(target)) return { status: "met" };
  const answer = await addressCheckApi.check(
    CHECK_KIND[target.kind],
    target.address,
    pending
  );
  return answer.refusal === null
    ? { status: "missing" }
    : { status: "refused", refusal: answer.refusal.message };
}

/** Whether an entity this tab holds unsaved stands for the target. */
function heldUnsaved(
  target: Target,
  unsaved: readonly PendingAddress[]
): boolean {
  const kinds: readonly AddressCheckKind[] =
    target.kind === "field-group" ? ["fieldGroup"] : ["collection", "single"];
  return unsaved.some(
    each => each.address === target.address && kinds.includes(each.kind)
  );
}

/** A target's state from what is known of it here and what the server answered. */
function stateOf(
  target: Target,
  local: "met" | null,
  query: UseQueryResult<TargetAnswer> | undefined
): NeedState {
  if (local) return { ...target, status: local };
  if (query?.data) return { ...target, ...query.data };
  if (query?.isError) {
    return {
      ...target,
      status: "unchecked",
      refusal: apiErrorMessage(query.error, "The server did not answer."),
    };
  }
  return { ...target, status: "checking" };
}

/** Why Create waits for what the template needs, or null. */
function needsBlockedBy(
  open: readonly NeedState[],
  makesToo: (key: string) => boolean
): string | null {
  if (open.some(state => state.status === "checking")) {
    return "Checking what the template needs…";
  }
  if (
    open.some(
      state => state.status === "refused" || state.status === "unchecked"
    )
  ) {
    return "Leave out the fields that need what cannot be made.";
  }
  if (open.some(state => !makesToo(state.key))) {
    return "Create what the template needs too, or leave out the fields that need it.";
  }
  return null;
}

/** A target's name, "collection authors". */
export function needName(state: Pick<NeedState, "kind" | "address">): string {
  return `${BUILDER_KIND_NOUN[state.kind]} ${state.address}`;
}

export function useTemplateNeeds(
  needs: readonly TemplateNeed[],
  /** The entity being created, as it would be saved. */
  self: { kind: BuilderKind; address: string },
  unsaved: readonly PendingAddress[],
  /** What the needs belong to; a new one starts with every target made too. */
  template: object | null
): TemplateNeeds {
  // Each target once, in the order the fields name it.
  const targets = useMemo(() => {
    const seen = new Map<string, { kind: NeededKind; address: string }>();
    for (const need of needs) {
      const kind = NEED_KIND[need.kind];
      const key = `${kind}:${need.slug}`;
      if (!seen.has(key)) seen.set(key, { kind, address: need.slug });
    }
    return [...seen].map(([key, target]) => ({ key, ...target }));
  }, [needs]);

  // A target is met here, asking nothing: a link to the entity being created,
  // or an entity this tab holds unsaved, which its save creates first.
  const local = targets.map(target =>
    (target.kind === self.kind && target.address === self.address) ||
    heldUnsaved(target, unsaved)
      ? ("met" as const)
      : null
  );
  // Everything this tab will create counts as pending for each target: its
  // unsaved entities, the new entity, and the template's other targets, so
  // two of them that would share an address are refused, not both made.
  const pendingFor = (target: Target): PendingAddress[] => [
    ...unsaved,
    ...(self.address === ""
      ? []
      : [{ kind: CHECK_KIND[self.kind], address: self.address }]),
    ...targets
      .filter(other => other.key !== target.key)
      .map(other => ({ kind: CHECK_KIND[other.kind], address: other.address })),
  ];
  const answers = useQueries({
    queries: targets.map((target, at) => {
      const pending = pendingFor(target);
      return {
        queryKey: [
          "template-need",
          target.kind,
          target.address,
          JSON.stringify(pending),
        ],
        queryFn: () => answerFor(target, pending),
        enabled: local[at] === null,
        // An unanswered check is named, not retried behind a spinner.
        retry: false,
      };
    }),
  });
  const states = targets.map((target, at) =>
    stateOf(target, local[at], answers[at])
  );

  // The targets the person chose not to make, for the template they were
  // chosen for: a template picked anew makes every one too.
  const [notMade, setNotMade] = useState<{
    template: object | null;
    keys: ReadonlySet<string>;
  }>({ template, keys: new Set() });
  const skipped =
    notMade.template === template ? notMade.keys : new Set<string>();

  const open = states.filter(state => state.status !== "met");
  const makesToo = (key: string) => !skipped.has(key);
  const blockedBy = needsBlockedBy(open, makesToo);

  return {
    open,
    makesToo,
    toggleMakeToo: key =>
      setNotMade(prev => {
        const keys = new Set(prev.template === template ? prev.keys : []);
        if (keys.has(key)) keys.delete(key);
        else keys.add(key);
        return { template, keys };
      }),
    blockedBy,
    needed: owner =>
      open
        .filter(state => state.status === "missing" && makesToo(state.key))
        .map(state => neededEntity(state.kind, state.address, owner)),
  };
}
