/**
 * The session on a second document, as the SDK publishes it for a document
 * view that edits another document in place: what it is opened on, what it
 * says about the document and its lock, and what a save answers.
 */
import { expectTypeOf } from "vitest";

import {
  useDocumentSession,
  type DocumentSession,
  type DocumentSessionLock,
  type DocumentSessionOpen,
  type DocumentSessionOutcome,
  type DocumentSessionRefusal,
  type DocumentSessionTarget,
} from "@nextlyhq/plugin-sdk/admin";

// Opened on an entry of a collection, or on nothing, which lets it go; the
// whole session in one shape, so a member added, dropped or retyped fails here.
expectTypeOf(useDocumentSession).toEqualTypeOf<
  (target: DocumentSessionTarget | null) => DocumentSession
>();
expectTypeOf<{
  target: DocumentSessionTarget;
  session: DocumentSession;
  lock: DocumentSessionLock;
  ready: Extract<DocumentSessionOpen, { status: "ready" }>;
  refused: Extract<DocumentSessionOutcome, { ok: false }>;
}>().toEqualTypeOf<{
  target: {
    readonly collection: string;
    readonly id: string;
    readonly locale?: string;
  };
  session: {
    readonly open: DocumentSessionOpen;
    readonly lock: DocumentSessionLock;
    readonly mayPublish: boolean;
    readonly saveDraft: (
      changes: Readonly<Record<string, unknown>>
    ) => Promise<DocumentSessionOutcome>;
    readonly publish: (
      changes: Readonly<Record<string, unknown>>
    ) => Promise<DocumentSessionOutcome>;
    readonly record: (changes: Readonly<Record<string, unknown>>) => void;
    readonly discard: () => Promise<void>;
  };
  // Who holds the document, by name, when someone else does.
  lock:
    | { readonly status: "claiming" }
    | { readonly status: "held" }
    | { readonly status: "held-by-other"; readonly holder: string | null }
    | { readonly status: "lost" }
    | { readonly status: "unavailable" };
  // When it changed and whether it has unpublished changes, for a surface
  // that says so.
  ready: {
    readonly status: "ready";
    readonly values: Readonly<Record<string, unknown>>;
    readonly published: boolean;
    readonly unpublishedChanges: boolean;
    readonly changedAt: string | null;
    readonly draftable: boolean;
  };
  // Every reason a write did not happen, named.
  refused: {
    readonly ok: false;
    readonly reason: "stale" | "locked" | "no-drafts" | "unread" | "refused";
    readonly message: string | null;
    readonly changedBy?: string | null;
  };
}>();
// The refusal's own name covers the same reasons.
type Refused = Extract<DocumentSessionOutcome, { ok: false }>;
expectTypeOf<Refused["reason"]>().toEqualTypeOf<DocumentSessionRefusal>();
