/**
 * What the editor's lock questions are judged by: the host's block
 * definitions and nesting rules, or the live registry's where the host gives
 * none.
 *
 * One reading for the store's apply, its lock question and a surface that
 * answers a lock question from the structure alone (the Add panel), so the
 * three cannot judge one edit by two sets of definitions.
 *
 * @module lock-sources
 */

import {
  registryBlockSource,
  registryNestingSource,
  type BlockDocument,
  type DocumentLimits,
  type LockSources,
  type NestingSource,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";
import { useMemo } from "react";

/** The lock sources a host hands the store, if any. */
export type HostLocks = Pick<LockSources, "definitions" | "nesting"> | undefined;

/**
 * The definitions lock questions are judged by: the host's own, or the live
 * registry. Held per source, so the store keeps its identity across renders.
 */
export function useLockDefinitions(locks: HostLocks): SlotDefaultSource {
  const host = locks?.definitions;
  return useMemo(() => host ?? registryBlockSource(), [host]);
}

/**
 * The host's lock sources as the store's options spell them: none without
 * definitions of its own, which then come from the live registry.
 */
export function hostLocksOf(
  definitions: SlotDefaultSource | undefined,
  nesting: NestingSource | undefined
): HostLocks {
  return definitions === undefined ? undefined : { definitions, nesting };
}

/**
 * What every lock question is judged by: the host's definitions and nesting
 * rules, or the live registry's, the document as last saved, and the caps
 * every edit is applied under, so a lock walk and a repair plan are bounded
 * as the apply they stand for is.
 */
export function lockSourcesOf(
  locks: HostLocks,
  stored: BlockDocument,
  limits: DocumentLimits
): LockSources {
  return {
    definitions: locks?.definitions ?? registryBlockSource(),
    nesting: locks?.nesting ?? registryNestingSource(),
    stored: [stored],
    limits,
  };
}
