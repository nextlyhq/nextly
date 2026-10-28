/**
 * The block fixture's definitions: what the server registers from the
 * declaration and what the editor registers from the editor entry, one set of
 * objects for both, as a plugin contributing blocks is meant to keep them.
 *
 * Written with `createElement` rather than JSX so the config, which imports
 * this file, loads under every reader of it (the CLI included) without a JSX
 * transform.
 */
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import type { SupportDefinition } from "@nextlyhq/plugin-sdk/blocks";
import { createElement } from "react";

/*
 * The fixture's support key, added to the vocabulary `defineBlock` checks, as
 * a plugin registering a support does.
 */
declare module "@nextlyhq/plugin-sdk/blocks" {
  interface BlockSupportKeys {
    fixtureTone: true;
  }
}

/** The fixture's own support, which its custom block opts into. */
const fixtureToneSupport: SupportDefinition = {
  key: "fixtureTone",
  label: "Fixture tone",
};

/**
 * A block with only generated controls, and no icon or keywords: the palette
 * draws its generic mark and the inspector its one text field.
 */
const plainFixtureBlock = defineBlock<{ label?: string }>({
  name: "fixture/plain",
  version: 1,
  description:
    "Exists for the e2e suite: a contributed block edited through its generated controls.",
  editor: { label: "Test fixture: plain", category: "Fixtures" },
  props: { label: { type: "text", role: "content" } },
  defaultProps: { label: "Plain fixture" },
  example: { props: { label: "Plain fixture" } },
  supports: { color: true },
  render: ({ props, className }) =>
    createElement(
      "p",
      { className, "data-fixture": "plain" },
      props.label ?? ""
    ),
});

/** Where the custom block's own inspector is, as the component map imports it. */
const CUSTOM_INSPECTOR_COMPONENT =
  "@/plugins/block-fixture/editor#FixtureInspector";

/**
 * A block whose content is edited through its own inspector, and which uses
 * the fixture's support, so the editor must register the support first.
 */
const customFixtureBlock = defineBlock<{ headline?: string }>({
  name: "fixture/custom",
  version: 1,
  description:
    "Exists for the e2e suite: a contributed block with its own inspector.",
  editor: {
    label: "Test fixture: custom inspector",
    category: "Fixtures",
    component: CUSTOM_INSPECTOR_COMPONENT,
  },
  props: { headline: { type: "text", role: "content" } },
  defaultProps: { headline: "Custom fixture" },
  example: { props: { headline: "Custom fixture" } },
  supports: { color: true, fixtureTone: true },
  render: ({ props, className }) =>
    createElement(
      "p",
      { className, "data-fixture": "custom" },
      props.headline ?? ""
    ),
});

/** Everything the fixture contributes, as the declaration and the editor entry both list it. */
export const blockFixtureContribution = {
  blocks: [plainFixtureBlock, customFixtureBlock],
  supports: [fixtureToneSupport],
};
