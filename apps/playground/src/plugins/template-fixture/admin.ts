"use client";

/**
 * A fixture for the browser suite: one Schema Builder template, named as a
 * test fixture, whose link needs a collection nothing else uses. The
 * new-entity dialog offers to make that collection too, and
 * e2e/tests/schema-builder-template-needs.spec.ts makes it, then saves both.
 *
 * It registers templates only, by a side-effect import in the playground's
 * admin route, as a plugin's admin module registers its templates: no
 * collections, no routes. Its template appears only in "Browse all
 * templates", under "Test fixtures".
 */
import { registerSchemaTemplates } from "@nextlyhq/plugin-sdk/admin";

/** The collection the fixture's template links to: made by the dialog, never by the config. */
const TEMPLATE_FIXTURE_TARGET = "e2e_template_target";

registerSchemaTemplates("Template fixture", [
  {
    id: "needed-collection",
    kind: "collection",
    category: "Test fixtures",
    name: "E2E template with a needed collection",
    description: "A test fixture: a link to a collection the dialog makes too.",
    fields: [
      {
        name: "target",
        label: "Target",
        type: "relationship",
        relationTo: TEMPLATE_FIXTURE_TARGET,
      },
      { name: "note", label: "Note", type: "text" },
    ],
  },
]);
