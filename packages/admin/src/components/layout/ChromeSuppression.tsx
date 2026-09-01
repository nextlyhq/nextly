"use client";

import React from "react";

import {
  resolveSuppressedChrome,
  type AdminChromeLayer,
  type ChromeSuppressionRequest,
} from "./lib/chrome-suppression";
import { useMountRegistry } from "./lib/mount-registry";

interface ChromeSuppressionContextValue {
  hidden: Set<AdminChromeLayer>;
  register: (request: ChromeSuppressionRequest) => () => void;
}

/**
 * Defaults to hiding nothing and accepting registrations that do nothing.
 *
 * A surface rendered outside the dashboard layout — a test, a standalone auth
 * page, Storybook — then calls the hook harmlessly instead of throwing. The
 * alternative is every consumer guarding the call, which is a rule each new call
 * site has to remember.
 */
const ChromeSuppressionContext =
  React.createContext<ChromeSuppressionContextValue>({
    hidden: new Set(),
    register: () => () => {},
  });

/**
 * Holds what the currently mounted surfaces have asked to hide.
 *
 * State lives here rather than in each surface because the consumers are the
 * layout's own children: React data flows down, so the layout cannot read a
 * request made below it without the request being lifted to a provider above.
 */
export function ChromeSuppressionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { entries: requests, register } =
    useMountRegistry<ChromeSuppressionRequest>();

  const value = React.useMemo<ChromeSuppressionContextValue>(
    () => ({ hidden: resolveSuppressedChrome(requests), register }),
    [requests, register]
  );

  return (
    <ChromeSuppressionContext.Provider value={value}>
      {children}
    </ChromeSuppressionContext.Provider>
  );
}

/**
 * Read which layers are hidden. For the layout's own chrome components.
 */
export function useSuppressedChrome(): Set<AdminChromeLayer> {
  return React.useContext(ChromeSuppressionContext).hidden;
}

/**
 * Ask for admin chrome to be hidden for as long as this component is mounted.
 *
 * Mount-scoped on purpose: the request is released on unmount, so navigating
 * away restores the chrome with nothing to remember to undo. That is also why
 * there is no route list — the surface that wants the window is the one that
 * knows, and it only claims it while it is on screen.
 *
 * `canExit` must be the truth about whether this surface renders a way back,
 * derived from the affordance rather than declared beside it. Passing `true`
 * from a surface with no exit is how an author gets stranded, and the resolver
 * cannot detect the lie — it can only withhold the rail when told `false`.
 */
export function useSuppressAdminChrome(options: {
  layers: readonly AdminChromeLayer[];
  canExit: boolean;
}): void {
  const { register } = React.useContext(ChromeSuppressionContext);
  const { canExit } = options;
  // Joined so a caller passing a fresh array literal each render — which is the
  // natural way to call this — does not re-register on every render.
  const key = options.layers.join(",");

  useRegistrationEffect(() => {
    const layers = key === "" ? [] : (key.split(",") as AdminChromeLayer[]);
    return register({ layers, canExit });
  }, [key, canExit, register]);
}

/**
 * A LAYOUT effect on the client, because the chrome this releases is on screen
 * until the request lands.
 *
 * Registering in a passive effect means the first paint shows the full admin
 * frame — both sidebars, the header, the page padding — which is then removed on
 * the following frame. The editor is the widest thing in the admin, so that is a
 * whole-layout reflow visible as a flash on every open.
 *
 * Falls back to a passive effect where there is no DOM. A layout effect during a
 * server render warns and cannot run, and nothing has painted there anyway.
 */
const useRegistrationEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;
