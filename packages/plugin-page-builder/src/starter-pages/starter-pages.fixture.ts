/**
 * A starter page for tests only: a Section holding a Heading in the site's
 * brand colour, an empty Image and a Button, every block a core one. What
 * the boot judgement, the list and the copy are tested with until the page
 * builder ships starters of its own.
 *
 * @module starter-pages/starter-pages.fixture
 */
import {
  defineStarterPage,
  type StarterPageDefinition,
} from "@nextlyhq/plugin-sdk/blocks";

/** The variable the fixture's heading is coloured with. */
export const FIXTURE_VARIABLE = "color.primary";

/** A test starter, with `id` and `label` of its own. */
export function fixtureStarter(
  id = "test-welcome",
  label = "Welcome"
): StarterPageDefinition {
  return defineStarterPage({
    id,
    label,
    description: "A heading in the brand colour, an image to add and a button.",
    blocks: [
      {
        id: "welcome",
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        slots: {
          children: [
            {
              id: "welcome-title",
              type: "core/heading",
              version: 1,
              props: { text: label, level: "h1" },
              styles: {
                base: { base: { color: { $token: FIXTURE_VARIABLE } } },
              },
            },
            {
              id: "welcome-image",
              type: "core/image",
              version: 1,
              props: { loading: "lazy" },
            },
            {
              id: "welcome-button",
              type: "core/button",
              version: 1,
              props: { label: "Get in touch", href: "/contact" },
            },
          ],
        },
      },
    ],
  });
}
