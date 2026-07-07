/**
 * Homepage single (page-builder M7) — proves `pageBuilderField()` mounts the visual
 * editor as a custom field inside a Single, exactly as it does inside a collection. The
 * host single form persists the `layout` BlockDocument; the /home route renders it.
 */
import { pageBuilderField } from "@nextlyhq/plugin-page-builder";
import { defineSingle, text } from "nextly/config";

export const Homepage = defineSingle({
  slug: "homepage",
  label: { singular: "Homepage" },
  fields: [
    text({ name: "title" }),
    pageBuilderField("layout", { label: "Layout" }),
  ],
});
