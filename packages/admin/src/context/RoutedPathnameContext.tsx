"use client";

/**
 * The address the admin's router last drew a screen for.
 *
 * Not always the address in the bar. Under Cache Components a visited page
 * stays mounted but hidden, and Back shows it again with its effects before its
 * router has read the address Back went to: for those effects the bar already
 * holds the next page's address while this still holds the screen on show. A
 * screen that writes the address compares the two, so it writes only onto its
 * own.
 *
 * Absent outside the admin's router, where there is no routed screen to
 * compare with.
 *
 * @module context/RoutedPathnameContext
 */
import { createContext, useContext } from "react";

export const RoutedPathnameContext = createContext<string | undefined>(
  undefined
);

/** The routed screen's pathname, or `undefined` outside the admin's router. */
export function useRoutedPathname(): string | undefined {
  return useContext(RoutedPathnameContext);
}
