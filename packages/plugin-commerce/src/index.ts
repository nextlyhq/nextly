/**
 * `@nextlyhq/plugin-commerce`: commerce for Nextly.
 *
 * The plugin, `commerce()`, with its own tables, a built-in products
 * catalogue, the server-side cart and the storefront's routes and typed
 * functions; and beneath it money held exactly, and the catalogue-source and
 * payment-provider contracts that provider plugins implement. Their test
 * suites, a test payment provider and an in-memory catalogue source are at
 * `@nextlyhq/plugin-commerce/testing`.
 *
 * Everything here is `@experimental` until the plugin graduates.
 *
 * @module index
 */
export { commerce, type CommerceOptions } from "./plugin";
export {
  commerceServer,
  commerceServices,
  type CommerceServer,
} from "./storefront/server";
export type {
  CartCookieAction,
  CartResult,
  CartService,
} from "./cart/cart-service";
export type { CartLineAvailability, CartLineView, CartView } from "./cart/view";
export {
  cartCookieHeader,
  cartCookieName,
  clearCartCookieHeader,
  readCartToken,
} from "./cart/token";
export type {
  CatalogueItemView,
  CataloguePageView,
  CatalogueService,
} from "./storefront/catalogue-service";
export { productsCollection } from "./catalogue/products-collection";
export {
  createProductsSource,
  type ProductsSourceOptions,
} from "./catalogue/products-source";

export { commerceError, type CommerceErrorCode } from "./errors";

export { assertCurrency, isCurrencyCode, minorUnits } from "./money/currency";
export {
  add,
  assertMoney,
  assertSameCurrency,
  compare,
  equals,
  isMoney,
  money,
  moneySchema,
  multiply,
  negate,
  subtract,
  sum,
  type Money,
} from "./money/money";
export { allocate } from "./money/allocate";
export { fromDecimalString, toDecimalString } from "./money/decimal";

export {
  assertOperationId,
  operationIdSchema,
  type OperationId,
} from "./contracts/operation";
export {
  assertPaymentProvider,
  parseProviderAnswer,
  parseStartPaymentInput,
  paymentAmountRefusal,
  paymentProviderCapabilitiesSchema,
  providerPaymentSchema,
  providerRefundSchema,
  providerWebhookEventSchema,
  requirePaymentAmount,
  requirePaymentOperation,
  startPaymentInputSchema,
  startProviderPayment,
  supportedPaymentOperations,
  supportsPaymentOperation,
  type ConfirmPaymentInput,
  type PaymentOperation,
  type PaymentOperationInput,
  type PaymentProvider,
  type PaymentProviderCapabilities,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderRefund,
  type ProviderWebhookEvent,
  type RefundPaymentInput,
  type StartPaymentInput,
  type WebhookInput,
} from "./contracts/payment-provider";
export {
  assertCatalogueSource,
  catalogueItemSchema,
  pricedLineSchema,
  stockReportSchema,
  type CatalogueItem,
  type CataloguePrice,
  type CatalogueSource,
  type CatalogueStock,
  type CatalogueStockListener,
  type PricedLine,
  type StockReport,
} from "./contracts/catalogue-source";
