import { z } from "zod";

import { commerceError } from "../errors";

/**
 * ISO 4217 currencies whose minor unit is not two decimal places. Every other
 * currency a store can sell in has two.
 *
 * Kept as an explicit table rather than read from `Intl`, because the CLDR data
 * behind `Intl.NumberFormat` gives display digits, which differ from ISO 4217's
 * minor units for several currencies (for example IQD, where CLDR shows 0
 * decimals and ISO 4217 defines 3). An amount is stored in ISO's minor unit,
 * the unit payment providers charge in.
 */
const MINOR_UNITS_NOT_TWO: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

/**
 * ISO 4217 codes that are not money a store sells in: precious metals, units
 * of account and fund codes (CLF, UYI, UYW and the like, which some countries
 * use for indexation, not for payment), the testing code and "no currency".
 */
const NOT_A_SALES_CURRENCY: ReadonlySet<string> = new Set([
  "BOV",
  "CHE",
  "CHW",
  "CLF",
  "COU",
  "MXV",
  "USN",
  "UYI",
  "UYW",
  "XAG",
  "XAU",
  "XBA",
  "XBB",
  "XBC",
  "XBD",
  "XDR",
  "XPD",
  "XPT",
  "XSU",
  "XTS",
  "XUA",
  "XXX",
]);

/**
 * ISO 4217 currencies introduced recently enough that some supported Node
 * versions' locale data lacks them (VED was missing from Node 24.21's ICU
 * 78.3, read 2026-10-13). Listed so a store's currency is accepted on every
 * supported Node version alike.
 */
const RECENT_ISO_CODES: readonly string[] = [
  "MRU",
  "SLE",
  "STN",
  "VED",
  "VES",
  "XCG",
  "ZWG",
];

/**
 * The currency codes accepted as real ISO 4217 codes: the running engine's
 * own list, which tracks the standard without a hand-kept copy of every
 * currency, plus the recent codes above. The minor unit still comes from the
 * table above, never from `Intl`.
 */
let knownCodes: ReadonlySet<string> | undefined;
function engineCurrencyCodes(): ReadonlySet<string> {
  knownCodes ??= new Set([
    ...Intl.supportedValuesOf("currency"),
    ...RECENT_ISO_CODES,
  ]);
  return knownCodes;
}

/**
 * Whether `code` is an ISO 4217 currency a store can sell in, written as the
 * standard writes it: three upper-case letters.
 *
 * @experimental
 */
export function isCurrencyCode(code: unknown): code is string {
  return (
    typeof code === "string" &&
    /^[A-Z]{3}$/.test(code) &&
    !NOT_A_SALES_CURRENCY.has(code) &&
    engineCurrencyCodes().has(code)
  );
}

/**
 * A currency code arriving from outside, held to `isCurrencyCode`: an
 * amount's currency and a provider's declared currencies are one test.
 */
export const currencyCodeSchema = z.string().refine(isCurrencyCode, {
  message: "a currency is an ISO 4217 sales currency code",
});

/**
 * The number of decimal places in `currency`'s minor unit: 2 for USD (cents),
 * 0 for JPY, 3 for KWD.
 *
 * @experimental
 * @throws `COMMERCE_UNKNOWN_CURRENCY` when `currency` is not a sales currency.
 */
export function minorUnits(currency: string): number {
  assertCurrency(currency);
  return MINOR_UNITS_NOT_TWO[currency] ?? 2;
}

/**
 * Refuse anything that is not a sales currency code.
 *
 * @experimental
 */
export function assertCurrency(currency: unknown): asserts currency is string {
  if (!isCurrencyCode(currency)) {
    throw commerceError("COMMERCE_UNKNOWN_CURRENCY", {
      currency:
        typeof currency === "string" ? currency.slice(0, 16) : typeof currency,
    });
  }
}
