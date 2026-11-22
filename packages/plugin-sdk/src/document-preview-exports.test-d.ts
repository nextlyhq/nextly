/**
 * The surrounding document's preview, as the SDK publishes it: `null` where
 * the editor offers none, the editor's own opener, and an optional opener for
 * the preview beside the form, absent where the editor has no such pane.
 */
import { expectTypeOf } from "vitest";

import type {
  DocumentPreview,
  useDocumentPreview,
} from "@nextlyhq/plugin-sdk/admin";

expectTypeOf<{
  hook: typeof useDocumentPreview;
  shape: DocumentPreview;
}>().toEqualTypeOf<{
  hook: () => DocumentPreview | null;
  shape: {
    open: (before?: () => Promise<boolean>) => void | Promise<void>;
    openBeside?: () => void;
  };
}>();
