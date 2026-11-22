/**
 * What a render compiles with: a caller's context reconciled with the stored
 * artifact and the host (its scope, the caps and the host-fetch policy), and
 * the label a fetch policy is known by.
 *
 * @module styles-effective-compile
 */
import {
  isFetchableUrl,
  DEFAULT_LIMITS,
  type DocumentLimits,
  type MayFetchUrl,
  type RemotePatternInput,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import type { PageStyles } from "./styles-artifact";

/**
 * PRECONDITION: `document` is the tree that will RENDER, with condition-gated nodes already
 * removed by {@link pruneHiddenNodes}.
 *
 * Stated on the signature because this is exported and the unsafe call is the natural-looking one.
 * Handed a RAW document, every gated node counts as surviving, so its rules are appended from the
 * artifact and its markup is withheld by the renderer — publishing the colours, fonts and
 * `url(...)` of a block nobody was served. `PageRenderer` runs the pass itself, so the ordinary
 * path cannot get this wrong; a consumer assembling styles by hand can, which is why the prune is
 * exported alongside this.
 */
/**
 * A stable label for a host-fetch policy, or `undefined` when there is none.
 *
 * Derived from the patterns rather than assigned by a caller, so it changes
 * exactly when the policy does and there is nothing to remember to bump. Sorted
 * before joining because two lists holding the same entries in a different
 * order are the same policy, and a label that disagreed would recompile every
 * stored sheet on a cosmetic reordering.
 *
 * Written as JSON, for two reasons that are both about being WRONG in a way
 * nobody would see.
 *
 * It has to survive storage. This label is persisted inside the stylesheet
 * artifact, and that artifact is written to a JSON column — which on PostgreSQL
 * cannot hold a NUL byte at all. A separator chosen for being impossible in a
 * hostname is exactly the kind that is also impossible to store, and the failure
 * would be a save that errors only once a site turns the policy on.
 *
 * It has to keep ABSENT and EMPTY apart. `isAllowedRemoteUrl` reads an omitted
 * `port` as "any port" and `port: ""` as "the default port only", so a policy
 * tightened from one to the other is a different policy. Joining fields into a
 * string collapses that difference, and a stylesheet compiled under the broader
 * rule would go on being served under the narrower one. `JSON.stringify` drops
 * an undefined field and keeps an empty one, which is precisely the distinction.
 */
export function fetchPolicyLabel(
  patterns: readonly RemotePatternInput[] | undefined
): string | undefined {
  if (patterns === undefined) return undefined;
  const parts = patterns.map(pattern => {
    // A `URL` keeps the trailing colon on `protocol` and answers "" for the
    // fields it has none of; the object form omits them. Normalised to the
    // object's spelling so the same policy written either way labels the same.
    const fields =
      pattern instanceof URL
        ? {
            protocol: pattern.protocol.replace(/:$/, ""),
            hostname: pattern.hostname,
            port: pattern.port,
            pathname: pattern.pathname,
            search: pattern.search,
          }
        : {
            protocol: pattern.protocol,
            hostname: pattern.hostname,
            port: pattern.port,
            pathname: pattern.pathname,
            search: pattern.search,
          };
    // Key order is fixed by writing the members out, so two equal patterns
    // cannot label differently because they were built in a different order.
    return JSON.stringify([
      fields.protocol ?? null,
      fields.hostname,
      fields.port ?? null,
      fields.pathname ?? null,
      fields.search ?? null,
    ]);
  });
  // An EMPTY list is a real policy — it allows no remote host at all — and must
  // not label the same as having no policy, which asks nothing. The version
  // prefix means a later change to this encoding invalidates old stamps rather
  // than silently matching them.
  return JSON.stringify(["v1", ...parts.sort()]);
}

/**
 * The identity of a fetch policy that declines to identify itself.
 *
 * A plain word, and deliberately not valid `fetchPolicyLabel` output: every
 * label this module produces is a JSON array, so no stored stamp can ever equal
 * this. That makes "a custom predicate with no stated identity" mean recompile
 * every time — the slow answer and the correct one, since the alternative is
 * serving CSS whose URLs were admitted by a function that has since changed.
 *
 * Storage-safe on purpose. It can be STAMPED onto a recompiled artifact and
 * written to a JSON column, so it must not carry the control characters an
 * impossible-looking sentinel invites.
 */
export const UNIDENTIFIED_FETCH_POLICY = "unidentified-fetch-policy";

/** What a page must be recompiled WITH, and judged BY. */
export interface EffectiveCompile {
  /** The context to recompile with, or `undefined` when the caller gave none. */
  context: StyleCompileContext | undefined;
  /** The policy label to compare a stored sheet's stamp against. */
  fetchPolicyId: string | undefined;
  /**
   * The host-fetch predicate in force for this render — the caller's own when
   * they supplied one, otherwise the one derived from the pattern list.
   *
   * Returned in its own right because the SITE sheet needs it and cannot read
   * it off `context`: that is `undefined` whenever the caller gave no style
   * context, while the site sheet is compiled regardless. Deriving it a second
   * time at the other call site is how one sheet comes to refuse a host the
   * other serves.
   */
  mayFetchUrl: MayFetchUrl | undefined;
}

/**
 * Reconcile what a CALLER supplied with what the stored artifact and the host
 * already knew.
 *
 * A caller's raw context is not the context to compile with, and the three
 * differences all fail silently:
 *
 * - **Scope lives on the ARTIFACT, not the context.** A caller normally omits it
 *   for exactly that reason, so compiling with the raw context rebuilds a scoped
 *   page unscoped and lets its selectors reach another document rendered beside
 *   it. Only a STRING is carried over: the artifact is a database record, so its
 *   `scope` can be null or a number, and the compiler dereferences it before any
 *   block boundary exists — a malformed one would fail the whole page rather
 *   than render it unstyled.
 * - **Limits come from the caller's own cap**, which preparation already honours.
 *   Compiling against the context's caps instead retains nodes whose styles were
 *   never written, so the document holds nodes the class map does not name.
 * - **A sheet with no policy stamp compares equal to no policy at all.** A caller
 *   with its own `mayFetchUrl` and no `fetchPolicyId` would therefore reuse an
 *   unstamped sheet under a predicate that never judged it. A caller's predicate
 *   is authoritative and opaque — nothing here can tell one such function from
 *   another — so absent a stated identity it gets one no artifact can carry, and
 *   every stored sheet reads as compiled under another policy. Safe rather than
 *   fast, and a caller wanting its sheets cached says which policy its predicate
 *   IS.
 *
 * One derivation for every entry point that resolves a stored page. Two would
 * agree on the day they were written, and the drift would be a page served with
 * another page's selectors or with URLs the current policy refuses.
 */
export function effectiveCompile(args: {
  styleContext: StyleCompileContext | undefined;
  styles: PageStyles | undefined;
  limits: DocumentLimits | undefined;
  remotePatterns: readonly RemotePatternInput[] | undefined;
}): EffectiveCompile {
  const patterns = args.remotePatterns;
  // A caller's OWN predicate wins: it is the more specific answer, and a host
  // that passed one deliberately should not have it replaced by one derived
  // from the pattern list.
  const fetchPolicyId =
    args.styleContext?.mayFetchUrl === undefined
      ? fetchPolicyLabel(patterns)
      : (args.styleContext.fetchPolicyId ?? UNIDENTIFIED_FETCH_POLICY);
  // Derived ONCE, here, and handed back so both sheets are judged by the same
  // function. The caller's own predicate wins for the same reason it does
  // below; a pattern list with no caller predicate becomes one.
  const derived =
    args.styleContext?.mayFetchUrl ??
    (patterns === undefined
      ? undefined
      : (url: string) => isFetchableUrl(url, patterns));
  if (args.styleContext === undefined)
    return { context: undefined, fetchPolicyId, mayFetchUrl: derived };
  return {
    mayFetchUrl: derived,
    context: {
      ...args.styleContext,
      limits: args.limits ?? args.styleContext.limits ?? DEFAULT_LIMITS,
      // `derived` itself, not a second closure over the same list. It already
      // encodes both rules: a caller's own predicate is what it resolved to,
      // and no list with no caller predicate leaves it undefined. Rebuilding
      // one here would hand the two sheets different functions while this
      // module promised them one, which is the divergence the promise exists
      // to prevent.
      ...(derived === undefined ? {} : { mayFetchUrl: derived }),
      ...(args.styleContext.scope === undefined &&
      typeof args.styles?.scope === "string"
        ? { scope: args.styles.scope }
        : {}),
    },
    fetchPolicyId,
  };
}

/**
 * Whether a stored sheet was compiled under a different fetch policy than the
 * one in force, or under an anonymous one, which is stale against every
 * policy. See the reasoning where {@link resolvePageStylesWithTrace} asks.
 */
export function storedUnderAnotherPolicy(
  styles: PageStyles | undefined,
  fetchPolicyId: string | undefined
): boolean {
  if (styles === undefined) return false;
  return (
    styles.fetchPolicyId !== fetchPolicyId ||
    styles.fetchPolicyId === UNIDENTIFIED_FETCH_POLICY
  );
}
