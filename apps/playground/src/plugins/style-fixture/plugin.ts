/**
 * A minimal fixture plugin that injects a component rendering all three
 * plugin-styling layers into the Posts collection list (the `afterList` view
 * injection point — the same battle-tested surface first-party plugins use), so
 * e2e/tests/plugin-admin-styling.spec.ts can prove a plugin's admin UI is styled
 * in the real admin (light and dark). Kept in the playground alongside the
 * form/page builders, which are here for the same reason.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

import { STYLE_FIXTURE_PATH } from "./constants";

export const styleFixturePlugin = definePlugin({
  name: "style-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    admin: {
      // Render the showcase after the Posts list.
      views: { posts: { afterList: STYLE_FIXTURE_PATH } },
      // Also expose it as a standalone plugin page at
      // /admin/plugins/style-fixture/showcase, so plugin-page-routing.spec.ts
      // can cover deep-link route resolution.
      pages: [{ path: "/showcase", component: STYLE_FIXTURE_PATH }],
      // Declared for tooling/the plugin doctor; the file is loaded by the
      // side-effect import in ./admin.
      styles: "playground/style-fixture/admin.css",
      // A `text` widget, so e2e/tests/plugin-text-widget.spec.ts can prove
      // that prose declared by a plugin reaches the dashboard through the
      // whole path -- contribution, validation, layout, render -- and that a
      // link to a scheme that runs code does not become a link.
      widgets: [
        {
          id: "style-fixture/notes",
          title: "Fixture notes",
          archetype: "text",
          defaultSize: "md",
          content: [
            "## Release checklist",
            "",
            "Before a release, **drain the queue** and read [the runbook](https://nextlyhq.com/docs).",
            "",
            "- one",
            "- two",
            "",
            "Do not [run this](javascript:alert%28document.cookie%29).",
          ].join("\n"),
        },
      ],
    },
  },
});
