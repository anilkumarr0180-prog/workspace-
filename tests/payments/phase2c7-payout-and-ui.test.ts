import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PayoutEngine } from '../../lib/services/payout-engine';

function createMockAdminDb(options: {
  timesheetStatus: string;
  existingTransfer: { id: string; status: string; gross_amount: number; fee_amount: number; net_amount: number } | null;
}) {
  const queryChain = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => {
        if (table === 'timesheets') {
          return {
            data: {
              id: 'ts-1',
              contract_id: 'c-1',
              client_id: 'cli-1',
              freelancer_id: 'free-1',
              total_amount: 500,
              total_minutes: 120,
              week_start_date: '2026-11-23',
              status: options.timesheetStatus,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      maybeSingle: async () => {
        if (table === 'payout_transfers') {
          return { data: options.existingTransfer, error: null };
        }
        if (table === 'freelancer_payout_profiles') {
          return {
            data: {
              user_id: 'free-1',
              account_id: 'acct_test_1',
              payouts_enabled: true,
              onboarding_status: 'complete',
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      then: (resolve: (val: { data: unknown[]; error: null }) => void) => {
        if (table === 'payment_ledger') {
          // Intentionally omit metadata.timesheet_id to verify top-level row.timesheet_id matching
          resolve({
            data: [{ timesheet_id: 'ts-1', currency: 'INR', event_type: 'hourly_funded', metadata: {}, status: 'succeeded' }],
            error: null,
          });
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return chain;
  };

  return {
    from: (table: string) => queryChain(table),
    rpc: async (fn: string) => {
      if (fn === 'reserve_timesheet_payout_transfer' && options.existingTransfer) {
        return {
          data: {
            reserved_by_caller: false,
            transfer_id: options.existingTransfer.id,
            status: options.existingTransfer.status,
            idempotency_key: 'payout:timesheet:ts-1:50000',
            provider_transfer_id: 'trf_existing_1',
            gross_amount: options.existingTransfer.gross_amount,
            fee_amount: options.existingTransfer.fee_amount,
            net_amount: options.existingTransfer.net_amount,
            on_hold: false,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${fn} when existing payout_transfers row is reused`);
    },
  } as unknown as SupabaseClient;
}

test('Phase 2C.7 (Unit): initiateTimesheetPayout checks existing payout_transfers before transfer dispatch and matches top-level timesheet_id', async () => {
  const engineWithCompleted = new PayoutEngine(
    createMockAdminDb({
      timesheetStatus: 'paid',
      existingTransfer: {
        id: 'tr-existing-1',
        status: 'completed',
        gross_amount: 500,
        fee_amount: 50,
        net_amount: 450,
      },
    })
  );
  // Stub eligibility check to isolate payout_transfers pre-check
  engineWithCompleted.checkFreelancerPayoutEligibility = async () => ({
    eligible: true,
    accountId: 'acct_test_1',
    status: 'complete',
  });

  const res = await engineWithCompleted.initiateTimesheetPayout('ts-1');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.transferId, 'tr-existing-1');
  assert.strictEqual(res.status, 'completed');
  assert.strictEqual(res.netAmount, 450);

  const engineUnpaid = new PayoutEngine(
    createMockAdminDb({
      timesheetStatus: 'approved',
      existingTransfer: null,
    })
  );
  const unpaidRes = await engineUnpaid.initiateTimesheetPayout('ts-1');
  assert.strictEqual(unpaidRes.success, false);
  assert.strictEqual(unpaidRes.code, 'TIMESHEET_UNPAID');
});

test('Phase 2C.7 (Source): Contract page distinguishes partial vs full Razorpay timesheet payment toast', () => {
  const pageSrc = fs.readFileSync(path.resolve(process.cwd(), 'app/contracts/[id]/page.tsx'), 'utf8');
  assert.ok(pageSrc.includes("verifyRes.timesheet?.status === 'paid'"));
  assert.ok(pageSrc.includes('Partial timesheet payment confirmed via Razorpay'));
});
