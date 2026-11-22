/**
 * The Page Builder's Settings place, as this plugin types it.
 *
 * A module augmentation reaches a consumer only through a module the
 * published declarations include. Here it is imported by the admin entry's
 * Page Builder tab, whose props name the place, so the built declarations
 * carry it beside that tab; declared beside the server contribution instead,
 * it was dropped from every published declaration, and a consumer's type
 * check refused the place's name.
 *
 * @module admin/page-builder-place
 */
import type { Control, FieldValues } from "react-hook-form";

/**
 * What the Page Builder hands a tab at its place, as it declares it. Restated
 * rather than imported, so this plugin never depends on the Page Builder's
 * package.
 */
interface PageBuilderSettingsContext {
  userId: string;
  document: "page" | "template";
  collection: string;
  entryId: string | null;
  draws: { collection: string; entryId: string | null } | null;
}

/**
 * What the Page Builder hands a block at its place besides the context, as
 * it declares it: where the block is drawn (General in Page settings, or the
 * right panel's page settings), the type's name for its pages, and the page
 * being edited. Restated, as the context is.
 */
export interface PageBuilderSettingsBlockProps {
  /** Where the block is drawn: Page settings' General, or the right panel. */
  at: "general" | "panel";
  /** The page's content type, named for its pages ("Pages"), where known. */
  typePlural?: string;
  /** The entry's form, which the page's fields are typed into. */
  control?: Control<FieldValues>;
  /** The page's blocks as they are being edited, which the form holds only once stored. */
  design?: Readonly<Record<string, unknown>>;
  /** The form path of the field the builder edits. */
  designField?: string;
}

declare module "@nextlyhq/plugin-sdk" {
  interface AdminPlaces {
    "nextlyhq-plugin-page-builder.settings": {
      context: PageBuilderSettingsContext;
    };
  }
}
