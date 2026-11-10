/**
 * A label with its indefinite article, for a sentence that names a block or a
 * container. Read off the label's first letter, which is right for the block
 * names these sentences carry.
 *
 * @module with-article
 */

/** "an Accordion", "a Card"; a namespace's "any acme block" as it is. */
export function withArticle(label: string): string {
  if (label.startsWith("any ")) return label;
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}
