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

export type RazorpayEnvironment = 'test' | 'live';

export interface RazorpayGatewayConfig {
  environment: RazorpayEnvironment;
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  currency: string;
  isLive: boolean;
  isTest: boolean;
}

/**
 * Validates and returns the centralized Razorpay gateway configuration.
 * Strictly prevents accidental live-mode execution, enforces environment-key prefix alignment,
 * and ensures secrets are never exposed to browser-facing contexts.
 */
export function getRazorpayConfig(customEnv?: Record<string, string | undefined>): RazorpayGatewayConfig {
  const envSource = customEnv || process.env;

  // 1. Resolve and validate environment
  const rawEnv = (envSource.RAZORPAY_ENVIRONMENT || 'test').trim().toLowerCase();
  if (rawEnv !== 'test' && rawEnv !== 'live') {
    throw new Error(
      `Invalid RAZORPAY_ENVIRONMENT "${rawEnv}". Supported environments are "test" and "live".`
    );
  }
  const environment: RazorpayEnvironment = rawEnv as RazorpayEnvironment;
  const isLive = environment === 'live';
  const isTest = environment === 'test';

  // 2. Validate API Key ID & Secret presence
  const keyId = envSource.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim();
  const keySecret = envSource.RAZORPAY_KEY_SECRET?.trim();

  if (!keyId) {
    throw new Error('Missing NEXT_PUBLIC_RAZORPAY_KEY_ID environment variable.');
  }

  if (!keySecret) {
    throw new Error('Missing RAZORPAY_KEY_SECRET environment variable.');
  }

  // 3. Environment & Key Prefix Alignment
  // Razorpay test keys strictly start with "rzp_test_"; live keys start with "rzp_live_"
  if (isTest) {
    if (keyId.startsWith('rzp_live_')) {
      throw new Error(
        'Razorpay environment mismatch: RAZORPAY_ENVIRONMENT is set to "test", but NEXT_PUBLIC_RAZORPAY_KEY_ID contains a live key ("rzp_live_...").'
      );
    }
  } else if (isLive) {
    if (keyId.startsWith('rzp_test_')) {
      throw new Error(
        'Razorpay environment mismatch: RAZORPAY_ENVIRONMENT is set to "live", but NEXT_PUBLIC_RAZORPAY_KEY_ID contains a test key ("rzp_test_...").'
      );
    }

    // Guard against placeholder secrets in live mode
    if (keySecret.toLowerCase().includes('your_') || keySecret.toLowerCase().includes('placeholder') || keySecret.length < 16) {
      throw new Error(
        'Razorpay live configuration incomplete: RAZORPAY_KEY_SECRET must be configured with genuine live credentials.'
      );
    }

    // Live mode requires dedicated webhook secret for reliable asynchronous reconciliation
    const webhookSecret = envSource.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!webhookSecret || webhookSecret.length < 8) {
      throw new Error(
        'Razorpay live configuration incomplete: RAZORPAY_WEBHOOK_SECRET is required in live mode for asynchronous payment reconciliation.'
      );
    }
  }

  const webhookSecret = envSource.RAZORPAY_WEBHOOK_SECRET?.trim() || undefined;
  const currency = (envSource.RAZORPAY_CURRENCY?.trim() || 'INR').toUpperCase();

  return {
    environment,
    keyId,
    keySecret,
    webhookSecret,
    currency,
    isLive,
    isTest,
  };
}

export function getRazorpayClient(customConfig?: RazorpayGatewayConfig): Razorpay {
  const config = customConfig || getRazorpayConfig();

  return new Razorpay({
    key_id: config.keyId,
    key_secret: config.keySecret,
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


