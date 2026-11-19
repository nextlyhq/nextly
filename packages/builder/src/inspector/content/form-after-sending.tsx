"use client";

/**
 * A Form's "After sending": what a visitor sees once a send is accepted.
 *
 * "Show a message" or "Go to a page", with the message's words or the page
 * under the choice. A form picked from a provider starts on "Use the form's
 * own setting (<what it is>)", the provider's choice for that form, which
 * this block may override.
 *
 * The page is the shared link setting (a page of the site, or an address),
 * drawn by the caller with the block's link props.
 *
 * @module form-after-sending
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

import { SegmentedChoice } from "./content-controls";
import type { ContentServices } from "./content-services";
import { pickedFormOf, type PickedForm } from "./form-picked";

/** The words of each choice. */
const CHOICE_WORDS = {
  message: "Show a message",
  page: "Go to a page",
} as const;

/** What the block shows once sent, with the default for its mode applied. */
function afterSendingOf(
  stored: unknown,
  picked: boolean
): "form" | "message" | "page" {
  if (stored === "message" || stored === "page") return stored;
  if (stored === "form" && picked) return "form";
  return picked ? "form" : "message";
}

/** What a picked form's own setting is, once the host says. */
function useOwnSetting(
  picked: PickedForm | undefined,
  services: ContentServices | undefined
): string | undefined {
  const [own, setOwn] = React.useState<string | undefined>(undefined);
  const describe = services?.describeForm;
  const provider = picked?.provider;
  const ref = picked?.ref;
  React.useEffect(() => {
    setOwn(undefined);
    if (describe === undefined || provider === undefined || ref === undefined) {
      return;
    }
    let current = true;
    describe({ provider, ref })
      .then(described => {
        if (current && described !== undefined) {
          setOwn(CHOICE_WORDS[described.afterSending.kind]);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [describe, provider, ref]);
  return own;
}

/** "Use the form's own setting", with what it is where that is known. */
function ownSettingWords(own: string | undefined): string {
  return own === undefined
    ? "Use the form's own setting"
    : `Use the form's own setting (${own})`;
}

export function AfterSendingControl({
  id,
  props,
  disabled,
  services,
  onCommit,
  message,
  page,
}: {
  id: string;
  /** The block's stored props. */
  props: Readonly<Record<string, unknown>>;
  disabled: (name: string) => boolean;
  services: ContentServices | undefined;
  onCommit: (name: string, value: unknown) => void;
  /** The message's own row, drawn for "Show a message". */
  message: React.ReactNode;
  /** The shared link setting, drawn for "Go to a page". */
  page: React.ReactNode;
}): React.JSX.Element {
  const picked = pickedFormOf(props.form);
  const chosen = afterSendingOf(props.afterSending, picked !== undefined);
  const own = useOwnSetting(picked, services);
  const options =
    picked === undefined
      ? (["message", "page"] as const)
      : (["form", "message", "page"] as const);
  const words = (option: (typeof options)[number]): string =>
    option === "form" ? ownSettingWords(own) : CHOICE_WORDS[option];
  return (
    <div className="nx-form-after" data-content-control="after-sending">
      <div className="nx-inspector__field nx-inspector__field--stacked">
        {/* Its own name, not the section's title again right above it. */}
        <p className="nx-inspector__field-name" id={`${id}-label`}>
          Then
        </p>
        {picked === undefined ? (
          <SegmentedChoice
            id={id}
            labelledBy={`${id}-label`}
            options={options}
            labels={options.map(words)}
            value={chosen}
            disabled={disabled("afterSending")}
            onChoose={next => onCommit("afterSending", next)}
          />
        ) : (
          // Three choices, one of them long: a menu.
          <Select
            value={chosen}
            disabled={disabled("afterSending")}
            onValueChange={next => onCommit("afterSending", next)}
          >
            <SelectTrigger id={id} aria-labelledby={`${id}-label`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map(option => (
                <SelectItem key={option} value={option}>
                  {words(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {chosen === "message" ? message : null}
      {chosen === "page" ? page : null}
    </div>
  );
}
