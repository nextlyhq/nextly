/**
 * What a route draws while its code is fetched, where the page around it says:
 * a signed-in screen's outline, the one the frame drew for its address, so
 * the outline stays put from the frame to the page, and nothing the outline
 * asked of the frame (a folded panel) is let go for the moments the code takes
 * to arrive. Absent, a route draws its own quiet loading state (`lazyRoute`).
 *
 * Its own module, so the layout that gives it and the route that reads it
 * share it without either importing the other.
 *
 * @module pages/route-loading-outline
 */
import { createContext, type ReactNode } from "react";

export const RouteLoadingOutline = createContext<ReactNode>(null);
