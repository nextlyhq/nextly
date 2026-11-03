/**
 * Previews of catalogue families while an author browses Google Fonts.
 *
 * A preview is loaded into the EDITOR's own document only, never into the
 * canvas frame or the site's stylesheet, so nothing a visitor loads changes.
 * It loads from the address the host built (the catalogue's file host), only
 * once its row is on screen, and under the name `nx-preview-<id>`, which no
 * site family can have, so a preview never stands in for a font the site
 * actually stores.
 *
 * A preview that fails leaves its row in the admin's font, without a word: a
 * missing preview changes nothing an author can act on.
 *
 * @module font-preview
 */
import * as React from "react";

/** The family a preview is loaded under. */
export function previewFamily(id: string): string {
  return `nx-preview-${id}`;
}

/** Each preview once per page, whichever rows ask for it. */
const loaded = new Map<string, Promise<boolean>>();

/** Load one preview into a document's fonts; answers whether it loaded. */
function loadPreview(id: string, url: string, doc: Document): Promise<boolean> {
  const key = `${id}|${url}`;
  const known = loaded.get(key);
  if (known !== undefined) return known;
  const face = new FontFace(previewFamily(id), `url("${url}")`);
  doc.fonts.add(face);
  const done = face.load().then(
    () => true,
    () => false
  );
  loaded.set(key, done);
  return done;
}

/**
 * Whether a row's preview has loaded. Starts loading the first time the row
 * is on screen.
 */
export function usePreview(
  target: Element | null,
  id: string,
  url: string,
  doc: Document = document
): boolean {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (target === null || typeof IntersectionObserver === "undefined") return;
    let live = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void loadPreview(id, url, doc).then(done => {
        if (live) setReady(done);
      });
    });
    observer.observe(target);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [target, id, url, doc]);
  return ready;
}
