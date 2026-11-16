"use client";

/**
 * Which fields of the version on screen the reader may not read.
 *
 * A version read names what its read rules held back, path by path, and a list
 * row is named by its own index (`items.1.secret`), so a field hidden in one
 * row is readable in the row beside it. The paths are carried here rather than
 * handed down through the form: the fields are drawn by the same renderer the
 * live editor uses, several levels below whoever read the version, and
 * threading a set through every level would make every field type's props
 * carry a fact only one of them acts on.
 *
 * Empty by default, which is the live editor's own answer: nothing is withheld
 * where there is no version on screen.
 *
 * @module components/features/versions/withheld-fields-context
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * What the read held back, read two ways from the one list: the paths
 * themselves, and every path that holds one of them, the path and each of
 * its containers (`meta` and `meta.secret` for `meta.secret`). Both are made
 * once, where the list arrives, so asking of any field is a lookup.
 */
interface Withheld {
  paths: ReadonlySet<string>;
  holding: ReadonlySet<string>;
}

const NONE: Withheld = { paths: new Set(), holding: new Set() };

const WithheldFieldsContext = createContext<Withheld>(NONE);

/** Each path, and each container above it, by its own path. */
function holdingPaths(paths: readonly string[]): ReadonlySet<string> {
  const holding = new Set<string>();
  for (const path of paths) {
    const parts = path.split(".");
    for (let end = 1; end <= parts.length; end++) {
      holding.add(parts.slice(0, end).join("."));
    }
  }
  return holding;
}

export function WithheldFieldsProvider({
  paths,
  children,
}: {
  /** The field paths the version read held back. */
  paths: readonly string[];
  children: ReactNode;
}) {
  const withheld = useMemo(
    () =>
      paths.length === 0
        ? NONE
        : { paths: new Set(paths), holding: holdingPaths(paths) },
    [paths]
  );
  return (
    <WithheldFieldsContext.Provider value={withheld}>
      {children}
    </WithheldFieldsContext.Provider>
  );
}

/**
 * The question below, for a caller that must call its hooks before it knows
 * the field's path: it reads the context now and asks of a path later.
 */
export function useWithheldFields(): (
  fieldPath: string | undefined
) => boolean {
  const withheld = useContext(WithheldFieldsContext);
  return fieldPath =>
    fieldPath !== undefined &&
    fieldPath !== "" &&
    withheld.paths.has(fieldPath);
}

/**
 * Whether anything at or below a field was held back from the reader: the
 * field itself, or a field inside it (`meta.secret` for `meta`). A view that
 * folds unchanged fields away asks this, so a field that says something is
 * hidden is never folded or counted as one that did not change.
 */
export function useHoldsWithheld(): (fieldPath: string) => boolean {
  const withheld = useContext(WithheldFieldsContext);
  return fieldPath => fieldPath !== "" && withheld.holding.has(fieldPath);
}

/**
 * Whether this field's value was held back from the reader. Answered by the
 * field's full path, so only the row that lost the field is told it did.
 */
export function useFieldWithheld(fieldPath: string | undefined): boolean {
  return useWithheldFields()(fieldPath);
}
