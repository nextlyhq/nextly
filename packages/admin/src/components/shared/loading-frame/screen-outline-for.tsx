"use client";

/**
 * Which screen's outline an admin address shows while nothing about the
 * screen is known yet: while the session is checked, while the route's code
 * loads, and while the reader's permissions for it arrive.
 *
 * Read from the address alone, because that is all there is before the server
 * answers. A screen's own loading state, once it has mounted, draws the same
 * outline, so the two never disagree about where the screen's parts go.
 *
 * @module components/shared/loading-frame/screen-outline-for
 */

import type { JSX } from "react";

import { DOCUMENT_COLUMN_INSET } from "@admin/components/features/entries/EntryForm/DocumentEditorLayout";
import {
  USERS_LIST,
  USERS_LIST_COLUMNS,
} from "@admin/components/features/users/users-list-layout";
import { CONTENT_MEASURE_LENGTH } from "@admin/components/layout/content-measure";
import { useCollectionFoldedPanel } from "@admin/components/layout/PanelFold";
import { ROUTES } from "@admin/constants/routes";

import {
  DashboardOutline,
  EditorOutline,
  FormOutline,
  GenericOutline,
  ListOutline,
  MediaOutline,
} from "./outlines";

/**
 * The users list's own columns, as its outline draws them before a site's
 * custom fields are known.
 */
const USERS_OUTLINE_COLUMNS = Object.values(USERS_LIST_COLUMNS);

/** The kinds of screen an address can open, as far as their outline goes. */
type ScreenOutlineKind =
  | "dashboard"
  | "list"
  | "entry-editor"
  | "entry-creator"
  | "single-editor"
  | "media"
  | "users"
  | "form"
  | "generic";

/** A collection address's last part that opens a new entry's editor, read from its route. */
const NEW_ENTRY = ROUTES.COLLECTION_ENTRY_CREATE.split("/").at(-1);
/** A collection address's last part that names a page of its own, not an entry. */
const COLLECTION_PAGES = new Set(["api"]);
/** A Single address's last part that names a page of its own, not the editor. */
const SINGLE_PAGES = new Set(["api", "versions"]);

/** A section's screens, by the address's parts after the section. */
type SectionKinds = (slug?: string, item?: string) => ScreenOutlineKind;

/** The kind of screen under each section that has an outline of its own. */
const SECTION_KINDS: Readonly<Record<string, SectionKinds>> = {
  collections: (slug, item) => {
    if (slug === undefined) return "generic";
    if (item === undefined) return "list";
    if (item === NEW_ENTRY) return "entry-creator";
    return COLLECTION_PAGES.has(item) ? "generic" : "entry-editor";
  },
  singles: (slug, item) => {
    if (slug === undefined) return "generic";
    return item !== undefined && SINGLE_PAGES.has(item)
      ? "generic"
      : "single-editor";
  },
  media: () => "media",
  users: slug => (slug === undefined ? "users" : "form"),
  settings: () => "form",
  account: () => "form",
};

/** The address's parts after the admin's own segment. */
function addressParts(pathname: string): string[] {
  return pathname
    .replace(/^\/admin\/?/, "")
    .split("/")
    .filter(part => part.length > 0);
}

/** The kind of screen `pathname` opens. */
function screenOutlineKind(pathname: string): ScreenOutlineKind {
  const [section, slug, item] = addressParts(pathname);
  if (section === undefined) return "dashboard";
  return SECTION_KINDS[section]?.(slug, item) ?? "generic";
}

/** The collection whose document `pathname` opens, or none. */
function documentCollection(
  kind: ScreenOutlineKind,
  pathname: string
): string | undefined {
  if (kind !== "entry-editor" && kind !== "entry-creator") return undefined;
  return addressParts(pathname)[1];
}

/** The outline of the screen `pathname` opens. */
export function ScreenOutlineFor({
  pathname,
}: {
  pathname: string;
}): JSX.Element {
  const kind = screenOutlineKind(pathname);
  // A collection whose document screens start with the panel folded is
  // outlined folded, by the screen's own declaration, so the frame does not
  // move when the screen arrives.
  useCollectionFoldedPanel(documentCollection(kind, pathname));
  switch (kind) {
    case "dashboard":
      return <DashboardOutline />;
    case "list":
      return <ListOutline list={addressParts(pathname)[1]} />;
    case "entry-editor":
    case "entry-creator":
    case "single-editor":
      return (
        <EditorOutline
          creating={kind === "entry-creator"}
          // The document panel is wider beside a Single's fields.
          sideWidth={kind === "single-editor" ? 360 : 320}
          columnClassName={DOCUMENT_COLUMN_INSET}
          columnStyle={{ maxWidth: CONTENT_MEASURE_LENGTH }}
        />
      );
    case "media":
      return <MediaOutline />;
    case "users":
      return (
        <ListOutline
          title="Users"
          // The users page says what it is for under its title.
          subtitle
          list={USERS_LIST}
          selection
          headers={USERS_OUTLINE_COLUMNS.map(column => column.header)}
          columnWidths={USERS_OUTLINE_COLUMNS.map(column => column.width)}
        />
      );
    case "form":
      return <FormOutline />;
    case "generic":
      return <GenericOutline />;
  }
}
