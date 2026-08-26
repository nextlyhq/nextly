/**
 * The viewport widths a preview offers, resolved from a collection's own
 * declaration.
 *
 * ## Why this is declared rather than guessed
 *
 * Nothing here can know the widths a site's CSS actually breaks at. A page may
 * be built with the page builder, with Tailwind, or with hand-written media
 * queries, and only the first of those is data this system holds. Shipping
 * phone/tablet/desktop numbers would therefore be a claim about somebody else's
 * stylesheet — and on a site whose tablet is 991px, a preset labelled "Tablet"
 * that sizes the frame to 1024 lands in the wrong tier while looking correct.
 *
 * So the widths are declared by whoever knows them. An application states them
 * directly; a plugin that DOES hold a site's breakpoints supplies a function
 * that reads them, the same way `previewUrlFromTemplate` supplies a `url`.
 *
 * ## Why a function is accepted alongside a list
 *
 * A site's breakpoints are stored data an author edits, so a value captured
 * once at boot goes stale the moment they change it. The function form is
 * evaluated per mint, on the server, where the current value is readable — the
 * same reason `admin.preview.url` is a function. Neither ever reaches the
 * browser: what crosses is the resolved list.
 *
 * ## Why every rejection here is a silent DROP
 *
 * These are presets on a credential handout. A malformed row must cost an
 * author that row, never the whole list and never the preview itself — one typo
 * removing every working preset, or failing the mint outright, is a worse
 * outcome than the bad row it was guarding against.
 *
 * @module domains/collections/services/preview-viewports
 */

/** One offered viewport: a name an author picked, and a width in CSS pixels. */
export interface PreviewViewport {
  label: string;
  width: number;
}

/**
 * What a collection may declare, either as a fixed list or as a function of
 * whatever state actually holds the answer.
 */
export type PreviewViewportsDeclaration =
  | readonly PreviewViewport[]
  | (() => readonly PreviewViewport[] | Promise<readonly PreviewViewport[]>);

/**
 * The most viewports one preview will offer.
 *
 * The control is a dropdown in a dense toolbar, and a list past this length
 * stops being a set of choices and becomes something to search. The engine caps
 * a site's own breakpoints at seven per axis, so a derived list cannot exceed
 * this on its own; the cap is here for a hand-written declaration.
 */
const MAX_VIEWPORTS = 12;

/** True when a value is a usable row, checked field by field. */
function usableViewport(value: unknown): value is PreviewViewport {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<PreviewViewport>;
  if (typeof row.label !== "string" || row.label.trim() === "") return false;
  return (
    typeof row.width === "number" && Number.isFinite(row.width) && row.width > 0
  );
}

/**
 * Resolve a declaration into the list a caller may offer.
 *
 * Answers `[]` for every failure — absent, throwing, or the wrong shape — so a
 * caller has one thing to check and no error path to forget.
 */
export async function resolvePreviewViewports(
  declaration: PreviewViewportsDeclaration | undefined
): Promise<PreviewViewport[]> {
  if (declaration === undefined) return [];

  let raw: unknown;
  try {
    raw = typeof declaration === "function" ? await declaration() : declaration;
  } catch {
    /*
     * The declaration is user code and may throw. Losing the presets is the
     * affordable outcome; losing the mint is not, because the pane cannot open
     * without it and the author gets no preview at all rather than a plainer
     * one.
     */
    return [];
  }

  if (!Array.isArray(raw)) return [];

  const seen = new Set<number>();
  const resolved: PreviewViewport[] = [];
  for (const candidate of raw) {
    if (!usableViewport(candidate)) continue;

    // Whole pixels: a viewport is a device width, and a fractional one would
    // render as `767.6px` in a control that has to read as a number.
    const width = Math.round(candidate.width);

    /*
     * Checked AFTER rounding, because rounding is what makes a row unusable:
     * `0.4` is positive and finite, so it satisfies every test asked of the
     * declared value, and then becomes `0`. Offered, it is an option reading
     * "0px" that does not preview 0px — `previewFrameFit` reads zero as no
     * request at all and fills the pane — so the broken preset is the one that
     * looks like it works.
     */
    if (width <= 0) continue;

    // Two names for one width are indistinguishable once chosen — the frame is
    // the same size either way — so the first declared wins and the rest are
    // dropped rather than crowding the list.
    if (seen.has(width)) continue;
    seen.add(width);

    resolved.push({ label: candidate.label.trim(), width });
    if (resolved.length === MAX_VIEWPORTS) break;
  }

  return resolved;
}
