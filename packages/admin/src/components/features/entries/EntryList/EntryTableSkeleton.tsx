import type React from "react";

import { outlineRowsFor } from "@admin/components/shared/loading-frame/list-rows";
import {
  ScreenOutline,
  TableOutline,
} from "@admin/components/shared/loading-frame/outlines";

/**
 * The entries table while its rows load: the table's real head, from the
 * columns already known, over still outline rows, as many as the list drew
 * when this person last opened it. Part of the screen's wait, so it appears
 * only after the frame's delay and the frame draws the line under the bar
 * meanwhile.
 */
export const EntryTableSkeleton: React.FC<{
  /** The list's name (its `registryKey`), for how many rows it last drew. */
  list: string;
  /** The heads of the columns the table will draw. */
  headers?: readonly React.ReactNode[];
}> = ({ list, headers }) => (
  <ScreenOutline>
    <TableOutline headers={headers} rows={outlineRowsFor(list)} list={list} />
  </ScreenOutline>
);

EntryTableSkeleton.displayName = "EntryTableSkeleton";
