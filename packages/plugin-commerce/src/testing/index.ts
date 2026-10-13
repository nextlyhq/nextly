/**
 * `@nextlyhq/plugin-commerce/testing`: the contract suites every provider
 * plugin runs, and the reference implementations they are proved against.
 *
 * Kept off the root entry so a store never loads test code. Everything here is
 * `@experimental` until the plugin graduates.
 *
 * @module testing
 */
export {
  ContractViolation,
  expectContract,
  expectRefusal,
  runContractCases,
  type ContractCase,
  type ContractRun,
} from "./contract-case";
export {
  paymentProviderContract,
  type PaymentProviderContractOptions,
  type PaymentProviderUnderTest,
} from "./payment-provider-contract";
export {
  catalogueSourceContract,
  type CatalogueSourceContractOptions,
} from "./catalogue-source-contract";
export {
  createTestPaymentProvider,
  TEST_PAYMENT_METHODS,
  TEST_SIGNATURE_HEADER,
  type TestPaymentProviderControl,
  type TestPaymentProviderOptions,
} from "./test-payment-provider";
export {
  createInMemoryCatalogueSource,
  type InMemoryCatalogueSourceControl,
  type InMemoryCatalogueSourceOptions,
} from "./in-memory-catalogue-source";
