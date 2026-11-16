import { PaymentProvider, TransferProvider, RefundProvider, PayoutProvider } from './types';
import { RazorpayPaymentProvider } from './providers/razorpay-provider';
import { MockRouteProvider } from './providers/mock-route-provider';

/**
 * Marketplace Payment & Payout Provider Registry
 *
 * DISCLOSURE NOTICE:
 * - Payment Gateway: Razorpay integration (Test/Live mode depending on RAZORPAY_ENVIRONMENT).
 * - Transfer / Payout Gateway: Educational SIMULATED provider (MockRouteProvider).
 *   All marketplace route transfers and linked account payouts are simulated ledger
 *   operations. No live external bank disbursements or actual payout completions are executed.
 */

// Singleton instances for marketplace providers
let cachedPaymentProvider: PaymentProvider | null = null;
let cachedMockRouteProvider: MockRouteProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!cachedPaymentProvider) {
    cachedPaymentProvider = new RazorpayPaymentProvider();
  }
  return cachedPaymentProvider;
}

export function getMockRouteProvider(): MockRouteProvider {
  if (!cachedMockRouteProvider) {
    cachedMockRouteProvider = new MockRouteProvider();
  }
  return cachedMockRouteProvider;
}

export function getTransferProvider(): TransferProvider {
  return getMockRouteProvider();
}

export function getRefundProvider(): RefundProvider {
  return getMockRouteProvider();
}

export function getPayoutProvider(): PayoutProvider {
  return getMockRouteProvider();
}

export interface PayoutProviderMetadata {
  mode: 'simulated' | 'live';
  isSimulated: boolean;
  providerName: string;
  description: string;
  supportsActualPayouts: boolean;
}

export function getPayoutProviderMetadata(): PayoutProviderMetadata {
  return {
    mode: 'simulated',
    isSimulated: true,
    providerName: 'mock_route',
    description: 'Simulated Route and Payout Provider (Test Environment). No live bank payouts are executed.',
    supportsActualPayouts: false,
  };
}
