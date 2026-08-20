/**
 * The rich-text editor's node set and theme, loaded on demand.
 *
 * ## Why this is async, and must stay async
 *
 * The node classes drag Lexical — and PrismJS behind it — with them. Measured on
 * this package, that is a 630KB chunk against a 777KB main bundle, which is why
 * `FieldRenderer` reaches the editor through `lazy(() => import(...))` and says
 * so. Exporting the classes directly from the package index would make that
 * eager for every consumer of `@nextlyhq/admin`, including the ones who never
 * open a rich-text field, and would collapse the SSR boundary the lazy load
 * exists for.
 *
 * So the surface is a FUNCTION that imports, never a value that is imported.
 * Getting this wrong is invisible in review and obvious only in a bundle
 * report, which is the kind of mistake worth designing out rather than
 * remembering.
 *
 * It is also the shape the page builder needs: PB-D11 asks for ONE shared,
 * lazily-mounted editor instance, so the performance constraint and the feature
 * requirement point the same way.
 *
 * ## On having two copies of Lexical
 *
 * Nothing here checks for one, deliberately. Lexical already does, on this exact
 * path: `createEditor()` rejects any node class that is not a `LexicalNode`
 * subclass OF THE COPY THE EDITOR IS USING, and throws in production builds as
 * well as development. Its message names the offending class, its type and the
 * Lexical version — better than a wrapper of ours would produce. A second check
 * would either restate that or fire where Lexical's does not, and a duplicate
 * alarm that disagrees with the real one is worse than no alarm.
 *
 * @module lib/rich-text/load-editor-kit
 */
import type { RichTextEditorKit } from "@admin/components/features/entries/fields/special/rich-text-kit";

export type { RichTextEditorKit };

/**
 * Load the node classes and theme this site's rich text is written against.
 *
 * Await it once and reuse the result. The dynamic import is cached by the module
 * system so a second call is cheap, but every class an editor registers must
 * come from ONE call chain: mixing classes from two Lexical copies is the
 * failure this arrangement exists to avoid, and it is silent when the content is
 * written and visible only when it is read back as plain text.
 *
 * @example
 * ```ts
 * const { nodes, theme } = await loadRichTextEditorKit();
 * const editor = createEditor({ namespace: "canvas", nodes: [...nodes], theme });
 * ```
 */
export async function loadRichTextEditorKit(): Promise<RichTextEditorKit> {
  const kit = await import(
    "@admin/components/features/entries/fields/special/rich-text-kit"
  );
  return kit.richTextEditorKit();
}
