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

import { sourceResolver, type SourceResolver } from "./resolved-sources";
import {
  failUnavailableSourceOrOp,
  getSource,
  sourceTarget,
  type WidgetSource,
} from "./sources";

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
  | { kind: "system"; source: WidgetSource; resolve: SourceResolver }
  | { kind: "plugin"; source: WidgetSource; resolve: SourceResolver }
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
  // A plugin source's rows are not an entity the permission table names, for
  // the same reason a system source's are not: whatever they are, they are the
  // plugin's own, and the `read-<slug>` gate would be asking about a collection
  // that does not exist. Its `requiredPermission` stays advisory, as every
  // source's is.
  plugin: false,
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
  // A RESOLVER-ANSWERED source -- core's own or a plugin's -- is executable
  // exactly when something registered a resolver for it. The two halves are
  // published together, so a source with no resolver means a registration that
  // never completed rather than a caller asking for something reasonable --
  // and it answers like every other dead end, because saying which is which
  // would confirm the source exists. One branch for both kinds, because the
  // question ("what answers this id") and the store are one.
  if (source.kind === "system" || source.kind === "plugin") {
    const resolve = sourceResolver(source.id);
    if (!resolve) {
      failUnavailableSourceOrOp(
        `${source.kind} source "${sourceId}" has no registered resolver`
      );
    }
    return { kind: source.kind, source, resolve };
  }
  // A single is executable the way a collection is: its one document is read
  // through the Direct API with the caller, and the executor decides what
  // that read looks like.
  if (source.kind === "single") return { kind: "single", source };
  if (source.kind === "collection") return { kind: "collection", source };

  // 🔴 Unreachable through the type, and kept anyway. Every member of
  // `WIDGET_SOURCE_KINDS` is now executable, so the compiler narrows this to
  // `never` -- which is a statement about TypeScript callers, not about the
  // values that arrive. A source built by a plugin compiled separately, by
  // JavaScript, or through a cast can still carry a kind this function has
  // never heard of, and the alternative to refusing it is falling through to
  // the collection arm with an id that names no collection.
  //
  // It costs nothing: the branch reads a value already in hand and never runs.
  // Widened through a `string` local because a template literal cannot
  // interpolate `never` -- the narrowing is what makes the cheap guard look
  // impossible, so the widening says out loud that it is deliberate.
  const unexpected: string = source.kind;
  failUnavailableSourceOrOp(
    `source "${sourceId}" has kind "${unexpected}", which is not executable; only collections, singles, system and plugin sources are`
  );
}
