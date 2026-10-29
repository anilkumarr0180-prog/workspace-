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

function formatKnownGatewayError(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'authentication failed') {
    return 'Razorpay Gateway Authentication Failed: Your Razorpay Key ID and Key Secret do not match or are invalid in server environment variables.';
  }
  return trimmed;
}

/**
 * Safely extracts human-readable error messages from diverse error types:
 * - Standard Error instances (err.message)
 * - Razorpay SDK normalized error objects ({ error: { description: '...' } } or { error: { message: '...' } })
 * - Direct object shapes ({ message: '...' } or { description: '...' })
 * - String errors
 * Sanitizes against accidental token/secret exposure and falls back to a safe default.
 */
export function extractPaymentErrorMessage(err: unknown, fallbackMessage: string): string {
  if (!err) {
    return fallbackMessage;
  }

  if (err instanceof Error) {
    return err.message && err.message.trim() ? formatKnownGatewayError(err.message) : fallbackMessage;
  }

  if (typeof err === 'string' && err.trim().length > 0) {
    return formatKnownGatewayError(err);
  }

  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;

    // Razorpay SDK error structure: { statusCode: number, error: { description: string, code?: string } }
    if (obj.error && typeof obj.error === 'object' && obj.error !== null) {
      const nested = obj.error as Record<string, unknown>;
      if (typeof nested.description === 'string' && nested.description.trim().length > 0) {
        return formatKnownGatewayError(nested.description);
      }
      if (typeof nested.message === 'string' && nested.message.trim().length > 0) {
        return formatKnownGatewayError(nested.message);
      }
    }

    if (typeof obj.description === 'string' && obj.description.trim().length > 0) {
      return formatKnownGatewayError(obj.description);
    }

    if (typeof obj.message === 'string' && obj.message.trim().length > 0) {
      return formatKnownGatewayError(obj.message);
    }
  }

  return fallbackMessage;
}


