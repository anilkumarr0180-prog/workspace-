/**
 * Provider-Independent Payment & Transfer Architecture Interfaces
 * Defines contracts for Client Payment, Marketplace Transfers, Refunds, and Payouts.
 */

export type CurrencyCode = 'INR' | 'USD';

export type PayoutStatus =
  | 'pending'
  | 'eligible'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'reversed'
  | 'on_hold';

export type AccountStatus =
  | 'created'
  | 'under_review'
  | 'needs_clarification'
  | 'activated'
  | 'suspended';

export interface PlatformFeeBreakdown {
  grossAmount: number;
  feeRate: number; // e.g. 0.10 for 10%
  feeAmount: number;
  netPayout: number;
  currency: CurrencyCode;
  grossSubunits: number;
  feeSubunits: number;
  netSubunits: number;
}

// -----------------------------------------------------------------------------
// 1. Client Payment Provider Interface
// -----------------------------------------------------------------------------

export interface PaymentOrderRequest {
  contractId: string;
  milestoneId?: string;
  timesheetId?: string;
  clientId: string;
  amount: number; // major units (e.g., 1000.00)
  currency: CurrencyCode;
  notes?: Record<string, string>;
}

export interface PaymentOrderResponse {
  success: boolean;
  orderId: string;
  amountSubunits: number;
  currency: CurrencyCode;
  keyId: string;
  error?: string;
}

export interface PaymentVerificationRequest {
  orderId: string;
  paymentId: string;
  signature: string;
  expectedAmountSubunits: number;
  expectedCurrency: CurrencyCode;
}

export interface PaymentVerificationResult {
  success: boolean;
  paymentId: string;
  status: 'captured' | 'failed' | 'authorized';
  amountSubunits: number;
  currency: CurrencyCode;
  verifiedAt: string;
  error?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly environment: 'test' | 'live';
  createOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse>;
  verifyPayment(req: PaymentVerificationRequest): Promise<PaymentVerificationResult>;
  fetchPaymentStatus(paymentId: string): Promise<{ status: string; amount: number; currency: string }>;
}

// -----------------------------------------------------------------------------
// 2. Marketplace Transfer Provider Interface (Route / Split Transfers)
// -----------------------------------------------------------------------------

export interface CreateTransferRequest {
  paymentId: string;
  destinationAccountId: string;
  amount: number; // Net amount to transfer (major units)
  currency: CurrencyCode;
  onHold?: boolean;
  idempotencyKey: string;
  notes?: Record<string, string>;
}

export interface TransferResponse {
  success: boolean;
  transferId: string;
  destinationAccountId: string;
  amount: number;
  currency: CurrencyCode;
  onHold: boolean;
  status: 'pending' | 'processed' | 'failed';
  createdAt: string;
  isSimulated: boolean;
  error?: string;
}

export interface ReleaseTransferRequest {
  transferId: string;
  idempotencyKey?: string;
}

export interface ReverseTransferRequest {
  transferId: string;
  amount?: number; // Optional partial amount; defaults to full
  currency?: CurrencyCode;
  reason?: string;
}

export interface TransferReversalResponse {
  success: boolean;
  reversalId: string;
  transferId: string;
  amount: number;
  currency: CurrencyCode;
  status: 'processed' | 'failed';
  isSimulated: boolean;
  error?: string;
}

export interface TransferProvider {
  readonly name: string;
  createTransfer(req: CreateTransferRequest): Promise<TransferResponse>;
  releaseTransfer(req: ReleaseTransferRequest): Promise<TransferResponse>;
  reverseTransfer(req: ReverseTransferRequest): Promise<TransferReversalResponse>;
  fetchTransfer(transferId: string): Promise<TransferResponse>;
}

// -----------------------------------------------------------------------------
// 3. Refund Provider Interface
// -----------------------------------------------------------------------------

export interface CreateRefundRequest {
  paymentId: string;
  amount?: number; // Major units; if omitted, full refund
  reverseAllTransfers?: boolean;
  notes?: Record<string, string>;
}

export interface RefundResponse {
  success: boolean;
  refundId: string;
  paymentId: string;
  amount: number;
  currency: CurrencyCode;
  status: 'processed' | 'pending' | 'failed';
  isSimulated: boolean;
  error?: string;
}

export interface RefundProvider {
  readonly name: string;
  createRefund(req: CreateRefundRequest): Promise<RefundResponse>;
}

// -----------------------------------------------------------------------------
// 4. Payout Provider Interface (Linked Account Onboarding & Verification)
// -----------------------------------------------------------------------------

export interface CreatePayoutAccountRequest {
  userId: string;
  email: string;
  legalName: string;
  businessType?: 'individual' | 'business';
  phone?: string;
  bankName: string;
  bankIfsc: string;
  accountNumberMasked: string;
  panMasked: string;
}

export interface PayoutAccountResponse {
  success: boolean;
  accountId: string;
  status: AccountStatus;
  payoutEligible: boolean;
  isSimulated: boolean;
  error?: string;
}

export interface PayoutProvider {
  readonly name: string;
  createPayoutAccount(req: CreatePayoutAccountRequest): Promise<PayoutAccountResponse>;
  getPayoutAccountStatus(accountId: string): Promise<{ status: AccountStatus; payoutEligible: boolean }>;
}
