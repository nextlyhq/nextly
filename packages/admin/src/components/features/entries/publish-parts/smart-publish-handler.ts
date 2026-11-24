/**
 * The entry and Single editors' Publish, handed to the document's actions: the page's smart
 * Publish run with this editor's own submit, or nothing, which leaves Publish as it is.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/smart-publish-handler
 */

import { localizedFieldNamesOf } from "../entry-locale-source";
import type { SubmitOutcome } from "../EntryForm/submit-outcome";
import type { DocumentActionOutcome } from "../EntryForm/useDocumentActionBindings";
import type { EntryFormIntent } from "../EntryForm/useEntryForm";

import { editsSharedFields } from "./shared-edits";
import type { SmartPublish } from "./useSmartPublish";

/** What an editor says about its form, for its Publish to run. */
export interface SmartPublishEditor {
  /** The editor's one submit, which every write passes through. */
  submit: (event: undefined, intent: EntryFormIntent) => Promise<SubmitOutcome>;
  /** Whether the language on screen is live. */
  published: boolean;
  /** Whether a live document keeps its edits as a working draft. */
  draftsEnabled: boolean;
  /** Whether the editor holds unsaved work. */
  unsaved: () => boolean;
  /** The form, for what it started from and what it holds at the press. */
  form: {
    getValues: () => Record<string, unknown>;
    formState: { defaultValues?: Readonly<Record<string, unknown>> };
  };
  fields: readonly { type?: string; name?: string; localized?: boolean }[];
  /** Whether the document is translated at all. */
  localized: boolean;
}

/**
 * The save that leaves what is live alone, as Save chooses it: undefined on a live document that
 * keeps no drafts, whose every save goes live.
 */
function savesWithoutPublishing(
  editor: SmartPublishEditor
): EntryFormIntent | undefined {
  if (!editor.published) return "save-draft";
  return editor.draftsEnabled ? "save-working-draft" : undefined;
}

/** The document's Publish, where the page has a smart one for it. */
export function smartPublishHandler(
  smartPublish: SmartPublish | undefined,
  editor: SmartPublishEditor
): { onPublish?: () => Promise<DocumentActionOutcome> } {
  if (smartPublish === undefined) return {};
  const save = savesWithoutPublishing(editor);
  return {
    onPublish: () =>
      smartPublish({
        publish: () => editor.submit(undefined, "publish"),
        save:
          save === undefined ? undefined : () => editor.submit(undefined, save),
        unsaved: editor.unsaved,
        sharedEdited: () =>
          editsSharedFields({
            fields: editor.fields,
            translated: localizedFieldNamesOf(editor.fields, editor.localized),
            startedFrom: editor.form.formState.defaultValues ?? {},
            current: editor.form.getValues(),
          }),
      }),
  };
}
