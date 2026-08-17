/**
 * The pure resolver is covered in `chrome-suppression.test.ts`. This file covers
 * the seam that file cannot reach: whether a request made by a CHILD actually
 * arrives, and whether unmounting that child releases it.
 *
 * Worth having separately because the resolver being correct says nothing about
 * the wiring. A provider that never registered, registered once and cached, or
 * removed by value instead of by identity would leave every resolver test green.
 */
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import {
  ChromeSuppressionProvider,
  useSuppressAdminChrome,
  useSuppressedChrome,
} from "../ChromeSuppression";
import type { AdminChromeLayer } from "../lib/chrome-suppression";

/**
 * Stands in for the admin's own chrome: it reports what the layout would hide.
 *
 * Reading it out as text rather than asserting on a returned Set keeps the
 * assertion on the value a RENDER received, which is what the layout consumes.
 */
function ChromeProbe() {
  const hidden = useSuppressedChrome();
  return (
    <div data-testid="hidden">
      {hidden.size === 0 ? "none" : [...hidden].sort().join(",")}
    </div>
  );
}

function ImmersiveSurface({
  layers,
  canExit,
}: {
  layers: readonly AdminChromeLayer[];
  canExit: boolean;
}) {
  useSuppressAdminChrome({ layers, canExit });
  return <div>editor</div>;
}

const hiddenText = () => screen.getByTestId("hidden").textContent;

describe("chrome suppression wiring", () => {
  it("hides nothing when no surface is mounted", () => {
    render(
      <ChromeSuppressionProvider>
        <ChromeProbe />
      </ChromeSuppressionProvider>
    );
    expect(hiddenText()).toBe("none");
  });

  it("delivers a child's request to the layout", () => {
    render(
      <ChromeSuppressionProvider>
        <ChromeProbe />
        <ImmersiveSurface layers={["header", "subSidebar"]} canExit />
      </ChromeSuppressionProvider>
    );
    // The positive control for every negative assertion below: if registration
    // did not work at all, this is the test that fails first.
    expect(hiddenText()).toBe("header,subSidebar");
  });

  it("releases the request when the surface unmounts", () => {
    function Host({ open }: { open: boolean }) {
      return (
        <ChromeSuppressionProvider>
          <ChromeProbe />
          {open ? (
            <ImmersiveSurface layers={["header", "primaryRail"]} canExit />
          ) : null}
        </ChromeSuppressionProvider>
      );
    }
    const view = render(<Host open />);
    expect(hiddenText()).toBe("header,primaryRail");
    // Navigating away is an unmount. Nothing calls a release explicitly, which
    // is the property: the chrome comes back with nothing to remember to undo.
    view.rerender(<Host open={false} />);
    expect(hiddenText()).toBe("none");
  });

  it("withholds the rail from a surface that renders no way back", () => {
    render(
      <ChromeSuppressionProvider>
        <ChromeProbe />
        <ImmersiveSurface
          layers={["primaryRail", "header", "pageFrame"]}
          canExit={false}
        />
      </ChromeSuppressionProvider>
    );
    // Asserted through the real hook rather than by calling the resolver, so a
    // provider that dropped `canExit` on the way through would fail here.
    expect(hiddenText()).toBe("header,pageFrame");
  });

  it("releases only the surface that unmounted", () => {
    function Host({ second }: { second: boolean }) {
      return (
        <ChromeSuppressionProvider>
          <ChromeProbe />
          <ImmersiveSurface layers={["header"]} canExit />
          {second ? <ImmersiveSurface layers={["header"]} canExit /> : null}
        </ChromeSuppressionProvider>
      );
    }
    // Both ask for the SAME layer, so the two requests are equal by value and
    // differ only by identity. A provider removing by value releases both and
    // the header comes back while a surface still wants it hidden.
    const view = render(<Host second />);
    expect(hiddenText()).toBe("header");
    view.rerender(<Host second={false} />);
    expect(hiddenText()).toBe("header");
  });

  it("hides nothing when the hook is called outside a provider", () => {
    // A surface rendered outside the dashboard layout — a test, an auth page —
    // must not throw. Asserted because the alternative is every call site
    // guarding, which is a rule each new one has to remember.
    render(
      <>
        <ChromeProbe />
        <ImmersiveSurface layers={["header"]} canExit />
      </>
    );
    expect(hiddenText()).toBe("none");
  });
});
