import { z } from "zod";

import { commerceError } from "../errors";

/**
 * The currencies a store can sell in, by the number of decimal places in each
 * one's minor unit: ISO 4217 List One as its maintenance agency, SIX,
 * published it on 2026-09-17, less its fund codes (BOV, CHE, CHW, CLF, COU,
 * MXV, USN, UYI, UYW and XAD, used for indexation rather than payment) and the
 * codes with no minor unit (precious metals, units of account, XTS for testing
 * and XXX for "no currency").
 *
 * A copy of the standard rather than a reading of `Intl`, which follows the
 * engine's ICU data: Node 24.21's ICU 78.3 still lists withdrawn currencies
 * (HRK, BGN, ANG, SLL, ZWL, CUC), lacks a current one (VED), and gives CLDR's
 * display digits, which differ from ISO's minor units for some currencies
 * (IQD: CLDR shows none, ISO 4217 defines 3). An amount is held in ISO's minor
 * unit, the unit payment providers charge in. This changes with each
 * amendment to the list.
 */
const SALES_CURRENCIES: Readonly<Record<0 | 2 | 3, string>> = {
  0: `
    BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF
  `,
  2: `
    AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BMD BND BOB BRL BSD
    BTN BWP BYN BZD CAD CDF CHF CNY COP CRC CUP CVE CZK DKK DOP DZD EGP
    ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR
    ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL
    MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR
    NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD
    SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS
    UAH USD UYU UZS VED VES WST XCD XCG YER ZAR ZMW ZWG
  `,
  3: `
    BHD IQD JOD KWD LYD OMR TND
  `,
};

/** Each sales currency's minor unit, read from the table above. */
const MINOR_UNITS: ReadonlyMap<string, number> = new Map(
  Object.entries(SALES_CURRENCIES).flatMap(([units, codes]) =>
    codes
      .trim()
      .split(/\s+/)
      .map(code => [code, Number(units)] as const)
  )
);

/**
 * Whether `code` is an ISO 4217 currency a store can sell in, written as the
 * standard writes it: three upper-case letters.
 *
 * @experimental
 */
export function isCurrencyCode(code: unknown): code is string {
  return typeof code === "string" && MINOR_UNITS.has(code);
}

/**
 * A currency code arriving from outside, held to `isCurrencyCode`: an
 * amount's currency and a provider's declared currencies are one test.
 */
export const currencyCodeSchema: z.ZodString & z.ZodType<string, string> = z
  .string()
  .refine(isCurrencyCode, {
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
  const units = MINOR_UNITS.get(currency);
  if (units === undefined) throw unknownCurrency(currency);
  return units;
}

/**
 * Refuse anything that is not a sales currency code.
 *
 * @experimental
 */
export function assertCurrency(currency: unknown): asserts currency is string {
  if (!isCurrencyCode(currency)) throw unknownCurrency(currency);
}

function unknownCurrency(currency: unknown) {
  return commerceError("COMMERCE_UNKNOWN_CURRENCY", {
    currency:
      typeof currency === "string" ? currency.slice(0, 16) : typeof currency,
  });
}
