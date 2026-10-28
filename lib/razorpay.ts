import Razorpay from 'razorpay';
import crypto from 'crypto';

/**
 * Razorpay Test Mode server-side helper and signature verification utilities.
 * Ensures credentials remain strictly on the server and signatures are verified with constant-time equality.
 */

export interface RazorpayOrderResult {
  id: string;
  amount: number; // in sub-units (paise/cents)
  currency: string;
  receipt?: string;
  status: string;
  notes?: Record<string, string>;
}

export function getRazorpayClient(): Razorpay {
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keyId.trim()) {
    throw new Error('Missing NEXT_PUBLIC_RAZORPAY_KEY_ID environment variable.');
  }

  if (!keySecret || !keySecret.trim()) {
    throw new Error('Missing RAZORPAY_KEY_SECRET environment variable.');
  }

  return new Razorpay({
    key_id: keyId.trim(),
    key_secret: keySecret.trim(),
  });
}

/**
 * Verify Razorpay payment signature returned by Checkout.js modal upon payment completion.
 * Computes HMAC-SHA256 of `${orderId}|${paymentId}` and validates against razorpaySignature.
 */
export function verifyRazorpayPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret || !keySecret.trim()) {
    throw new Error('Missing RAZORPAY_KEY_SECRET environment variable for signature verification.');
  }

  if (!orderId || !paymentId || !signature) {
    return false;
  }

  try {
    const payload = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret.trim())
      .update(payload)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch (err) {
    console.error('Error during Razorpay signature verification:', err);
    return false;
  }
}

/**
 * Check if the dedicated Razorpay webhook secret is configured.
 */
export function isRazorpayWebhookConfigured(): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  return Boolean(secret && secret.trim().length > 0);
}

/**
 * Verify Razorpay Webhook signature against raw request body using ONLY the dedicated webhook secret.
 * Never falls back to RAZORPAY_KEY_SECRET.
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string,
  secret?: string
): boolean {
  const webhookSecret = secret || process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret || !webhookSecret.trim()) {
    return false;
  }

  if (!rawBody || !signature) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret.trim())
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch (err) {
    console.error('Error during Razorpay webhook verification:', err);
    return false;
  }
}

