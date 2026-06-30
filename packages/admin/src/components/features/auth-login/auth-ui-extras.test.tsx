import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "../../../lib/plugins/component-registry";

import { AuthUiExtras, AuthChallenge, type AuthUiMeta } from "./auth-ui-extras";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

const base: AuthUiMeta = {
  providers: [],
  challengeViews: {},
  slots: { beforeForm: [], afterForm: [], branding: [] },
};

describe("AuthUiExtras (D57)", () => {
  it("renders a labeled button for a provider without a component", () => {
    render(
      <AuthUiExtras
        authUi={{
          ...base,
          providers: [
            { strategy: "oauth-google", label: "Sign in with Google" },
          ],
        }}
      />
    );
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
  });

  it("renders a provider's custom component when supplied", () => {
    registerComponent("@p/auth#GoogleBtn", () => <div>custom-google</div>);
    render(
      <AuthUiExtras
        authUi={{
          ...base,
          providers: [
            {
              strategy: "oauth-google",
              label: "Google",
              component: "@p/auth#GoogleBtn",
            },
          ],
        }}
      />
    );
    expect(screen.getByText("custom-google")).toBeInTheDocument();
  });

  it("renders before/after-form + branding slots", () => {
    registerComponent("@p/auth#Brand", () => <div>brand-slot</div>);
    registerComponent("@p/auth#Before", () => <div>before-slot</div>);
    registerComponent("@p/auth#After", () => <div>after-slot</div>);
    render(
      <AuthUiExtras
        authUi={{
          ...base,
          slots: {
            branding: ["@p/auth#Brand"],
            beforeForm: ["@p/auth#Before"],
            afterForm: ["@p/auth#After"],
          },
        }}
      />
    );
    expect(screen.getByText("brand-slot")).toBeInTheDocument();
    expect(screen.getByText("before-slot")).toBeInTheDocument();
    expect(screen.getByText("after-slot")).toBeInTheDocument();
  });

  it("renders nothing extra for an empty auth-ui", () => {
    const { container } = render(<AuthUiExtras authUi={base} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AuthChallenge (D71)", () => {
  it("renders the registered challenge view with its props", () => {
    registerComponent(
      "@p/auth#Totp",
      (p: { challengeType: string; pendingToken: string }) => (
        <div>
          totp-view {p.challengeType} {p.pendingToken}
        </div>
      )
    );
    render(
      <AuthChallenge
        authUi={{ ...base, challengeViews: { totp: "@p/auth#Totp" } }}
        challengeType="totp"
        pendingToken="pt-123"
        onResolved={() => {}}
      />
    );
    expect(screen.getByText(/totp-view totp pt-123/)).toBeInTheDocument();
  });

  it("shows a fallback when no challenge view is registered for the type", () => {
    render(
      <AuthChallenge
        authUi={base}
        challengeType="totp"
        pendingToken="pt-123"
        onResolved={() => {}}
      />
    );
    expect(screen.getByTestId("challenge-fallback")).toBeInTheDocument();
  });
});
