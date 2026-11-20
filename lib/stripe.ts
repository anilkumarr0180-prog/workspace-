import Stripe from 'stripe';

let cachedStripeClient: Stripe | null = null;

/**
 * Returns an authoritative Stripe client initialized with server-side secrets.
 * Throws a clear error if STRIPE_SECRET_KEY is not configured.
 */
export function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY environment variable is missing. Please configure it in your environment or Vercel dashboard.'
    );
  }

  if (!cachedStripeClient) {
    cachedStripeClient = new Stripe(secretKey, {
      apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
      appInfo: {
        name: 'Workspace Marketplace',
        version: '1.0.0',
      },
    });
  }

  return cachedStripeClient;
}

/**
 * Checks whether Stripe is configured with minimum required keys.
 */
export function isStripeConfigured(): boolean {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  return Boolean(secret && publishable);
}

/**
 * Returns public publishable key for client-side Stripe Elements initialization.
 */
export function getStripePublishableKey(): string {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || '';
}

/**
 * Returns webhook signing secret for verifying Stripe webhooks.
 */
export function getStripeWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
}

