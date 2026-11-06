/**
 * Whether the section a style field sits in is held read-only.
 *
 * @module section-held
 */
import * as React from "react";

/**
 * Whether the section a field sits in is held read-only. Its fieldset holds
 * the form controls; a control that is not one (a slider's thumb), or one
 * drawn outside the fieldset (a popover's, mounted at the page's root), reads
 * this.
 */
export const SectionHeld: React.Context<boolean> =
  React.createContext<boolean>(false);
