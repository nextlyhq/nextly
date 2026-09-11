/**
 * Whether a source can be executed at all, and by WHAT.
 *
 * Its own module because two callers need the same answer and must not derive
 * it twice: the executor, which runs the query, and `api/widget-query`'s gate,
 * which decides whether the caller is told anything specific about the source.
 * The gate answered this question on the source's KIND alone, and that admitted
 * a system source nobody had registered a resolver for -- which then reached
 * field-level validation, where every message is specific. An undeclared
 * `select` named the field AND the source, while an invented id got the generic
 * refusal, so the pair distinguished a registered source from a nonexistent
 * one: the enumeration oracle that gate exists to close.
 *
 * Extracted rather than exported from `execute.ts` for the same reason
 * `result.ts` was. The endpoint mocks the executor in its own tests, and a
 * module mock is a closed literal -- so importing this from there left it
 * `undefined` at the call site, which threw a `TypeError` and was reported as
 * an internal error rather than a refusal. Nothing here needs the Direct API,
 * so nothing here should drag it in.
 *
 * @module domains/widgets/executable-source
 */

import {
  failUnavailableSourceOrOp,
  getSource,
  sourceTarget,
  type WidgetSource,
} from "./sources";
import { systemResolver, type SystemSourceResolver } from "./system-sources";

/**
 * A resolved source together with HOW it is answered.
 *
 * 🔴 The two travel as one value because they must never be decided
 * separately. Asking the resolver store "is there an entry for this id?" and
 * asking the source "what kind are you?" are two questions with two answers,
 * and a dispatch that took the first would send a query wherever the map
 * happened to point -- so an entry left under a collection id, by any route,
 * would divert that collection's rows away from the access-controlled Direct
 * API. Deciding once, on the KIND, and carrying the resolver out of that same
 * branch makes the disagreement unrepresentable rather than merely unlikely.
 */
export type ExecutableSource =
  | { kind: "system"; source: WidgetSource; resolve: SystemSourceResolver }
  | { kind: "collection"; source: WidgetSource }
  | { kind: "single"; source: WidgetSource };

/**
 * Which executable kinds are answered by a read of the entity the id names.
 *
 * An exhaustive record rather than a `kind !== "system"` test, so a kind added
 * to `ExecutableSource` has to say here whether the entity-read gate applies
 * to it instead of inheriting an answer nobody gave.
 */
const READS_AN_ENTITY: Record<ExecutableSource["kind"], boolean> = {
  collection: true,
  single: true,
  system: false,
};

/**
 * The entity this source reads through the Direct API, by slug, or none.
 *
 * A collection and a single are each one entity the permission table names,
 * read with the caller and gated on `read-<slug>` -- the same decision for
 * both, so the endpoint that takes it need not know which kind it holds. A
 * system source's rows are not such an entity (a release is not a row in a
 * collection), and its authorization lives in the service that owns them.
 *
 * Published from here rather than restated at the gate, because the gate once
 * listed the kinds it would admit and the list drifted: `single` became
 * executable in the domain while the endpoint went on refusing it as "not
 * executable yet".
 */
export function entityRead(executable: ExecutableSource): string | undefined {
  return READS_AN_ENTITY[executable.kind]
    ? sourceTarget(executable.source.id)
    : undefined;
}

/**
 * Resolves `sourceId` against the live registry, or fails loudly.
 *
 * Every refusal goes through `failUnavailableSourceOrOp`, so a source that does
 * not exist and one that exists but is not executable answer the caller
 * identically -- the second would otherwise confirm the source is real. The
 * distinction survives in the log.
 */
export function resolveExecutableSource(sourceId: string): ExecutableSource {
  // Re-resolve rather than trusting the caller's copy: a source can be
  // deregistered between configuration and execution, and a query pointing at
  // a source that no longer exists must fail rather than fall through.
  const source = getSource(sourceId);
  if (!source) {
    failUnavailableSourceOrOp(`unknown source "${sourceId}" at execution`);
  }
  // A SYSTEM source is executable exactly when something registered a resolver
  // for it. The two halves are published together, so a source with no
  // resolver means a registration that never completed rather than a caller
  // asking for something reasonable -- and it answers like every other dead
  // end, because saying which is which would confirm the source exists.
  if (source.kind === "system") {
    const resolve = systemResolver(source.id);
    if (!resolve) {
      failUnavailableSourceOrOp(
        `system source "${sourceId}" has no registered resolver`
      );
    }
    return { kind: "system", source, resolve };
  }
  // A single is executable the way a collection is: its one document is read
  // through the Direct API with the caller, and the executor decides what
  // that read looks like.
  if (source.kind === "single") return { kind: "single", source };
  if (source.kind !== "collection") {
    failUnavailableSourceOrOp(
      `source "${sourceId}" has kind "${source.kind}", which is not executable yet; only collections, singles and system sources are`
    );
  }
  return { kind: "collection", source };
}
