"use client";

/**
 * A bound image's Fallback: what visitors see when the bound field has no
 * picture to give.
 *
 * An image's fallback is an image address (`https://…`, `http://…` or a path
 * on the site), the one kind the engine draws one from, so this row asks for
 * an address and holds back anything else with the reason, rather than saving
 * a fallback the page would ignore. A stored address is shown with a small
 * picture of it and the address itself, cut where the inspector is narrow;
 * the whole of it is on the field's tooltip and in its accessible name.
 *
 * The row keeps a place for a second way to fill it, a file chosen from the
 * media library, which writes a media id through the same `onFallback`.
 *
 * @module image-binding-fallback
 */
import { imageValueOf, type Binding } from "@nextlyhq/blocks-engine";
import { Input } from "@nextlyhq/ui";
import * as React from "react";

import type { ContentServices } from "./content-controls";

/** What an image's Fallback row is given. */
export interface ImageBindingFallbackProps {
  /** The image prop's binding, whose `fallback` the row shows and edits. */
  readonly binding: Binding;
  /** Store a fallback: an image address, or `""` for none. */
  readonly onFallback: (value: string) => void;
  /** The host's services; the library action reads its media picker here. */
  readonly services: ContentServices | undefined;
  readonly disabled?: boolean;
  /** The id of the prop's name, which the row is about. */
  readonly describedBy?: string;
}

/** What the row says of a typed value that is not an image address. */
const NOT_AN_ADDRESS =
  "Enter an image address: one starting https:// or http://, or a path on this site such as /media/spring.jpg.";

/**
 * Whether a value is an image address, by the engine's own reading of an
 * image value: the same one a visitor's page draws a fallback by.
 */
function isImageAddress(value: string): boolean {
  return imageValueOf(value)?.holds === "address";
}

/** The binding's fallback as text, or `""` for none. */
function storedFallback(binding: Binding): string {
  return "fallback" in binding && typeof binding.fallback === "string"
    ? binding.fallback
    : "";
}

/** A bound image's Fallback row. */
export function ImageBindingFallback({
  binding,
  onFallback,
  disabled = false,
  describedBy,
}: ImageBindingFallbackProps): React.JSX.Element {
  const id = React.useId();
  const errorId = React.useId();
  const stored = storedFallback(binding);
  const [refusal, setRefusal] = React.useState(false);
  // The address whose picture would not load, so a broken one draws no
  // empty frame; another address is tried afresh.
  const [broken, setBroken] = React.useState<string>();
  const pictured = isImageAddress(stored) && broken !== stored;
  const commit = (typed: string): void => {
    const next = typed.trim();
    if (next === stored) {
      setRefusal(false);
      return;
    }
    // Held back rather than saved: the page draws a fallback only from an
    // image address, so anything else would be stored and never shown.
    if (next !== "" && !isImageAddress(next)) {
      setRefusal(true);
      return;
    }
    setRefusal(false);
    onFallback(next);
  };
  const described = [describedBy, refusal ? errorId : undefined]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="nx-binding__fallback nx-image-fallback">
      <label className="nx-binding__fallback-label" htmlFor={id}>
        Fallback
      </label>
      <div className="nx-image-fallback__value">
        <div
          className="nx-image-fallback__address"
          data-pictured={pictured ? "" : undefined}
        >
          {pictured ? (
            // Decorative: the address beside it says which picture it is.
            <img
              className="nx-image-fallback__thumb"
              src={stored}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setBroken(stored)}
            />
          ) : null}
          <Input
            id={id}
            // Remounted for a fallback changed elsewhere (an undo, the
            // library action), so the field never shows a stale address.
            key={stored}
            defaultValue={stored}
            placeholder="https://… or /media/…"
            spellCheck={false}
            disabled={disabled}
            // The whole address, which the field cuts where it is narrow.
            title={stored === "" ? undefined : `Fallback: ${stored}`}
            aria-label={stored === "" ? undefined : `Fallback: ${stored}`}
            aria-invalid={refusal ? true : undefined}
            aria-describedby={described === "" ? undefined : described}
            onChange={() => {
              if (refusal) setRefusal(false);
            }}
            onBlur={event => commit(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              commit(event.currentTarget.value);
            }}
          />
        </div>
        {/* Reserved for "Choose from library": a file picked there is written
            as the fallback through `onFallback`, as its media id. Empty until
            then, and not drawn while empty. */}
        <div className="nx-image-fallback__actions" data-fallback-actions="" />
      </div>
      {refusal ? (
        <p className="nx-inspector__error" id={errorId} role="alert">
          {NOT_AN_ADDRESS}
        </p>
      ) : null}
    </div>
  );
}
