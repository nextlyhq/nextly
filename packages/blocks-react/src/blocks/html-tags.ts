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
export const HTML_TAG_LABELS: Readonly<Record<string, string>> = {
  div: "Generic box",
  section: "Section",
  article: "Article",
  aside: "Aside",
  header: "Header",
  footer: "Footer",
  main: "Main content",
};
