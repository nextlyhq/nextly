/**
 * The workflows the step and assignment tests take steps through, as plain definitions, so the
 * unit tests can read them without booting anything.
 *
 * - `editorial`: custom names for every step. Writing → Legal check → Cleared, with a move out of
 *   Legal check to On hold that requires a comment, a move back from On hold into Legal check (so
 *   review can be re-entered by a move after a submit), and a fast track from On hold into the
 *   publishable stage that names no permission, so it needs `publish-<slug>`. Only a step of
 *   kind approve may lead into a publishable stage, so the fast track is one.
 *   Clearing and bouncing need the named action `sign-off`; clearing refuses self-approval.
 * - `handover`: no submit step at all: review is entered by a move.
 * - `reviewWorkflow()`: the preset, whose approval does not refuse self-approval.
 */
import { defineWorkflow } from "../../define-workflow";

export const editorial = defineWorkflow({
  slug: "editorial",
  label: "Editorial",
  stages: [
    { name: "writing", label: "Writing" },
    { name: "legal", label: "Legal check" },
    { name: "hold", label: "On hold" },
    { name: "cleared", label: "Cleared", allowsPublish: true },
  ],
  steps: [
    {
      name: "send",
      label: "Send to legal",
      kind: "submit",
      from: "writing",
      to: "legal",
      primary: true,
    },
    {
      name: "clear",
      label: "Clear",
      kind: "approve",
      from: "legal",
      to: "cleared",
      permission: "sign-off",
      refusesSelfApproval: true,
      primary: true,
    },
    {
      name: "bounce",
      label: "Bounce",
      kind: "request-changes",
      from: ["legal", "cleared"],
      to: "writing",
      permission: "sign-off",
    },
    {
      name: "park",
      label: "Park",
      kind: "move",
      from: "legal",
      to: "hold",
      commentRequired: true,
    },
    {
      name: "resume",
      label: "Resume",
      kind: "move",
      from: "hold",
      to: "legal",
      primary: true,
    },
    {
      name: "fastTrack",
      label: "Fast-track",
      kind: "approve",
      from: "hold",
      to: "cleared",
    },
  ],
});

export const handover = defineWorkflow({
  slug: "handover",
  label: "Handover",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "review", label: "Review" },
    { name: "ok", label: "OK", allowsPublish: true },
  ],
  steps: [
    {
      name: "handOver",
      label: "Hand over",
      kind: "move",
      from: "draft",
      to: "review",
    },
    {
      name: "signOff",
      label: "Sign off",
      kind: "approve",
      from: "review",
      to: "ok",
      permission: "sign-off",
      refusesSelfApproval: true,
      primary: true,
    },
    {
      name: "sendBack",
      label: "Send back",
      kind: "request-changes",
      from: ["review", "ok"],
      to: "draft",
      permission: "sign-off",
    },
  ],
});
