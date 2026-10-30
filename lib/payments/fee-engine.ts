import { CurrencyCode, PlatformFeeBreakdown } from './types';

/**
 * Platform Fee Engine
 * Centralized, authoritative calculation of marketplace platform service fees.
 * Ensures consistent 10% fee deduction, two-decimal currency rounding, and subunit conversions.
 */

export const DEFAULT_PLATFORM_FEE_RATE = 0.10; // 10% marketplace fee

export interface FeeOptions {
  feeRate?: number;
  minFee?: number;
}

/**
 * Calculates platform fee and net freelancer payout from a gross transaction amount.
 * All financial amounts are rounded to 2 decimal places to prevent fractional cent/paise drift.
 */
export function calculatePlatformFee(
  grossAmount: number,
  currency: CurrencyCode = 'INR',
  options?: FeeOptions
): PlatformFeeBreakdown {
  if (grossAmount <= 0 || !Number.isFinite(grossAmount)) {
    throw new Error(`Gross amount must be a positive finite number, received: ${grossAmount}`);
  }

  const rate = options?.feeRate !== undefined ? options.feeRate : DEFAULT_PLATFORM_FEE_RATE;
  if (rate < 0 || rate >= 1) {
    throw new Error(`Fee rate must be between 0 and 1, received: ${rate}`);
  }

  // Calculate fee with standard round-half-up to 2 decimals
  let rawFee = Number((grossAmount * rate).toFixed(2));
  if (options?.minFee !== undefined && rawFee < options.minFee) {
    rawFee = options.minFee;
  }

  // Ensure fee does not exceed gross amount
  const feeAmount = Math.min(rawFee, grossAmount);
  const netPayout = Number((grossAmount - feeAmount).toFixed(2));

  // Convert to subunits (paise or cents)
  const grossSubunits = Math.round(grossAmount * 100);
  const feeSubunits = Math.round(feeAmount * 100);
  const netSubunits = grossSubunits - feeSubunits;

  return {
    grossAmount,
    feeRate: rate,
    feeAmount,
    netPayout,
    currency,
    grossSubunits,
    feeSubunits,
    netSubunits,
  };
}
