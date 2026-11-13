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
import { CONTENT_MEASURE_LENGTH } from "@admin/components/layout/content-measure";

import {
  DashboardOutline,
  EditorOutline,
  FormOutline,
  GenericOutline,
  ListOutline,
  MediaOutline,
} from "./outlines";

/** The kinds of screen an address can open, as far as their outline goes. */
type ScreenOutlineKind =
  | "dashboard"
  | "list"
  | "entry-editor"
  | "single-editor"
  | "media"
  | "users"
  | "form"
  | "generic";

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

/** The kind of screen `pathname` opens. */
function screenOutlineKind(pathname: string): ScreenOutlineKind {
  const [section, slug, item] = pathname
    .replace(/^\/admin\/?/, "")
    .split("/")
    .filter(part => part.length > 0);
  if (section === undefined) return "dashboard";
  return SECTION_KINDS[section]?.(slug, item) ?? "generic";
}

/** The outline of the screen `pathname` opens. */
export function ScreenOutlineFor({
  pathname,
}: {
  pathname: string;
}): JSX.Element {
  const kind = screenOutlineKind(pathname);
  switch (kind) {
    case "dashboard":
      return <DashboardOutline />;
    case "list":
      return <ListOutline />;
    case "entry-editor":
    case "single-editor":
      return (
        <EditorOutline
          // The document panel is wider beside a Single's fields.
          sideWidth={kind === "single-editor" ? 360 : 320}
          columnClassName={DOCUMENT_COLUMN_INSET}
          columnStyle={{ maxWidth: CONTENT_MEASURE_LENGTH }}
        />
      );
    case "media":
      return <MediaOutline />;
    case "users":
      return <ListOutline title="Users" />;
    case "form":
      return <FormOutline />;
    case "generic":
      return <GenericOutline />;
  }
}
