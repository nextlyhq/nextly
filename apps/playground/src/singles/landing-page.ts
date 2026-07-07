/**
 * Landing Page single — a second page-builder-backed single, to demo `pageBuilderField`
 * across multiple singles alongside the Homepage.
 */
import { pageBuilderField } from "@nextlyhq/plugin-page-builder";
import { defineSingle, text } from "nextly/config";

export const LandingPage = defineSingle({
  slug: "landing-page",
  label: { singular: "Landing Page" },
  fields: [
    text({ name: "title" }),
    pageBuilderField("hero", { label: "Hero section" }),
  ],
});
