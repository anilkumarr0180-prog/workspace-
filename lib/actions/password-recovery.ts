'use server';

import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { queueAndDispatchEmail } from '@/lib/email/queue';
import { isValidEmailAddress } from '@/lib/email/smtp-transport';

// In-memory sliding window rate-limiting for brute force & email bombing protection
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const ipRateLimits = new Map<string, RateLimitBucket>();
const emailRateLimits = new Map<string, RateLimitBucket>();

function checkRateLimit(
  map: Map<string, RateLimitBucket>,
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const bucket = map.get(key);

  if (!bucket || now > bucket.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= maxRequests) {
    return false;
  }

  bucket.count++;
  return true;
}

export interface RequestPasswordResetInput {
  email: string;
  clientIp?: string;
  userAgent?: string;
  origin?: string;
}

export interface RequestPasswordResetResult {
  success: boolean;
  message: string;
  rateLimited?: boolean;
}

export interface ExecutePasswordResetInput {
  password: string;
  tokenHash?: string;
  clientIp?: string;
  userAgent?: string;
}

export interface ExecutePasswordResetResult {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Validates password complexity according to enterprise NIST guidelines:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special symbol
 */
function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must include at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must include at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must include at least one number (0-9).' };
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return { valid: false, error: 'Password must include at least one special symbol (e.g. !@#$%^&*).' };
  }
  return { valid: true };
}

/**
 * Requests a secure password reset link.
 * Strictly adheres to anti-enumeration principles: returns identical response regardless of whether
 * the email exists in the database.
 */
export async function requestPasswordReset(
  input: RequestPasswordResetInput
): Promise<RequestPasswordResetResult> {
  const cleanEmail = (input.email || '').trim().toLowerCase();
  const genericSuccess = 'If an account exists with that email, instructions to reset your password have been sent.';

  if (!cleanEmail || !isValidEmailAddress(cleanEmail)) {
    // Return early with generic message to avoid giving syntax-based enumeration hints
    return { success: true, message: genericSuccess };
  }

  const clientIp = (input.clientIp || '127.0.0.1').split(',')[0].trim();

  // Multi-tier rate limiting:
  // 1. IP limiter: max 5 requests per 15 minutes
  if (!checkRateLimit(ipRateLimits, clientIp, 5, 15 * 60 * 1000)) {
    return {
      success: false,
      rateLimited: true,
      message: 'Too many password reset requests from this network. Please wait a few minutes before trying again.',
    };
  }

  // 2. Target email limiter: max 3 requests per 15 minutes to prevent email inbox flooding
  if (!checkRateLimit(emailRateLimits, cleanEmail, 3, 15 * 60 * 1000)) {
    // Return success message so attackers cannot discover if the email is rate-limited
    return { success: true, message: genericSuccess };
  }

  try {
    let adminClient;
    try {
      adminClient = getAdminSupabaseClient();
    } catch {
      return { success: true, message: genericSuccess };
    }

    // Resolve base origin for recovery redirect
    const appBaseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
      input.origin?.replace(/\/$/, '') ||
      'http://localhost:3000';

    const redirectTo = `${appBaseUrl}/auth/callback?type=recovery&next=/reset-password`;

    // Generate authoritative recovery token via Supabase GoTrue
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: cleanEmail,
      options: {
        redirectTo,
      },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      // User does not exist or GoTrue rejected: apply artificial jitter delay (180ms)
      // to neutralize timing attacks, then return generic success
      await new Promise((r) => setTimeout(r, 180 + Math.random() * 50));
      return { success: true, message: genericSuccess };
    }

    const tokenHash =
      linkData.properties?.hashed_token ||
      (linkData.properties as { token_hash?: string })?.token_hash;

    const actionUrl = tokenHash
      ? `${appBaseUrl}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=/reset-password`
      : linkData.properties.action_link;
    const user = linkData.user;

    // Fetch user profile name
    const { data: profile } = await adminClient
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    const recipientName =
      profile?.full_name ||
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      cleanEmail.split('@')[0];

    // Dispatch transactional password recovery email immediately
    await queueAndDispatchEmail({
      eventType: 'password_reset_request',
      templateKey: 'password_reset_v1',
      recipientEmail: cleanEmail,
      recipientUserId: user.id,
      subject: 'Reset your Workspace password',
      payload: {
        recipientName,
        email: cleanEmail,
        actionUrl,
        expiresInMinutes: 15,
        requestedIp: clientIp,
        requestedDevice: input.userAgent?.slice(0, 100) || undefined,
        accountState: 'existing_account',
      },
      relatedEntityId: user.id,
      idempotencyKey: `email:pwd_reset:${user.id}:${Date.now()}`,
      immediate: true,
    });

    return {
      success: true,
      message: genericSuccess,
    };
  } catch (err: unknown) {
    console.error('[PASSWORD RECOVERY ERROR]:', err);
    return {
      success: true,
      message: genericSuccess,
    };
  }
}

/**
 * Validates the new password, updates the user's credentials in Supabase GoTrue,
 * globally terminates all other active sessions, and dispatches a security confirmation email.
 */
export async function executePasswordReset(
  input: ExecutePasswordResetInput
): Promise<ExecutePasswordResetResult> {
  const fieldErrors: Record<string, string> = {};

  const strengthCheck = validatePasswordStrength(input.password);
  if (!strengthCheck.valid) {
    fieldErrors.password = strengthCheck.error || 'Password does not meet complexity requirements.';
    return { success: false, fieldErrors };
  }

  const supabase = await createClient();
  const adminClient = getAdminSupabaseClient();

  // 1. Identify caller user
  // If user reached /reset-password via recovery callback, they hold an active recovery session
  let targetUserId: string | null = null;
  let targetUserEmail: string | null = null;

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  if (currentUser?.id) {
    targetUserId = currentUser.id;
    targetUserEmail = currentUser.email || null;
  }

  // 2. If token_hash provided directly (cross-tab recovery)
  if (!targetUserId && input.tokenHash) {
    try {
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: input.tokenHash,
        type: 'recovery',
      });
      if (!verifyError && verifyData.user) {
        targetUserId = verifyData.user.id;
        targetUserEmail = verifyData.user.email || null;
      }
    } catch {
      // Non-blocking
    }
  }

  if (!targetUserId) {
    return {
      success: false,
      error: 'Your password reset session has expired or is invalid. Please request a new reset link.',
    };
  }

  try {
    // 3. Authoritatively update password via Admin Client
    const { data: updatedUser, error: updateErr } = await adminClient.auth.admin.updateUserById(
      targetUserId,
      {
        password: input.password,
      }
    );

    if (updateErr) {
      return {
        success: false,
        error: `Failed to update password: ${updateErr.message}`,
      };
    }

    const email = targetUserEmail || updatedUser.user?.email;
    const clientIp = (input.clientIp || '127.0.0.1').split(',')[0].trim();

    // 4. Global Session Revocation (Enterprise Security Standard)
    // Invalidate all active refresh tokens & sessions across all devices
    try {
      await adminClient.auth.admin.signOut(targetUserId, 'global');
    } catch (signOutErr) {
      console.warn('[PASSWORD RESET] Global signout notice:', signOutErr);
    }

    // Also clear session on current client
    try {
      await supabase.auth.signOut();
    } catch {
      // Non-blocking
    }

    // 5. Send Security Confirmation Notice to the user's inbox
    if (email) {
      const { data: profile } = await adminClient
        .from('profiles')
        .select('full_name')
        .eq('id', targetUserId)
        .maybeSingle();

      const recipientName =
        profile?.full_name ||
        updatedUser.user?.user_metadata?.full_name ||
        email.split('@')[0];

      await queueAndDispatchEmail({
        eventType: 'password_changed_security_alert',
        templateKey: 'password_changed_alert_v1',
        recipientEmail: email,
        recipientUserId: targetUserId,
        subject: 'Security Alert: Your Workspace password was changed',
        payload: {
          recipientName,
          email,
          changedAt: new Date().toUTCString(),
          changedIp: clientIp,
          changedDevice: input.userAgent?.slice(0, 100) || undefined,
          accountState: 'existing_account',
        },
        relatedEntityId: targetUserId,
        idempotencyKey: `email:pwd_changed:${targetUserId}:${Date.now()}`,
        immediate: true,
      }).catch((alertErr) => {
        console.warn('[PASSWORD ALERT EMAIL NOTICE]:', alertErr);
      });
    }

    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'An unexpected error occurred while resetting password.';
    return {
      success: false,
      error: errorMsg,
    };
  }
}

