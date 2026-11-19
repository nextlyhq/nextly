/**
 * A style field's write of several paths of its property as one edit, handed
 * to a control drawn below the field's shell.
 *
 * Its own module, holding only the context, so a control can read it without
 * importing the field's whole write path.
 *
 * @module field-path-writes
 */
import * as React from "react";

import type { CommitOutcome } from "./style-field-surroundings";
import type { PathWrite } from "./style-field-target";

/**
 * The field's `commitPaths`, for a control that sets more than its own path
 * in one press: a background size choice writes the size and the repeat
 * together, so one undo takes both back. `undefined` outside a field.
 */
export const FieldPathWrites: React.Context<
  ((writes: readonly PathWrite[]) => CommitOutcome) | undefined
> = React.createContext<
  ((writes: readonly PathWrite[]) => CommitOutcome) | undefined
>(undefined);
