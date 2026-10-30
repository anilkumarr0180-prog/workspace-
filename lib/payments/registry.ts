import { PaymentProvider, TransferProvider, RefundProvider, PayoutProvider } from './types';
import { RazorpayPaymentProvider } from './providers/razorpay-provider';
import { MockRouteProvider } from './providers/mock-route-provider';

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
