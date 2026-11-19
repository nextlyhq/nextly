/**
 * The fact that a create copies a stored entry the caller read in the same
 * call, as a field type's validator is told it (`PluginFieldWrite.copiedFrom`).
 *
 * A validator may treat a value the source already holds as no change, so the
 * fact must be impossible to claim without the read behind it. That is made a
 * boundary rather than a convention: the only value the write path hands on is
 * one {@link readSourceCopy} minted from a successful read, recorded in a
 * module-private set. A plain object of the same shape, however it reached a
 * write's parameters (a request body, a spread, a plugin's options), is not in
 * the set, and {@link copiedFromOf} answers nothing for it.
 *
 * @module domains/collections/services/copied-from
 */
import { NextlyError } from "../../../errors";
import type { PluginFieldWrite } from "../../../plugins/contributions";

import type { CollectionServiceResult } from "./collection-types";

/** The copy as a validator sees it. */
export type CopiedFrom = NonNullable<PluginFieldWrite["copiedFrom"]>;

declare const sourceReadBrand: unique symbol;

/** A copy minted from the caller's own read of its source. */
export type SourceReadCopy = CopiedFrom & {
  readonly [sourceReadBrand]: "SourceReadCopy";
};

/** Every copy {@link readSourceCopy} minted. Weak, so none outlives its write. */
const minted = new WeakSet<object>();

/** The entry a create copies: its collection, its id, and the field named. */
export interface CopySource {
  readonly collection: string;
  readonly id: string;
  /** The source field the copied value came from, where the create names one. */
  readonly field?: string;
}

/**
 * The copy a create may carry, from the caller's read of `source` that has
 * just succeeded. `draftShown` says whether that read showed the caller the
 * source's pending draft (`_isWorkingDraft`), the one rule the read path uses
 * to decide who may see it, so a draft-only value never vouches for a caller
 * who could not read it. The fields are the ones that read returned, so a
 * value a field read rule withheld vouches for nothing either.
 */
export function readSourceCopy(
  source: CopySource,
  read: CollectionServiceResult
): SourceReadCopy {
  // Called only after the read has been checked, so a refused read here is a
  // defect in the caller: refused loudly rather than minted.
  if (!read.success || read.data === null || typeof read.data !== "object") {
    throw NextlyError.internal({
      logContext: { reason: "copy-without-source-read" },
    });
  }
  const data = read.data as Record<string, unknown>;
  const plain: CopiedFrom = {
    collection: source.collection,
    id: source.id,
    forms: Object.freeze(
      data._isWorkingDraft === true
        ? (["published", "draft"] as const)
        : (["published"] as const)
    ),
    fields: Object.freeze(
      Object.keys(data).filter(key => data[key] !== undefined)
    ),
    ...(source.field === undefined ? {} : { field: source.field }),
  };
  // The brand is a type only: what makes it a minted copy is the set below.
  const copy = Object.freeze(plain) as unknown as SourceReadCopy;
  minted.add(copy);
  return copy;
}

/**
 * The copy a write carries, where it is one {@link readSourceCopy} minted;
 * otherwise nothing, whatever the value looks like.
 */
export function copiedFromOf(value: unknown): CopiedFrom | undefined {
  return typeof value === "object" && value !== null && minted.has(value)
    ? (value as CopiedFrom)
    : undefined;
}
