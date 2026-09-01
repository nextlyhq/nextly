/**
 * The frame is the advertised width EDGE TO EDGE.
 *
 * The toolbar labels the desktop view "600px", which is the width virtually
 * every HTML email is built to. If the document inside carries horizontal
 * padding, a conventional fixed-width 600px table has only 568px to lay out in
 * and overflows the frame that claims to be showing it at true size — a
 * preview that is wrong about the one measurement it displays.
 *
 * Asserted on the generated document rather than on geometry: jsdom lays
 * nothing out, and the document IS the artifact this component produces.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PreviewPane } from "../TemplatePreview";

afterEach(cleanup);

function srcDocOf(format: "html" | "text") {
  render(
    <PreviewPane
      html="<table width='600'><tr><td>body</td></tr></table>"
      text="plain"
      subject="s"
      format={format}
    />
  );
  return screen.getByTitle("Email preview").getAttribute("srcdoc") ?? "";
}

describe("the previewed document does not eat into the device width", () => {
  it("applies no horizontal body padding in the HTML preview", () => {
    const doc = srcDocOf("html");
    // Vertical breathing room is fine; horizontal is what steals from the
    // 600px the toolbar promises.
    expect(doc).toContain("padding:16px 0");
    expect(doc).not.toMatch(/body\{[^}]*padding:16px[;}]/);
  });

  /*
   * The plain-text pane is a monospace stream rather than a laid-out document,
   * and it is not rendered at a device width at all — it fills the pane. Its
   * padding is readability, not layout, so it stays.
   */
  it("keeps padding in the plain-text preview", () => {
    expect(srcDocOf("text")).toContain("padding:16px");
  });
});
