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
