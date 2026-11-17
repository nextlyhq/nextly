/**
 * How the page's "Header & footer" menu reaches the builder's own list of
 * sets: inside the builder, "Manage headers & footers" closes Page settings
 * and opens the Pages panel at its Header & footer group, rather than leaving
 * for the admin's list in a new tab. Outside the builder (an entry's own
 * form) nothing provides it, and the menu opens the admin's list.
 *
 * @module admin/editor/manage-sets
 */
import { createContext } from "react";

/** Opens the builder's list of sets, or null where there is none. */
export const ManageSetsContext = createContext<(() => void) | null>(null);
