/**
 * Landing Page single — a second blocks-backed single, demonstrating the field
 * across multiple singles alongside the Homepage.
 */
import { blocks } from "@nextlyhq/plugin-page-builder";
import { defineSingle, text } from "nextly/config";

export const LandingPage = defineSingle({
  slug: "landing-page",
  label: { singular: "Landing Page" },
  fields: [
    text({ name: "title" }),
    blocks({
      name: "hero",
      label: "Hero section",
      blocks: { allow: ["core/*"] },
    }),
  ],
});
