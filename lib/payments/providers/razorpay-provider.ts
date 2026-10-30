import {
  PaymentProvider,
  PaymentOrderRequest,
  PaymentOrderResponse,
  PaymentVerificationRequest,
  PaymentVerificationResult,
} from '../types';
import {
  getRazorpayClient,
  getRazorpayConfig,
  verifyRazorpayPaymentSignature,
  extractPaymentErrorMessage,
} from '@/lib/razorpay';

export class RazorpayPaymentProvider implements PaymentProvider {
  public readonly name = 'razorpay';
  public readonly environment: 'test' | 'live';

  constructor() {
    const config = getRazorpayConfig();
    this.environment = config.environment;
  }

  async createOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    try {
      const config = getRazorpayConfig();
      const razorpay = getRazorpayClient(config);

      const amountSubunits = Math.round(req.amount * 100);
      const receipt = `rcpt_${(req.milestoneId || req.timesheetId || req.contractId).slice(0, 8)}_${Date.now().toString().slice(-6)}`;

      const order = await razorpay.orders.create({
        amount: amountSubunits,
        currency: req.currency,
        receipt,
        notes: {
          contract_id: req.contractId,
          ...(req.milestoneId ? { milestone_id: req.milestoneId } : {}),
          ...(req.timesheetId ? { timesheet_id: req.timesheetId } : {}),
          client_id: req.clientId,
          environment: this.environment,
          ...(req.notes || {}),
        },
      });

      return {
        success: true,
        orderId: order.id,
        amountSubunits: Number(order.amount),
        currency: order.currency as 'INR' | 'USD',
        keyId: config.keyId,
      };
    } catch (err: unknown) {
      const message = extractPaymentErrorMessage(err, 'Failed to create payment order');
      return {
        success: false,
        orderId: '',
        amountSubunits: 0,
        currency: req.currency,
        keyId: '',
        error: message,
      };
    }
  }

  async verifyPayment(req: PaymentVerificationRequest): Promise<PaymentVerificationResult> {
    const isValidSignature = verifyRazorpayPaymentSignature(
      req.orderId,
      req.paymentId,
      req.signature
    );

    if (!isValidSignature) {
      return {
        success: false,
        paymentId: req.paymentId,
        status: 'failed',
        amountSubunits: 0,
        currency: req.expectedCurrency,
        verifiedAt: new Date().toISOString(),
        error: 'Cryptographic signature verification failed.',
      };
    }

    try {
      const config = getRazorpayConfig();
      const razorpay = getRazorpayClient(config);
      const payment = await razorpay.payments.fetch(req.paymentId);

      const status = payment.status === 'captured' ? 'captured' : 'failed';
      const amountSubunits = Number(payment.amount);

      if (status !== 'captured') {
        return {
          success: false,
          paymentId: req.paymentId,
          status: 'failed',
          amountSubunits,
          currency: (payment.currency as 'INR' | 'USD') || req.expectedCurrency,
          verifiedAt: new Date().toISOString(),
          error: `Payment status is ${payment.status}, expected captured.`,
        };
      }

      if (amountSubunits !== req.expectedAmountSubunits) {
        return {
          success: false,
          paymentId: req.paymentId,
          status: 'failed',
          amountSubunits,
          currency: req.expectedCurrency,
          verifiedAt: new Date().toISOString(),
          error: `Amount mismatch: captured ${amountSubunits}, expected ${req.expectedAmountSubunits}`,
        };
      }

      return {
        success: true,
        paymentId: req.paymentId,
        status: 'captured',
        amountSubunits,
        currency: req.expectedCurrency,
        verifiedAt: new Date().toISOString(),
      };
    } catch (apiErr: unknown) {
      const message = extractPaymentErrorMessage(apiErr, 'Communication error with Razorpay API');
      return {
        success: false,
        paymentId: req.paymentId,
        status: 'failed',
        amountSubunits: 0,
        currency: req.expectedCurrency,
        verifiedAt: new Date().toISOString(),
        error: message,
      };
    }
  }

  async fetchPaymentStatus(paymentId: string): Promise<{ status: string; amount: number; currency: string }> {
    const config = getRazorpayConfig();
    const razorpay = getRazorpayClient(config);
    const payment = await razorpay.payments.fetch(paymentId);
    return {
      status: payment.status,
      amount: Number(payment.amount) / 100,
      currency: payment.currency,
    };
  }
}
