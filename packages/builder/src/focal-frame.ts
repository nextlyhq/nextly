/**
 * The picture a style field aims over, and how the block fits it.
 *
 * @module focal-frame
 */
import * as React from "react";

/**
 * The selected block's picture, as the canvas draws it, and the fit in force
 * for it here. Carried by context because only the focal point reads it, and
 * the field table it is drawn from passes every field the same props.
 */
export interface FocalFrameValue {
  /** The picture's address, as the canvas shows it; none for no picture. */
  readonly picture?: string | undefined;
  /**
   * Where the canvas places the picture, resolved there: what a contextual
   * point (`inherit`, a variable) comes to, which the inspector cannot read.
   */
  readonly position?: string | undefined;
  /** The `object-fit` keyword in force here, lowercased; none when unset. */
  readonly fit?: string | undefined;
}

export const FocalFrame: React.Context<FocalFrameValue> =
  React.createContext<FocalFrameValue>({});
