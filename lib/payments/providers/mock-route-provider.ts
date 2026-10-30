import {
  TransferProvider,
  RefundProvider,
  PayoutProvider,
  CreateTransferRequest,
  TransferResponse,
  ReleaseTransferRequest,
  ReverseTransferRequest,
  TransferReversalResponse,
  CreateRefundRequest,
  RefundResponse,
  CreatePayoutAccountRequest,
  PayoutAccountResponse,
  AccountStatus,
} from '../types';
import crypto from 'crypto';

interface StoredTransfer {
  id: string;
  destinationAccountId: string;
  paymentId: string;
  amount: number;
  currency: 'INR' | 'USD';
  onHold: boolean;
  status: 'pending' | 'processed' | 'failed';
  idempotencyKey: string;
  createdAt: string;
  reversedAmount: number;
  notes?: Record<string, string>;
}

interface StoredAccount {
  id: string;
  userId: string;
  legalName: string;
  status: AccountStatus;
  payoutEligible: boolean;
  createdAt: string;
}

/**
 * MockRouteProvider
 * Educational simulation of Razorpay Route marketplace capabilities:
 * - Linked accounts & simulated KYC onboarding
 * - Held transfers (on_hold: true)
 * - Transfer release (on_hold: false)
 * - Transfer reversals and client refunds
 *
 * NOTE: All operations are strictly simulated in-memory/database for learning purposes.
 * NO live bank transfers, Razorpay Route APIs, or payouts are executed.
 */
export class MockRouteProvider implements TransferProvider, RefundProvider, PayoutProvider {
  public readonly name = 'mock_route';

  // In-memory simulation registry for idempotent calls within instance lifecycle
  private accounts = new Map<string, StoredAccount>();
  private transfers = new Map<string, StoredTransfer>();
  private idempotencyMap = new Map<string, string>(); // idempotencyKey -> transferId

  /**
   * Creates a simulated linked account for marketplace onboarding.
   */
  async createPayoutAccount(req: CreatePayoutAccountRequest): Promise<PayoutAccountResponse> {
    const randomHex = crypto.randomBytes(6).toString('hex');
    const accountId = `acc_sim_${randomHex}`;

    // Fictional simulation: default to 'activated' and payout eligible for streamlined educational flow
    const stored: StoredAccount = {
      id: accountId,
      userId: req.userId,
      legalName: req.legalName,
      status: 'activated',
      payoutEligible: true,
      createdAt: new Date().toISOString(),
    };

    this.accounts.set(accountId, stored);

    return {
      success: true,
      accountId,
      status: 'activated',
      payoutEligible: true,
      isSimulated: true,
    };
  }

  /**
   * Retrieves status of a simulated linked account.
   */
  async getPayoutAccountStatus(accountId: string): Promise<{ status: AccountStatus; payoutEligible: boolean }> {
    const acc = this.accounts.get(accountId);
    if (!acc) {
      // Default to activated for pre-existing or test IDs
      return { status: 'activated', payoutEligible: true };
    }
    return { status: acc.status, payoutEligible: acc.payoutEligible };
  }

  /**
   * Creates a simulated transfer to a linked account, with optional settlement hold.
   */
  async createTransfer(req: CreateTransferRequest): Promise<TransferResponse> {
    // 1. Idempotency check
    if (this.idempotencyMap.has(req.idempotencyKey)) {
      const existingId = this.idempotencyMap.get(req.idempotencyKey)!;
      const existing = this.transfers.get(existingId);
      if (existing) {
        return {
          success: true,
          transferId: existing.id,
          destinationAccountId: existing.destinationAccountId,
          amount: existing.amount,
          currency: existing.currency,
          onHold: existing.onHold,
          status: existing.status,
          createdAt: existing.createdAt,
          isSimulated: true,
        };
      }
    }

    if (req.amount <= 0) {
      return {
        success: false,
        transferId: '',
        destinationAccountId: req.destinationAccountId,
        amount: req.amount,
        currency: req.currency,
        onHold: Boolean(req.onHold),
        status: 'failed',
        createdAt: new Date().toISOString(),
        isSimulated: true,
        error: 'Transfer amount must be greater than zero.',
      };
    }

    const transferId = `trf_sim_${crypto.randomBytes(7).toString('hex')}`;
    const createdAt = new Date().toISOString();

    const stored: StoredTransfer = {
      id: transferId,
      destinationAccountId: req.destinationAccountId,
      paymentId: req.paymentId,
      amount: req.amount,
      currency: req.currency,
      onHold: req.onHold !== false, // default true for marketplace hold
      status: 'processed',
      idempotencyKey: req.idempotencyKey,
      createdAt,
      reversedAmount: 0,
      notes: req.notes,
    };

    this.transfers.set(transferId, stored);
    this.idempotencyMap.set(req.idempotencyKey, transferId);

    return {
      success: true,
      transferId,
      destinationAccountId: req.destinationAccountId,
      amount: req.amount,
      currency: req.currency,
      onHold: stored.onHold,
      status: 'processed',
      createdAt,
      isSimulated: true,
    };
  }

  /**
   * Releases a settlement hold (PATCH /v1/transfers/:id equivalent: on_hold: false).
   */
  async releaseTransfer(req: ReleaseTransferRequest): Promise<TransferResponse> {
    const transfer = this.transfers.get(req.transferId);
    if (!transfer) {
      // Simulate successful release for unknown/reloaded ID in test runs
      return {
        success: true,
        transferId: req.transferId,
        destinationAccountId: 'acc_sim_default',
        amount: 0,
        currency: 'INR',
        onHold: false,
        status: 'processed',
        createdAt: new Date().toISOString(),
        isSimulated: true,
      };
    }

    transfer.onHold = false;
    return {
      success: true,
      transferId: transfer.id,
      destinationAccountId: transfer.destinationAccountId,
      amount: transfer.amount,
      currency: transfer.currency,
      onHold: false,
      status: 'processed',
      createdAt: transfer.createdAt,
      isSimulated: true,
    };
  }

  /**
   * Reverses a held transfer back to the primary marketplace account.
   */
  async reverseTransfer(req: ReverseTransferRequest): Promise<TransferReversalResponse> {
    const reversalId = `rvr_sim_${crypto.randomBytes(6).toString('hex')}`;
    const transfer = this.transfers.get(req.transferId);

    const reverseAmount = req.amount !== undefined ? req.amount : (transfer ? transfer.amount : 0);

    if (transfer) {
      transfer.reversedAmount += reverseAmount;
    }

    return {
      success: true,
      reversalId,
      transferId: req.transferId,
      amount: reverseAmount,
      currency: req.currency || 'INR',
      status: 'processed',
      isSimulated: true,
    };
  }

  /**
   * Simulates full or partial refund on a client payment.
   */
  async createRefund(req: CreateRefundRequest): Promise<RefundResponse> {
    const refundId = `rfnd_sim_${crypto.randomBytes(6).toString('hex')}`;
    return {
      success: true,
      refundId,
      paymentId: req.paymentId,
      amount: req.amount || 0,
      currency: 'INR',
      status: 'processed',
      isSimulated: true,
    };
  }

  /**
   * Fetches the transfer details.
   */
  async fetchTransfer(transferId: string): Promise<TransferResponse> {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return {
        success: true,
        transferId,
        destinationAccountId: 'acc_sim_fallback',
        amount: 0,
        currency: 'INR',
        onHold: false,
        status: 'processed',
        createdAt: new Date().toISOString(),
        isSimulated: true,
      };
    }

    return {
      success: true,
      transferId: transfer.id,
      destinationAccountId: transfer.destinationAccountId,
      amount: transfer.amount,
      currency: transfer.currency,
      onHold: transfer.onHold,
      status: transfer.status,
      createdAt: transfer.createdAt,
      isSimulated: true,
    };
  }
}
