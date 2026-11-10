/**
 * The conditions preview's read, as the editor and the route share it: what
 * the editor asks about the page it opened, and what it is answered.
 *
 * @experimental Settles with the editor's condition controls.
 * @module conditions-preview-contract
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";

/** The route, under the plugin's own prefix. */
export const CONDITIONS_PREVIEW_ENTRY_PATH = "/conditions-preview/entry";

/** The page asked about: its collection, its id, and the language edited. */
export interface ConditionsPreviewRequest {
  readonly collection: string;
  readonly id: string;
  readonly locale?: string;
}

/**
 * What a visitor reads of the page, and nothing more: its published values as
 * an anonymous visitor reads them, or `null` where they read none (never
 * published, or not theirs to read), and the fields a visitor may read. With
 * what one of the collection's entries is called, for the editor's words.
 */
export interface ConditionsPreviewResponse {
  readonly id: string;
  readonly noun: string;
  readonly publicValues: Readonly<Record<string, unknown>> | null;
  readonly fields: readonly BindingFieldShape[];
}
