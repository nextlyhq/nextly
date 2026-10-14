# @nextlyhq/plugin-commerce

Commerce for [Nextly](https://nextlyhq.com): a catalogue to sell from, a cart
kept on the server, exact money, and the contracts that catalogue sources and
payment providers implement so a store can swap one for another.

## Status

`@experimental`, and not published to npm yet. It has:

- `commerce()`, the plugin: its own tables and migrations, a built-in products
  collection to sell from (or a catalogue source of the site's own), and a cart
  kept on the server behind an HTTP-only cookie, with REST routes and typed
  server functions for a storefront. See the
  [commerce docs](https://nextlyhq.com/docs/plugins/commerce).
- The money type and its allocation rule.
- The catalogue-source and payment-provider contracts, their test suites, a
  test payment provider and an in-memory catalogue source.

Checkout, orders, payments and the admin screens come later.

## Usage

### The plugin

```ts
import { defineConfig } from "nextly";
import { commerce } from "@nextlyhq/plugin-commerce";

export default defineConfig({
  plugins: [commerce({ currency: "USD" })],
});
```

### Money

Every amount is a whole number of the currency's minor unit with its ISO 4217
code, never a floating-point number of dollars.

```ts
import {
  add,
  allocate,
  money,
  toDecimalString,
} from "@nextlyhq/plugin-commerce";

const subtotal = add(money(129_900, "USD"), money(4_500, "USD")); // $1,344.00
toDecimalString(subtotal); // "1344.00"

// Spread $10.00 of tax over two lines in proportion to their totals. The parts
// always add up to exactly the total (largest-remainder rule).
allocate(money(1_000, "USD"), [129_900, 4_500]); // [967, 33] cents
```

Combining two currencies, a fractional amount or a fractional factor throws a
`NextlyError` (`COMMERCE_CURRENCY_MISMATCH`, `COMMERCE_INVALID_AMOUNT`) rather
than guessing.

### Writing a payment provider

A payment provider plugin implements `PaymentProvider`: it declares its
capabilities, and implements `start`, `confirm`, `read`, `findByReference` and
`verifyWebhook`, plus `capture`, `cancel` and `refund` with
`findRefundByReference` exactly when it declares them.

Every call that changes something at the provider carries an `operationId`,
commerce's own identifier for the operation, which the provider uses as its
idempotency key: a repeat with the same request returns the first answer, and
a different request under the same key is refused with
`COMMERCE_OPERATION_KEY_REUSED`.

Prove a provider against the contract by running its suite in your tests.
Here the suite runs against the test provider this package ships; a provider
plugin passes its own provider, a signer for its own webhook scheme, and its
test mode's payment methods (for Stripe, `pm_card_visa` and
`pm_card_chargeDeclined`):

```ts
import {
  createTestPaymentProvider,
  paymentProviderContract,
  TEST_PAYMENT_METHODS,
} from "@nextlyhq/plugin-commerce/testing";
import { describe, it } from "vitest";

describe("the test provider meets the payment contract", async () => {
  const cases = await paymentProviderContract({
    create() {
      const { provider, control } = createTestPaymentProvider();
      return { provider, signWebhook: control.signWebhook };
    },
    currency: "USD",
    amount: 2500,
    paymentMethods: {
      succeeds: TEST_PAYMENT_METHODS.succeeds,
      declines: TEST_PAYMENT_METHODS.declines,
    },
  });
  for (const c of cases) it(c.name, c.run);
});
```

Each case that changes something at the provider loses the answer once and
repeats the call, then checks the change happened exactly once. The suites
return plain cases, so they run under any test runner.

`catalogueSourceContract` does the same for a catalogue source.
`createTestPaymentProvider` and `createInMemoryCatalogueSource` are reference
implementations that pass both suites, for tests that need a provider or a
catalogue.

## Related packages

- [`@nextlyhq/plugin-sdk`](../plugin-sdk): the plugin authoring surface this
  package builds on.
- [`nextly`](../nextly): the core.

## License

MIT
