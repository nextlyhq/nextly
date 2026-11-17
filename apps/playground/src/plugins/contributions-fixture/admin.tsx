"use client";

/**
 * Registers the contributions fixture's components, by a side-effect import in
 * the playground's admin route.
 *
 * Here rather than in the generated component map: the fixture runs only on
 * the e2e suite's own server, and the committed map is written without it.
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import {
  FixtureActionDialog,
  FixtureBlock,
  FixtureCell,
  FixtureGatedBlock,
  FixtureReplacement,
  FixtureSection,
  FixtureTab,
} from "./components";
import {
  ACTION_DIALOG,
  BLOCK,
  CELL,
  GATED_BLOCK,
  REPLACEMENT,
  SECTION,
  TAB,
} from "./constants";

registerComponents({
  [BLOCK]: FixtureBlock,
  [GATED_BLOCK]: FixtureGatedBlock,
  [CELL]: FixtureCell,
  [TAB]: FixtureTab,
  [SECTION]: FixtureSection,
  [ACTION_DIALOG]: FixtureActionDialog,
  [REPLACEMENT]: FixtureReplacement,
});
