"use client";

/**
 * The question a document view asks when it could edit more than one field
 * and its address names none of them: which one.
 *
 * Asked rather than answered with the first, because opening the wrong one of
 * two looks like the right editor showing the wrong content. The answer goes
 * into the address (`?field=`), so a reload, a link or the browser's back
 * button reaches the same field.
 *
 * @module components/features/entries/EntryForm/DocumentViewFieldChooser
 */
import { Button } from "@nextlyhq/ui";

import { setSearchParam } from "@admin/lib/navigation";
import type { ViewFieldCandidate } from "@admin/lib/plugins/document-view-registry";

export function DocumentViewFieldChooser({
  candidates,
}: {
  candidates: readonly ViewFieldCandidate[];
}): React.JSX.Element {
  return (
    <section
      aria-labelledby="document-view-field-chooser"
      className="mx-auto flex max-w-md flex-col gap-4 px-6 py-12"
    >
      <h1
        id="document-view-field-chooser"
        className="text-lg font-semibold text-foreground"
      >
        Which field do you want to edit?
      </h1>
      <ul className="flex flex-col gap-2">
        {candidates.map(candidate => (
          <li key={candidate.name}>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => setSearchParam("field", candidate.name)}
            >
              {candidate.label ?? candidate.name}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
