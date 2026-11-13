/**
 * The icon a new entity is offered from its name, until the person picks one.
 *
 * Matched by whole word, with a plural taken as its singular, so "Products"
 * offers what "Product" does and "Reorder rule" says nothing about orders.
 * Every icon here is one the icon picker draws (its own list is the test's
 * reference), so the sidebar can always show the suggestion.
 *
 * @module lib/builder/icon-suggestion
 */

/** The icon offered when nothing in the name suggests one. */
export const DEFAULT_ENTITY_ICON = "FileText";

/** Words a name may hold, each with the icon it suggests; the first match wins. */
const SUGGESTIONS: ReadonlyArray<{ words: readonly string[]; icon: string }> = [
  { words: ["product", "item", "inventory", "stock"], icon: "Package" },
  { words: ["order", "cart", "checkout", "purchase"], icon: "ShoppingCart" },
  {
    words: [
      "team",
      "member",
      "people",
      "person",
      "staff",
      "customer",
      "author",
    ],
    icon: "Users",
  },
  {
    words: ["event", "booking", "appointment", "schedule"],
    icon: "Calendar",
  },
  { words: ["photo", "image", "gallery", "picture"], icon: "Image" },
  { words: ["location", "place", "venue", "store"], icon: "MapPin" },
  { words: ["category", "tag", "topic", "label"], icon: "Tag" },
  { words: ["newsletter", "email", "mail", "subscriber"], icon: "Mail" },
  { words: ["video"], icon: "Video" },
  { words: ["review", "testimonial", "rating"], icon: "Star" },
  { words: ["faq", "question", "comment", "message"], icon: "MessageSquare" },
  { words: ["setting", "config"], icon: "Settings" },
  { words: ["home", "homepage"], icon: "Home" },
];

/** A name's words, in lower case. */
function wordsOf(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Whether `word` is `entry`, or its plural with `s` or `es`. */
function matches(word: string, entry: string): boolean {
  return word === entry || word === `${entry}s` || word === `${entry}es`;
}

/** The icon `name` suggests, or the default when none of its words do. */
export function suggestIcon(name: string): string {
  const words = wordsOf(name);
  const found = SUGGESTIONS.find(suggestion =>
    words.some(word => suggestion.words.some(entry => matches(word, entry)))
  );
  return found?.icon ?? DEFAULT_ENTITY_ICON;
}
