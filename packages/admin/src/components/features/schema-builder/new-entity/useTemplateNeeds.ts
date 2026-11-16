/**
 * What the picked template needs to exist, and whether each is there: a
 * collection a link of its points at, a field group a field of its uses.
 *
 * Each target is asked about with the server's own address check, counting
 * the entities unsaved in this tab, so one answer says all three things the
 * dialog needs to know: already used (it exists, or waits unsaved, and the
 * save creates it first), free (it can be made too), or refused (it cannot be
 * made, so the field needing it must be left out). A link to the very entity
 * being created needs nothing made.
 *
 * Each missing target is made too unless the person says not; one not made
 * too, or refused, holds Create until the fields needing it are left out.
 *
 * @module components/features/schema-builder/new-entity/useTemplateNeeds
 */
import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { TemplateNeed } from "@admin/lib/builder/template-check";
import type { UnsavedEntity } from "@admin/lib/builder/unsaved-entities";
import {
  addressCheckApi,
  type PendingAddress,
} from "@admin/services/addressCheckApi";

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
  status: "checking" | "met" | "missing" | "refused";
  /** Why the server would refuse it, when refused. */
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

/** The address check's name for each kind a template needs. */
const CHECK_KIND = {
  collection: "collection",
  "field-group": "fieldGroup",
} as const;

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

  const answers = useQueries({
    queries: targets.map(target => ({
      queryKey: [
        "template-need",
        target.kind,
        target.address,
        JSON.stringify(unsaved),
      ],
      queryFn: () =>
        addressCheckApi.check(CHECK_KIND[target.kind], target.address, unsaved),
      // A link to the entity being created asks nothing.
      enabled: !(target.kind === self.kind && target.address === self.address),
    })),
  });

  const states: NeedState[] = targets.map((target, at) => {
    if (target.kind === self.kind && target.address === self.address) {
      return { ...target, status: "met" };
    }
    const answer = answers[at]?.data;
    if (!answer) return { ...target, status: "checking" };
    if (answer.refusal === null) return { ...target, status: "missing" };
    // Used already: it exists, or waits unsaved and is created first.
    if (answer.refusal.code === "DUPLICATE")
      return { ...target, status: "met" };
    return { ...target, status: "refused", refusal: answer.refusal.message };
  });

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
  const blockedBy = open.some(state => state.status === "checking")
    ? "Checking what the template needs…"
    : open.some(state => state.status === "refused")
      ? "Leave out the fields that need what cannot be made."
      : open.some(state => !makesToo(state.key))
        ? "Create what the template needs too, or leave out the fields that need it."
        : null;

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
