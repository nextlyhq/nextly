/**
 * The document-action surface a plugin compiles against.
 *
 * What these pin is the contract a document view relies on: that the hook can
 * answer null (a view drawn outside an editor has to handle it), that running
 * an action always says what it came to, that a dismissed question is its own
 * answer, and the four save states a surface draws.
 */
import type { JSX } from "react";
import { expectTypeOf } from "vitest";

import {
  DocumentPrimaryAction,
  DocumentSaveIndicator,
  useBeforeDocumentAction,
  useDocumentActions,
  useTrackedWrite,
} from "@nextlyhq/plugin-sdk/admin";
import type {
  DocumentActionOutcome,
  DocumentActions,
  DocumentSaveState,
  StoreReadiness,
} from "@nextlyhq/plugin-sdk/admin";

expectTypeOf(
  useDocumentActions
).returns.toEqualTypeOf<DocumentActions | null>();

expectTypeOf<DocumentActions["run"]>().parameter(0).toEqualTypeOf<string>();
expectTypeOf<DocumentActions["run"]>().returns.toEqualTypeOf<
  Promise<DocumentActionOutcome>
>();

expectTypeOf<
  Extract<DocumentActionOutcome, { ok: false }>["reason"]
>().toEqualTypeOf<"invalid" | "refused" | "failed" | "busy" | "cancelled">();

expectTypeOf<DocumentSaveState["kind"]>().toEqualTypeOf<
  "saved" | "unsaved" | "saving" | "failed"
>();
expectTypeOf<
  NonNullable<Extract<DocumentSaveState, { kind: "failed" }>["retry"]>
>().returns.toEqualTypeOf<Promise<DocumentActionOutcome>>();

// A handler is given the action and how to wait for the store's tracked
// writes; one written for the action alone still fits.
expectTypeOf(useBeforeDocumentAction)
  .parameter(0)
  .toEqualTypeOf<
    (action: string, store: StoreReadiness) => void | Promise<void>
  >();
expectTypeOf<StoreReadiness["writesSettled"]>().returns.toEqualTypeOf<
  Promise<boolean>
>();
// The check is synchronous: the store makes it with nothing awaited between
// it and the write.
expectTypeOf<StoreReadiness["checkBeforeWrite"]>()
  .parameter(0)
  .toEqualTypeOf<() => boolean>();

expectTypeOf(useTrackedWrite).returns.toEqualTypeOf<
  (label: string, write: Promise<unknown>) => void
>();

expectTypeOf<DocumentActions["storedAt"]>().toEqualTypeOf<Date | null>();

// The header's controls for a view without one: components a view places,
// which may render nothing outside a document editor.
expectTypeOf(DocumentSaveIndicator).parameter(0).toEqualTypeOf<{
  className?: string;
}>();
expectTypeOf(DocumentSaveIndicator).returns.toEqualTypeOf<JSX.Element | null>();
expectTypeOf(DocumentPrimaryAction).returns.toEqualTypeOf<JSX.Element | null>();
