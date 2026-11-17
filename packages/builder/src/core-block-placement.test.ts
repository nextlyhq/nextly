/**
 * Every core block's settings are where the fixture says: each one's tab,
 * section and label, walked through the inspection the block panel draws.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";

import {
  CORE_SETTING_PLACES,
  type SettingPlace,
} from "./core-block-placement.fixture";
import { inspectSelection } from "./inspector";
import { propLabel } from "./prop-label";

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => clearBlocks());

/** Where each of a core block's settings is drawn, through the inspection. */
function placesOf(block: (typeof coreBlocks)[number]): SettingPlace[] {
  const inspection = inspectSelection(
    {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: block.name,
          version: block.version,
          props: {},
        } as BlockNode,
      ],
    },
    "a"
  );
  if (inspection === null) throw new Error(`${block.name} is not inspectable`);
  const { content, advanced, styleProps } = inspection.sections;
  return (
    [
      ["content", content],
      ["advanced", advanced],
      ["style", styleProps],
    ] as const
  ).flatMap(([tab, sections]) =>
    sections.flatMap(section =>
      section.rows.map(row => ({
        block: block.name,
        setting: row.name,
        tab,
        section: section.label,
        label: propLabel(row.name, row.schema),
      }))
    )
  );
}

describe("the core blocks' settings", () => {
  it("covers all 23 core blocks", () => {
    expect(coreBlocks).toHaveLength(23);
  });

  it("are each where the fixture places them", () => {
    expect(coreBlocks.flatMap(placesOf)).toEqual(CORE_SETTING_PLACES);
  });
});
