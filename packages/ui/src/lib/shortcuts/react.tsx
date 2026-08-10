/**
 * React bindings for the shortcut manager.
 *
 * Precedence follows the component tree. `ShortcutProvider` owns the single listener and is
 * depth 0; every `ShortcutScope` beneath it adds one. A shortcut registered deeper wins, which is
 * what makes an editor canvas outrank the shell that contains it without either one naming a
 * number the other has to stay clear of.
 *
 * @example
 * ```tsx
 * // The shell, once, at the root.
 * <ShortcutProvider>
 *   <App />
 * </ShortcutProvider>
 *
 * // Anywhere inside it.
 * useShortcuts(
 *   [{ keys: "mod+s", description: "Save", run: save, when: () => isDirty }],
 *   { name: "entry-form" }
 * );
 *
 * // A canvas that must own the keyboard while a drag is in flight. `blocking` is what stops the
 * // shell's Escape from navigating away mid-drag: while the drag runs, nothing below this layer
 * // sees a keystroke at all.
 * //
 * // The bindings live in their own component so the hook is called at a component's top level.
 * // A scope's children are ordinary React children, so a hook cannot be called among them
 * // directly — the rules-of-hooks lint rejects it, and conditional rendering would change hook
 * // order.
 * function DragKeys({ isDragging, cancel }) {
 *   useShortcuts([{ keys: "Escape", description: "Cancel drag", run: cancel }], {
 *     name: "canvas-drag",
 *     enabled: isDragging,
 *     blocking: true,
 *   });
 *   return null;
 * }
 *
 * <ShortcutScope>
 *   <DragKeys isDragging={isDragging} cancel={cancel} />
 *   <Canvas />
 * </ShortcutScope>
 * ```
 *
 * @module lib/shortcuts/react
 */
"use client";

import * as React from "react";

import {
  createShortcutManager,
  type ActiveShortcut,
  type ShortcutBinding,
  type ShortcutManager,
  type ShortcutManagerOptions,
} from "./manager";

interface ShortcutContextValue {
  manager: ShortcutManager;
  depth: number;
}

const ShortcutContext = React.createContext<ShortcutContextValue | null>(null);

/**
 * Props for {@link ShortcutProvider}.
 *
 * @experimental
 */
export interface ShortcutProviderProps extends ShortcutManagerOptions {
  children?: React.ReactNode;
  /**
   * Where the listener is installed. Defaults to `document`.
   *
   * The bubble phase is deliberate: a component that handles its own keys and calls
   * `stopPropagation` wins without knowing this exists, because React attaches its handlers
   * below `document`.
   */
  target?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

/**
 * Installs the application's one keydown listener and roots the layer stack.
 *
 * @experimental
 */
export function ShortcutProvider({
  children,
  target,
  ...managerOptions
}: ShortcutProviderProps): React.JSX.Element {
  // Options are read once, when the manager is built. Re-creating it on a changed option would
  // drop every layer registered by a child, since registrations live on the manager instance.
  const optionsRef = React.useRef(managerOptions);
  const manager = React.useMemo(
    () => createShortcutManager(optionsRef.current),
    []
  );

  React.useEffect(() => {
    // `target === null` is an explicit "attach nothing", for tests and for a host that drives
    // `handle` itself. An omitted target falls back to the document.
    if (target === null) return;
    const resolved =
      target ?? (typeof document === "undefined" ? null : document);
    if (!resolved) return;
    return manager.attach(resolved);
  }, [manager, target]);

  const value = React.useMemo(() => ({ manager, depth: 0 }), [manager]);
  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
}

/**
 * Raises the precedence of everything inside it by one level.
 *
 * @experimental
 */
export function ShortcutScope({
  children,
}: {
  children?: React.ReactNode;
}): React.JSX.Element {
  const parent = React.useContext(ShortcutContext);
  if (!parent) {
    throw new Error("ShortcutScope must be rendered inside a ShortcutProvider");
  }
  const value = React.useMemo(
    () => ({ manager: parent.manager, depth: parent.depth + 1 }),
    [parent.manager, parent.depth]
  );
  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
}

/**
 * Options for {@link useShortcuts}, minus the depth, which comes from the tree.
 *
 * @experimental
 */
export interface UseShortcutsOptions {
  /** Identifies this layer in a help panel. */
  name: string;
  /** Whether the layer participates. A disabled layer neither matches nor blocks. */
  enabled?: boolean;
  /**
   * Whether unmatched keys stop here rather than reaching layers beneath.
   *
   * Set this while a drag or a modal interaction owns the keyboard.
   */
  blocking?: boolean;
}

/**
 * Register shortcuts for as long as the calling component is mounted.
 *
 * The bindings array may be rebuilt on every render; it is re-read in place rather than
 * re-registered, so inline closures are fine and the layer keeps its position in the stack.
 *
 * @experimental
 */
export function useShortcuts(
  bindings: readonly ShortcutBinding[],
  options: UseShortcutsOptions
): void {
  const context = React.useContext(ShortcutContext);
  if (!context) {
    throw new Error("useShortcuts must be called inside a ShortcutProvider");
  }
  const { manager, depth } = context;

  const registration = React.useRef<ReturnType<
    ShortcutManager["register"]
  > | null>(null);

  // The newest bindings and options, reachable from an effect that must not re-run when they
  // change. Registration is deliberately NOT keyed on them: rebuilding the layer would move it
  // to the top of its depth, changing precedence for a reason the caller never asked for.
  const latest = React.useRef({ bindings, options });

  React.useLayoutEffect(() => {
    registration.current = manager.register([], {
      name: latest.current.options.name,
      depth,
    });
    return () => {
      registration.current?.dispose();
      registration.current = null;
    };
  }, [manager, depth]);

  // No dependency array: the bindings close over render-scoped values, so re-reading them every
  // render is what keeps them from going stale, and it is cheap.
  React.useLayoutEffect(() => {
    latest.current = { bindings, options };
    registration.current?.update(bindings, {
      name: options.name,
      depth,
      enabled: options.enabled,
      blocking: options.blocking,
    });
  });
}

/**
 * The manager itself, for a help panel that lists what is currently bound.
 *
 * @experimental
 */
export function useShortcutManager(): ShortcutManager {
  const context = React.useContext(ShortcutContext);
  if (!context) {
    throw new Error(
      "useShortcutManager must be called inside a ShortcutProvider"
    );
  }
  return context.manager;
}

/**
 * The shortcuts currently in effect, most precedent first.
 *
 * Read at call time rather than subscribed to: this is for a help panel, which opens, reads once
 * and closes, and a subscription would re-render it on every layer change beneath.
 *
 * @experimental
 */
export function useActiveShortcuts(): readonly ActiveShortcut[] {
  const manager = useShortcutManager();
  return manager.activeBindings();
}
