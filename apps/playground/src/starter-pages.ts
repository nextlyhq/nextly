/**
 * Starter pages — e2e fixtures, registered only when
 * `NEXTLY_E2E_STYLE_FIXTURE=1`, like the other browser-test fixtures.
 *
 * **Welcome** is a Section holding a Heading in the site's brand colour (the
 * `color.primary` variable, so its preview follows a change to the Primary
 * colour in Design), an Image left empty (so it shows the Image's own empty
 * state and loads nothing), and a Button linking to `/contact`. Every block
 * is a core one. The browser tests create pages from it in the New page
 * dialog, start an empty page from it in the builder, and check its preview
 * wears the site's colour.
 */
import { defineStarterPage } from "@nextlyhq/plugin-sdk/blocks";

export const E2E_STARTER_PAGES = [
  defineStarterPage({
    id: "e2e-welcome",
    label: "Welcome",
    description:
      "A heading in your brand colour, an image to add and a button.",
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
              props: { text: "Welcome to our site", level: "h1" },
              styles: {
                base: { base: { color: { $token: "color.primary" } } },
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
  }),
] as const;
