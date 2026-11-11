import { getAdminSupabaseClient } from '../supabase/admin';
import { sendEmail } from './service';
import { hasTemplate, renderTemplate } from './templates';
import type {
  EmailAdapter,
  OutboxEmailRecord,
  ProcessOutboxBatchOptions,
  ProcessOutboxBatchResult,
  ProcessOutboxRecordResult,
} from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: OutboxProcessor cannot be executed on the client.');
}

/**
 * Sanitizes an error message before recording it in the outbox database.
 * Redacts potential credentials, API keys, and excessive text.
 */
function sanitizeErrorMessage(error: unknown): string {
  if (!error) return 'Unknown delivery error';
  const raw = error instanceof Error ? error.message : String(error);
  // Redact long alphanumeric strings (API keys, JWTs, hashes)
  const redacted = raw.replace(/([a-zA-Z0-9_\-\.]{20,})/g, '[REDACTED]');
  return redacted.slice(0, 3900);
}

/**
 * Resolves the recipient's account state using trusted server-side information only.
 * 1. Honors explicit payload state if provided.
 * 2. If recipient_user_id is present, recipient is strictly 'existing_account'.
 * 3. Defaults safely to 'unknown' if not determinable.
 */
function resolveAccountState(record: OutboxEmailRecord): 'existing_account' | 'no_account' | 'unknown' {
  const payload = (record.payload || {}) as Record<string, unknown>;
  if (
    payload.accountState === 'existing_account' ||
    payload.accountState === 'no_account' ||
    payload.accountState === 'unknown'
  ) {
    return payload.accountState;
  }

  if (record.recipient_user_id) {
    return 'existing_account';
  }

  return 'unknown';
}

/**
 * Server-side transactional outbox processor.
 * 
 * Reliability guarantees:
 * - Atomically claims eligible records via DB stored procedure `claim_outbox_emails` (FOR UPDATE SKIP LOCKED).
 * - Never increments attempts in application code (the database stored procedure strictly owns the counter).
 * - Calls `mark_outbox_email_sent` upon provider acceptance.
 * - Calls `mark_outbox_email_failed` upon delivery failure with backoff schedule.
 * - Failure of one item never halts processing of subsequent items in the batch.
 * - Does not create unmonitored background promises.
 */
export async function processOutboxBatch(
  options?: ProcessOutboxBatchOptions,
  customAdapter?: EmailAdapter
): Promise<ProcessOutboxBatchResult> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: processOutboxBatch() cannot be executed on the client.');
  }

  const batchSize = Math.max(1, Math.min(options?.batchSize ?? 10, 100));
  const workerId = options?.workerId || `worker-${process.pid}-${Date.now()}`;
  const lockTimeoutSeconds = Math.max(10, Math.min(options?.lockTimeoutSeconds ?? 300, 86400));
  const retryDelaySeconds = options?.retryDelaySeconds ?? 60;

  const supabase = getAdminSupabaseClient();

  // 1. Atomically claim eligible records via database function
  const { data: claimedRows, error: claimError } = await supabase.rpc('claim_outbox_emails', {
    p_batch_size: batchSize,
    p_worker_id: workerId,
    p_lock_timeout_seconds: lockTimeoutSeconds,
  });

  if (claimError) {
    const errorMsg = sanitizeErrorMessage(claimError);
    return {
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      suppressedCount: 0,
      results: [{ id: 'batch_claim', success: false, error: `Database claim failed: ${errorMsg}` }],
    };
  }

  const records = (claimedRows || []) as OutboxEmailRecord[];
  if (records.length === 0) {
    return {
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      suppressedCount: 0,
      results: [],
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  let suppressedCount = 0;
  const results: ProcessOutboxRecordResult[] = [];

  // 2. Process each claimed record sequentially and safely
  for (const record of records) {
    try {
      const payload = (record.payload || {}) as Record<string, unknown>;

      // Pre-flight Hook: Unread direct message read status verification
      if (
        record.template_key === 'unread_message_v1' &&
        record.related_entity_id &&
        record.recipient_user_id
      ) {
        const { data: participant } = await supabase
          .from('conversation_participants')
          .select('last_read_at')
          .eq('conversation_id', record.related_entity_id)
          .eq('user_id', record.recipient_user_id)
          .maybeSingle();

        const lastMsgTimeStr = (payload.lastMessageTimestamp as string) || record.created_at;
        const lastMsgTime = new Date(lastMsgTimeStr).getTime();
        const lastReadTime = participant?.last_read_at ? new Date(participant.last_read_at).getTime() : 0;

        if (lastReadTime >= lastMsgTime) {
          const reason = 'Pre-flight check: Recipient read conversation before dispatch';
          await supabase.rpc('mark_outbox_email_suppressed', {
            p_id: record.id,
            p_reason: reason,
          });

          suppressedCount++;
          results.push({
            id: record.id,
            success: true,
            status: 'suppressed',
            suppressionReason: reason,
          });
          continue;
        }
      }

      let emailSubject = record.subject;
      let textContent: string;
      let htmlContent: string | undefined;

      // Render via template registry if template_key is registered
      if (hasTemplate(record.template_key)) {
        const resolvedState = resolveAccountState(record);
        const templateData = {
          ...payload,
          accountState: payload.accountState || resolvedState,
        };
        const rendered = renderTemplate(record.template_key, templateData);
        emailSubject = record.subject && record.subject.trim() ? record.subject : rendered.subject;
        htmlContent = rendered.html;
        textContent = rendered.text;
      } else {
        textContent = typeof payload.text === 'string' && payload.text.trim()
          ? payload.text
          : `${record.subject}\n\nEvent: ${record.event_type}\nTemplate: ${record.template_key}`;
        htmlContent = typeof payload.html === 'string' && payload.html.trim()
          ? payload.html
          : undefined;
      }

      // Dispatch through the unified email service
      const dispatchResult = await sendEmail(
        {
          to: record.recipient_email,
          subject: emailSubject,
          text: textContent,
          html: htmlContent,
        },
        customAdapter
      );

      if (dispatchResult.success) {
        // Record provider acceptance in database
        const { error: markSentError } = await supabase.rpc('mark_outbox_email_sent', {
          p_id: record.id,
          p_provider: dispatchResult.provider,
          p_provider_message_id: dispatchResult.providerMessageId || null,
        });

        if (markSentError) {
          // Stored procedure update error
          failedCount++;
          results.push({
            id: record.id,
            success: false,
            status: 'failed',
            provider: dispatchResult.provider,
            error: `Email sent but DB status update failed: ${sanitizeErrorMessage(markSentError)}`,
          });
        } else {
          sentCount++;
          results.push({
            id: record.id,
            success: true,
            status: 'sent',
            provider: dispatchResult.provider,
            providerMessageId: dispatchResult.providerMessageId,
          });
        }
      } else {
        // Provider rejected delivery
        const errorMsg = sanitizeErrorMessage(dispatchResult.error);
        await supabase.rpc('mark_outbox_email_failed', {
          p_id: record.id,
          p_error: errorMsg,
          p_retry_delay_seconds: retryDelaySeconds,
        });

        failedCount++;
        results.push({
          id: record.id,
          success: false,
          status: 'failed',
          provider: dispatchResult.provider,
          error: errorMsg,
        });
      }
    } catch (unhandledErr: unknown) {
      // Unhandled error during dispatch (e.g. timeout, network crash)
      const errorMsg = sanitizeErrorMessage(unhandledErr);
      try {
        await supabase.rpc('mark_outbox_email_failed', {
          p_id: record.id,
          p_error: `Unhandled dispatch exception: ${errorMsg}`,
          p_retry_delay_seconds: retryDelaySeconds,
        });
      } catch {
        // If DB fails here, the stale-lock recovery mechanism will reclaim it after lock timeout
      }

      failedCount++;
      results.push({
        id: record.id,
        success: false,
        status: 'failed',
        error: errorMsg,
      });
    }
  }

  return {
    claimedCount: records.length,
    sentCount,
    failedCount,
    suppressedCount,
    results,
  };
}
