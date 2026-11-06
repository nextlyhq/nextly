/**
 * The digest an approval keeps of the content it approved, so a later save can be told apart from
 * one that changed nothing the approval covers.
 *
 * @module domains/workflows/approval-digest
 */
import { createHash } from "node:crypto";

import { NextlyError } from "../../errors";
import type { SystemColumnEntity } from "../../lib/system-columns";
import { canonicalJson } from "../../shared/lib/canonical-json";
import { documentSystemKeys } from "../versions/snapshot-system-keys";

/**
 * sha256, in hex, of the canonical JSON of a recorded version's content: its snapshot without the
 * keys the framework manages (id, timestamps, status, the version and its changer), which move on
 * saves that change no content. Key order does not matter; a snapshot stored as JSON text is read
 * as the value it holds.
 */
export function approvalDigest(
  snapshot: unknown,
  entity: SystemColumnEntity
): string {
  const value = readSnapshot(snapshot);
  const system = documentSystemKeys(entity);
  // Only the top level carries the framework's keys; nested content is the editor's.
  const content =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(([key]) => !system.has(key))
        )
      : value;
  return createHash("sha256")
    .update(canonicalJson(content) ?? "", "utf8")
    .digest("hex");
}

/** A snapshot as the value it holds: stored as JSON text by some dialects. */
function readSnapshot(snapshot: unknown): unknown {
  if (typeof snapshot !== "string") return snapshot;
  try {
    return JSON.parse(snapshot) as unknown;
  } catch (error) {
    // A snapshot that is not JSON cannot be approved as any content.
    throw NextlyError.internal({
      cause: error instanceof Error ? error : undefined,
      logContext: { reason: "approval-snapshot-unreadable" },
    });
  }
}
