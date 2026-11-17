/**
 * The words an author picks a container's HTML tag by: a plain name and what
 * the tag means in one line ("Section — a themed part of the page"), with the
 * tag itself shown once beside them from the prop's `code` (`<section>`).
 * "Generic box", not "div", for an author who does not read HTML, with the tag
 * still there for one who does.
 *
 * One map for every container, so a tag reads the same on a section, a box
 * and a card.
 *
 * @module blocks/html-tags
 */
import type { PropSchema } from "@nextlyhq/blocks-engine";

const HTML_TAG_LABELS: Readonly<Record<string, string>> = {
  div: "Generic box — groups blocks, with no meaning of its own",
  section: "Section — a themed part of the page",
  article: "Article — stands on its own, like a post or a product",
  aside: "Aside — related to what is around it, but apart",
  header: "Header — introduces the page or a part of it",
  footer: "Footer — closes the page or a part of it",
  main: "Main content — the one main part of the page",
};

/**
 * A container's `as` prop, one schema for all of them: only which tags a
 * container offers differs, so only that is passed. A container offering one
 * tag still declares it, and the inspector hides a choice of one.
 *
 * Edited in Advanced › HTML on every container, with the block's anchor,
 * classes and attributes: it changes the page's HTML, not what a visitor
 * reads or sees.
 */
export function htmlTagProp(options: readonly string[]): PropSchema {
  return {
    label: "HTML tag",
    group: "advanced",
    section: "HTML",
    optionLabels: HTML_TAG_LABELS,
    // What each choice writes: the tag itself, as it reads in the page.
    code: Object.fromEntries(options.map(tag => [tag, `<${tag}>`])),
    display: "menu",
    type: "select",
    options: [...options],
  };
}
