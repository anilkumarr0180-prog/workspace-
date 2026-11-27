export interface LedgerSettlementRow {
  id?: string;
  contract_id?: string;
  timesheet_id?: string | null;
  amount: number | string;
  currency?: string;
  event_type?: string;
  status?: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AttemptSettlementRow {
  id?: string;
  contract_id?: string;
  timesheet_id?: string | null;
  billing_type?: string | null;
  amount: number | string;
  currency?: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Computes the total amount already settled for a SPECIFIC weekly timesheet.
 * Never falls back to contract-wide totals across other weeks or milestones.
 */
export function calculateTimesheetPaidAmount(params: {
  timesheetId: string;
  weekStartDate: string;
  ledgerRows: LedgerSettlementRow[];
  attemptRows?: AttemptSettlementRow[];
}): number {
  const { timesheetId, weekStartDate, ledgerRows, attemptRows = [] } = params;

  let paidFromLedger = 0;

  for (const row of ledgerRows) {
    // Only count settled/succeeded funding rows; ignore reversed, failed, or pending rows
    if (row.status && !['succeeded', 'captured', 'completed'].includes(row.status)) {
      continue;
    }

    // Never count refunds, reversals, fees, or payouts as client funding
    if (
      row.event_type &&
      ['escrow_refund', 'transfer_reversed', 'transfer_failed', 'service_fee_deducted', 'payout_disbursed', 'payout_initiated'].includes(
        row.event_type
      )
    ) {
      continue;
    }

    const meta = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<
      string,
      unknown
    >;
    const rowTsId =
      (typeof row.timesheet_id === 'string' && row.timesheet_id) ||
      (typeof meta.timesheet_id === 'string' ? meta.timesheet_id : undefined);

    if (rowTsId) {
      if (rowTsId === timesheetId) {
        paidFromLedger += Number(row.amount || 0);
      }
      continue;
    }

    // Legacy hourly rows without timesheet_id: only match hourly/timesheet entries for the exact week
    const isHourlyEvent =
      row.event_type === 'hourly_funded' ||
      meta.type === 'hourly_timesheet' ||
      (typeof row.description === 'string' && row.description.startsWith('Hourly Invoice'));

    if (!isHourlyEvent) {
      continue;
    }

    const weekMatch =
      typeof row.description === 'string' ? row.description.match(/\b\d{4}-\d{2}-\d{2}\b/) : null;
    const weekKey = weekMatch
      ? weekMatch[0]
      : typeof meta.week_start_date === 'string'
      ? meta.week_start_date
      : undefined;

    if (weekKey === weekStartDate) {
      paidFromLedger += Number(row.amount || 0);
    }
  }

  if (paidFromLedger > 0) {
    return Math.round(paidFromLedger * 100) / 100;
  }

  // Fallback to captured payment_attempts ONLY if they explicitly belong to this timesheet/week
  let paidFromAttempts = 0;
  for (const att of attemptRows) {
    const meta = (att.metadata && typeof att.metadata === 'object' ? att.metadata : {}) as Record<
      string,
      unknown
    >;
    const attTsId =
      (typeof att.timesheet_id === 'string' && att.timesheet_id) ||
      (typeof meta.timesheet_id === 'string' ? meta.timesheet_id : undefined);

    if (attTsId) {
      if (attTsId === timesheetId) {
        paidFromAttempts += Number(att.amount || 0);
      }
      continue;
    }

    if (att.billing_type === 'timesheet' && meta.week_start_date === weekStartDate) {
      paidFromAttempts += Number(att.amount || 0);
    }
  }

  return Math.round(paidFromAttempts * 100) / 100;
}

/**
 * Validates that the authenticated user is authorized as the client for a timesheet.
 */
export function isClientAuthorizedForTimesheet(params: {
  userId: string;
  timesheetClientId: string;
  contractClientId?: string | null;
  companyMemberRole?: string | null;
}): boolean {
  const { userId, timesheetClientId, contractClientId, companyMemberRole } = params;
  if (!userId) return false;
  if (userId === timesheetClientId || (contractClientId && userId === contractClientId)) {
    return true;
  }
  if (companyMemberRole && ['owner', 'admin', 'hiring_manager'].includes(companyMemberRole)) {
    return true;
  }
  return false;
}

/**
 * Validates captured Stripe payment amount and currency against server-calculated balance due.
 * Allows +/- 1 cent rounding tolerance; rejects underpayments, unexpected overpayments, and currency mismatches.
 */
export function validateStripeTimesheetCapture(params: {
  capturedCents: number;
  capturedCurrency: string;
  expectedBalanceDue: number;
  expectedCurrency?: string;
}): { valid: boolean; error?: string; code?: string } {
  const {
    capturedCents,
    capturedCurrency,
    expectedBalanceDue,
    expectedCurrency = 'USD',
  } = params;

  if (!capturedCurrency || capturedCurrency.toUpperCase() !== expectedCurrency.toUpperCase()) {
    return {
      valid: false,
      error: `Currency mismatch: expected ${expectedCurrency.toUpperCase()}, received ${capturedCurrency || 'unknown'}.`,
      code: 'CURRENCY_MISMATCH',
    };
  }

  if (!Number.isFinite(expectedBalanceDue) || expectedBalanceDue <= 0) {
    return {
      valid: false,
      error: 'No outstanding balance due on this timesheet.',
      code: 'NO_BALANCE_DUE',
    };
  }

  const expectedCents = Math.round(expectedBalanceDue * 100);
  if (!Number.isFinite(capturedCents) || capturedCents < expectedCents - 1) {
    return {
      valid: false,
      error: `Underpayment detected: expected ${expectedCents} cents, captured ${capturedCents} cents.`,
      code: 'UNDERPAYMENT',
    };
  }

  if (capturedCents > expectedCents + 1) {
    return {
      valid: false,
      error: `Overpayment detected: expected ${expectedCents} cents, captured ${capturedCents} cents.`,
      code: 'OVERPAYMENT',
    };
  }

  return { valid: true };
}
