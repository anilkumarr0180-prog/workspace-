import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { isValidEmailAddress } from './smtp-transport';
import { processOutboxBatch } from './outbox-processor';
import type { TemplateKey } from './templates/types';
import type { ProcessOutboxBatchResult } from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email queueing and dispatch cannot be executed on the client.');
}

export interface QueueOutboxEmailInput {
  eventType: string;
  templateKey: TemplateKey;
  recipientEmail: string;
  recipientUserId?: string | null;
  subject: string;
  payload: Record<string, unknown>;
  relatedEntityId?: string | null;
  idempotencyKey?: string;
  immediate?: boolean; // Defaults to true for real-time transactional dispatch
}

export interface QueueOutboxEmailResult {
  success: boolean;
  outboxId?: string;
  error?: string;
  batchResult?: ProcessOutboxBatchResult;
}

/**
 * Persists an email into the durable `public.email_outbox` table and immediately triggers
 * processing to deliver it via the configured SMTP transport in real time.
 */
export async function queueAndDispatchEmail(
  input: QueueOutboxEmailInput
): Promise<QueueOutboxEmailResult> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: queueAndDispatchEmail() cannot run in the browser.');
  }

  const recipientEmail = input.recipientEmail?.trim().toLowerCase();
  if (!recipientEmail || !isValidEmailAddress(recipientEmail)) {
    return {
      success: false,
      error: `Invalid recipient email address: "${input.recipientEmail || ''}".`,
    };
  }

  const subject = input.subject?.trim();
  if (!subject) {
    return {
      success: false,
      error: 'Email subject is required.',
    };
  }

  try {
    const supabase = getAdminSupabaseClient();

    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      `email:${input.eventType}:${input.relatedEntityId || Date.now()}:${recipientEmail}:${Math.random().toString(36).slice(2, 8)}`;

    // 1. Durably record in transactional email_outbox table
    const { data, error: insertError } = await supabase
      .from('email_outbox')
      .insert({
        event_type: input.eventType,
        template_key: input.templateKey,
        recipient_email: recipientEmail,
        recipient_user_id: input.recipientUserId || null,
        subject,
        payload: input.payload,
        related_entity_id: input.relatedEntityId || null,
        idempotency_key: idempotencyKey,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError) {
      // If duplicate key error, record already exists
      if (insertError.code === '23505') {
        console.info(`[EMAIL OUTBOX] Duplicate idempotency key "${idempotencyKey}", proceeding with existing record.`);
      } else {
        console.error('[EMAIL OUTBOX] Insertion failure:', insertError.message);
        return {
          success: false,
          error: `Failed to queue email in outbox: ${insertError.message}`,
        };
      }
    }

    const outboxId = data?.id;

    // 2. Immediate transactional dispatch (drain outbox record)
    let batchResult: ProcessOutboxBatchResult | undefined;
    if (input.immediate !== false) {
      try {
        batchResult = await processOutboxBatch({
          batchSize: 5,
          workerId: `immediate-${process.pid}-${Date.now()}`,
          lockTimeoutSeconds: 60,
          retryDelaySeconds: 30,
        });
      } catch (dispatchErr: unknown) {
        console.warn(
          '[EMAIL OUTBOX] Immediate dispatch caught non-fatal notice (record safely queued for worker retry):',
          dispatchErr instanceof Error ? dispatchErr.message : dispatchErr
        );
      }
    }

    return {
      success: true,
      outboxId,
      batchResult,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[EMAIL OUTBOX] Unexpected queue error:', errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Immediately triggers an outbox drain batch to process any pending emails
 * (e.g. queued by database triggers like `trg_proposals_queue_email_on_insert`).
 */
export async function triggerOutboxDrain(batchSize = 10): Promise<ProcessOutboxBatchResult> {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: triggerOutboxDrain() cannot run in the browser.');
  }

  try {
    return await processOutboxBatch({
      batchSize,
      workerId: `drain-${process.pid}-${Date.now()}`,
      lockTimeoutSeconds: 60,
      retryDelaySeconds: 30,
    });
  } catch (err: unknown) {
    console.warn('[EMAIL OUTBOX] triggerOutboxDrain notice:', err instanceof Error ? err.message : err);
    return {
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      suppressedCount: 0,
      results: [],
    };
  }
}

