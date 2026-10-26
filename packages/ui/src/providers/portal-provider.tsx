"use client";

import { createContext, useContext, type ReactNode, type JSX } from "react";

type PortalContextValue = {
  container: HTMLElement | null;
};

const PortalContext = createContext<PortalContextValue>({ container: null });

interface PortalProviderProps {
  /** The DOM element to portal overlay content into. Defaults to document.body (Radix default). */
  container: HTMLElement | null;
  children: ReactNode;
}

/** @public */
function PortalProvider({
  container,
  children,
}: PortalProviderProps): JSX.Element {
  return (
    <PortalContext.Provider value={{ container }}>
      {children}
    </PortalContext.Provider>
  );
}

/** @public */
function usePortalContainer(): HTMLElement | undefined {
  const { container } = useContext(PortalContext);
  return container ?? undefined; // undefined = Radix default (document.body)
}

export { PortalProvider, usePortalContainer };
