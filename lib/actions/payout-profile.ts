'use server';

import { createClient } from '@/lib/supabase/server';
import { getPayoutProvider } from '@/lib/payments/registry';
import { AccountStatus } from '@/lib/payments/types';

export interface FreelancerPayoutProfileData {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  accountStatus: AccountStatus;
  legalName: string;
  businessType: 'individual' | 'business';
  panMasked: string;
  bankAccountMasked: string;
  bankIfsc: string;
  bankName: string;
  payoutEligible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutProfileResult {
  success: boolean;
  profile?: FreelancerPayoutProfileData;
  error?: string;
  code?: string;
}

export interface SetupPayoutProfileInput {
  legalName: string;
  bankName: string;
  bankIfsc: string;
  accountNumber: string; // Fictional test account number (e.g. "987654321099")
  panNumber: string;     // Fictional test PAN (e.g. "ABCDE1234F")
  businessType?: 'individual' | 'business';
}

/**
 * Fetches the active freelancer payout profile for the authenticated user or specified user.
 */
export async function getFreelancerPayoutProfile(userId?: string): Promise<PayoutProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' };
  }

  const targetUserId = userId || user.id;

  try {
    const { data, error } = await supabase
      .from('freelancer_payout_profiles')
      .select('*')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    if (!data) {
      return { success: true, profile: undefined };
    }

    return {
      success: true,
      profile: {
        id: data.id,
        userId: data.user_id,
        provider: data.provider,
        providerAccountId: data.provider_account_id,
        accountStatus: data.account_status as AccountStatus,
        legalName: data.legal_name,
        businessType: data.business_type as 'individual' | 'business',
        panMasked: data.pan_last4 ? `XXXXX${data.pan_last4}` : '',
        bankAccountMasked: data.bank_account_last4 ? `XXXXXX${data.bank_account_last4}` : '',
        bankIfsc: data.bank_ifsc || '',
        bankName: data.bank_name || '',
        payoutEligible: Boolean(data.payout_eligible),
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve payout profile.';
    return { success: false, error: message };
  }
}

/**
 * Sets up or updates the freelancer's simulated linked account for marketplace payouts.
 * Uses fictional test data; never stores raw sensitive KYC credentials.
 */
export async function setupFreelancerPayoutProfile(
  input: SetupPayoutProfileInput
): Promise<PayoutProfileResult> {
  if (!input.legalName || input.legalName.trim().length < 2) {
    return { success: false, error: 'Legal name must be at least 2 characters.', code: 'INVALID_INPUT' };
  }

  if (!input.bankName || !input.bankIfsc || !input.accountNumber) {
    return { success: false, error: 'Complete bank account details are required.', code: 'INVALID_INPUT' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' };
  }

  try {
    // 1. Register with MockRouteProvider to get realistic account identifier
    const payoutProvider = getPayoutProvider();
    const panLast4 = input.panNumber.trim().slice(-4) || '9999';
    const accLast4 = input.accountNumber.trim().slice(-4) || '1234';

    const providerRes = await payoutProvider.createPayoutAccount({
      userId: user.id,
      email: user.email || 'freelancer@example.com',
      legalName: input.legalName.trim(),
      businessType: input.businessType || 'individual',
      bankName: input.bankName.trim(),
      bankIfsc: input.bankIfsc.trim().toUpperCase(),
      accountNumberMasked: `XXXXXX${accLast4}`,
      panMasked: `XXXXX${panLast4}`,
    });

    if (!providerRes.success) {
      return { success: false, error: providerRes.error || 'Provider rejected linked account registration.' };
    }

    // 2. Persist in database via secure stored procedure
    const { data, error } = await supabase.rpc('setup_freelancer_payout_profile', {
      p_user_id: user.id,
      p_legal_name: input.legalName.trim(),
      p_bank_name: input.bankName.trim(),
      p_bank_ifsc: input.bankIfsc.trim().toUpperCase(),
      p_account_number_masked: `XXXXXX${accLast4}`,
      p_pan_masked: `XXXXX${panLast4}`,
      p_business_type: input.businessType || 'individual',
      p_provider_account_id: providerRes.accountId,
    });

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    return {
      success: true,
      profile: {
        id: data.id,
        userId: data.user_id,
        provider: data.provider,
        providerAccountId: data.provider_account_id,
        accountStatus: data.account_status as AccountStatus,
        legalName: data.legal_name,
        businessType: data.business_type as 'individual' | 'business',
        panMasked: `XXXXX${data.pan_last4}`,
        bankAccountMasked: `XXXXXX${data.bank_account_last4}`,
        bankIfsc: data.bank_ifsc,
        bankName: data.bank_name,
        payoutEligible: Boolean(data.payout_eligible),
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to configure payout profile.';
    return { success: false, error: message };
  }
}

export interface PayoutTransferRecord {
  id: string;
  contractId: string;
  contractTitle?: string;
  milestoneId?: string | null;
  timesheetId?: string | null;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  currency: string;
  status: string;
  providerTransferId: string;
  providerAccountId: string;
  settledAt?: string | null;
  createdAt: string;
}

/**
 * Retrieves payout transfer history for the authenticated freelancer.
 */
export async function getFreelancerPayoutHistory(): Promise<{
  success: boolean;
  transfers: PayoutTransferRecord[];
  summary: {
    totalPaid: number;
    pendingPayout: number;
    totalTransfers: number;
  };
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      transfers: [],
      summary: { totalPaid: 0, pendingPayout: 0, totalTransfers: 0 },
      error: 'Authentication required.',
    };
  }

  try {
    const { data, error } = await supabase
      .from('payout_transfers')
      .select(`
        id,
        contract_id,
        milestone_id,
        timesheet_id,
        recipient_user_id,
        provider,
        provider_transfer_id,
        provider_account_id,
        gross_amount,
        fee_amount,
        net_amount,
        currency,
        on_hold,
        status,
        settled_at,
        created_at,
        contracts (title)
      `)
      .eq('recipient_user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return {
        success: false,
        transfers: [],
        summary: { totalPaid: 0, pendingPayout: 0, totalTransfers: 0 },
        error: error.message,
      };
    }

    interface RawTransferRow {
      id: string;
      contract_id: string;
      milestone_id: string | null;
      timesheet_id: string | null;
      provider_transfer_id: string;
      provider_account_id: string;
      gross_amount: number | string;
      fee_amount: number | string;
      net_amount: number | string;
      currency: string;
      status: string;
      settled_at: string | null;
      created_at: string;
      contracts?: { title?: string } | Array<{ title?: string }> | null;
    }

    let totalPaid = 0;
    let pendingPayout = 0;

    const transfers: PayoutTransferRecord[] = ((data as unknown as RawTransferRow[]) || []).map((t) => {
      const net = Number(t.net_amount) || 0;
      const gross = Number(t.gross_amount) || 0;
      const fee = Number(t.fee_amount) || 0;

      if (t.status === 'completed') {
        totalPaid += net;
      } else if (t.status === 'processing' || t.status === 'pending' || t.status === 'on_hold') {
        pendingPayout += net;
      }

      const cObj = Array.isArray(t.contracts) ? t.contracts[0] : t.contracts;

      return {
        id: t.id,
        contractId: t.contract_id,
        contractTitle: cObj?.title || 'Contract Engagement',
        milestoneId: t.milestone_id,
        timesheetId: t.timesheet_id,
        grossAmount: gross,
        feeAmount: fee,
        netAmount: net,
        currency: t.currency,
        status: t.status,
        providerTransferId: t.provider_transfer_id,
        providerAccountId: t.provider_account_id,
        settledAt: t.settled_at,
        createdAt: t.created_at,
      };
    });

    return {
      success: true,
      transfers,
      summary: {
        totalPaid: Math.round(totalPaid * 100) / 100,
        pendingPayout: Math.round(pendingPayout * 100) / 100,
        totalTransfers: transfers.length,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve payout history.';
    return {
      success: false,
      transfers: [],
      summary: { totalPaid: 0, pendingPayout: 0, totalTransfers: 0 },
      error: message,
    };
  }
}
