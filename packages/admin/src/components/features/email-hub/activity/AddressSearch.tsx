"use client";

import { Button, Input, Label } from "@nextlyhq/ui";
import type { FormEvent, JSX } from "react";
import { useId, useState } from "react";

export interface AddressSearchProps {
  /** Whether the list shows a search's results rather than the Activity. */
  searching: boolean;
  /** Searches for one exact address. */
  onSearch: (address: string) => void;
  /** Goes back to the whole Activity. */
  onClear: () => void;
}

/**
 * Activity's search by address: one whole address, sent only when asked.
 *
 * The address stays in this field and the request's body. It is never put
 * in the page's address, the browser's form history or a cache key, and the
 * server keeps a record that a search was made, never the address. Only a
 * whole address finds anything, however it is cased.
 */
export function AddressSearch({
  searching,
  onSearch,
  onClear,
}: AddressSearchProps): JSX.Element {
  const [address, setAddress] = useState("");
  const inputId = useId();
  const hintId = useId();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const whole = address.trim();
    if (whole) onSearch(whole);
  };
  return (
    <form
      role="search"
      aria-label="Search by address"
      onSubmit={submit}
      className="space-y-1.5"
    >
      <Label htmlFor={inputId} className="text-sm font-medium">
        Find what was sent to an address
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          type="email"
          inputMode="email"
          // Kept out of the browser's saved form entries.
          autoComplete="off"
          spellCheck={false}
          required
          value={address}
          onChange={event => setAddress(event.target.value)}
          placeholder="name@example.com"
          aria-describedby={hintId}
          className="sm:max-w-sm"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            Search
          </Button>
          {searching && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAddress("");
                onClear();
              }}
            >
              Clear search
            </Button>
          )}
        </div>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        Only a whole address finds anything. Each search is recorded, with who
        made it, never the address.
      </p>
    </form>
  );
}
