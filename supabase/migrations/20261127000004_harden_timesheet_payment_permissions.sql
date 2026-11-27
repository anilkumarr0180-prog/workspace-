-- ==============================================================================
-- Migration: 20261127000004_harden_timesheet_payment_permissions.sql
-- Description: Remediate permission regression (20261118000003), harden
--   partial-payment accounting and terminal-state guards in both
--   fund_timesheet_with_payment() and reconcile_timesheet_webhook_payment(),
--   and enforce concurrency-safe payment_ledger idempotency without failing on
--   preserved historical duplicate records.
-- ==============================================================================

-- 1. Non-unique lookup index for fast ledger idempotency & balance queries
--    (A static UNIQUE INDEX cannot be created without modifying preserved
--     historical duplicate rows for pay_real_service_123; future duplicates are
--     blocked below via advisory-locked BEFORE INSERT trigger + RPC row locks.)
DROP INDEX IF EXISTS public.uq_payment_ledger_timesheet_rzp_payment;

CREATE INDEX IF NOT EXISTS idx_payment_ledger_timesheet_rzp_payment
    ON public.payment_ledger (
        timesheet_id,
        event_type,
        (metadata->>'razorpay_payment_id')
    )
    WHERE timesheet_id IS NOT NULL
      AND event_type = 'hourly_funded'
      AND status = 'succeeded'
      AND COALESCE(metadata->>'razorpay_payment_id', '') <> '';

-- 2. Concurrency-safe BEFORE INSERT trigger preventing future duplicate
--    successful hourly_funded ledger rows for the same (timesheet_id, razorpay_payment_id)
CREATE OR REPLACE FUNCTION public.prevent_duplicate_razorpay_timesheet_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment_id text := NULLIF(trim(COALESCE(NEW.metadata->>'razorpay_payment_id', '')), '');
BEGIN
    IF NEW.timesheet_id IS NOT NULL
       AND NEW.event_type = 'hourly_funded'
       AND NEW.status = 'succeeded'
       AND v_payment_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(
            hashtext('rzp_ts_ledger:' || NEW.timesheet_id::text || ':' || v_payment_id)
        );

        IF EXISTS (
            SELECT 1
              FROM public.payment_ledger
             WHERE timesheet_id = NEW.timesheet_id
               AND event_type = 'hourly_funded'
               AND status = 'succeeded'
               AND metadata->>'razorpay_payment_id' = v_payment_id
        ) THEN
            RAISE EXCEPTION 'Duplicate Razorpay payment % for timesheet %', v_payment_id, NEW.timesheet_id
                USING ERRCODE = '23505';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_razorpay_timesheet_ledger ON public.payment_ledger;
CREATE TRIGGER trg_prevent_duplicate_razorpay_timesheet_ledger
    BEFORE INSERT ON public.payment_ledger
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_duplicate_razorpay_timesheet_ledger();

-- 3. Hardened fund_timesheet_with_payment() with partial-payment accounting
CREATE OR REPLACE FUNCTION public.fund_timesheet_with_payment(
    p_timesheet_id uuid,
    p_razorpay_payment_id text,
    p_razorpay_order_id text,
    p_razorpay_signature text,
    p_amount_subunits bigint,
    p_currency text,
    p_environment text DEFAULT 'test',
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.timesheets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role text := COALESCE(auth.role(), '');
    v_timesheet public.timesheets;
    v_attempt public.payment_attempts;
    v_order_id text := NULLIF(trim(COALESCE(p_razorpay_order_id, '')), '');
    v_payment_id text := NULLIF(trim(COALESCE(p_razorpay_payment_id, '')), '');
    v_signature text := NULLIF(trim(COALESCE(p_razorpay_signature, '')), '');
    v_currency text := NULLIF(upper(trim(COALESCE(p_currency, ''))), '');
    v_env text := lower(trim(COALESCE(NULLIF(trim(p_environment), ''), 'test')));
    v_amount numeric(12,2);
    v_ledger_currency text;
    v_prior_paid numeric(12,2);
    v_outstanding numeric(12,2);
    v_new_paid numeric(12,2);
    v_next_status text;
BEGIN
    IF v_role <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: fund_timesheet_with_payment is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    IF p_timesheet_id IS NULL THEN
        RAISE EXCEPTION 'Timesheet ID is required' USING ERRCODE = '22023';
    END IF;

    IF v_order_id IS NULL THEN
        RAISE EXCEPTION 'Razorpay order ID is required' USING ERRCODE = '22023';
    END IF;

    IF v_payment_id IS NULL THEN
        RAISE EXCEPTION 'Razorpay payment ID is required' USING ERRCODE = '22023';
    END IF;

    IF v_signature IS NULL THEN
        RAISE EXCEPTION 'Razorpay signature is required' USING ERRCODE = '22023';
    END IF;

    IF p_amount_subunits IS NULL OR p_amount_subunits <= 0 THEN
        RAISE EXCEPTION 'Expected amount in subunits must be positive' USING ERRCODE = '22023';
    END IF;

    IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'Valid 3-letter ISO currency is required' USING ERRCODE = '22023';
    END IF;

    IF v_env NOT IN ('test', 'live') THEN
        RAISE EXCEPTION 'Invalid environment "%". Supported environments are "test" and "live"', v_env
            USING ERRCODE = '22023';
    END IF;

    -- Canonical lock order: 1) payment_attempts, 2) timesheets
    SELECT * INTO v_attempt
      FROM public.payment_attempts
     WHERE timesheet_id = p_timesheet_id
       AND razorpay_order_id = v_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment attempt not found for timesheet % and order %', p_timesheet_id, v_order_id
            USING ERRCODE = '23503';
    END IF;

    IF v_attempt.billing_type <> 'timesheet' OR v_attempt.milestone_id IS NOT NULL THEN
        RAISE EXCEPTION 'Payment attempt % is not configured for timesheet billing', v_attempt.id
            USING ERRCODE = '22023';
    END IF;

    IF v_attempt.amount_subunits <> p_amount_subunits THEN
        RAISE EXCEPTION 'Payment amount (% subunits) does not match persisted attempt (% subunits)',
            p_amount_subunits, v_attempt.amount_subunits
            USING ERRCODE = '22023';
    END IF;

    IF ROUND(v_attempt.amount * 100)::bigint <> v_attempt.amount_subunits THEN
        RAISE EXCEPTION 'Persisted payment attempt % has inconsistent amount (%) and subunits (%)',
            v_attempt.id, v_attempt.amount, v_attempt.amount_subunits
            USING ERRCODE = '22023';
    END IF;

    v_ledger_currency := upper(trim(v_attempt.currency));
    IF v_ledger_currency <> v_currency THEN
        RAISE EXCEPTION 'Payment currency (%) does not match persisted attempt currency (%)',
            v_currency, v_ledger_currency
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_timesheet
      FROM public.timesheets
     WHERE id = p_timesheet_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    -- Never resurrect failed, expired, or refunded attempts
    IF v_attempt.status IN ('failed', 'refunded') THEN
        RAISE EXCEPTION 'Payment attempt % is in terminal status "%" and cannot be captured',
            v_attempt.id, v_attempt.status
            USING ERRCODE = '22023';
    END IF;

    -- Idempotent handling for already-captured attempts
    IF v_attempt.status = 'captured' THEN
        IF v_attempt.razorpay_payment_id IS NOT NULL
           AND trim(v_attempt.razorpay_payment_id) <> ''
           AND trim(v_attempt.razorpay_payment_id) <> v_payment_id THEN
            RAISE EXCEPTION 'Payment attempt % is already captured with a different payment ID',
                v_attempt.id
                USING ERRCODE = '22023';
        END IF;

        RETURN v_timesheet;
    END IF;

    IF v_attempt.status NOT IN ('created', 'authorized') THEN
        RAISE EXCEPTION 'Payment attempt % has unsupported status "%"',
            v_attempt.id, v_attempt.status
            USING ERRCODE = '22023';
    END IF;

    IF v_timesheet.status = 'paid' THEN
        RAISE EXCEPTION 'Timesheet % is already paid; cannot capture a new payment attempt',
            p_timesheet_id
            USING ERRCODE = '22023';
    END IF;

    IF v_timesheet.status NOT IN ('approved', 'open') THEN
        RAISE EXCEPTION 'Timesheet % is in status "%" and cannot be paid',
            p_timesheet_id, v_timesheet.status
            USING ERRCODE = '22023';
    END IF;

    -- Authoritative remaining balance calculation under timesheet lock
    SELECT COALESCE(SUM(amount), 0)
      INTO v_prior_paid
      FROM public.payment_ledger
     WHERE event_type = 'hourly_funded'
       AND status = 'succeeded'
       AND (
           timesheet_id = p_timesheet_id
           OR (timesheet_id IS NULL AND metadata->>'timesheet_id' = p_timesheet_id::text)
       );

    v_outstanding := GREATEST(0, ROUND((v_timesheet.total_amount - v_prior_paid) * 100) / 100.0);

    IF v_timesheet.total_amount <= 0 OR v_attempt.amount <= 0 OR v_outstanding <= 0.01 THEN
        RAISE EXCEPTION 'Timesheet % has no remaining balance due (total %, settled %)',
            p_timesheet_id, v_timesheet.total_amount, v_prior_paid
            USING ERRCODE = '22023';
    END IF;

    IF v_attempt.amount > (v_outstanding + 0.01) THEN
        RAISE EXCEPTION 'Payment amount (%) exceeds remaining timesheet balance (%)',
            v_attempt.amount, v_outstanding
            USING ERRCODE = '22023';
    END IF;

    -- Idempotency check if this exact payment_id was already recorded in ledger
    IF EXISTS (
        SELECT 1
          FROM public.payment_ledger
         WHERE timesheet_id = p_timesheet_id
           AND event_type = 'hourly_funded'
           AND status = 'succeeded'
           AND metadata->>'razorpay_payment_id' = v_payment_id
    ) THEN
        UPDATE public.payment_attempts
           SET status = 'captured',
               razorpay_payment_id = v_payment_id,
               razorpay_signature = v_signature,
               updated_at = clock_timestamp()
         WHERE id = v_attempt.id;

        RETURN v_timesheet;
    END IF;

    v_amount := v_attempt.amount;
    v_new_paid := ROUND((v_prior_paid + v_amount) * 100) / 100.0;
    v_next_status := CASE
        WHEN v_new_paid >= (v_timesheet.total_amount - 0.01) THEN 'paid'
        ELSE 'approved'
    END;

    UPDATE public.payment_attempts
       SET status = 'captured',
           razorpay_payment_id = v_payment_id,
           razorpay_signature = v_signature,
           updated_at = clock_timestamp()
     WHERE id = v_attempt.id;

    UPDATE public.timesheets
       SET status = v_next_status,
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
     RETURNING * INTO v_timesheet;

    INSERT INTO public.payment_ledger (
        contract_id,
        timesheet_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_timesheet.contract_id,
        v_timesheet.id,
        v_timesheet.client_id,
        NULL,
        v_amount,
        v_ledger_currency,
        'hourly_funded',
        'succeeded',
        'Hourly Invoice Payment for Week of ' || v_timesheet.week_start_date::text || ' (' || v_timesheet.total_minutes || ' mins)',
        jsonb_build_object(
            'provider', 'razorpay',
            'environment', v_env,
            'razorpay_payment_id', v_payment_id,
            'razorpay_order_id', v_order_id
        ) || COALESCE(p_metadata, '{}'::jsonb)
    );

    RETURN v_timesheet;
END;
$$;

-- 4. Hardened reconcile_timesheet_webhook_payment() aligned with checkout RPC
CREATE OR REPLACE FUNCTION public.reconcile_timesheet_webhook_payment(
    p_timesheet_id uuid,
    p_razorpay_order_id text,
    p_razorpay_payment_id text DEFAULT NULL,
    p_amount_subunits bigint DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_payment_metadata jsonb DEFAULT '{}'::jsonb,
    p_event_id text DEFAULT NULL,
    p_payload_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt public.payment_attempts;
    v_timesheet public.timesheets;
    v_webhook_event public.webhook_events;
    v_event_type text;
    v_environment text;
    v_order_id text := NULLIF(trim(COALESCE(p_razorpay_order_id, '')), '');
    v_payment_id text := NULLIF(trim(COALESCE(p_razorpay_payment_id, '')), '');
    v_amount numeric(12,2);
    v_ledger_currency text;
    v_prior_paid numeric(12,2);
    v_outstanding numeric(12,2);
    v_new_paid numeric(12,2);
    v_next_status text;
BEGIN
    IF current_user <> 'service_role' AND COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Access denied: reconcile_timesheet_webhook_payment is restricted to service_role'
            USING ERRCODE = '42501';
    END IF;

    IF p_timesheet_id IS NULL THEN
        RAISE EXCEPTION 'Timesheet ID cannot be null' USING ERRCODE = '22023';
    END IF;

    IF v_order_id IS NULL THEN
        RAISE EXCEPTION 'Razorpay order ID cannot be null or empty' USING ERRCODE = '22023';
    END IF;

    v_event_type := COALESCE(p_payment_metadata->>'event', 'payment.captured');
    v_environment := COALESCE(p_payment_metadata->>'environment', 'test');

    IF p_event_id IS NOT NULL AND trim(p_event_id) <> '' THEN
        SELECT * INTO v_webhook_event
          FROM public.webhook_events
         WHERE event_id = trim(p_event_id)
           FOR UPDATE;

        IF FOUND THEN
            IF v_webhook_event.status = 'processed' THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'idempotent', true,
                    'event_id', p_event_id,
                    'status', 'already_processed',
                    'message', 'Webhook event already processed previously'
                );
            END IF;

            UPDATE public.webhook_events
               SET status = 'processing',
                   metadata = metadata || jsonb_build_object('retried_at', clock_timestamp())
             WHERE id = v_webhook_event.id;
        ELSE
            INSERT INTO public.webhook_events (
                event_id,
                event_type,
                provider,
                environment,
                payload_hash,
                status,
                metadata
            ) VALUES (
                trim(p_event_id),
                v_event_type,
                'razorpay',
                v_environment,
                COALESCE(p_payload_hash, 'none'),
                'processing',
                jsonb_build_object(
                    'order_id', v_order_id,
                    'payment_id', v_payment_id,
                    'timesheet_id', p_timesheet_id
                )
            ) RETURNING * INTO v_webhook_event;
        END IF;
    END IF;

    -- Canonical lock order: 1) payment_attempts, 2) timesheets
    SELECT * INTO v_attempt
      FROM public.payment_attempts
     WHERE timesheet_id = p_timesheet_id
       AND razorpay_order_id = v_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '23503', 'message', 'Payment attempt not found for timesheet order')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Payment attempt not found for timesheet % and order %', p_timesheet_id, v_order_id
            USING ERRCODE = '23503';
    END IF;

    IF v_attempt.billing_type <> 'timesheet' OR v_attempt.milestone_id IS NOT NULL THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Conflicting payment billing type')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Payment attempt is not configured for timesheet billing' USING ERRCODE = '22023';
    END IF;

    IF p_amount_subunits IS NOT NULL AND v_attempt.amount_subunits <> p_amount_subunits THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Amount mismatch')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Webhook amount (% subunits) does not match persisted attempt (% subunits)', p_amount_subunits, v_attempt.amount_subunits
            USING ERRCODE = '22023';
    END IF;

    v_ledger_currency := upper(trim(v_attempt.currency));
    IF p_currency IS NOT NULL AND v_ledger_currency <> upper(trim(p_currency)) THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Currency mismatch')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Webhook currency (%) does not match persisted attempt (%)', p_currency, v_ledger_currency
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_timesheet
      FROM public.timesheets
     WHERE id = p_timesheet_id
       FOR UPDATE;

    IF NOT FOUND THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '23503', 'message', 'Timesheet not found')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    -- Never resurrect failed, expired, or refunded attempts
    IF v_attempt.status IN ('failed', 'refunded') THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Terminal payment attempt cannot be resurrected')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Payment attempt % is in terminal status "%" and cannot be captured',
            v_attempt.id, v_attempt.status
            USING ERRCODE = '22023';
    END IF;

    -- Idempotent handling for already-captured attempts
    IF v_attempt.status = 'captured' THEN
        IF v_payment_id IS NOT NULL
           AND v_attempt.razorpay_payment_id IS NOT NULL
           AND trim(v_attempt.razorpay_payment_id) <> ''
           AND trim(v_attempt.razorpay_payment_id) <> v_payment_id THEN
            IF v_webhook_event.id IS NOT NULL THEN
                UPDATE public.webhook_events
                   SET status = 'failed',
                       error_details = jsonb_build_object('code', '22023', 'message', 'Mismatched payment ID on captured attempt')
                 WHERE id = v_webhook_event.id;
            END IF;
            RAISE EXCEPTION 'Payment attempt % is already captured with a different payment ID', v_attempt.id
                USING ERRCODE = '22023';
        END IF;

        IF v_payment_id IS NOT NULL AND v_attempt.razorpay_payment_id IS NULL THEN
            UPDATE public.payment_attempts
               SET razorpay_payment_id = v_payment_id,
                   updated_at = clock_timestamp()
             WHERE id = v_attempt.id;
        END IF;

        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'processed',
                   metadata = metadata || jsonb_build_object('idempotent', true, 'reconciled_at', clock_timestamp())
             WHERE id = v_webhook_event.id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'timesheet_id', p_timesheet_id,
            'status', v_timesheet.status,
            'message', 'Timesheet payment was already reconciled'
        );
    END IF;

    IF v_attempt.status NOT IN ('created', 'authorized') THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Unsupported attempt status')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Payment attempt % has unsupported status "%"', v_attempt.id, v_attempt.status
            USING ERRCODE = '22023';
    END IF;

    IF v_timesheet.status = 'paid' THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Timesheet is already paid')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Timesheet % is already paid; cannot capture a new payment attempt', p_timesheet_id
            USING ERRCODE = '22023';
    END IF;

    IF v_timesheet.status NOT IN ('approved', 'open') THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Timesheet is not in a payable status')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Timesheet % is in status "%" and cannot be paid', p_timesheet_id, v_timesheet.status
            USING ERRCODE = '22023';
    END IF;

    -- Authoritative remaining balance calculation under timesheet lock
    SELECT COALESCE(SUM(amount), 0)
      INTO v_prior_paid
      FROM public.payment_ledger
     WHERE event_type = 'hourly_funded'
       AND status = 'succeeded'
       AND (
           timesheet_id = p_timesheet_id
           OR (timesheet_id IS NULL AND metadata->>'timesheet_id' = p_timesheet_id::text)
       );

    v_outstanding := GREATEST(0, ROUND((v_timesheet.total_amount - v_prior_paid) * 100) / 100.0);

    IF v_timesheet.total_amount <= 0 OR v_attempt.amount <= 0 OR v_outstanding <= 0.01 THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'No remaining balance due')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Timesheet % has no remaining balance due', p_timesheet_id
            USING ERRCODE = '22023';
    END IF;

    IF v_attempt.amount > (v_outstanding + 0.01) THEN
        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'failed',
                   error_details = jsonb_build_object('code', '22023', 'message', 'Payment exceeds remaining balance')
             WHERE id = v_webhook_event.id;
        END IF;
        RAISE EXCEPTION 'Payment amount (%) exceeds remaining timesheet balance (%)',
            v_attempt.amount, v_outstanding
            USING ERRCODE = '22023';
    END IF;

    IF v_payment_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM public.payment_ledger
         WHERE timesheet_id = p_timesheet_id
           AND event_type = 'hourly_funded'
           AND status = 'succeeded'
           AND metadata->>'razorpay_payment_id' = v_payment_id
    ) THEN
        UPDATE public.payment_attempts
           SET status = 'captured',
               razorpay_payment_id = COALESCE(v_payment_id, razorpay_payment_id),
               updated_at = clock_timestamp()
         WHERE id = v_attempt.id;

        IF v_webhook_event.id IS NOT NULL THEN
            UPDATE public.webhook_events
               SET status = 'processed',
                   metadata = metadata || jsonb_build_object('idempotent', true, 'reconciled_at', clock_timestamp())
             WHERE id = v_webhook_event.id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'timesheet_id', p_timesheet_id,
            'status', v_timesheet.status,
            'message', 'Payment ID was already recorded in ledger'
        );
    END IF;

    v_amount := v_attempt.amount;
    v_new_paid := ROUND((v_prior_paid + v_amount) * 100) / 100.0;
    v_next_status := CASE
        WHEN v_new_paid >= (v_timesheet.total_amount - 0.01) THEN 'paid'
        ELSE 'approved'
    END;

    UPDATE public.payment_attempts
       SET status = 'captured',
           razorpay_payment_id = COALESCE(v_payment_id, razorpay_payment_id),
           updated_at = clock_timestamp()
     WHERE id = v_attempt.id;

    UPDATE public.timesheets
       SET status = v_next_status,
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
     RETURNING * INTO v_timesheet;

    INSERT INTO public.payment_ledger (
        contract_id,
        timesheet_id,
        from_user_id,
        to_user_id,
        amount,
        currency,
        event_type,
        status,
        description,
        metadata
    ) VALUES (
        v_timesheet.contract_id,
        v_timesheet.id,
        v_timesheet.client_id,
        NULL,
        v_amount,
        v_ledger_currency,
        'hourly_funded',
        'succeeded',
        'Hourly Invoice Payment (Webhook): Week of ' || v_timesheet.week_start_date::text || ' (' || v_timesheet.total_minutes || ' mins)',
        jsonb_build_object(
            'provider', 'razorpay',
            'environment', v_environment,
            'event', v_event_type,
            'razorpay_order_id', v_order_id,
            'razorpay_payment_id', v_payment_id,
            'webhook_event_id', p_event_id
        ) || COALESCE(p_payment_metadata, '{}'::jsonb)
    );

    IF v_webhook_event.id IS NOT NULL THEN
        UPDATE public.webhook_events
           SET status = 'processed',
               metadata = metadata || jsonb_build_object('reconciled_at', clock_timestamp(), 'timesheet_id', p_timesheet_id)
         WHERE id = v_webhook_event.id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'idempotent', false,
        'timesheet_id', p_timesheet_id,
        'status', v_next_status,
        'paid_amount', v_new_paid
    );
END;
$$;

-- 5. Restrict RPC execution strictly to service_role
REVOKE ALL ON FUNCTION public.fund_timesheet_with_payment(uuid, text, text, text, bigint, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fund_timesheet_with_payment(uuid, text, text, text, bigint, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_timesheet_webhook_payment(uuid, text, text, bigint, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_timesheet_webhook_payment(uuid, text, text, bigint, text, jsonb, text, text) TO service_role;

-- 6. Revoke direct table write privileges from PUBLIC, anon, and authenticated
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.timesheets FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.payment_attempts FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.payment_ledger FROM PUBLIC, anon, authenticated;

-- Preserve SELECT for authenticated (under RLS) and full access for service_role
GRANT SELECT ON public.timesheets TO authenticated;
GRANT SELECT ON public.payment_attempts TO authenticated;
GRANT SELECT ON public.payment_ledger TO authenticated;

GRANT ALL ON public.timesheets TO service_role;
GRANT ALL ON public.payment_attempts TO service_role;
GRANT ALL ON public.payment_ledger TO service_role;
