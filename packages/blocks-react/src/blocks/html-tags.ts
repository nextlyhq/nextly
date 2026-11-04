/**
 * The words an author picks a container's HTML tag by, the tag itself shown
 * beside them (`showOptionValue`): "Generic box", not "div", for an author
 * who does not read HTML, with the tag still there for one who does.
 *
 * One map for every container, so a tag reads the same on a section, a box
 * and a card.
 *
 * @module blocks/html-tags
 */
import type { PropSchema } from "@nextlyhq/blocks-engine";

const HTML_TAG_LABELS: Readonly<Record<string, string>> = {
  div: "Generic box",
  section: "Section",
  article: "Article",
  aside: "Aside",
  header: "Header",
  footer: "Footer",
  main: "Main content",
};

/**
 * A container's `as` prop, one schema for all of them: only which tags a
 * container offers differs, so only that is passed. A container offering one
 * tag still declares it, and the inspector hides a choice of one.
 */
export function htmlTagProp(options: readonly string[]): PropSchema {
  return {
    label: "HTML tag",
    optionLabels: HTML_TAG_LABELS,
    showOptionValue: true,
    display: "menu",
    type: "select",
    options: [...options],
  };
}
