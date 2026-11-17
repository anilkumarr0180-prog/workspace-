import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions, SentMessageInfo } from 'nodemailer';
import type { SendEmailOptions, SendEmailResult } from './types';

// Strictly enforce server-only environment
if (typeof window !== 'undefined') {
  throw new Error('Security Violation: SMTP transport cannot be executed in the browser.');
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  requireTls?: boolean;
}

// RFC 5322 compliant email regex for input validation
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validates a single recipient email address format.
 */
export function isValidEmailAddress(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Sanitizes error messages to prevent leaking passwords, authentication tokens,
 * long hexadecimal or base64 credentials, or internal network topology.
 */
export function sanitizeSmtpError(error: unknown): string {
  if (!error) return 'Unknown SMTP delivery error';
  const raw = error instanceof Error ? error.message : String(error);

  const sanitized = raw
    // Redact 20+ character alphanumeric strings (API keys, hashes, tokens)
    .replace(/([a-zA-Z0-9_\-\.]{20,})/g, '[REDACTED]')
    // Redact passwords in key-value format (e.g. password=xyz or pass: xyz)
    .replace(/(pass(?:word)?\s*[:=]\s*)[^\s,]+/gi, '$1[REDACTED]')
    // Redact bearer tokens
    .replace(/(bearer\s+)[^\s,]+/gi, '$1[REDACTED]')
    // Redact raw auth strings
    .replace(/(auth(?:entication)?\s+failed\s*[:=]?\s*)[^\s,]+/gi, '$1[REDACTED]');

  return sanitized.slice(0, 1000);
}

/**
 * Resolves SMTP configuration from server-side environment variables.
 * In production, fails closed if mandatory configuration is missing or invalid.
 */
export function getSmtpConfig(): SmtpConfig {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: getSmtpConfig() cannot be executed in the browser.');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const host = process.env.SMTP_HOST?.trim();
  const rawPort = process.env.SMTP_PORT?.trim() || '587';
  const port = parseInt(rawPort, 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim() || process.env.SMTP_PASSWORD?.trim();
  const from =
    process.env.SMTP_FROM?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    'Workspace <notifications@workspace.com>';
  const requireTls = process.env.SMTP_REQUIRE_TLS !== 'false';

  // -------------------------------------------------------------------------
  // Strict Production Enforcement (Fail Closed)
  // -------------------------------------------------------------------------
  if (isProduction) {
    if (!host || host.includes('your_smtp_host') || host.length < 3) {
      throw new Error(
        'Configuration Violation: Missing or invalid SMTP_HOST in production. ' +
        'A valid SMTP server hostname is required for production email delivery.'
      );
    }

    if (isNaN(port) || port <= 0 || port > 65535) {
      throw new Error(
        `Configuration Violation: Invalid SMTP_PORT="${rawPort}" in production. ` +
        'Port must be a valid TCP port number between 1 and 65535.'
      );
    }

    if (!user || user.includes('your_smtp_user') || user.length < 2) {
      throw new Error(
        'Configuration Violation: Missing or invalid SMTP_USER in production. ' +
        'Authenticated SMTP credentials are required for production email delivery.'
      );
    }

    if (!pass || pass.includes('your_smtp_password') || pass.length < 2) {
      throw new Error(
        'Configuration Violation: Missing or invalid SMTP_PASS / SMTP_PASSWORD in production. ' +
        'Authenticated SMTP credentials are required for production email delivery.'
      );
    }
  } else {
    // Non-production validation: if host is set, validate port
    if (host && (isNaN(port) || port <= 0 || port > 65535)) {
      throw new Error(`Invalid SMTP_PORT: "${rawPort}". Must be a valid port number.`);
    }
  }

  return {
    host: host || '127.0.0.1',
    port: isNaN(port) ? 587 : port,
    secure,
    user: user || undefined,
    pass: pass || undefined,
    from,
    requireTls,
  };
}

let cachedTransporter: Transporter<SentMessageInfo> | null = null;
let cachedConfigFingerprint: string | null = null;

/**
 * Resets the cached transporter instance. Used primarily in test environments.
 */
export function resetCachedSmtpTransporter(): void {
  if (cachedTransporter) {
    try {
      cachedTransporter.close();
    } catch {
      // Ignore close errors
    }
    cachedTransporter = null;
    cachedConfigFingerprint = null;
  }
}

/**
 * Creates or retrieves the cached Nodemailer SMTP transporter.
 * Strictly enforces TLS certificate verification (rejectUnauthorized: true).
 */
export function getSmtpTransporter(customConfig?: SmtpConfig): Transporter<SentMessageInfo> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: SMTP transporter cannot be executed in the browser.');
  }

  const config = customConfig || getSmtpConfig();
  const fingerprint = `${config.host}:${config.port}:${config.secure}:${config.user || ''}:${config.requireTls}`;

  if (!customConfig && cachedTransporter && cachedConfigFingerprint === fingerprint) {
    return cachedTransporter;
  }

  const transportOptions = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    requireTLS: config.requireTls && !config.secure,
    tls: {
      // CRITICAL SECURITY: Never disable TLS certificate verification
      rejectUnauthorized: true,
    },
    // Serverless-friendly connection timeouts (fail fast instead of hanging Vercel lambdas)
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };

  const transporter = nodemailer.createTransport(transportOptions);

  if (!customConfig) {
    cachedTransporter = transporter;
    cachedConfigFingerprint = fingerprint;
  }

  return transporter;
}

/**
 * Verifies the SMTP connection and authentication readiness.
 * Sanitizes errors to prevent exposing raw credentials or passwords.
 */
export async function verifySmtpConnection(
  transporter?: Transporter<SentMessageInfo>
): Promise<{ success: boolean; error?: string }> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: verifySmtpConnection() cannot be executed in the browser.');
  }

  try {
    const activeTransporter = transporter || getSmtpTransporter();
    await activeTransporter.verify();
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: sanitizeSmtpError(err),
    };
  }
}

/**
 * Dispatches an email message via Nodemailer SMTP.
 * Validates recipient addresses, enforces server-controlled sender,
 * and sanitizes all error messages.
 */
export async function sendSmtpEmail(
  options: SendEmailOptions,
  transporter?: Transporter<SentMessageInfo>
): Promise<SendEmailResult> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: sendSmtpEmail() cannot be executed in the browser.');
  }

  const recipients = Array.isArray(options.to) ? options.to : [options.to];
  if (recipients.length === 0 || !recipients[0]) {
    return {
      success: false,
      provider: 'smtp',
      error: 'Recipient "to" address is required.',
    };
  }

  for (const recipient of recipients) {
    if (!isValidEmailAddress(recipient)) {
      return {
        success: false,
        provider: 'smtp',
        error: `Invalid recipient email address format: "${recipient.slice(0, 3)}***".`,
      };
    }
  }

  if (!options.subject || !options.subject.trim()) {
    return {
      success: false,
      provider: 'smtp',
      error: 'Email subject is required.',
    };
  }

  if (!options.text && !options.html) {
    return {
      success: false,
      provider: 'smtp',
      error: 'Email body (text or html) is required.',
    };
  }

  try {
    const config = getSmtpConfig();
    const activeTransporter = transporter || getSmtpTransporter();
    const serverControlledFrom = options.from || config.from;

    const mailOptions: SendMailOptions = {
      from: serverControlledFrom,
      to: recipients,
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: options.replyTo,
      headers: options.headers,
    };

    const info = await activeTransporter.sendMail(mailOptions);

    if (!info.messageId) {
      return {
        success: false,
        provider: 'smtp',
        error: 'SMTP server accepted email without returning a provider message ID.',
      };
    }

    return {
      success: true,
      provider: 'smtp',
      providerMessageId: info.messageId,
    };
  } catch (err: unknown) {
    return {
      success: false,
      provider: 'smtp',
      error: sanitizeSmtpError(err),
    };
  }
}
