/**
 * What a chip shows inside a field: its variable's friendly name, from the
 * namer the surrounding block provides. A list's blocks provide one that knows
 * what `item` is, so the same chip reads the same way wherever it sits.
 *
 * @module components/features/settings/EmailTemplateForm/written/ChipLabel
 */
import { createContext, useContext, type JSX } from "react";

import type { ChipNamer } from "./chip-names";

/** Names chips; without a provider, a chip shows its variable's path. */
export const ChipNamesContext = createContext<ChipNamer>(variable => variable);

/** A chip's friendly name, with its variable's path on hover. */
export function ChipLabel({ variable }: { variable: string }): JSX.Element {
  const name = useContext(ChipNamesContext);
  return <span title={variable}>{name(variable)}</span>;
}
