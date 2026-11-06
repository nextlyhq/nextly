"use client";

/**
 * "Resume setup", at the end of the header's summary line: the way back to a
 * setup card the reader dismissed. A control, not a link, since it changes
 * the reader's dashboard rather than going anywhere; drawn as the summary's
 * parts are. Pressed, it brings the card back and, once the write lands, is
 * itself gone (`useSetupResume`).
 *
 * @module components/features/dashboard/header/ResumeSetupLink
 */

import type { JSX } from "react";

import type { SetupResume } from "../setup/useSetupResume";

import { LINK_CLASS } from "./SummaryLine";

export function ResumeSetupLink({
  resume,
}: {
  resume: SetupResume;
}): JSX.Element {
  return (
    <>
      <button
        type="button"
        className={LINK_CLASS}
        onClick={resume.resume}
        // One write at a time: a second press while the first settles would
        // only repeat it.
        disabled={resume.isResuming}
        data-testid="dashboard-summary-resume-setup"
      >
        Resume setup
      </button>
      {resume.failed ? (
        // Said where the press was, so the reader knows it did not take and
        // that pressing again is the way on.
        <span role="status" data-testid="dashboard-summary-resume-failed">
          {" "}
          (could not resume, try again)
        </span>
      ) : null}
    </>
  );
}
