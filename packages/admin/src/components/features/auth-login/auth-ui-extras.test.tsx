import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "../../../lib/plugins/component-registry";

import {
  AuthUiExtras,
  AuthUiExtrasAfter,
  AuthChallenge,
  type AuthUiMeta,
} from "./auth-ui-extras";

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
  it("renders a labeled button for a provider a host handler can start", () => {
    render(
      <AuthUiExtras
        authUi={{
          ...base,
          providers: [
            { strategy: "oauth-google", label: "Sign in with Google" },
          ],
        }}
        onProvider={() => undefined}
      />
    );
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
  });

  it("renders NOTHING for a plain-strategy provider with no host handler", () => {
    // Neither a component nor a path, and the host handed no handler: the
    // button would look like a way in and do nothing. Production renders
    // this component without `onProvider`, so the omission is the common
    // case, not an exotic one.
    const { container } = render(
      <AuthUiExtras
        authUi={{
          ...base,
          providers: [
            { strategy: "oauth-google", label: "Sign in with Google" },
          ],
        }}
      />
    );
    expect(screen.queryByText("Sign in with Google")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
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

  it("renders the branding and before-form slots, and not the after-form one", () => {
    // The two halves render in different places on the page. A single
    // component put every slot below the form, which made `beforeForm` a name
    // that described nothing.
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
    expect(screen.queryByText("after-slot")).not.toBeInTheDocument();
  });

  it("renders the after-form slot in its own half", () => {
    registerComponent("@p/auth#After2", () => <div>after-slot</div>);
    render(
      <AuthUiExtrasAfter
        authUi={{
          ...base,
          slots: {
            branding: [],
            beforeForm: [],
            afterForm: ["@p/auth#After2"],
          },
        }}
      />
    );
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
        resolve={async () => ({ ok: true })}
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
        resolve={async () => ({ ok: true })}
        onResolved={() => {}}
      />
    );
    expect(screen.getByTestId("challenge-fallback")).toBeInTheDocument();
  });
  it("renders a resumed challenge, which carries no token", () => {
    // The resume path is the reason the host posts the answer: there is no
    // token in the browser to hand a plugin component.
    registerComponent(
      "@p/auth#Resumed",
      (p: { challengeType: string; pendingToken?: string }) => (
        <div>
          resumed {p.challengeType} token:{String(p.pendingToken)}
        </div>
      )
    );
    render(
      <AuthChallenge
        authUi={{ ...base, challengeViews: { totp: "@p/auth#Resumed" } }}
        challengeType="totp"
        resolve={async () => ({ ok: true })}
        onResolved={() => {}}
      />
    );
    expect(
      screen.getByText(/resumed totp token:undefined/)
    ).toBeInTheDocument();
  });
});

describe("provider buttons", () => {
  it("navigates when the provider declares an href", () => {
    // Without this a plain provider button rendered and did nothing: the host
    // passes no click handler, so only providers shipping their own component
    // could ever start a sign-in.
    render(
      <AuthUiExtras
        authUi={{
          ...base,
          providers: [
            {
              strategy: "google",
              label: "Continue with Google",
              href: "/sso/google/authorize",
            },
          ],
        }}
      />
    );
    const link = screen.getByText("Continue with Google").closest("a");
    expect(link).toHaveAttribute("href", "/sso/google/authorize");
  });

  it("falls back to a button when there is no href", () => {
    const onProvider = vi.fn();
    render(
      <AuthUiExtras
        authUi={{
          ...base,
          providers: [{ strategy: "saml", label: "Company SSO" }],
        }}
        onProvider={onProvider}
      />
    );
    const button = screen.getByText("Company SSO").closest("button");
    expect(button).toBeInTheDocument();
    button?.click();
    expect(onProvider).toHaveBeenCalledWith("saml");
  });

  it("renders the plugin component when one is given, href or not", () => {
    registerComponent("@p/auth#Custom", () => <div>custom-provider</div>);
    render(
      <AuthUiExtras
        authUi={{
          ...base,
          providers: [
            {
              strategy: "google",
              label: "Continue with Google",
              component: "@p/auth#Custom",
              href: "/sso/google/authorize",
            },
          ],
        }}
      />
    );
    expect(screen.getByText("custom-provider")).toBeInTheDocument();
    expect(screen.queryByText("Continue with Google")).not.toBeInTheDocument();
  });
});
