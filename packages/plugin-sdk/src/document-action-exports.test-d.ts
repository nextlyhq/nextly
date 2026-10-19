/**
 * The document-action surface a plugin compiles against.
 *
 * What these pin is the contract a document view relies on: that the hook can
 * answer null (a view drawn outside an editor has to handle it), that running
 * an action always says what it came to, that a dismissed question is its own
 * answer, and the four save states a surface draws.
 */
import { expectTypeOf } from "vitest";

import {
  useBeforeDocumentAction,
  useDocumentActions,
  useTrackedWrite,
} from "@nextlyhq/plugin-sdk/admin";
import type {
  DocumentActionOutcome,
  DocumentActions,
  DocumentSaveState,
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
  Extract<DocumentSaveState, { kind: "failed" }>["retry"]
>().returns.toEqualTypeOf<Promise<DocumentActionOutcome>>();

expectTypeOf(useBeforeDocumentAction)
  .parameter(0)
  .toEqualTypeOf<(action: string) => void | Promise<void>>();

expectTypeOf(useTrackedWrite).returns.toEqualTypeOf<
  (label: string, write: Promise<unknown>) => void
>();
