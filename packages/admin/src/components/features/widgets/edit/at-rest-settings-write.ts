"use client";

/**
 * A card's own settings write at rest, for a card whose body has controls of its own.
 *
 * The frame's quick setting and settings sheet reach the at-rest write through the grid's
 * props. A card body is a registered component that receives only the widget props a plugin's
 * card does, so the same write is offered to it through context instead: one write, one
 * channel, one set of failure messages. `undefined` while customising, where a change belongs
 * to the draft, and before an arrangement has been read.
 *
 * @module components/features/widgets/edit/at-rest-settings-write
 */

import {
  createContext,
  useContext,
  type ComponentProps,
  type Provider,
} from "react";

import type { ArrangedGrid } from "./ArrangedGrid";

export type AtRestSettingsWrite = ComponentProps<
  typeof ArrangedGrid
>["writes"]["settings"];

const AtRestSettingsWriteContext =
  createContext<AtRestSettingsWrite>(undefined);

export const AtRestSettingsWriteProvider: Provider<AtRestSettingsWrite> =
  AtRestSettingsWriteContext.Provider;

/** The at-rest settings write, or `undefined` where a card's own controls cannot save. */
export function useAtRestSettingsWrite(): AtRestSettingsWrite {
  return useContext(AtRestSettingsWriteContext);
}
