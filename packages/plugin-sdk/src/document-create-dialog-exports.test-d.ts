/**
 * A document view's create dialog, as the SDK publishes it: an optional
 * component path on both view declarations, and the props the admin hands the
 * dialog's body (the collection and `close(createdId?)`).
 */
import { expectTypeOf } from "vitest";

import type {
  DocumentCreateDialogProps,
  PluginDocumentView,
  PluginFieldTypeDocumentView,
} from "@nextlyhq/plugin-sdk/admin";

expectTypeOf<PluginDocumentView["createDialog"]>().toEqualTypeOf<
  string | undefined
>();
expectTypeOf<PluginFieldTypeDocumentView["createDialog"]>().toEqualTypeOf<
  string | undefined
>();
expectTypeOf<DocumentCreateDialogProps>().toEqualTypeOf<{
  collection: {
    slug: string;
    labels: { singular: string; plural: string };
  };
  close: (createdId?: string) => void;
}>();
