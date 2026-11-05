/**
 * The compare-and-swap on a rewrite's own writes.
 *
 * A rewrite reads a host, decides what it should become and writes it. An
 * author saving that host in between would have their edit overwritten by a
 * value computed from what was there before it. So every write a rewrite makes
 * carries what it expects to find stored: the hash of the value it read. The
 * blocks field's validation, which every write path runs, reads the stored
 * value afresh on the write's own connection and refuses the write when the
 * hash differs. The rewrite then reads the host again and decides again.
 *
 * The expectation travels with the write's own call, in an async context, so
 * no other write is judged by it: an author's save of the same host in the same
 * process is not the rewrite's, and is not refused for disagreeing with what
 * the rewrite read.
 *
 * The context is loaded only once a rewrite runs, so a module that reaches a
 * browser bundle through the plugin's root never loads a Node built-in, and a
 * validation in a process that never ran a rewrite asks nothing.
 *
 * @module host-rewrite/expectations
 */
import type { AsyncLocalStorage } from "node:async_hooks";

import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";

import { documentKeyOf, type HostAddress, type HostForm } from "./contract";
import { storedHash } from "./stored-hash";

/** The issue code a write refused by the check carries. */
export const HOST_CHANGED = "HOST_CHANGED_DURING_REWRITE";

/** What one stored form must still hold: the hash of the value read. */
export interface FormExpectation {
  readonly form: HostForm;
  /** The hash of the value read, by {@link storedHash}. */
  readonly hash: string;
}

/** What one rewrite write expects to find stored. */
export interface StoredExpectation {
  /** The host written. */
  readonly host: HostAddress;
  /**
   * Every stored form the write depends on, each with the hash it must still
   * have. A publish names both: the live row it was computed from, and the
   * draft form, which with no pending draft reads as that same live row.
   */
  readonly forms: readonly FormExpectation[];
  /**
   * For a publish, whether the document still has no pending working draft.
   * A draft that leaves this field alone reads, on the draft form, exactly as
   * the live row does, and a publish would put it live; so its absence is
   * asked as such, in the same validation, rather than inferred from a hash.
   */
  readonly noPendingDraft?: () => Promise<boolean>;
  /**
   * The language the write is judged in, as validation names it: absent for
   * the site's default language. A write in another language (a hook's own
   * write, say) is not this one.
   */
  readonly locale?: string;
  /**
   * Set once the write's own validation has judged it. Only that first
   * validation is the rewrite's: a hook's nested write to the same field,
   * made within the same call, runs later and is its own.
   */
  readonly judged: { done: boolean };
}

/** The context, once a rewrite in this process has asked for it. */
let context: Promise<AsyncLocalStorage<StoredExpectation>> | undefined;

/** The context, loaded on first use. */
function expectationContext(): Promise<AsyncLocalStorage<StoredExpectation>> {
  context ??= import("node:async_hooks").then(
    loaded => new loaded.AsyncLocalStorage<StoredExpectation>()
  );
  return context;
}

/** Run `write` with `expectation` as what its validation must find stored. */
export async function writeExpecting<T>(
  expectation: StoredExpectation,
  write: () => Promise<T>
): Promise<T> {
  const storage = await expectationContext();
  return storage.run(expectation, write);
}

/** The issue the blocks field raises for a write that lost the race. */
export interface ChangedIssue {
  readonly path: string;
  readonly code: typeof HOST_CHANGED;
  readonly message: string;
}

/**
 * The refusal for this field write when it is a rewrite's own and the stored
 * value is not the one the rewrite read; `undefined` otherwise.
 *
 * Matched by document, field path and language, and used once: one
 * expectation covers one write of one field of one document in one language.
 * A write in the same context to another document, another language, or the
 * same field again after the rewrite's own validation (a hook's nested write)
 * is not the rewrite's and is not judged.
 */
export async function changedSinceRead(
  write: PluginFieldWrite,
  path: string
): Promise<ChangedIssue | undefined> {
  if (context === undefined) return undefined;
  const expected = (await context).getStore();
  if (expected === undefined || expected.judged.done) return undefined;
  if (!sameField(expected.host, write, path)) return undefined;
  if (write.locale !== expected.locale) return undefined;
  expected.judged.done = true;
  const field = expected.host.path[0] ?? path;
  for (const form of expected.forms) {
    if (!(await holdsStill(write, field, form))) return changedIssue(path);
  }
  if (
    expected.noPendingDraft !== undefined &&
    !(await expected.noPendingDraft())
  ) {
    return changedIssue(path);
  }
  return undefined;
}

/** Whether one stored form still holds the value the rewrite read. */
async function holdsStill(
  write: PluginFieldWrite,
  field: string,
  expected: FormExpectation
): Promise<boolean> {
  const read = await write.readStored(
    write.kind === "single"
      ? { single: write.slug, field, form: expected.form }
      : {
          collection: write.slug,
          id: write.id ?? "",
          field,
          form: expected.form,
        }
  );
  const now = await storedHash(read.kind === "value" ? read.value : undefined);
  return now === expected.hash;
}

/** The refusal a write that lost the race carries. */
function changedIssue(path: string): ChangedIssue {
  return {
    path,
    code: HOST_CHANGED,
    message:
      "This content changed while it was being converted, so the conversion was not saved. It is read again and converted from what is stored now.",
  };
}

/** Whether a field write is the one an expectation was made for. */
function sameField(
  host: HostAddress,
  write: PluginFieldWrite,
  path: string
): boolean {
  if (write.kind !== host.kind) return false;
  if (write.kind === "collection" && write.id === undefined) return false;
  return (
    documentKeyOf({ kind: write.kind, slug: write.slug, id: write.id }) ===
      documentKeyOf(host) && path === host.path.join(".")
  );
}
