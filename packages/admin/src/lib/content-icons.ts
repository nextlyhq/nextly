/**
 * The icon a collection or a Single is drawn with wherever the admin lists
 * content: the icon it names in `admin.icon`, or the default for its kind.
 *
 * The defaults say what each kind is. A collection holds many entries, so it
 * shows a list (bullets and lines); a Single is one document, so it shows a
 * framed page (a header row and a side column). Every list of content reads
 * them from here, so the panel and any overview of content agree.
 *
 * @module lib/content-icons
 */
import * as Icons from "@admin/components/icons";
import { List, PanelsTopLeft, type LucideIcon } from "@admin/components/icons";

/** The kinds of content type the admin lists. */
type ContentKind = "collection" | "single";

const NAMED = Icons as unknown as Record<string, LucideIcon | undefined>;

const DEFAULT_ICON: Readonly<Record<ContentKind, LucideIcon>> = {
  collection: List,
  single: PanelsTopLeft,
};

/**
 * The icon for a content type of `kind` that names `name` as its icon: that
 * icon when the admin has it, else the kind's default.
 */
export function contentIcon(
  kind: ContentKind,
  name: string | null | undefined
): LucideIcon {
  return (name ? NAMED[name] : undefined) ?? DEFAULT_ICON[kind];
}
