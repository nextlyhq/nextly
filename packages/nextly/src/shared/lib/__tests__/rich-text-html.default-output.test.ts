/**
 * The HTML the converter writes when no style option is given, for a document
 * holding every node type. The snapshot was taken before the class-only option
 * existed, so any change to the default output, including whitespace and the
 * order of attributes, shows up here as a diff.
 *
 * @module shared/lib/__tests__/rich-text-html.default-output.test
 */
import { describe, expect, it } from "vitest";

import { convertRichTextToHtml } from "../rich-text-html";

import { EVERY_NODE } from "./rich-text-html.fixture";

describe("the converter's default output", () => {
  it("is unchanged for a document with every node type", () => {
    expect(convertRichTextToHtml(EVERY_NODE)).toMatchSnapshot();
  });
});
