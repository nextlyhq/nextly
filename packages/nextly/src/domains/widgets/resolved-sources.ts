/**
 * Sources answered by a FUNCTION, and the one store that holds those functions.
 *
 * Two kinds are answered this way and they share everything except who may
 * publish them. A `system:` source is core's own — a release is not a row in a
 * collection table, so the releases service answers it. A `plugin:` source is a
 * third party's, contributed through `contributes.widgetSources`. Neither is a
 * table the Direct API can compile a query against, which is the whole reason a
 * resolver exists.
 *
 * 🔴 ONE store, keyed by id, because a second one is a second answer to "what
 * answers this id". The invariant that matters is not which kind a resolver
 * belongs to but which kinds may carry a resolver AT ALL: a resolver stored
 * under a `collection:` or `single:` id would answer a question the
 * access-controlled Direct API is supposed to answer, diverting that entity's
 * rows away from it. {@link RESOLVER_ANSWERED_KINDS} states that rule once, and
 * both doors below go through it.
 *
 * ## What a resolver is handed, and what it is not
 *
 * `(query, caller)` and nothing else. No request, no headers, no fetch-capable
 * context — a plugin's resolver reaches whatever its own closure captured at
 * registration, exactly as `releases-widget-source.ts` does today.
 *
 * 🔴 What that signature does and does NOT bound, stated exactly, because the
 * difference is security-relevant and the generous reading is wrong.
 *
 * BOUNDED: the SHAPE of the question. `validateReadWidgetQuery` refuses a field
 * name the source never declared, an operator outside the vocabulary, and an
 * operand that is a plain object. So a resolver is never asked about a column
 * its own source did not publish, and never handed a structure where a scalar
 * belongs.
 *
 * NOT BOUNDED: the operand VALUES. `where: { total: { equals: "http://..." } }`
 * validates cleanly and arrives at the resolver verbatim, because nothing
 * constrains what a legal string contains. A caller who may place a widget can
 * therefore choose those bytes.
 *
 * So a resolver MUST NOT use any value out of `query` as an outbound URL, a
 * filesystem path, a table or column name, or anything else that names a
 * destination. Treat every operand as caller-controlled input and validate it
 * against a closed set before it decides where a request goes. The contract
 * hands over a question, not a trusted one.
 *
 * Why that is a rule rather than a validator here: Directus mitigated an
 * import-endpoint SSRF with an IP denylist (CVE-2022-23080) and the denylist
 * was itself bypassed by DNS rebinding (CVE-2023-26492). A host-side filter
 * over a value the plugin then uses as a destination is one round of research
 * from being no filter at all, so the host declines to imply one.
 *
 * ## What this contract does NOT promise
 *
 * That a resolver consults `caller`. It cannot: the host hands over the caller
 * and the resolver decides what to do with it. Pairing the source and the
 * resolver in one call makes "registered but unanswerable" unrepresentable, and
 * validating the query keeps a malformed question out — neither proves a third
 * party authorized anything, and neither is the SSRF bound the section above
 * declines to claim. WordPress has required a `permission_callback` on every REST route
 * since 5.5 and plugins still ship `__return_true` for it (CVE-2026-4019,
 * CVE-2026-4020); Payload's Local API disables access control by default. A
 * required field is not an enforced check.
 *
 * This is the same trust boundary a plugin's `init()`, hooks and services
 * already cross — a Nextly plugin is an ordinary npm dependency, as trusted as
 * the code that imports it — not a new, narrower one. The documentation says so
 * rather than implying a guarantee the shape cannot make.
 *
 * @module domains/widgets/resolved-sources
 */

import { NextlyError } from "../../errors/nextly-error";
import type { ReadCaller } from "../../services/dashboard/readable-resources";

import type { WidgetQuery } from "./query";
import type { WidgetResult } from "./result";
import { registerSource, type WidgetSource } from "./sources";

/**
 * Answers one source's query, for one caller.
 *
 * Returns the same `WidgetResult` a collection query does, so the archetypes
 * that draw a count or a list need no branch for where the rows came from.
 */
export type SourceResolver = (
  query: WidgetQuery,
  caller: ReadCaller
) => Promise<WidgetResult>;

/**
 * The source kinds a resolver may be registered for.
 *
 * An allowlist, checked at runtime rather than left to the type. `registerSource`
 * validates that a source's kind agrees with its namespace and nothing more, so
 * a well-formed `collection:` source satisfies it completely — and the type
 * states this rule only for a TypeScript caller, not for a plugin compiled
 * separately, for JavaScript, or for a cast.
 */
const RESOLVER_ANSWERED_KINDS: ReadonlySet<string> = new Set([
  "system",
  "plugin",
]);

/** A source this registry may answer. */
export type ResolvedWidgetSource = WidgetSource & { kind: "system" | "plugin" };

/**
 * The resolvers, pinned where every other boot-time widget store is.
 *
 * On `globalThis` so they survive the module re-evaluation Next.js and
 * Turbopack perform, matching the source store beside them.
 */
const globalForResolvers = globalThis as unknown as {
  __nextly_systemResolvers?: Map<string, SourceResolver>;
};

function resolvers(): Map<string, SourceResolver> {
  globalForResolvers.__nextly_systemResolvers ??= new Map();
  return globalForResolvers.__nextly_systemResolvers;
}

/**
 * Publish a resolver-answered source and the function that answers it, together.
 *
 * 🔴 One call, because the two halves are useless apart and dangerous apart in
 * one direction: a source registered without a resolver is discoverable, passes
 * validation, and fails only when a reader puts the card on their dashboard.
 * Registering them separately makes that state reachable through ordinary
 * refactoring; this signature makes it unrepresentable.
 *
 * Refused BEFORE `registerSource`, so a rejected registration writes neither
 * store. Checking afterwards would leave the source published and unanswerable,
 * which is the exact state this function's signature exists to prevent.
 *
 * The source then goes through `registerSource`, the same door a collection
 * source uses, so its shape is validated by the same rules and a duplicate id
 * is refused the same way.
 *
 * 🔴 The resolver is keyed from the snapshot `registerSource` RETURNS, never by
 * reading `source.id` a second time. `source` belongs to the plugin, and `id`
 * may be an accessor or a Proxy trap rather than a stored string -- so a second
 * read can answer differently and file the resolver under a key no source
 * claims. The published source would then fail every query as unanswerable,
 * which is the exact state one call exists to make unreachable: two reads of a
 * caller-owned property are two values, however atomic the signature looks.
 */
export function registerResolvedSource(
  source: ResolvedWidgetSource,
  resolve: SourceResolver
): void {
  if (!RESOLVER_ANSWERED_KINDS.has(source?.kind)) {
    // `invalidInput`, matching `sources.ts`: a source registered by core or by
    // a plugin is developer input, not a reader's, so the message is safe to
    // surface verbatim and says what to change.
    throw NextlyError.invalidInput({
      message:
        `Invalid widget source: ${String(source?.id)}: a resolver may only be ` +
        `registered for a "system:" or "plugin:" source, not kind ` +
        `"${String(source?.kind)}"`,
    });
  }
  const registered = registerSource(source);
  resolvers().set(registered.id, resolve);
}

/** The resolver for `sourceId`, or `undefined` when nothing answers it. */
export function sourceResolver(sourceId: string): SourceResolver | undefined {
  return resolvers().get(sourceId);
}

/**
 * Forget every registered resolver.
 *
 * Paired with `clearSources`: clearing one and not the other leaves a resolver
 * addressable under an id no source claims, or a source nothing can answer.
 */
export function clearResolvers(): void {
  resolvers().clear();
}
