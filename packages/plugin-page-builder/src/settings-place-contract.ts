/**
 * The admin place the Page Builder's Settings dialog offers other plugins:
 * a tab beside the page's or the design's own settings, handed what is being
 * edited and a way to edit what the document states for its page as a whole.
 *
 * A leaf, importing nothing that runs, so a plugin adding a tab can read the
 * place's name and shape without reaching the editor's code.
 *
 * @module settings-place-contract
 */
import type { BlockDocument, DocumentSeo } from "@nextlyhq/blocks-engine";
import type { Control, FieldValues } from "react-hook-form";

/**
 * The place's name: in the plugin's namespace, as a place a plugin declares
 * must be.
 */
export const PAGE_BUILDER_SETTINGS_PLACE =
  "nextlyhq-plugin-page-builder.settings";

/**
 * What the place's context names: who is looking, and what is being edited.
 *
 * @experimental Settles with the template SEO panel.
 */
export interface PageBuilderSettingsContext {
  /** The signed-in person. */
  userId: string;
  /** A page drawn by its own blocks, or a design drawing entries. */
  document: "page" | "template";
  /** The collection the edited document is stored in. */
  collection: string;
  /** The edited document's id, or null before it is first saved. */
  entryId: string | null;
  /**
   * For a design: the collection whose entries it draws, and the one entry
   * an entry's own design draws; null for a collection's template, which
   * draws them all. Null for a page.
   */
  draws: { collection: string; entryId: string | null } | null;
}

/**
 * What every tab at the place is handed besides the context and `setBadge`.
 *
 * @experimental Settles with the template SEO panel.
 */
export interface PageBuilderSettingsTabProps {
  /**
   * What the document states for its page as a whole (`settings.seo`), and
   * how to change it: one edit of the document, undone with the editor's
   * Undo and saved with the page.
   */
  seo: {
    value: DocumentSeo | undefined;
    /**
     * Answers whether the edit was made: false where the editor refused it,
     * as it refuses metadata past the document's limits.
     */
    set: (next: DocumentSeo | null) => boolean;
  };
  /** The document as it is being edited. */
  design: BlockDocument;
  /** The entry's form, which its fields write through. */
  control: Control<FieldValues>;
  /** Whether the document takes edits now. */
  writable: boolean;
  /**
   * Hold an edit the tab has not made yet, such as text still being typed:
   * `make` is run before the document is stored (Save, Publish, the save
   * shortcut), so the store keeps it. Answers the release, called once the
   * tab has made the edit itself or goes away.
   */
  holdEdit: (make: () => void) => () => void;
  /**
   * The form path of the field the design is edited in, whose value is the
   * design as saved until the editor stores it.
   */
  designField?: string;
  /** Show the dialog's General tab, where the page's own fields are. */
  openGeneral?: () => void;
}

declare module "@nextlyhq/plugin-sdk" {
  interface AdminPlaces {
    "nextlyhq-plugin-page-builder.settings": {
      context: PageBuilderSettingsContext;
    };
  }
}
