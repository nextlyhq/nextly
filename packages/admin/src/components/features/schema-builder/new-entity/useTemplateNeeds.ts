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

import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
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

/** What the server says of a target alone: refused for its spelling, there, or absent. */
type LookUp = TargetAnswer | { status: "absent" };

/** The address rule's refusals of an address's spelling alone, whatever else is pending. */
const SPELLING_REFUSALS: ReadonlySet<string> = new Set([
  "SLUG_REQUIRED",
  "SLUG_INVALID_TYPE",
  "SLUG_INVALID_FORMAT",
  "SLUG_TOO_LONG",
]);

/** How long the new entity's address settles before checks count it as pending. */
const SETTLE_MS = 300;

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
  // Encoded as a path segment: what is read is the target, never a route its
  // characters would spell.
  const address = encodeURIComponent(target.address);
  if (target.kind === "field-group") {
    return held(() => fieldGroupApi.get(address));
  }
  return (
    (await held(() => collectionApi.get(address))) ||
    held(() => singleApi.get(address))
  );
}

/**
 * A target asked of the server alone, once per target: whether the server
 * holds it (read under its encoded address), and only for one it does not,
 * its spelling by the server's own address rule. An entity that exists under
 * an address newer rules refuse keeps working, so it stays a target.
 */
async function lookUp(target: Target): Promise<LookUp> {
  if (await serverHolds(target)) return { status: "met" };
  const alone = await addressCheckApi.check(
    CHECK_KIND[target.kind],
    target.address,
    []
  );
  return alone.refusal && SPELLING_REFUSALS.has(alone.refusal.code)
    ? { status: "refused", refusal: alone.refusal.message }
    : { status: "absent" };
}

/** Whether an absent target can be made, with what this tab will create counted as pending. */
async function makeable(
  target: Target,
  pending: readonly PendingAddress[]
): Promise<TargetAnswer> {
  const answer = await addressCheckApi.check(
    CHECK_KIND[target.kind],
    target.address,
    pending
  );
  return answer.refusal === null
    ? { status: "missing" }
    : { status: "refused", refusal: answer.refusal.message };
}

/**
 * Whether the target is met here, asking nothing: a link to the entity being
 * created (a Single's too, since links may name Singles), a system collection
 * a link may name, or an entity this tab holds unsaved, which its save creates
 * first.
 */
function metHere(
  target: Target,
  self: { kind: BuilderKind; address: string },
  unsaved: readonly PendingAddress[]
): boolean {
  const linksToSelf =
    target.address === self.address &&
    (target.kind === self.kind ||
      (target.kind === "collection" && self.kind === "single"));
  return (
    linksToSelf ||
    (target.kind === "collection" && SYSTEM_LINK_TARGETS.has(target.address)) ||
    heldUnsaved(target, unsaved)
  );
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

/** A query's answer, its failure named, or null while it is on its way. */
function settled<T>(
  target: Target,
  query: UseQueryResult<T> | undefined
): T | NeedState | null {
  if (query?.data) return query.data;
  if (query?.isError) {
    return {
      ...target,
      status: "unchecked",
      refusal: apiErrorMessage(query.error, "The server did not answer."),
    };
  }
  return null;
}

/** A target's state from what is known of it here and what the server answered. */
function stateOf(
  target: Target,
  local: boolean,
  lookup: UseQueryResult<LookUp> | undefined,
  check: UseQueryResult<TargetAnswer> | undefined,
  // Whether the new entity's address has changed since the checks counted it:
  // an absent target is checking until it has, never answered for the old one.
  settling: boolean
): NeedState {
  if (local) return { ...target, status: "met" };
  const found = settled(target, lookup);
  if (found === null) return { ...target, status: "checking" };
  if (found.status !== "absent") return { ...target, ...found };
  if (settling) return { ...target, status: "checking" };
  return { ...target, status: "checking", ...settled(target, check) };
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

  const local = targets.map(target => metHere(target, self, unsaved));
  // Each target asked of the server alone once, whatever is typed.
  const lookups = useQueries({
    queries: targets.map((target, at) => ({
      queryKey: ["template-need", target.kind, target.address],
      queryFn: () => lookUp(target),
      enabled: !local[at],
      // An unanswered check is named, not retried behind a spinner.
      retry: false,
    })),
  });
  // Everything this tab will create counts as pending for an absent target:
  // its unsaved entities, the new entity once its address settles, and the
  // template's other targets, so two of them that would share an address are
  // refused, not both made.
  const settledSelf = useDebouncedValue(self.address, SETTLE_MS);
  const pendingFor = (target: Target): PendingAddress[] => [
    ...unsaved,
    ...(settledSelf === ""
      ? []
      : [{ kind: CHECK_KIND[self.kind], address: settledSelf }]),
    ...targets
      .filter(other => other.key !== target.key)
      .map(other => ({ kind: CHECK_KIND[other.kind], address: other.address })),
  ];
  const checks = useQueries({
    queries: targets.map((target, at) => {
      const pending = pendingFor(target);
      return {
        queryKey: [
          "template-need-made",
          target.kind,
          target.address,
          JSON.stringify(pending),
        ],
        queryFn: () => makeable(target, pending),
        enabled: !local[at] && lookups[at]?.data?.status === "absent",
        retry: false,
      };
    }),
  });
  const settling = settledSelf !== self.address;
  const states = targets.map((target, at) =>
    stateOf(target, local[at], lookups[at], checks[at], settling)
  );

  // The targets the person chose not to make, for the template they were
  // chosen for. Every change of template is recorded as it happens, none
  // between included, so a template picked anew makes every one too.
  const [notMade, setNotMade] = useState<{
    template: object | null;
    keys: ReadonlySet<string>;
  }>({ template, keys: new Set() });
  if (notMade.template !== template) {
    setNotMade({ template, keys: new Set() });
  }
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
