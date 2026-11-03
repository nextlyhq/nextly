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

/** What one rewrite write expects to find stored. */
export interface StoredExpectation {
  /** The host written. */
  readonly host: HostAddress;
  /** The stored form the hash was read from. */
  readonly form: HostForm;
  /** The hash of the value read, by {@link storedHash}. */
  readonly hash: string;
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
 * Matched by document and field path, not by language: one expectation covers
 * one write of one field of one document. A write in the same context to
 * another document (a hook's own write, say) is not the rewrite's and is not
 * judged.
 */
export async function changedSinceRead(
  write: PluginFieldWrite,
  path: string
): Promise<ChangedIssue | undefined> {
  if (context === undefined) return undefined;
  const expected = (await context).getStore();
  if (expected === undefined || !sameField(expected.host, write, path)) {
    return undefined;
  }
  const field = expected.host.path[0] ?? path;
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
  if (now === expected.hash) return undefined;
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
