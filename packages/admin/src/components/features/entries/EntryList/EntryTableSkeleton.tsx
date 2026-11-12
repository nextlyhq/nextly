import type React from "react";

import {
  ScreenOutline,
  TableOutline,
} from "@admin/components/shared/loading-frame/outlines";

/**
 * The entries table while its rows load: the table's real head, from the
 * columns already known, over five still outline rows. Part of the screen's
 * wait, so it appears only after the frame's delay and the frame draws the
 * line under the bar meanwhile.
 */
export const EntryTableSkeleton: React.FC<{
  /** The heads of the columns the table will draw. */
  headers?: readonly React.ReactNode[];
}> = ({ headers }) => (
  <ScreenOutline>
    <TableOutline headers={headers} />
  </ScreenOutline>
);

EntryTableSkeleton.displayName = "EntryTableSkeleton";
