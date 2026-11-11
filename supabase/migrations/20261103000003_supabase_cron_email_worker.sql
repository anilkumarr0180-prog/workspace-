-- ==============================================================================
-- Migration: 20261103000003_supabase_cron_email_worker.sql
-- Description: Sets up Supabase pg_cron + pg_net transactional email outbox
--              worker scheduler with Supabase Vault secret integration.
--
-- Architectural Guarantees:
-- 1. NO SECRETS IN SQL: URLs and CRON_SECRET are retrieved dynamically from
--    Supabase Vault (vault.decrypted_secrets) at runtime.
-- 2. ASYNC TRIGGER, NOT QUEUE: pg_net acts purely as an HTTP trigger to invoke
--    the Next.js worker route. The public.email_outbox table remains 100% the
--    durable source of truth.
-- 3. RESILIENCE TO LOST HTTP CALLS: Invocations are non-blocking and stateless.
--    If an HTTP ping fails or drops, pending/recoverable outbox records are
--    preserved intact and processed on the subsequent scheduled run.
-- 4. IDEMPOTENT SCHEDULING: Safe to apply repeatedly without duplicate jobs.
-- 5. LEAST PRIVILEGE: Function restricted strictly to postgres and service_role.
-- ==============================================================================

-- 1. Ensure required extensions are available
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 2. Create the asynchronous outbox worker invocation function
CREATE OR REPLACE FUNCTION public.trigger_email_outbox_worker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, cron, pg_temp
AS $$
DECLARE
    v_worker_url text;
    v_cron_secret text;
    v_request_id bigint;
BEGIN
    -- Dynamically resolve credentials from Supabase Vault
    -- Production setup requires inserting these two secrets into Vault:
    --   SELECT vault.create_secret('https://<your-app>.vercel.app/api/email/process', 'app_worker_url');
    --   SELECT vault.create_secret('<random-32-byte-secret>', 'app_cron_secret');
    SELECT decrypted_secret INTO v_worker_url
      FROM vault.decrypted_secrets
     WHERE name = 'app_worker_url'
     LIMIT 1;

    SELECT decrypted_secret INTO v_cron_secret
      FROM vault.decrypted_secrets
     WHERE name = 'app_cron_secret'
     LIMIT 1;

    -- If credentials are not configured in Vault (e.g. before production setup or in local dev),
    -- exit cleanly without raising an error to avoid bloating database cron logs.
    IF v_worker_url IS NULL OR v_worker_url = '' OR v_cron_secret IS NULL OR v_cron_secret = '' THEN
        RETURN NULL;
    END IF;

    -- Asynchronously invoke the Next.js protected route via pg_net
    v_request_id := net.http_post(
        url := v_worker_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_cron_secret
        ),
        body := jsonb_build_object(
            'triggered_at', clock_timestamp(),
            'source', 'pg_cron'
        ),
        timeout_milliseconds := 15000
    );

    RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
    -- Prevent background scheduler from crashing; log error notice
    RAISE WARNING 'trigger_email_outbox_worker error: %', SQLERRM;
    RETURN NULL;
END;
$$;

-- 3. Restrict execution privileges
REVOKE ALL ON FUNCTION public.trigger_email_outbox_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_email_outbox_worker() TO postgres, service_role;

-- 4. Idempotently register the 1-minute cron job in pg_cron
DO $$
BEGIN
    -- Unschedule existing job if already registered to guarantee idempotency
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-outbox') THEN
        PERFORM cron.unschedule('process-email-outbox');
    END IF;

    -- Schedule job to run every minute ('* * * * *')
    PERFORM cron.schedule(
        'process-email-outbox',
        '* * * * *',
        'SELECT public.trigger_email_outbox_worker();'
    );
END $$;

