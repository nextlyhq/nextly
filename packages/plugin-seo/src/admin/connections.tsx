/**
 * The SEO settings screen's Connections tab: the optional services and
 * outputs, each off until someone switches it on. A switch changes the
 * draft, and the page saves it with every other tab.
 *
 * @module admin/connections
 */
import { Switch } from "@nextlyhq/plugin-sdk/admin";
import type { JSX, ReactNode } from "react";

import { ConnectionStyles } from "./connection-styles";
import type { SettingsDraft } from "./settings-draft";
import type { TabProps } from "./tabs";

/** The host the site is served from, for the sentences that name it. */
function siteHostOf(draft: SettingsDraft): string {
  const [first] = draft.productionAddresses;
  if (first !== undefined) {
    try {
      return new URL(first.trim()).host;
    } catch {
      // A half-typed address names no host yet; fall through.
    }
  }
  return typeof window === "undefined" ? "your-site" : window.location.host;
}

/** One service or output: its name and what it does, and its control. */
function Connection({
  name,
  help,
  control,
}: {
  name: string;
  help: ReactNode;
  control: ReactNode;
}): JSX.Element {
  return (
    <div className="nx-seo-conn">
      <div>
        <b>{name}</b>
        <p className="nx-seo-help">{help}</p>
      </div>
      {control}
    </div>
  );
}

/** A switch for one of the draft's on-or-off values. */
function Toggle({
  label,
  on,
  set,
}: {
  label: string;
  on: boolean;
  set: (on: boolean) => void;
}): JSX.Element {
  return <Switch aria-label={label} checked={on} onCheckedChange={set} />;
}

/** Optional services and outputs, each off until switched on. */
export function ConnectionsTab({ draft, change }: TabProps): JSX.Element {
  const host = siteHostOf(draft);
  return (
    <div className="nx-seo-conns">
      <ConnectionStyles />
      <Connection
        name="llms.txt"
        help={`A plain list of your pages at ${host}/llms.txt, for AI tools to read. Off by default; few tools use it today. It lists the same pages and words people see.`}
        control={
          <Toggle
            label="llms.txt"
            on={draft.llmsTxt}
            set={llmsTxt => change(current => ({ ...current, llmsTxt }))}
          />
        }
      />
      <Connection
        name="Plain-text copies of pages"
        help="Adds a text version of each page, the same words people see, for AI tools. Off by default."
        control={
          <Toggle
            label="Plain-text copies"
            on={draft.plainTextCopies}
            set={plainTextCopies =>
              change(current => ({ ...current, plainTextCopies }))
            }
          />
        }
      />
    </div>
  );
}
