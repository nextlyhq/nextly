/**
 * A widget the site itself declares in `admin.dashboard.widgets`, for the e2e
 * suite: registered and offered like a plugin's, and drawn by a component the
 * generated component map imports from beside the config file. Its component
 * is named relative to `nextly.config.ts`, as a site writes it.
 */
import { defineWidget } from "nextly";

/** The component, relative to the config file, as the component map resolves it. */
const SITE_NOTES_COMPONENT = "./src/dashboard/site-notes#SiteNotesCard";

export const siteNotesWidget = defineWidget({
  id: "playground/site-notes",
  title: "Test fixture: site widget",
  description:
    "Exists for the e2e suite: a widget the site config declares and draws.",
  category: "Fixtures",
  size: { default: { w: 6, h: 3 } },
  load: async () => ({ notes: ["Declared by the site, not a plugin."] }),
  view: { component: SITE_NOTES_COMPONENT },
  isEmpty: data => data.notes.length === 0,
});
