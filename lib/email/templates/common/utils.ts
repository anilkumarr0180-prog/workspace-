if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email template utilities cannot be loaded in the browser.');
}

/**
 * Safely escapes HTML special characters to prevent HTML/XSS injection in email clients.
 */
export function escapeHtml(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolves the canonical application base URL.
 * Never defaults to localhost in production.
 */
export function getBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.trim().replace(/\/+$/, '')}`;
  }

  return 'http://localhost:3000';
}

/**
 * Builds an absolute application URL from a relative path.
 * Protects against open-redirect protocols (e.g. javascript:, data:).
 */
export function buildAppUrl(path: string): string {
  if (!path) return getBaseUrl();
  // Strip any unexpected protocol attempts
  const sanitizedPath = path.replace(/^[a-zA-Z0-9+.-]+:/, '');
  const cleanPath = sanitizedPath.startsWith('/') ? sanitizedPath : `/${sanitizedPath}`;
  return `${getBaseUrl()}${cleanPath}`;
}

/**
 * Formats a currency amount with currency symbol or uppercase ISO code.
 */
export function formatCurrency(amount: number, currency: string = 'INR'): string {
  const code = (currency || 'INR').toUpperCase();
  const formattedNumber = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  if (code === 'INR') return `₹${formattedNumber}`;
  if (code === 'USD') return `$${formattedNumber}`;
  if (code === 'EUR') return `€${formattedNumber}`;
  if (code === 'GBP') return `£${formattedNumber}`;
  return `${code} ${formattedNumber}`;
}
