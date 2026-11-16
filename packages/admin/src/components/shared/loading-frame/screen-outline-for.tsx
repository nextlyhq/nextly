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
import { routePatternRegex } from "@admin/lib/route-pattern";

import {
  DashboardOutline,
  EditorOutline,
  FormOutline,
  GenericOutline,
  HistoryOutline,
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
  | "history"
  | "generic";

/**
 * The outline each collection and Single route draws, keyed by the route
 * table's own patterns and in its order: a literal segment (`create`, `api`,
 * `versions`) before the wildcard beside it. So an entry's history, which the
 * router opens as its own page, is outlined as that page and not as the
 * editor, and only an address the router opens in the editor is outlined (and
 * folded) as one.
 */
const CONTENT_ROUTE_OUTLINES: ReadonlyArray<
  readonly [pattern: string, kind: ScreenOutlineKind]
> = [
  [ROUTES.COLLECTION_ENTRIES, "list"],
  [ROUTES.COLLECTION_ENTRY_CREATE, "entry-creator"],
  [ROUTES.COLLECTION_ENTRY_API, "generic"],
  [ROUTES.COLLECTION_ENTRY_VERSIONS, "history"],
  [ROUTES.COLLECTION_ENTRY_EDIT, "entry-editor"],
  // A plugin's full-screen view of an entry is drawn by the entry's editor.
  [ROUTES.COLLECTION_ENTRY_VIEW, "entry-editor"],
  [ROUTES.SINGLE_API, "generic"],
  [ROUTES.SINGLE_VERSIONS, "history"],
  [ROUTES.SINGLE_EDIT, "single-editor"],
  [ROUTES.SINGLE_VIEW, "single-editor"],
];

/** The routes above as the router matches them, compiled once. */
const CONTENT_ROUTE_MATCHERS = CONTENT_ROUTE_OUTLINES.map(
  ([pattern, kind]) => [routePatternRegex(pattern).regex, kind] as const
);

/** The kind of screen under each other section that has an outline of its own. */
const SECTION_KINDS: Readonly<
  Record<string, (slug?: string) => ScreenOutlineKind>
> = {
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
export function screenOutlineKind(pathname: string): ScreenOutlineKind {
  const parts = addressParts(pathname);
  if (parts.length === 0) return "dashboard";
  const address = `/admin/${parts.join("/")}`;
  const content = CONTENT_ROUTE_MATCHERS.find(([regex]) => regex.test(address));
  if (content) return content[1];
  const [section, slug] = parts;
  return SECTION_KINDS[section]?.(slug) ?? "generic";
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
    case "history":
      return <HistoryOutline />;
    case "generic":
      return <GenericOutline />;
  }
}
