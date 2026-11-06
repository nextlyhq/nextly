"use client";

/**
 * What a new release is asked for when it is made: a name, and an optional
 * description, and nothing else. A release is assembled before it is
 * scheduled, so its moment is chosen later, from its page.
 *
 * One form, so the Releases page's New release and a document's "in a new
 * release" ask the same thing the same way.
 *
 * @module components/features/releases/ReleaseNameFields
 */

import { useId, type JSX } from "react";

import { Input, Label, Textarea } from "@admin/components/ui";

export function ReleaseNameFields({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  autoFocus = false,
  titleProblem,
}: {
  title: string;
  onTitleChange: (next: string) => void;
  description: string;
  onDescriptionChange: (next: string) => void;
  autoFocus?: boolean;
  /** Why the name cannot be taken, said under it; absent when it can. */
  titleProblem?: string;
}): JSX.Element {
  const ids = useId();
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${ids}-title`}>Name</Label>
        <Input
          id={`${ids}-title`}
          value={title}
          autoFocus={autoFocus}
          onChange={event => onTitleChange(event.target.value)}
          placeholder="Spring launch"
          aria-invalid={titleProblem !== undefined || undefined}
          aria-describedby={
            titleProblem === undefined ? undefined : `${ids}-title-problem`
          }
        />
        {titleProblem === undefined ? null : (
          <p
            id={`${ids}-title-problem`}
            className="text-sm text-destructive-700 dark:text-destructive"
          >
            {titleProblem}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${ids}-description`}>
          Description{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={`${ids}-description`}
          value={description}
          onChange={event => onDescriptionChange(event.target.value)}
          placeholder="What is going live, and why it goes together."
          rows={3}
        />
      </div>
    </>
  );
}
