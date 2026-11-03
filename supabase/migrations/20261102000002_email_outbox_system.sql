-- ==============================================================================
-- Migration: 20261102000002_email_outbox_system.sql
-- Description: Production-grade Transactional Email Outbox with Durable Queueing,
--              Strict Idempotency, Concurrency-Safe Worker Claiming, and Server-Only RLS.
-- ==============================================================================

-- 1. EMAIL OUTBOX TABLE
CREATE TABLE IF NOT EXISTS public.email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Event & Template Identity
    event_type TEXT NOT NULL,
    template_key TEXT NOT NULL,
    recipient_email TEXT NOT NULL CONSTRAINT chk_email_outbox_recipient CHECK (
        length(trim(recipient_email)) >= 3 AND recipient_email LIKE '%@%'
    ),
    recipient_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    subject TEXT NOT NULL CONSTRAINT chk_email_outbox_subject CHECK (length(trim(subject)) > 0),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    related_entity_id TEXT,

    -- Delivery Lifecycle Tracking
    status TEXT NOT NULL DEFAULT 'pending' CONSTRAINT chk_email_outbox_status CHECK (
        status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter')
    ),
    attempts INTEGER NOT NULL DEFAULT 0 CONSTRAINT chk_email_outbox_attempts CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CONSTRAINT chk_email_outbox_max_attempts CHECK (max_attempts > 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_attempt_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    last_error TEXT,
    provider TEXT,
    provider_message_id TEXT,

    -- Concurrency & Worker Lock Control
    idempotency_key TEXT NOT NULL CONSTRAINT uq_email_outbox_idempotency_key UNIQUE,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,

    -- Audit Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_outbox IS 'Durable transactional email outbox for asynchronous queueing, deduplication, and retry delivery.';
COMMENT ON COLUMN public.email_outbox.idempotency_key IS 'Unique business event key preventing duplicate email queuing.';
COMMENT ON COLUMN public.email_outbox.status IS 'Lifecycle: pending -> processing -> sent | failed (retrying) | dead_letter (exhausted).';

-- 2. HIGH-PERFORMANCE WORKER & AUDIT INDEXES
CREATE INDEX IF NOT EXISTS idx_email_outbox_claimable
    ON public.email_outbox (next_attempt_at ASC, created_at ASC)
    WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX IF NOT EXISTS idx_email_outbox_status
    ON public.email_outbox (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_outbox_recipient_user
    ON public.email_outbox (recipient_user_id, created_at DESC)
    WHERE recipient_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_outbox_event_entity
    ON public.email_outbox (event_type, related_entity_id)
    WHERE related_entity_id IS NOT NULL;

-- 3. AUTOMATIC UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION public.handle_email_outbox_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_outbox_updated_at ON public.email_outbox;
CREATE TRIGGER trg_email_outbox_updated_at
    BEFORE UPDATE ON public.email_outbox
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_email_outbox_updated_at();

-- 4. CONCURRENCY-SAFE BATCH CLAIM FUNCTION (FOR UPDATE SKIP LOCKED)
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
BEGIN
    RETURN QUERY
    WITH eligible_records AS (
        SELECT id
          FROM public.email_outbox
         WHERE (
             (status = 'pending' AND next_attempt_at <= now())
             OR (status = 'failed' AND attempts < max_attempts AND next_attempt_at <= now())
             -- Stale processing lock recovery: worker died or timed out
             OR (status = 'processing' AND locked_at < (now() - (p_lock_timeout_seconds || ' seconds')::interval))
         )
         ORDER BY next_attempt_at ASC, created_at ASC
         LIMIT p_batch_size
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.email_outbox o
       SET status = 'processing',
           locked_at = now(),
           locked_by = p_worker_id,
           attempts = o.attempts + 1,
           last_attempt_at = now(),
           updated_at = now()
      FROM eligible_records e
     WHERE o.id = e.id
    RETURNING o.*;
END;
$$;

COMMENT ON FUNCTION public.claim_outbox_emails IS 'Atomically claims batch of eligible outbox emails using FOR UPDATE SKIP LOCKED with stale lock recovery.';

-- 5. WORKER DELIVERY STATUS UPDATERS
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
           provider = p_provider,
           provider_message_id = p_provider_message_id,
           locked_at = NULL,
           locked_by = NULL,
           last_error = NULL,
           updated_at = now()
     WHERE id = p_id;
END;
$$;

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
BEGIN
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
               last_error = p_error,
               locked_at = NULL,
               locked_by = NULL,
               updated_at = now()
         WHERE id = p_id;
    ELSE
        UPDATE public.email_outbox
           SET status = 'failed',
               failed_at = now(),
               last_error = p_error,
               next_attempt_at = now() + (p_retry_delay_seconds || ' seconds')::interval,
               locked_at = NULL,
               locked_by = NULL,
               updated_at = now()
         WHERE id = p_id;
    END IF;
END;
$$;

-- 6. STRICT SECURITY & ROW-LEVEL SECURITY (RLS)
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- Explicitly deny all public, anon, and authenticated access to the table
REVOKE ALL ON public.email_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_outbox_emails(INTEGER, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_outbox_email_sent(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_outbox_email_failed(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

-- Grant exclusive operational privileges to service_role (trusted server-side execution only)
GRANT ALL ON public.email_outbox TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_outbox_emails(INTEGER, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbox_email_sent(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbox_email_failed(UUID, TEXT, INTEGER) TO service_role;
