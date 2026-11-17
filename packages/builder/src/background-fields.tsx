/**
 * The Background section's placement fields: where the image sits (the nine
 * points every position picker here uses) and how it is sized.
 *
 * @module background-fields
 */
import type { StyleValue } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { FocalFrame } from "./focal-frame";
import { FocalPointField } from "./focal-point-field";

type CommitOutcome = "applied" | "refused" | "unchanged";

/** What every own field is given, as `OWN_FIELDS` hands it. */
interface OwnFieldProps {
  id: string;
  labelledBy: string;
  stored: StyleValue | undefined;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}

/**
 * No picture to preview in the position picker: the frame an Image block
 * provides describes its own picture, not a background, so a background's
 * picker reads none rather than placing points over the wrong image.
 */
const NO_PICTURE = {};

/** Where the background image sits: the nine points, or Custom. */
export function BackgroundPositionField(
  props: OwnFieldProps
): React.JSX.Element {
  return (
    <FocalFrame.Provider value={NO_PICTURE}>
      <FocalPointField {...props} />
    </FocalFrame.Provider>
  );
}
