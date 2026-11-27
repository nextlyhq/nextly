/**
 * Two parts of Search engines and AI beside the AI tools choice: the tick
 * that adds a Content-Signal line stating the choice, and what robots.txt
 * can't do, with the search engines' own settings that can.
 *
 * @module admin/ai-controls
 */
import {
  Alert,
  AlertDescription,
  Checkbox,
  SettingsRowGroup,
} from "@nextlyhq/plugin-sdk/admin";
import { Info } from "lucide-react";
import { useId, type JSX } from "react";

import { contentSignalOf } from "../outputs/ai-crawlers";

import { ControlNote } from "./settings-parts";
import type { TabProps } from "./tabs";

/** Google's page on Search Console's Search generative AI setting. */
const SEARCH_GENERATIVE_AI_HELP =
  "https://support.google.com/webmasters/answer/16908024";

/** Bing Webmaster Tools, where Bing's AI preferences are set. */
const BING_WEBMASTER_TOOLS = "https://www.bing.com/webmasters";

/**
 * The tick under the AI tools choice: off by default, and when on,
 * robots.txt's group for every crawler states the choice as a Content-Signal
 * line, the line shown as it will be written. Stored with the own rules.
 */
export function ContentSignalTick({ draft, change }: TabProps): JSX.Element {
  const id = useId();
  const on = draft.robotsRules.contentSignal === true;
  return (
    <div className="mt-3">
      <label
        htmlFor={id}
        className="flex items-center gap-2 text-sm text-foreground"
      >
        <Checkbox
          id={id}
          checked={on}
          onCheckedChange={checked => {
            change(current => {
              const { contentSignal: _was, ...rest } = current.robotsRules;
              return {
                ...current,
                robotsRules:
                  checked === true ? { ...rest, contentSignal: true } : rest,
              };
            });
          }}
        />
        Add a Content-Signal line
      </label>
      <ControlNote>
        Read by some scanners and Cloudflare; not a standard. It states your
        choice as{" "}
        <code className="font-mono">
          Content-Signal: {contentSignalOf(draft.aiCrawlers)}
        </code>
        .
      </ControlNote>
    </div>
  );
}

/** An address outside the admin, opened in a new tab. */
function OutsideLink({
  href,
  children,
}: {
  href: string;
  children: string;
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-foreground underline underline-offset-2 hover:decoration-2"
    >
      {children}
    </a>
  );
}

/**
 * What robots.txt can't do, beside the choices that might suggest it can,
 * and the search engines' own settings that do it: Google's AI answers read
 * pages with Google Search's own crawler, so only Search Console's setting,
 * or a page's snippet controls, keep a site's text out of them; Bing sets
 * training and grounding apart in Bing Webmaster Tools.
 */
export function OutsideRobotsRow(): JSX.Element {
  return (
    <SettingsRowGroup
      label="Outside robots.txt"
      description="Settings for AI answers that live with the search engines."
    >
      <Alert variant="info" role="note">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <AlertDescription>
          <p>
            <b className="font-semibold">
              Google&apos;s AI Overviews and AI Mode:
            </b>{" "}
            robots.txt can&apos;t take your site out of them. They read pages
            with Google Search&apos;s own crawler, so blocking it would take you
            out of Google Search too. In Search Console, Settings ›{" "}
            <OutsideLink href={SEARCH_GENERATIVE_AI_HELP}>
              Search generative AI
            </OutsideLink>{" "}
            leaves the site out of AI Overviews, AI Mode and Discover&apos;s AI
            features; Google says it isn&apos;t a ranking signal. To keep one
            page&apos;s text out, set its{" "}
            <b className="font-semibold">Text under the link</b> to None on that
            page; that also removes the text from normal results.
          </p>
          <p className="mt-2">
            <b className="font-semibold">Bing and Copilot:</b>{" "}
            <OutsideLink href={BING_WEBMASTER_TOOLS}>
              Bing Webmaster Tools
            </OutsideLink>{" "}
            sets whether Bing may use your pages for AI training and for
            grounding Copilot&apos;s answers, from 15 December 2026.
          </p>
        </AlertDescription>
      </Alert>
    </SettingsRowGroup>
  );
}
