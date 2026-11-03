-- ==============================================================================
-- Migration: 20261102000003_email_outbox_retry_boundary_hardening.sql
-- Description: Hardening retry boundaries, stale processing recovery, parameter
--              validation, and dead_letter transitions for the email outbox.
-- ==============================================================================

-- 1. ADD ATTEMPTS CEILING CONSTRAINT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_email_outbox_attempts_limit'
          AND conrelid = 'public.email_outbox'::regclass
    ) THEN
        ALTER TABLE public.email_outbox
            ADD CONSTRAINT chk_email_outbox_attempts_limit
            CHECK (attempts <= max_attempts);
    END IF;
END $$;

-- 2. HARDEN claim_outbox_emails WITH BOUNDS, SWEEP & RETRY BOUNDARIES
CREATE OR REPLACE FUNCTION public.claim_outbox_emails(
    p_batch_size INTEGER DEFAULT 10,
    p_worker_id TEXT DEFAULT 'default-worker',
    p_lock_timeout_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_safe_batch_size INTEGER;
    v_safe_lock_timeout INTEGER;
    v_safe_worker_id TEXT;
BEGIN
    -- Input sanitization and bounds enforcement
    v_safe_batch_size := GREATEST(1, LEAST(COALESCE(p_batch_size, 10), 100));
    v_safe_lock_timeout := GREATEST(10, LEAST(COALESCE(p_lock_timeout_seconds, 300), 86400));
    v_safe_worker_id := SUBSTRING(COALESCE(NULLIF(trim(p_worker_id), ''), 'default-worker'), 1, 128);

    -- Phase 1: Sweep stale processing locks that have EXHAUSTED max_attempts directly to dead_letter
    UPDATE public.email_outbox
       SET status = 'dead_letter',
           failed_at = now(),
           last_error = COALESCE(last_error, 'Worker processing timed out') || ' [Stale lock expired at max attempts (' || attempts || '/' || max_attempts || ')]',
           locked_at = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE status = 'processing'
       AND locked_at < (now() - (v_safe_lock_timeout || ' seconds')::interval)
       AND attempts >= max_attempts;

    -- Phase 2: Atomically claim eligible records strictly BELOW max_attempts
    RETURN QUERY
    WITH eligible_records AS (
        SELECT id
          FROM public.email_outbox
         WHERE attempts < max_attempts
           AND (
               -- Ready pending messages
               (status = 'pending' AND next_attempt_at <= now())
               -- Ready failed messages awaiting retry
               OR (status = 'failed' AND next_attempt_at <= now())
               -- Stale processing messages whose worker crashed/timed out below max_attempts
               OR (status = 'processing' AND locked_at < (now() - (v_safe_lock_timeout || ' seconds')::interval))
           )
         ORDER BY next_attempt_at ASC, created_at ASC
         LIMIT v_safe_batch_size
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.email_outbox o
       SET status = 'processing',
           locked_at = now(),
           locked_by = v_safe_worker_id,
           attempts = o.attempts + 1,
           last_attempt_at = now(),
           updated_at = now()
      FROM eligible_records e
     WHERE o.id = e.id
    RETURNING o.*;
END;
$$;

COMMENT ON FUNCTION public.claim_outbox_emails IS 'Atomically claims batch of eligible outbox emails strictly below max_attempts, sweeping exhausted stale records to dead_letter.';

-- 3. HARDEN mark_outbox_email_failed WITH SANITIZED BOUNDS
CREATE OR REPLACE FUNCTION public.mark_outbox_email_failed(
    p_id UUID,
    p_error TEXT,
    p_retry_delay_seconds INTEGER DEFAULT 60
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempts INTEGER;
    v_max_attempts INTEGER;
    v_safe_delay INTEGER;
    v_safe_error TEXT;
BEGIN
    v_safe_delay := GREATEST(0, LEAST(COALESCE(p_retry_delay_seconds, 60), 604800));
    v_safe_error := SUBSTRING(COALESCE(p_error, 'Unknown delivery error'), 1, 4000);

    SELECT attempts, max_attempts
      INTO v_attempts, v_max_attempts
      FROM public.email_outbox
     WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF v_attempts >= v_max_attempts THEN
        UPDATE public.email_outbox
           SET status = 'dead_letter',
               failed_at = now(),
               last_error = v_safe_error,
               locked_at = NULL,
               locked_by = NULL,
               updated_at = now()
         WHERE id = p_id;
    ELSE
        UPDATE public.email_outbox
           SET status = 'failed',
               failed_at = now(),
               last_error = v_safe_error,
               next_attempt_at = now() + (v_safe_delay || ' seconds')::interval,
               locked_at = NULL,
               locked_by = NULL,
               updated_at = now()
         WHERE id = p_id;
    END IF;
END;
$$;

-- 4. HARDEN mark_outbox_email_sent
CREATE OR REPLACE FUNCTION public.mark_outbox_email_sent(
    p_id UUID,
    p_provider TEXT,
    p_provider_message_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.email_outbox
       SET status = 'sent',
           sent_at = now(),
           provider = SUBSTRING(COALESCE(NULLIF(trim(p_provider), ''), 'unknown'), 1, 64),
           provider_message_id = SUBSTRING(NULLIF(trim(p_provider_message_id), ''), 1, 255),
           locked_at = NULL,
           locked_by = NULL,
           last_error = NULL,
           updated_at = now()
     WHERE id = p_id;
END;
$$;

-- 5. VERIFY PERMISSIONS
REVOKE ALL ON FUNCTION public.claim_outbox_emails(INTEGER, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_outbox_email_failed(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_outbox_email_sent(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_outbox_emails(INTEGER, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbox_email_failed(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbox_email_sent(UUID, TEXT, TEXT) TO service_role;
