/**
 * Kinds of notice: the one way a feature adds something to a person's list.
 *
 * A kind is declared once, by the feature that writes it, and registered at
 * boot from that feature's own DI registration:
 *
 * ```ts
 * export const releaseStopped = defineNoticeKind({
 *   key: "releases.stopped",
 *   subjectType: "release",
 *   data: z.object({ title: z.string() }),
 *   render: (data, { subjectGone }) => ({
 *     title: `“${data.title}” stopped`,
 *     body: subjectGone ? "The release has since been deleted." : undefined,
 *   }),
 *   link: async ids => new Map(ids.map(id => [id, `/releases/${id}`])),
 * });
 * registerNoticeKind(releaseStopped);
 * ```
 *
 * Everything a reader sees comes from the kind, at read time:
 *   - **its text**, rendered from the snapshot stored with the notice, so the
 *     wording can change without rewriting rows;
 *   - **its link**, resolved in one batch per page — a subject that no longer
 *     exists gets none, and the kind is told so it can say "deleted";
 *   - **who may see it**: only the person it is addressed to, always, and a
 *     kind may narrow that further (a person who lost access to releases stops
 *     seeing release notices). It can never widen it.
 *
 * The data a notice carries is TYPED by the kind: `record()` takes the kind
 * object, so a feature can only record the data its own kind declares.
 *
 * @module domains/notices/notice-kinds
 * @experimental Until the notices feature is complete.
 */
import type { z } from "zod";

import { NextlyError } from "../../errors";

/** What a reader is shown for one notice. */
export interface NoticeText {
  title: string;
  body?: string;
}

/** What a kind knows about the notice it is rendering. */
export interface NoticeRenderContext {
  /**
   * The subject no longer exists (its `link` returned nothing for it). The
   * notice is kept — it is a record of something that happened — and the kind
   * says so in its own words.
   */
  subjectGone: boolean;
}

/**
 * A kind of notice.
 *
 * @typeParam TData - The snapshot each notice of this kind stores.
 * @experimental
 */
export interface NoticeKind<TData = unknown> {
  /**
   * Unique, and namespaced by the feature that owns it: `releases.stopped`,
   * `workflows.assigned`. Stored on every notice, so it is permanent once
   * notices of it exist.
   */
  key: string;
  /** What a notice of this kind is about, such as `release`. */
  subjectType: string;
  /**
   * The snapshot a notice keeps of its subject, validated when it is written.
   * Keep it to what the text needs: it outlives the subject.
   */
  data: z.ZodType<TData>;
  /** The text for one notice, from its snapshot. */
  render: (data: TData, context: NoticeRenderContext) => NoticeText;
  /**
   * Where each subject is in the admin, for a page of notices at once. A
   * subject missing from the answer no longer exists. Omitted, notices of
   * this kind have no link.
   */
  link?: (
    subjectIds: readonly string[]
  ) => Promise<ReadonlyMap<string, string>>;
  /**
   * Whether this person may see notices of this kind now. Narrows, never
   * widens: a notice is only ever shown to the person it was written for.
   * Omitted, they always may.
   */
  visible?: (userId: string) => Promise<boolean>;
}

/**
 * A kind's key: the owning feature, a dot, then the kind's own name, in
 * lowercase. The namespace is what keeps two features from claiming one key.
 */
const KIND_KEY = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-.]*$/;

/** The longest kind key or subject type: the width of their MySQL columns. */
export const NOTICE_NAME_MAX = 64;

/** The longest subject id or occurrence: the width of their MySQL columns. */
export const NOTICE_REFERENCE_MAX = 191;

/**
 * Declare a kind, with its data type inferred from its schema.
 *
 * An identity function that exists for the types: `record()` reads `TData`
 * off the object this returns.
 *
 * @experimental
 */
export function defineNoticeKind<TData>(
  kind: NoticeKind<TData>
): NoticeKind<TData> {
  // Bounded as well as shaped: the key and subject type are stored in columns
  // of NOTICE_NAME_MAX characters on MySQL, and are refused here on every
  // dialect so one cannot store what another truncates.
  if (
    !KIND_KEY.test(kind.key) ||
    kind.key.length > NOTICE_NAME_MAX ||
    kind.subjectType.length > NOTICE_NAME_MAX
  ) {
    throw NextlyError.internal({
      logContext: {
        detail: `Notice kind key "${kind.key}" must be "<feature>.<name>" in lowercase, such as "releases.stopped", and it and its subject type at most ${NOTICE_NAME_MAX} characters.`,
        reason: "invalid-notice-kind-key",
        key: kind.key,
      },
    });
  }
  return kind;
}

const kinds = new Map<string, NoticeKind<unknown>>();

/**
 * Make a kind known, so notices of it can be written and shown.
 *
 * Registering a key again REPLACES it, so a development reload that re-runs
 * every registration does not fail; two features cannot collide on one key
 * because each key is namespaced by its feature. A kind registered with a
 * different subject under an existing key is refused: that is two features
 * claiming one key, not a reload.
 *
 * @experimental
 */
export function registerNoticeKind<TData>(kind: NoticeKind<TData>): void {
  defineNoticeKind(kind);
  const existing = kinds.get(kind.key);
  if (existing !== undefined && existing.subjectType !== kind.subjectType) {
    throw NextlyError.internal({
      logContext: {
        detail: `Notice kind "${kind.key}" is already registered about "${existing.subjectType}", not "${kind.subjectType}".`,
        reason: "notice-kind-key-taken",
        key: kind.key,
      },
    });
  }
  kinds.set(kind.key, kind as NoticeKind<unknown>);
}

/** The registered kind with this key, if any. */
export function registeredNoticeKind(
  key: string
): NoticeKind<unknown> | undefined {
  return kinds.get(key);
}

/** Every registered kind. */
export function registeredNoticeKinds(): NoticeKind<unknown>[] {
  return [...kinds.values()];
}

/** Forget every kind. For tests only. */
export function clearNoticeKindsForTests(): void {
  kinds.clear();
}
