import { createContext, useContext, type ReactNode } from "react";

type PortalContextValue = {
  container: HTMLElement | null;
};

const PortalContext = createContext<PortalContextValue>({ container: null });

interface PortalProviderProps {
  /** The DOM element to portal overlay content into. Defaults to document.body (Radix default). */
  container: HTMLElement | null;
  children: ReactNode;
}

function PortalProvider({ container, children }: PortalProviderProps) {
  return (
    <PortalContext.Provider value={{ container }}>
      {children}
    </PortalContext.Provider>
  );
}

function usePortalContainer(): HTMLElement | undefined {
  const { container } = useContext(PortalContext);
  return container ?? undefined; // undefined = Radix default (document.body)
}

export { PortalProvider, usePortalContainer };
