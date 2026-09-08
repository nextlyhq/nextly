/**
 * The draft-preview request contract, asserted at the type level.
 *
 * Both properties here are compile-time only, so a runtime test cannot hold
 * them: nothing throws when the client's idea of the request drifts from the
 * server's — the request simply starts coming back 400 in a browser. These
 * fail the build instead, which is the whole point of deriving the payload.
 *
 * `include: ["src/**\/*"]` covers this file, so `check-types` enforces it.
 */
import type { DraftPreviewRequest } from "nextly/api/email-template-preview-types";

import type {
  DraftPreviewData,
  DraftPreviewTemplate,
} from "@admin/services/emailTemplateApi";

/*
 * The REQUEST type, not the parsed one. The schema defaults
 * `plainTextContent`, `preheader` and `layoutId` to null, so a caller may omit
 * all three and the server fills them in. Typed from `z.infer` — the output —
 * those fields are required and this assignment is a compile error, which
 * would reject payloads the endpoint accepts.
 */
const omittingDefaultedFields: DraftPreviewRequest = {
  template: {
    subject: "Welcome",
    htmlContent: "<p>Hello</p>",
    useLayout: false,
    kind: "template",
  },
  data: {},
};

/*
 * The WHOLE envelope is derived, not just the template inside it. If this
 * alias only tracked `["template"]`, a schema gaining another required
 * top-level property would still compile here and fail as a 400 at runtime.
 */
const wholeEnvelope: DraftPreviewRequest = {
  template: {} as DraftPreviewTemplate,
  // No assertion: `DraftPreviewData` is the schema's own record type, which an
  // empty object already satisfies. Asserting it would be noise the linter is
  // right to reject — and would hide a future narrowing of that field.
  data: {} satisfies DraftPreviewData,
};

void omittingDefaultedFields;
void wholeEnvelope;
