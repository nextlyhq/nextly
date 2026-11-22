"use client";

/**
 * Showing a field a refused save names, where the editor draws it out of
 * sight.
 *
 * A document view (the page builder, say) covers the form and draws some of
 * the document's fields in a dialog or a tab that is closed when a save is
 * refused, so the refusal's "go to this field" finds nothing on screen. The
 * view says how to show one of its fields, and the refusal's message offers
 * "Show me" for each field the view can show, and its usual link otherwise.
 *
 * @module components/features/entries/EntryForm/field-reveal
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type JSX,
  type ReactNode,
} from "react";

/**
 * How a surface shows the field at a form path: a function that opens what
 * holds it and focuses it, or null where the surface cannot show that field.
 */
export type FieldReveal = (path: string) => (() => void) | null;

/** The scope's registry: where the surface registers, and how it is asked. */
interface FieldRevealRegistry {
  register: (reveal: FieldReveal | null) => void;
  reveal: FieldReveal;
}

const FieldRevealContext = createContext<FieldRevealRegistry | null>(null);

/**
 * Where a surface below may say how it shows a field, and where the
 * refusal's message asks: the latest function registered is used, read when
 * asked rather than when this renders.
 */
export function FieldRevealScope({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const registered = useRef<FieldReveal | null>(null);
  const registry = useMemo<FieldRevealRegistry>(
    () => ({
      register: next => {
        registered.current = next;
      },
      reveal: path => registered.current?.(path) ?? null,
    }),
    []
  );
  return (
    <FieldRevealContext.Provider value={registry}>
      {children}
    </FieldRevealContext.Provider>
  );
}

/** How the surface in this scope shows a field, or null outside a scope. */
export function useFieldReveal(): FieldReveal | null {
  return useContext(FieldRevealContext)?.reveal ?? null;
}

/**
 * Tell the editor around this surface how to show one of its fields, while
 * it is mounted. The latest function is used, so it may close over state.
 * Outside a document view nothing asks, and this does nothing.
 */
export function useRevealField(reveal: FieldReveal | null): void {
  const registry = useContext(FieldRevealContext);
  const latest = useRef(reveal);
  latest.current = reveal;
  useEffect(() => {
    if (registry === null) return;
    registry.register(path => latest.current?.(path) ?? null);
    return () => registry.register(null);
  }, [registry]);
}
