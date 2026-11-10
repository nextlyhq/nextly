"use client";

/**
 * The bound props a visitor will not see, handed by the host to the parts of
 * the shell that say so: the inspector's note under each such prop.
 *
 * A context rather than a member of `ContentServices`: the services are one
 * object per language and person, kept so a control's reads are not redone,
 * while this answer changes with every edit to a binding.
 *
 * @module visitor-unreadable-context
 */

import type { VisitorUnreadableBinding } from "@nextlyhq/blocks-engine";
import { EyeOff } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";

import type { ContentServices } from "./content-controls";
import { VisitorUnreadableLine } from "./visitor-unreadable-badges";

/** The answer before a host gives one: nothing marked. */
const NONE: ReadonlyMap<string, readonly VisitorUnreadableBinding[]> =
  new Map();

const VisitorUnreadable =
  createContext<ReadonlyMap<string, readonly VisitorUnreadableBinding[]>>(NONE);

/**
 * Hands the shell the bindings a visitor will not see, by the id of the node
 * holding them.
 *
 * @experimental
 */
export function VisitorUnreadableProvider({
  value,
  children,
}: {
  readonly value: ReadonlyMap<string, readonly VisitorUnreadableBinding[]>;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <VisitorUnreadable.Provider value={value}>
      {children}
    </VisitorUnreadable.Provider>
  );
}

/** The bindings on `nodeId` a visitor will not see filled. */
export function useVisitorUnreadable(
  nodeId: string
): readonly VisitorUnreadableBinding[] {
  return useContext(VisitorUnreadable).get(nodeId) ?? [];
}

/**
 * The note under a prop whose bound value a visitor will not see: the field,
 * and what the published page shows instead, a fallback from the library
 * named by its file as the badge names it. Nothing for a prop with none.
 */
export function VisitorUnreadableNote({
  bindings,
  props,
  services,
}: {
  readonly bindings: readonly VisitorUnreadableBinding[];
  /** The props the field above it draws. */
  readonly props: ReadonlySet<string>;
  /** The host's services, whose media read names a library fallback's file. */
  readonly services?: ContentServices | undefined;
}): React.JSX.Element | null {
  const shown = bindings.filter(binding => props.has(binding.prop));
  if (shown.length === 0) return null;
  return (
    <div className="nx-inspector__visitor-unreadable" role="note">
      <EyeOff size={14} aria-hidden="true" />
      <div className="nx-inspector__visitor-unreadable-lines">
        {shown.map(binding => (
          <p key={binding.prop}>
            <VisitorUnreadableLine
              binding={binding}
              readMedia={services?.readMedia}
            />
          </p>
        ))}
      </div>
    </div>
  );
}
