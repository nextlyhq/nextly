/**
 * The editor chrome's stylesheet as one text, composed the way the CSS build
 * composes it, for the tests that check its rules.
 *
 * `builder-chrome.css` is an index: it imports a partial per area of the
 * editor, in cascade order. A test that read one partial would lose sight of a
 * rule the day it moved to another, and one that read the index would see only
 * the imports. This follows each local `@import "./name.css";` in place, in
 * order, so a test sees every rule the compiled sheet is built from, wherever
 * it lives. An import of a package (Tailwind's) stays as it is: the build
 * resolves it from the toolchain, and it holds none of the editor's rules.
 *
 * The reading is handed in rather than done here: this package's modules may
 * import only what the editor ships with (see `layering.test.ts`), and file
 * access belongs to the tests. Files are named by their `file:` URL as a
 * string rather than a `URL` object, because under jsdom the global `URL` is
 * the window's, which Node's `fileURLToPath` refuses; given the string, it
 * parses its own.
 */

/** The index the build compiles, beside this module. */
const CHROME_STYLESHEET: string = new URL(
  "./builder-chrome.css",
  import.meta.url
).href;

/**
 * A local import standing alone on its line, as the index writes each one.
 * Anchored to the line so an `@import` quoted inside a comment is left alone.
 */
const LOCAL_IMPORT = /^@import "(\.\/[^"]+\.css)";$/gm;

/** Reads one stylesheet's text, given its `file:` URL. */
export type ReadStylesheet = (fileUrl: string) => string;

/**
 * The text of `entry`, with each local import replaced by the imported
 * file's own composed text. A partial's final newline is dropped, because the
 * line the import stood on keeps its own.
 */
function compose(entry: string, read: ReadStylesheet): string {
  return read(entry).replace(LOCAL_IMPORT, (_line, specifier: string) =>
    compose(new URL(specifier, entry).href, read).replace(/\n$/, "")
  );
}

/**
 * The whole chrome stylesheet, every partial in the order the index imports
 * it. A test passes its reader: `url => readFileSync(fileURLToPath(url), "utf8")`.
 */
export function chromeStylesheetSource(read: ReadStylesheet): string {
  return compose(CHROME_STYLESHEET, read);
}
