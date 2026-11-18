/**
 * The words of the way into a document view, as the SDK publishes the view
 * declarations: optional text on a view declared on a collection and on one
 * offered wherever a field type is used.
 */
import { expectTypeOf } from "vitest";

import type {
  PluginDocumentView,
  PluginFieldTypeDocumentView,
} from "@nextlyhq/plugin-sdk/admin";

expectTypeOf<PluginDocumentView["openLabel"]>().toEqualTypeOf<
  string | undefined
>();
expectTypeOf<PluginFieldTypeDocumentView["openLabel"]>().toEqualTypeOf<
  string | undefined
>();
