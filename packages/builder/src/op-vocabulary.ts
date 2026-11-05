/**
 * The op vocabulary, re-exported from the engine.
 *
 * These moved to `@nextlyhq/blocks-engine` and are re-exported here unchanged.
 * Applying an edit is not an editing-surface concern: a plugin route, a script
 * or an agent has the same right to the operations the editor applies, and each
 * would otherwise grow its own vocabulary that agrees with this one only until
 * one of them changed.
 *
 * The re-export is not a transition step to be tidied away. The editor's
 * modules import ops from here, and a builder file reaching into the engine for
 * something the builder is the primary user of would spread that import path
 * across all of them for no gain. One path in, one place to change if the
 * engine ever reorganises.
 *
 * The editor imports this module rather than the published `ops` entry, which
 * also carries the composition actions' schemas: the shell would otherwise
 * load zod and build every schema on each editor load for an API it never
 * calls.
 *
 * @module op-vocabulary
 */
export {
  applyOp,
  applyOps,
  OpError,
  positionOf,
  sameStoredValue,
  sameStyleValue,
  type AppliedOp,
  type AppliedOps,
  type BuilderOp,
  type NodePatch,
  type OpPosition,
  type SlotAddress,
} from "@nextlyhq/blocks-engine";
