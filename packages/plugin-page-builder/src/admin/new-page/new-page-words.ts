/**
 * What the New page dialog says, in one place, so its words read the same
 * from the Pages list and from the builder.
 *
 * @module admin/new-page/new-page-words
 */

export const NEW_PAGE_WORDS = {
  type: "Type",
  title: "Title",
  titleNeeded: "Give the page a title to create it.",
  address: "Address",
  addressNote: "Made from the title. Change it any time.",
  changeAddress: "Change the address",
  headerFooter: "Header & footer",
  startFrom: "Start from",
  blank: "Blank",
  savedAsDraft: "Saved as a draft.",
  visibleAtOnce: "Visitors can see it as soon as it is created.",
  cancel: "Cancel",
  createAndOpen: "Create and open builder",
  create: "Create",
  creating: "Creating…",
  alsoNeeded: "This page also needs:",
  openForm: "Open the form",
  save: "Save",
  discard: "Discard",
  keepEditing: "Keep editing",
  loading: "Loading…",
} as const;

/** The dialog's title: "New page", the collection's name in a sentence. */
export function newPageTitle(singular: string): string {
  return `New ${inSentence(singular)}`;
}

/**
 * A collection's name inside a sentence: lowered where it is an ordinary
 * word ("Page" → "page"), kept where it reads as a name or an acronym
 * ("FAQ"), as the admin titles its own create dialog.
 */
function inSentence(label: string): string {
  const [first, second] = [...label];
  if (first === undefined) return label;
  const ordinary =
    first === first.toUpperCase() &&
    first !== first.toLowerCase() &&
    (second === undefined || second === second.toLowerCase());
  return ordinary ? first.toLowerCase() + label.slice(first.length) : label;
}

/** Said under the address where the one made from the title is in use. */
export function movedOnWords(wanted: string, slug: string): string {
  return `${wanted} is in use, so this page gets ${slug}.`;
}

/** The question asked before making a page while the one on screen is unsaved. */
export function saveFirstQuestion(title: string): string {
  return `Save changes to ${title} first?`;
}

/** What the ask says under its question. */
export const SAVE_FIRST_DETAIL =
  "The new page opens once this one is saved or its changes are discarded.";

/** A field's name for a person, from its path: `seoTitle` → "Seo title". */
export function fieldWords(path: string): string {
  const last = path.split(".").pop() ?? path;
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words === "" ? path : words[0]?.toUpperCase() + words.slice(1);
}
