/**
 * The contract every rewrite of a component's hosts plugs into.
 *
 * A HOST is a stored blocks value that may place a component: a collection
 * entry's blocks field (its live row, its working draft, each language), a
 * Single's, a component's own definition, a pattern's. A rewrite walks every
 * host on the site and hands each stored form of each one to a STEP, which says
 * what that form should become. The walker owns everything else: finding the
 * hosts, reading them, the fence against new references, writing only the
 * blocks field with a check that nobody changed it in between, retrying when
 * somebody did, resuming after an interruption, and reporting the hosts it had
 * to leave.
 *
 * A step never knows how it is walked, and the walker never knows what a step
 * does: turning a component's copies into plain blocks is one step, stripping a
 * component's retired field values is another.
 *
 * @module host-rewrite/contract
 * @experimental
 */

/** Which stored form of a host a step is looking at. */
export type HostForm = "published" | "draft";

/** Where one host's blocks value is stored. */
export interface HostAddress {
  /** A collection entry, or a Single. */
  readonly kind: "collection" | "single";
  /** The collection's or Single's slug, as registered. */
  readonly slug: string;
  /** The entry's id; absent for a Single. */
  readonly id?: string;
  /**
   * The keys leading to the blocks value in the stored row: `["content"]` for
   * a top-level field, `["hero", "body"]` for one inside the named group
   * `hero`.
   */
  readonly path: readonly string[];
  /** The language read and written, for a field stored per language. */
  readonly locale?: string;
}

/** What a step is told about the value it is handed. */
export interface StoredForm {
  readonly host: HostAddress;
  readonly form: HostForm;
}

/**
 * What a step says one stored form should become.
 *
 * - `unchanged`: nothing to do here.
 * - `rewritten`: store `value` in place of what was read.
 * - `refuse`: this form cannot be rewritten; `reason` says why in words an
 *   author can act on. The host is reported as left, and nothing is written.
 *
 * @experimental
 */
export type StepOutcome =
  | { readonly kind: "unchanged" }
  | { readonly kind: "rewritten"; readonly value: unknown }
  | { readonly kind: "refuse"; readonly reason: string };

/**
 * One rewrite's work on one stored form, as a function of what is stored.
 *
 * `doc` is the stored value as read, unvalidated: a step decides for itself
 * what a value it cannot read means, and the safe answer is `refuse`, never
 * `unchanged`. A step must be idempotent: handed its own `rewritten` value it
 * answers `unchanged`. The final walk relies on that to tell a finished host
 * from one that still needs work. It may be called more than once for the same
 * form (a retry after a concurrent edit), so it must not keep state between
 * calls.
 *
 * @experimental
 */
export type HostStep = (
  doc: unknown,
  form: StoredForm
) => StepOutcome | Promise<StepOutcome>;

/**
 * Why a host was left as it is.
 *
 * - `refused`: the step refused one of its forms.
 * - `pending-draft`: its working draft was rewritten, but its live row holds
 *   what the step would rewrite, and the live row cannot be written without
 *   putting the draft live. The author publishes or discards the draft, and the
 *   rewrite is tried again.
 * - `not-permitted`: the person the rewrite runs as may not update it (or, for
 *   a live row, publish it).
 * - `unreadable`: it could not be read, or read to the end.
 * - `unaddressable`: its value has no fixed address the rewrite can write
 *   (inside a repeater, or under a named group), and the step would change it.
 * - `changed`: it kept changing under the rewrite until the retries ran out.
 * - `write-refused`: the write was refused by the field's own rules.
 * - `layout`: a Layout names the component, which only its own editor changes.
 */
export type LeftReason =
  | "refused"
  | "pending-draft"
  | "not-permitted"
  | "unreadable"
  | "unaddressable"
  | "changed"
  | "write-refused"
  | "layout";

/** One host a rewrite left as it is, and why. */
export interface LeftHost {
  readonly host: HostAddress;
  readonly reason: LeftReason;
  /** The step's or the write's own words, when there are any. */
  readonly detail?: string;
}

/**
 * What one call of the rewrite did.
 *
 * `finished` is false when the call stopped at its budget, or when a write
 * re-queued a document: call it again and it resumes. Every list is about
 * THIS call. A call on a run that is done, but left documents, reads them
 * again (they may have been resolved since) and walks everything once more.
 * The run's own record of every document it left, and why, is its
 * progress (`ProgressStore.all`), which the final walk rewrites for every
 * document it reads.
 *
 * @experimental
 */
export interface RewriteReport {
  /** Hosts written in this call. */
  readonly rewritten: readonly HostAddress[];
  /** Hosts read in this call that needed nothing. */
  readonly unchanged: readonly HostAddress[];
  /** Hosts left as they are, with why. */
  readonly left: readonly LeftHost[];
  /**
   * Hosts the FINAL walk found still needing a rewrite: re-queued by a write
   * made while fenced, or skipped through a progress row that was wrong. Empty
   * on a run whose converting walk did its job.
   */
  readonly caughtByFinalWalk: readonly HostAddress[];
  /**
   * Hosts whose rewrite puts the value live: a public live row with no pending
   * draft, written by publishing it again. In a dry run, the ones a real run
   * would publish, so a caller can ask before it starts whether it may.
   */
  readonly publishing?: readonly HostAddress[];
  /** Whether the run has walked every host to the end, twice. */
  readonly finished: boolean;
}

/** The character joining a key's parts; no slug, id, key or locale holds it. */
const KEY_SEPARATOR = "\u001F";

/** The document a key names, as {@link documentKeyOf} spells it; `undefined` otherwise. */
export function documentAddressOf(
  key: string
): Pick<HostAddress, "kind" | "slug" | "id"> | undefined {
  const parts = key.split(KEY_SEPARATOR);
  if (parts[0] === "single" && parts.length === 2 && parts[1] !== "") {
    return { kind: "single", slug: parts[1] };
  }
  if (parts[0] === "collection" && parts.length === 3 && parts[2] !== "") {
    return { kind: "collection", slug: parts[1], id: parts[2] };
  }
  return undefined;
}

/** The document a host belongs to: `collection␟slug␟id` or `single␟slug`. */
export function documentKeyOf(
  host: Pick<HostAddress, "kind" | "slug" | "id">
): string {
  return host.kind === "single"
    ? ["single", host.slug].join(KEY_SEPARATOR)
    : ["collection", host.slug, host.id ?? ""].join(KEY_SEPARATOR);
}

/**
 * A host and form as one key, so what a step saw is what its writer writes:
 * a breakpoint removal keeps what it strips by it, and its undo reads that
 * back by it.
 */
export function formKey(host: HostAddress, form: HostForm): string {
  return JSON.stringify([
    host.kind,
    host.slug,
    host.id ?? "",
    host.path,
    host.locale ?? "",
    form,
  ]);
}
