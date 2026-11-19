"use client";

/**
 * The pieces every group of a collection list's query is drawn with: a
 * group's title, and the line under a field saying what is wrong with it.
 * Their own module, so the list's own groups and its custom source's groups
 * draw them from one place.
 *
 * @module list-query-parts
 */
import * as React from "react";

/** The note under a field that says what is wrong with it. */
export function FieldError({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p id={id} className="nx-inspector__error nx-list-query__error">
      {children}
    </p>
  );
}

/** A group's title, as the Advanced summary is titled. */
export function GroupTitle({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <h3 id={id} className="nx-list-query__title">
      {children}
    </h3>
  );
}

/**
 * A caution under a field: something a save warns about rather than
 * refuses, which the author cannot fix here, in the theme's warning tone.
 */
export function FieldCaution({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p id={id} className="nx-list-query__caution">
      {children}
    </p>
  );
}
