/**
 * Landing Page single — a second blocks-backed single, demonstrating the field
 * across multiple singles alongside the Homepage.
 *
 * The one that carries a publish lifecycle, which is what makes it the single
 * where draft preview can be exercised: a Single with no Draft/Published split
 * has no unpublished state to show anyone, so the admin offers no shareable
 * link for one. The Homepage deliberately has none, and covers the other half.
 */
import { blocks } from "@nextlyhq/plugin-page-builder";
import { defineSingle, text } from "nextly/config";

export const LandingPage = defineSingle({
  slug: "landing-page",
  label: { singular: "Landing Page" },
  // The Draft / Published lifecycle. Without it there is no pending state to
  // preview and nothing for a shareable link to show.
  status: true,
  // Where this Single is served — the one thing Nextly cannot work out, because
  // only the app knows that `app/landing/page.tsx` renders it.
  admin: { preview: { url: () => "/landing" } },
  fields: [
    text({ name: "title" }),
    blocks({
      name: "hero",
      label: "Hero section",
      blocks: { allow: ["core/*"] },
    }),
  ],
});
