/**
 * The editor chrome's stylesheet as one text, composed the way the CSS build
 * composes it, for the tests that check its rules.
 *
 * `builder-chrome.css` is an index: it imports a partial per area of the
 * editor, in cascade order. A test that read one partial would lose sight of a
 * rule the day it moved to another, and one that read the index would see only
 * its import rules. This puts each partial's text where the index imports it,
 * in order, so a test sees every rule the compiled sheet is built from,
 * wherever it lives. The import of a package (Tailwind's) stays as it is: the
 * build resolves it from the toolchain, and it holds none of the editor's
 * rules.
 *
 * The reading is handed in rather than done here: this package's modules may
 * import only what the editor ships with (see `layering.test.ts`), and file
 * access belongs to the tests. Files are named by their `file:` URL as a
 * string rather than a `URL` object, because under jsdom the global `URL` is
 * the window's, which Node's `fileURLToPath` refuses; given the string, it
 * parses its own.
 */

/**
 * This module's own URL, held apart from the `URL` call below: Vite rewrites
 * a literal path resolved against `import.meta.url` in place into an asset
 * address, which under jsdom is not a `file:` URL.
 */
const HERE: string = import.meta.url;

/** The index the build compiles, beside this module. */
const CHROME_STYLESHEET: string = new URL("builder-chrome.css", HERE).href;

/**
 * An import rule of a file beside the index, standing alone on its line, as
 * the index writes each one. Anchored to the line so one quoted inside a
 * comment is left alone.
 */
const LOCAL_IMPORT = /^@import "(\.\/[^"]+\.css)";$/gm;

/**
 * Any import rule naming a relative path, however it is written: quoted
 * either way or through `url()`, with a layer or a condition after it.
 */
const ANY_RELATIVE_IMPORT = /@import\s+(?:url\(\s*)?["']?\.{1,2}\//;

/** Reads one stylesheet's text, given its `file:` URL. */
export type ReadStylesheet = (fileUrl: string) => string;

/**
 * The text of `entry`, with each local import rule replaced by the imported
 * file's own composed text. A partial's final newline is dropped, because the
 * line the rule stood on keeps its own.
 */
function compose(entry: string, read: ReadStylesheet): string {
  return read(entry).replace(LOCAL_IMPORT, (_line, specifier: string) =>
    compose(new URL(specifier, entry).href, read).replace(/\n$/, "")
  );
}

/**
 * The whole chrome stylesheet, every partial in the order the index imports
 * it. A test passes its reader: `url => readFileSync(fileURLToPath(url), "utf8")`.
 *
 * Throws when an import of a relative path survives the composition: the
 * build would inline that file, and a test reading on without it would pass
 * every check that a rule is absent while missing the rules it holds.
 */
export function chromeStylesheetSource(read: ReadStylesheet): string {
  const text = compose(CHROME_STYLESHEET, read);
  const left = ANY_RELATIVE_IMPORT.exec(text);
  if (left !== null) {
    const line = text.slice(0, left.index).split("\n").length;
    throw new Error(
      `the composed chrome stylesheet still imports a relative path at line ${String(line)}; write each partial's import as the index does, one per line, as @import "./name.css";`
    );
  }
  return text;
}
