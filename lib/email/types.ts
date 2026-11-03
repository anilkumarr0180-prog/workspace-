/**
 * Shared Type Definitions for Unified Email Infrastructure
 * Strictly server-side types for transactional email dispatch and outbox processing.
 */

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email types and modules cannot be loaded in the browser.');
}

export type SupportedEmailProvider = 'mailpit' | 'resend' | 'test';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  success: boolean;
  provider: SupportedEmailProvider;
  providerMessageId?: string;
  error?: string;
}

export interface EmailAdapter {
  readonly name: SupportedEmailProvider;
  sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
}

export interface OutboxEmailRecord {
  id: string;
  event_type: string;
  template_key: string;
  recipient_email: string;
  recipient_user_id: string | null;
  subject: string;
  payload: Record<string, unknown>;
  related_entity_id: string | null;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'dead_letter' | 'suppressed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  provider: string | null;
  provider_message_id: string | null;
  idempotency_key: string;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessOutboxBatchOptions {
  batchSize?: number;
  workerId?: string;
  lockTimeoutSeconds?: number;
  retryDelaySeconds?: number;
}

export interface ProcessOutboxRecordResult {
  id: string;
  success: boolean;
  status?: 'sent' | 'failed' | 'suppressed' | 'cancelled';
  provider?: SupportedEmailProvider;
  providerMessageId?: string;
  error?: string;
  suppressionReason?: string;
}

export interface ProcessOutboxBatchResult {
  claimedCount: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  results: ProcessOutboxRecordResult[];
}
