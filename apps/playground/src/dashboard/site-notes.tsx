"use client";

/**
 * The site widget's component, drawn with the props its declaration types.
 */
import type { WidgetProps } from "@nextlyhq/plugin-sdk/widgets";
import type { JSX } from "react";

import type * as declaration from "./site-notes-widget";

/** Each note the widget's data holds, one line each. */
export function SiteNotesCard({
  data,
}: WidgetProps<typeof declaration.siteNotesWidget>): JSX.Element {
  return (
    <ul data-testid="site-notes-card">
      {data.notes.map(note => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}
