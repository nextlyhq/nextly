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

declare module "@nextlyhq/plugin-sdk" {
  interface AdminPlaces {
    "nextlyhq-plugin-page-builder.settings": {
      context: PageBuilderSettingsContext;
    };
  }
}
