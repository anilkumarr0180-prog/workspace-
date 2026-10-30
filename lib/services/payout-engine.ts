import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getTransferProvider } from '@/lib/payments/registry';
import { calculatePlatformFee } from '@/lib/payments/fee-engine';
import { createNotification } from '@/lib/actions/notifications';
import { PayoutStatus } from '@/lib/payments/types';

export interface PayoutEngineResult {
  success: boolean;
  transferId?: string;
  providerTransferId?: string;
  status?: PayoutStatus;
  grossAmount?: number;
  feeAmount?: number;
  netAmount?: number;
  error?: string;
  code?: string;
  eligible?: boolean;
}

/**
 * PayoutEngine
 * Orchestrates marketplace automatic payouts for fixed-price milestones and hourly timesheets.
 * Enforces:
 * - Eligibility checks before transfer creation
 * - Explicit milestone status checks (only 'approved' allowed)
 * - Centralized fee calculations
 * - Deterministic idempotency keys
 * - Delayed earnings settlement (earnings only increment when provider confirms completion)
 */
export class PayoutEngine {
  constructor(private customDb?: SupabaseClient) {}

  private getDb(): SupabaseClient {
    return this.customDb || getAdminSupabaseClient();
  }

  /**
   * Checks whether the freelancer is eligible to receive marketplace payouts.
   */
  async checkFreelancerPayoutEligibility(
    freelancerId: string
  ): Promise<{ eligible: boolean; accountId?: string; reason?: string }> {
    const adminDb = this.getDb();
    const { data: profile, error } = await adminDb
      .from('freelancer_payout_profiles')
      .select('id, provider_account_id, account_status, payout_eligible')
      .eq('user_id', freelancerId)
      .maybeSingle();

    if (error || !profile) {
      return {
        eligible: false,
        reason: 'Freelancer has not configured a payout profile.',
      };
    }

    if (profile.account_status !== 'activated' || !profile.payout_eligible) {
      return {
        eligible: false,
        reason: `Payout account status is "${profile.account_status}". Active account required.`,
      };
    }

    return {
      eligible: true,
      accountId: profile.provider_account_id,
    };
  }

  /**
   * Initiates automatic payout for an approved fixed-price milestone.
   */
  async initiateMilestonePayout(
    milestoneId: string,
    options?: { onHold?: boolean }
  ): Promise<PayoutEngineResult> {
    const adminDb = this.getDb();

    // 1. Fetch milestone details
    const { data: milestone, error: milestoneError } = await adminDb
      .from('contract_milestones')
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        amount,
        currency,
        status,
        sequence_order,
        title
      `)
      .eq('id', milestoneId)
      .single();

    if (milestoneError || !milestone) {
      return { success: false, error: 'Milestone not found.', code: 'NOT_FOUND' };
    }

    // 1b. Status verification: milestone must be approved (or already released for idempotent recovery)
    if (milestone.status === 'released') {
      const { data: existingTransfer } = await adminDb
        .from('payout_transfers')
        .select('*')
        .eq('milestone_id', milestone.id)
        .eq('status', 'completed')
        .maybeSingle();

      if (existingTransfer) {
        return {
          success: true,
          transferId: existingTransfer.id,
          providerTransferId: existingTransfer.provider_transfer_id,
          status: 'completed',
          grossAmount: Number(existingTransfer.gross_amount),
          feeAmount: Number(existingTransfer.fee_amount),
          netAmount: Number(existingTransfer.net_amount),
        };
      }

      return {
        success: true,
        status: 'completed',
        grossAmount: Number(milestone.amount),
        feeAmount: 0,
        netAmount: Number(milestone.amount),
      };
    }

    if (milestone.status !== 'approved') {
      return {
        success: false,
        error: `Milestone is in status "${milestone.status}". Only approved milestones are eligible for payout.`,
        code: 'MILESTONE_NOT_APPROVED',
      };
    }

    const grossAmount = Number(milestone.amount);
    const currency = (milestone.currency as 'INR' | 'USD') || 'INR';

    // 2. Eligibility verification
    const eligibility = await this.checkFreelancerPayoutEligibility(milestone.freelancer_id);
    if (!eligibility.eligible || !eligibility.accountId) {
      return {
        success: false,
        error: eligibility.reason || 'Freelancer is not eligible for payout.',
        code: 'PAYOUT_INELIGIBLE',
        eligible: false,
      };
    }

    // 3. Centralized platform fee calculation
    const feeBreakdown = calculatePlatformFee(grossAmount, currency);
    const idempotencyKey = `payout:milestone:${milestone.id}:${feeBreakdown.grossSubunits}`;

    // 4. Dispatch transfer via provider
    const transferProvider = getTransferProvider();
    const transferRes = await transferProvider.createTransfer({
      paymentId: `pay_milestone_${milestone.id}`,
      destinationAccountId: eligibility.accountId,
      amount: feeBreakdown.netPayout,
      currency,
      onHold: Boolean(options?.onHold),
      idempotencyKey,
      notes: {
        milestone_id: milestone.id,
        contract_id: milestone.contract_id,
        freelancer_id: milestone.freelancer_id,
      },
    });

    if (!transferRes.success) {
      return {
        success: false,
        error: transferRes.error || 'Provider rejected payout transfer.',
        code: 'TRANSFER_REJECTED',
      };
    }

    // 5. Persist transfer in database
    const { data: transferRecord, error: recordError } = await adminDb.rpc(
      'create_payout_transfer_record',
      {
        p_contract_id: milestone.contract_id,
        p_recipient_user_id: milestone.freelancer_id,
        p_gross_amount: feeBreakdown.grossAmount,
        p_fee_amount: feeBreakdown.feeAmount,
        p_net_amount: feeBreakdown.netPayout,
        p_currency: currency,
        p_idempotency_key: idempotencyKey,
        p_provider_transfer_id: transferRes.transferId,
        p_provider_account_id: eligibility.accountId,
        p_milestone_id: milestone.id,
        p_timesheet_id: null,
        p_on_hold: transferRes.onHold,
        p_metadata: {
          is_simulated: transferRes.isSimulated,
          fee_rate: feeBreakdown.feeRate,
        },
      }
    );

    if (recordError || !transferRecord) {
      return {
        success: false,
        error: `Failed to record payout transfer: ${recordError?.message || 'Unknown error'}`,
        code: 'DB_ERROR',
      };
    }

    // 6. When provider confirms completion (or for immediate test settlement):
    // Authoritatively confirm completion and update freelancer earnings!
    if (transferRes.status === 'processed') {
      const { error: confirmError } = await adminDb.rpc('confirm_payout_transfer_completion', {
        p_transfer_id: transferRecord.id,
      });

      if (confirmError) {
        return {
          success: false,
          error: `Failed to settle transfer: ${confirmError.message}`,
          code: 'SETTLEMENT_ERROR',
        };
      }

      // Notify freelancer
      createNotification({
        userId: milestone.freelancer_id,
        type: 'payment_processed',
        title: 'Payout Processed',
        message: `Payout of $${feeBreakdown.netPayout} for milestone "${milestone.title}" has been successfully transferred to your payout account.`,
        link: `/contracts/${milestone.contract_id}`,
        metadata: {
          milestoneId: milestone.id,
          contractId: milestone.contract_id,
          transferId: transferRecord.id,
          providerTransferId: transferRes.transferId,
        },
      }).catch(() => {});

      return {
        success: true,
        transferId: transferRecord.id,
        providerTransferId: transferRes.transferId,
        status: 'completed',
        grossAmount: feeBreakdown.grossAmount,
        feeAmount: feeBreakdown.feeAmount,
        netAmount: feeBreakdown.netPayout,
      };
    }

    return {
      success: true,
      transferId: transferRecord.id,
      providerTransferId: transferRes.transferId,
      status: transferRes.onHold ? 'on_hold' : 'processing',
      grossAmount: feeBreakdown.grossAmount,
      feeAmount: feeBreakdown.feeAmount,
      netAmount: feeBreakdown.netPayout,
    };
  }

  /**
   * Initiates automatic payout for a paid hourly timesheet.
   */
  async initiateTimesheetPayout(timesheetId: string): Promise<PayoutEngineResult> {
    const adminDb = this.getDb();

    // 1. Fetch timesheet details
    const { data: timesheet, error: timesheetError } = await adminDb
      .from('timesheets')
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        total_amount,
        total_minutes,
        week_start_date,
        status
      `)
      .eq('id', timesheetId)
      .single();

    if (timesheetError || !timesheet) {
      return { success: false, error: 'Timesheet not found.', code: 'NOT_FOUND' };
    }

    if (timesheet.status !== 'paid') {
      return {
        success: false,
        error: `Timesheet is in status "${timesheet.status}". Payment required before payout.`,
        code: 'TIMESHEET_UNPAID',
      };
    }

    const grossAmount = Number(timesheet.total_amount);
    const currency = 'INR';

    // 2. Eligibility verification
    const eligibility = await this.checkFreelancerPayoutEligibility(timesheet.freelancer_id);
    if (!eligibility.eligible || !eligibility.accountId) {
      return {
        success: false,
        error: eligibility.reason || 'Freelancer is not eligible for payout.',
        code: 'PAYOUT_INELIGIBLE',
        eligible: false,
      };
    }

    // 3. Centralized platform fee calculation
    const feeBreakdown = calculatePlatformFee(grossAmount, currency);
    const idempotencyKey = `payout:timesheet:${timesheet.id}:${feeBreakdown.grossSubunits}`;

    // 4. Dispatch transfer
    const transferProvider = getTransferProvider();
    const transferRes = await transferProvider.createTransfer({
      paymentId: `pay_timesheet_${timesheet.id}`,
      destinationAccountId: eligibility.accountId,
      amount: feeBreakdown.netPayout,
      currency,
      onHold: false,
      idempotencyKey,
      notes: {
        timesheet_id: timesheet.id,
        contract_id: timesheet.contract_id,
        freelancer_id: timesheet.freelancer_id,
      },
    });

    if (!transferRes.success) {
      return {
        success: false,
        error: transferRes.error || 'Provider rejected timesheet payout transfer.',
        code: 'TRANSFER_REJECTED',
      };
    }

    // 5. Persist transfer in database
    const { data: transferRecord, error: recordError } = await adminDb.rpc(
      'create_payout_transfer_record',
      {
        p_contract_id: timesheet.contract_id,
        p_recipient_user_id: timesheet.freelancer_id,
        p_gross_amount: feeBreakdown.grossAmount,
        p_fee_amount: feeBreakdown.feeAmount,
        p_net_amount: feeBreakdown.netPayout,
        p_currency: currency,
        p_idempotency_key: idempotencyKey,
        p_provider_transfer_id: transferRes.transferId,
        p_provider_account_id: eligibility.accountId,
        p_milestone_id: null,
        p_timesheet_id: timesheet.id,
        p_on_hold: false,
        p_metadata: {
          is_simulated: transferRes.isSimulated,
          week_start_date: timesheet.week_start_date,
        },
      }
    );

    if (recordError || !transferRecord) {
      return {
        success: false,
        error: `Failed to record payout transfer: ${recordError?.message || 'Unknown error'}`,
        code: 'DB_ERROR',
      };
    }

    // 6. Confirm transfer and update freelancer earnings
    const { error: confirmError } = await adminDb.rpc('confirm_payout_transfer_completion', {
      p_transfer_id: transferRecord.id,
    });

    if (confirmError) {
      return {
        success: false,
        error: `Failed to settle timesheet transfer: ${confirmError.message}`,
        code: 'SETTLEMENT_ERROR',
      };
    }

    // Notify freelancer
    createNotification({
      userId: timesheet.freelancer_id,
      type: 'payment_processed',
      title: 'Hourly Earnings Payout Settled',
      message: `Payout of $${feeBreakdown.netPayout} for timesheet week of ${timesheet.week_start_date} has been transferred.`,
      link: `/contracts/${timesheet.contract_id}`,
      metadata: {
        timesheetId: timesheet.id,
        contractId: timesheet.contract_id,
        transferId: transferRecord.id,
      },
    }).catch(() => {});

    return {
      success: true,
      transferId: transferRecord.id,
      providerTransferId: transferRes.transferId,
      status: 'completed',
      grossAmount: feeBreakdown.grossAmount,
      feeAmount: feeBreakdown.feeAmount,
      netAmount: feeBreakdown.netPayout,
    };
  }
}

export const payoutEngine = new PayoutEngine();
