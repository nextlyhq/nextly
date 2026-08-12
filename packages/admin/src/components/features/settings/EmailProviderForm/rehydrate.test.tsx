/**
 * A provider whose plugin comes back while its form is open.
 *
 * The record and the catalog are fetched separately, and the catalog is
 * refetched on focus. A form opened while the plugin was missing therefore
 * hydrates from a descriptor that does not exist — every configuration field
 * empty — and the catalog can then answer differently without the record
 * changing at all. Hydrating once per record is what keeps a refetch from
 * discarding typed input; it must not also keep the fields empty forever.
 */

import userEvent from "@testing-library/user-event";
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

import { EMAIL_PROVIDER_FORM_ID, EmailProviderForm } from "./EmailProviderForm";
import type { EmailProviderPayload } from "./schemas/emailProviderSchema";

const ACME: EmailProviderDescriptor = {
  type: "acme",
  label: "Acme",
  capabilities: {},
  configFields: [
    { name: "region", label: "Region", kind: "text", required: true },
  ],
};

/**
 * A second registered type that declares the SAME field name.
 *
 * This is what makes a stale value reachable. `formValuesToPayload` builds the
 * payload from the NEW descriptor's declared fields, so a value left over
 * under a name the new type does not declare is dropped on its way out and
 * cannot be submitted. A shared name has no such protection — and shared names
 * are the common case: `apiKey` is declared by both built-in API providers.
 */
const OTHER_WITH_FIELD: EmailProviderDescriptor = {
  type: "other",
  label: "Other",
  capabilities: {},
  configFields: [
    { name: "region", label: "Region", kind: "text", required: true },
  ],
};

/** A registered provider that is NOT the stored one, so the catalog is non-empty. */
const OTHER: EmailProviderDescriptor = {
  type: "other",
  label: "Other",
  capabilities: {},
  configFields: [],
};

const STORED: EmailProviderRecord = {
  id: "ep_1",
  name: "Transactional",
  type: "acme",
  fromEmail: "hello@example.com",
  fromName: "Example",
  configuration: { region: "eu-west-1" },
  isDefault: false,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function regionInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    'input[name="configuration.region"]'
  );
}

describe("the same provider, changed by someone else while the form is open", () => {
  it("takes the newer values for fields nobody is editing", async () => {
    // The detail query refetches on window focus, so a change made elsewhere
    // arrives while this form sits open. Keying hydration on the id alone
    // holds the old values and sends them back on the next save, reverting
    // that change from an edit that never touched those fields.
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()?.value).toBe("eu-west-1");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          configuration: { region: "us-east-1" },
          updatedAt: "2026-02-02T00:00:00.000Z",
        }}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()?.value).toBe("us-east-1");
  });

  it("keeps what the operator has typed", async () => {
    // The control, and the reason the identity guard existed. Reconciling must
    // not discard work in progress — a plain reset here would pass the case
    // above while wiping the field the moment the operator changed tabs.
    const user = userEvent.setup();
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    const input = regionInput();
    if (!input) throw new Error("expected the region field to render");
    await user.clear(input);
    await user.type(input, "typed-by-hand");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          configuration: { region: "us-east-1" },
          updatedAt: "2026-02-02T00:00:00.000Z",
        }}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()?.value).toBe("typed-by-hand");
  });

  it("drops configuration typed for a type the record no longer is", async () => {
    // Someone switched this provider to another type while the form sat open.
    // The value on screen was typed for the PREVIOUS provider, so keeping it
    // submits one provider's credential as another's — and overwrites what the
    // server holds for the new one.
    //
    // Asserted on the SUBMITTED PAYLOAD, not on the DOM: the rendered fields
    // come from the descriptor, so an input can disappear while its value is
    // still in form state. Only the payload separates those.
    const user = userEvent.setup();
    const submitted: EmailProviderPayload[] = [];
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    const input = regionInput();
    if (!input) throw new Error("expected the region field to render");
    await user.clear(input);
    await user.type(input, "typed-for-acme");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          type: "other",
          configuration: { region: "from-the-server" },
          updatedAt: "2026-02-02T00:00:00.000Z",
        }}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    const form = document.getElementById(EMAIL_PROVIDER_FORM_ID);
    if (!form) throw new Error("expected the form to render");
    fireEvent.submit(form);
    await waitFor(() => expect(submitted).toHaveLength(1));

    expect(submitted[0]?.type).toBe("other");
    // The server's value, not the one typed for the previous provider.
    expect(submitted[0]?.configuration).toMatchObject({
      region: "from-the-server",
    });
  });

  it("keeps a dirty IDENTITY field across a type change", async () => {
    // The control. Identity fields do not belong to a provider type, so a
    // rename in progress must survive — dropping everything dirty would be as
    // wrong as keeping everything.
    const user = userEvent.setup();
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    const name = document.querySelector<HTMLInputElement>('input[name="name"]');
    if (!name) throw new Error("expected the name field to render");
    await user.clear(name);
    await user.type(name, "Renaming In Progress");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          type: "other",
          configuration: { region: "from-the-server" },
          updatedAt: "2026-02-02T00:00:00.000Z",
        }}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(
      document.querySelector<HTMLInputElement>('input[name="name"]')?.value
    ).toBe("Renaming In Progress");
  });

  it("keeps a rename typed before the operator picked another type", async () => {
    // The operator's OWN type change, not a remote one. Replacing the
    // configuration has to leave every other field alone: the refetch below
    // keeps only values that still differ from the form's baseline, so a
    // rename folded into that baseline is overwritten by whatever the server
    // holds — an edit lost with nothing on screen to say so.
    //
    // Distinct from the remote-type-change case above. That one arrives
    // through the hydration guard; this one runs in the picker's own handler,
    // and only this one can move the baseline under a field typed by hand.
    const user = userEvent.setup();
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    const name = document.querySelector<HTMLInputElement>('input[name="name"]');
    if (!name) throw new Error("expected the name field to render");
    await user.clear(name);
    await user.type(name, "Renaming In Progress");

    await user.click(
      screen.getByRole("button", { name: OTHER_WITH_FIELD.label })
    );

    // A change made elsewhere arrives on the next focus refetch.
    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          name: "Renamed By Somebody Else",
          updatedAt: "2026-02-02T00:00:00.000Z",
        }}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(
      document.querySelector<HTMLInputElement>('input[name="name"]')?.value
    ).toBe("Renaming In Progress");
  });

  it("keeps the type the operator picked when a remote change arrives", async () => {
    // The same loss on the field the operator actually changed. A selection
    // folded into the baseline no longer differs from it, so the reconcile
    // puts the record's type back and the form silently returns to the
    // provider they had just moved away from.
    const user = userEvent.setup();
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    await user.click(
      screen.getByRole("button", { name: OTHER_WITH_FIELD.label })
    );

    // A change to an unrelated field, made elsewhere.
    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          fromName: "Changed Elsewhere",
          updatedAt: "2026-02-02T00:00:00.000Z",
        }}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    // Asserted on BOTH cards. A single assertion that the record's type is
    // deselected passes just as well on a form that lost its selection
    // entirely.
    expect(
      screen.getByRole("button", { name: OTHER_WITH_FIELD.label })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: ACME.label })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("keeps configuration typed under a picked type across TWO reconciles", async () => {
    // Two refetches, not one. The first arrives while the record still holds
    // the old type, so the configuration on screen is restored as not
    // belonging to the record. The second arrives after the record has moved
    // to the type the operator had already picked — the types now agree, so
    // nothing restores anything, and whatever stopped differing from the
    // form's baseline in between is replaced by the record's values.
    //
    // A single-refetch test cannot see this: it passes whether or not the
    // restore preserved the difference that makes the value survive.
    const user = userEvent.setup();
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    await user.click(
      screen.getByRole("button", { name: OTHER_WITH_FIELD.label })
    );

    const input = regionInput();
    if (!input) throw new Error("expected the region field to render");
    await user.clear(input);
    await user.type(input, "typed-for-other");

    // First refetch: an unrelated change, record still the old type.
    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          fromName: "Changed Elsewhere",
          updatedAt: "2026-02-02T00:00:00.000Z",
        }}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    // Second refetch: the record has moved to the type already on screen.
    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          type: "other",
          fromName: "Changed Elsewhere",
          configuration: { region: "from-the-server" },
          updatedAt: "2026-02-03T00:00:00.000Z",
        }}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()?.value).toBe("typed-for-other");
  });

  it("reconciles a change that carries the SAME timestamp", async () => {
    // MySQL stores `updated_at` as `datetime` with no fractional seconds, so
    // two writes inside one second come back indistinguishable. Keying on the
    // timestamp takes the second for the version already on screen and leaves
    // stale values that the next save writes back over the newer ones.
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()?.value).toBe("eu-west-1");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          configuration: { region: "written-in-the-same-second" },
          // Deliberately unchanged.
          updatedAt: STORED.updatedAt,
        }}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()?.value).toBe("written-in-the-same-second");
  });

  it("accepts the server's newer value after a type change reverts", async () => {
    // Rebuilding the configuration after a remote type change has to clear its
    // DIRTY mark as well as its value. Left dirty, the next refetch's
    // `keepDirtyValues` preserves this now-stale value in place of the
    // server's newer one — so the field the operator last touched silently
    // stops accepting updates.
    const user = userEvent.setup();
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    const input = regionInput();
    if (!input) throw new Error("expected the region field to render");
    await user.clear(input);
    await user.type(input, "typed-for-acme");

    // A remote type change rebuilds the configuration.
    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          type: "other",
          configuration: { region: "first-server-value" },
          updatedAt: "2026-02-02T00:00:00.000Z",
        }}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    // A later refetch of the SAME type brings a newer value.
    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{
          ...STORED,
          type: "other",
          configuration: { region: "second-server-value" },
          updatedAt: "2026-02-03T00:00:00.000Z",
        }}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()?.value).toBe("second-server-value");
  });

  it("does nothing when the record has not changed", async () => {
    // The other control. Reconciling on every refetch — rather than on a NEW
    // revision — reintroduces the reset this guard exists to prevent, and this
    // is the case that catches it.
    const user = userEvent.setup();
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    const input = regionInput();
    if (!input) throw new Error("expected the region field to render");
    await user.clear(input);
    await user.type(input, "half-typed");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={{ ...STORED }}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()?.value).toBe("half-typed");
  });
});

describe("a descriptor that gains a field while the form is open", () => {
  /**
   * The stored type, declaring one field MORE than `ACME`.
   *
   * A boolean, because it is the case with no honest empty state: a text input
   * renders blank whether it holds nothing or an empty string, while a switch
   * has to draw itself on or off and so states a position the form does not
   * hold.
   */
  const ACME_PLUS: EmailProviderDescriptor = {
    type: "acme",
    label: "Acme",
    capabilities: {},
    configFields: [
      { name: "region", label: "Region", kind: "text", required: true },
      { name: "sandbox", label: "Sandbox", kind: "boolean", default: true },
    ],
  };

  async function submittedPayload(
    payloads: EmailProviderPayload[]
  ): Promise<EmailProviderPayload | undefined> {
    const form = document.getElementById(EMAIL_PROVIDER_FORM_ID);
    if (!form) throw new Error("expected the form to render");
    fireEvent.submit(form);
    await waitFor(() => expect(payloads.length).toBeGreaterThan(0));
    return payloads[0];
  }

  it("initialises the new field instead of leaving it unset", async () => {
    // The catalog refetches on mount and on focus, so a deployment that adds a
    // configuration field to a type already in use arrives while forms are
    // open. The record has not changed, so nothing else prompts a rehydrate.
    //
    // Asserted on the SUBMITTED PAYLOAD rather than the switch. The control
    // draws its own empty state, so a switch reading "on" cannot distinguish a
    // form holding `true` from one holding nothing at all — which is the
    // disagreement being tested.
    const submitted: EmailProviderPayload[] = [];
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME_PLUS]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    expect((await submittedPayload(submitted))?.configuration).toMatchObject({
      sandbox: true,
    });
  });

  /** The OTHER type, declaring one field more than `OTHER_WITH_FIELD`. */
  const OTHER_PLUS: EmailProviderDescriptor = {
    type: "other",
    label: "Other",
    capabilities: {},
    configFields: [
      { name: "region", label: "Region", kind: "text", required: true },
      { name: "sandbox", label: "Sandbox", kind: "boolean", default: true },
    ],
  };

  it("initialises it for the type ON SCREEN, not the stored one", async () => {
    // The operator has picked a type and not saved it, so the form is showing
    // a provider the record is not. A field added to THAT type is the one that
    // needs initialising; reconciling against the record's descriptor instead
    // leaves it unset, and the switch draws a position the payload does not
    // carry.
    const user = userEvent.setup();
    const submitted: EmailProviderPayload[] = [];
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    await user.click(
      screen.getByRole("button", { name: OTHER_WITH_FIELD.label })
    );

    const input = regionInput();
    if (!input) throw new Error("expected the region field to render");
    await user.clear(input);
    await user.type(input, "typed-for-other");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME, OTHER_PLUS]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    expect((await submittedPayload(submitted))?.configuration).toMatchObject({
      region: "typed-for-other",
      sandbox: true,
    });
  });

  it("starts it from the DESCRIPTOR when the record is another provider", async () => {
    // A form showing a type its record is not. The record may still hold a
    // value at the new field's path — field names are shared across providers,
    // `apiKey` being declared by both built-in API ones — and seeding from it
    // would carry one provider's setting into another's form, where nobody
    // chose it and a save would persist it.
    //
    // The stored value has to DISAGREE with the declared default for the two
    // sources to be distinguishable at all: stored `false` against a
    // descriptor default of `true`.
    const user = userEvent.setup();
    const submitted: EmailProviderPayload[] = [];
    const storedWithSandbox: EmailProviderRecord = {
      ...STORED,
      configuration: { region: "eu-west-1", sandbox: false },
    };

    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={storedWithSandbox}
        descriptors={[ACME, OTHER_WITH_FIELD]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    await user.click(
      screen.getByRole("button", { name: OTHER_WITH_FIELD.label })
    );

    const input = regionInput();
    if (!input) throw new Error("expected the region field to render");
    await user.type(input, "typed-for-other");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={storedWithSandbox}
        descriptors={[ACME, OTHER_PLUS]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    // The new provider's declared default, not the old provider's stored value.
    expect((await submittedPayload(submitted))?.configuration).toMatchObject({
      sandbox: true,
    });
  });

  it("initialises it on a CREATE form too", async () => {
    // A create form is open across the same deployment and has no record at
    // all, so a rule that reconciles against one never runs for it.
    const user = userEvent.setup();
    const submitted: EmailProviderPayload[] = [];
    const { rerender } = render(
      <EmailProviderForm
        mode="create"
        descriptors={[ACME]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    const name = document.querySelector<HTMLInputElement>('input[name="name"]');
    const fromEmail = document.querySelector<HTMLInputElement>(
      'input[name="fromEmail"]'
    );
    const region = regionInput();
    if (!name || !fromEmail || !region) {
      throw new Error("expected the create form's fields to render");
    }
    await user.type(name, "New Provider");
    await user.type(fromEmail, "hello@example.com");
    await user.type(region, "eu-west-1");

    rerender(
      <EmailProviderForm
        mode="create"
        descriptors={[ACME_PLUS]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    expect((await submittedPayload(submitted))?.configuration).toMatchObject({
      region: "eu-west-1",
      sandbox: true,
    });
  });

  it("leaves a field being edited alone while it does so", async () => {
    // The constraint that makes the rule safe. A descriptor that RENAMES a
    // field rather than adding one arrives at a path the form already holds,
    // and initialising it would overwrite work in progress.
    //
    // Both halves are asserted together on purpose: the untouched field alone
    // passes just as well on a rule that never ran at all, which is the
    // failure this pair exists to separate.
    const user = userEvent.setup();
    const submitted: EmailProviderPayload[] = [];
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    const input = regionInput();
    if (!input) throw new Error("expected the region field to render");
    await user.clear(input);
    await user.type(input, "typed-by-hand");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME_PLUS]}
        isPending={false}
        onSubmit={payload => submitted.push(payload)}
      />
    );

    expect((await submittedPayload(submitted))?.configuration).toMatchObject({
      region: "typed-by-hand",
      sandbox: true,
    });
  });
});

describe("a catalog that starts without the stored provider's type", () => {
  it("fills the configuration once the type is registered again", () => {
    // Opened while the plugin is gone: the type is unregistered but the
    // catalog itself arrived, so the form hydrates with no descriptor.
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[OTHER]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    // Nothing to render the field from yet, and the form says why.
    expect(regionInput()).toBeNull();
    expect(screen.getByText(/not registered on this server/i)).toBeVisible();

    // The plugin is reinstalled and the next catalog refetch says so. The
    // record did not change, so nothing else prompts a rehydrate.
    rerender(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[OTHER, ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    // The field is editable again, and holds what is stored rather than a
    // blank that reads as "required credential missing" and submits as a
    // deliberate removal.
    expect(regionInput()?.value).toBe("eu-west-1");
  });

  it("does not rehydrate when the type was registered all along", async () => {
    // The control. Hydration is guarded per record precisely so a refetch
    // cannot discard typed input; a rule that reruns on every catalog change
    // would pass the test above while reintroducing that.
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    const input = regionInput();
    if (!input) throw new Error("the configuration field did not render");
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "us-east-1");

    // A catalog refetch that adds an UNRELATED provider.
    rerender(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME, OTHER]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()?.value).toBe("us-east-1");
  });
});

describe("a catalog refetch that fails over one already loaded", () => {
  it("keeps the form usable instead of replacing it", async () => {
    // The catalog refetches on mount and on window focus, so a form left open
    // over a blip fails a fetch it never asked for. TanStack Query keeps the
    // descriptors AND sets `error`, and replacing the form on the error alone
    // discards whatever had been typed — to fix nothing, since the cached
    // descriptor still renders and still validates.
    const user = userEvent.setup();
    const { rerender } = render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    const input = regionInput();
    if (!input) throw new Error("the configuration field did not render");
    await user.clear(input);
    await user.type(input, "us-east-1");

    rerender(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[ACME]}
        descriptorsError={new Error("network")}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    // Still editable, still holding the edit, and honest about what happened.
    expect(regionInput()?.value).toBe("us-east-1");
    expect(screen.getByText(/could not be refreshed/i)).toBeVisible();
  });

  it("is still fatal when there is no catalog to fall back on", () => {
    // The control. With nothing loaded the picker would be empty, which reads
    // as "this installation has no email providers".
    render(
      <EmailProviderForm
        mode="edit"
        provider={STORED}
        descriptors={[]}
        descriptorsError={new Error("network")}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(screen.getByText(/cannot be shown/i)).toBeVisible();
  });
});

describe("a create form whose chosen type leaves the catalog", () => {
  /**
   * A second provider with a field of its OWN.
   *
   * `OTHER` declares no fields, so a form reselected onto it and a form stuck
   * on a vanished type both render nothing — an assertion on absence cannot
   * tell the fixed case from the broken one. This descriptor makes the
   * reselection observable.
   */
  const FALLBACK: EmailProviderDescriptor = {
    type: "fallback",
    label: "Fallback",
    capabilities: {},
    configFields: [{ name: "endpoint", label: "Endpoint", kind: "text" }],
  };

  function endpointInput(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>(
      'input[name="configuration.endpoint"]'
    );
  }

  it("falls back to one that is still registered", async () => {
    // The catalog refetches on mount and on focus, so a create form left open
    // across a deployment that removed the chosen plugin keeps a type nothing
    // can render — no configuration section, and a submit the server refuses.
    const { rerender } = render(
      <EmailProviderForm
        mode="create"
        descriptors={[ACME, FALLBACK]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    // ACME is first, so it is the initial selection and its field renders.
    expect(regionInput()).not.toBeNull();

    rerender(
      <EmailProviderForm
        mode="create"
        descriptors={[FALLBACK]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    // Reselected onto a type that exists: ACME's field is gone AND the
    // fallback's has appeared. Asserting only the first would pass just as
    // well on a form left stuck on a vanished type.
    expect(regionInput()).toBeNull();
    expect(endpointInput()).not.toBeNull();
  });

  it("leaves a still-registered choice alone", async () => {
    // The control. A catalog refetch that merely ADDS a provider must not move
    // a selection the operator made.
    const { rerender } = render(
      <EmailProviderForm
        mode="create"
        descriptors={[ACME, FALLBACK]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()).not.toBeNull();

    rerender(
      <EmailProviderForm
        mode="create"
        descriptors={[
          ACME,
          FALLBACK,
          { ...FALLBACK, type: "third", label: "Third" },
        ]}
        isPending={false}
        onSubmit={() => {}}
      />
    );

    expect(regionInput()).not.toBeNull();
  });
});
