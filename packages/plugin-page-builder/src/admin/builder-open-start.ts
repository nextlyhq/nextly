/**
 * The builder opened straight from its address: what the editor will need is
 * asked for as the admin loads, rather than once the editor is drawn.
 *
 * The admin draws the builder, a view of the document, only after the
 * document's own reads have answered and its editor has been revealed; its
 * code is fetched as it is first drawn, and its start-up read sent as it
 * opens. At an address that names the builder, all of that is known from the
 * address alone, so the plugin's registration, which runs as the admin
 * loads, fetches the code and sends the start-up read at once. The editor,
 * once drawn, takes both rather than asking again (`preloadPart`,
 * `startEarlyBuilderReads`).
 *
 * Kept small, and the start-up read's code fetched only at such an address:
 * the registration runs on every admin screen.
 *
 * @module admin/builder-open-start
 */
import { BUILDER_VIEW_PATH } from "../builder-view";

/** What an address that opens the builder says about the editor. */
export interface BuilderOpenAddress {
  /** Whether the document is a collection's entry, rather than a Single. */
  readonly onCollection: boolean;
  /** The language the address names, if any. */
  readonly locale: string | undefined;
}

/** A document's builder: `/admin/collections/<slug>/<id>/builder` or `/admin/singles/<slug>/builder`. */
const BUILDER_ADDRESS = new RegExp(
  `/admin/(collections/[^/]+/[^/]+|singles/[^/]+)/${BUILDER_VIEW_PATH}/?$`
);

/** What `pathname` and `search` say about the builder, or `null` elsewhere. */
export function builderOpenAddress(
  pathname: string,
  search: string
): BuilderOpenAddress | null {
  const found = BUILDER_ADDRESS.exec(pathname);
  if (found === null) return null;
  const locale = new URLSearchParams(search).get("locale") ?? "";
  return {
    onCollection: found[1]?.startsWith("collections/") === true,
    locale: locale === "" ? undefined : locale,
  };
}

/** How the editor's code is fetched, and its start-up read sent. */
export interface BuilderOpenStart {
  readonly preload: () => void;
  readonly startReads: (address: BuilderOpenAddress) => Promise<void>;
}

/**
 * At an address that opens the builder, fetch its code and send its start-up
 * read; anywhere else, nothing.
 */
export function startBuilderOpen(
  here: Pick<Location, "pathname" | "search"> | undefined,
  start: BuilderOpenStart
): void {
  if (here === undefined) return;
  const address = builderOpenAddress(here.pathname, here.search);
  if (address === null) return;
  start.preload();
  // A start-up read that cannot be sent leaves the editor to send its own.
  start.startReads(address).catch(() => undefined);
}
