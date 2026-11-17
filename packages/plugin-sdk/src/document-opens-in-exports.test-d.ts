/**
 * Where the edited document opens and its list, and the pin action's id, as
 * the SDK publishes them for a document view that words its way out and
 * offers the editor's own pin from its menu.
 */
import { expectTypeOf } from "vitest";

import {
  PIN_TO_DASHBOARD_ACTION,
  useDocumentOpensIn,
  type DocumentOpensIn,
} from "@nextlyhq/plugin-sdk/admin";

expectTypeOf(useDocumentOpensIn).returns.toEqualTypeOf<DocumentOpensIn | null>();
expectTypeOf<DocumentOpensIn["opensIn"]>().toEqualTypeOf<string>();
expectTypeOf<DocumentOpensIn["list"]>().toEqualTypeOf<{
  label: string;
  address: string;
}>();
// The literal id, so a view comparing an action's id against it compares the
// value core gives the action.
expectTypeOf(PIN_TO_DASHBOARD_ACTION).toEqualTypeOf<"pin-to-dashboard">();
