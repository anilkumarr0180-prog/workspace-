-- Migration: 20261118000003_fund_timesheet_with_payment.sql
-- Description: Create fund_timesheet_with_payment stored procedure and grant service_role permissions on timesheets

-- 1. Create fund_timesheet_with_payment stored procedure
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
    v_timesheet public.timesheets;
    v_amount numeric(12,2);
BEGIN
    SELECT * INTO v_timesheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timesheet % not found', p_timesheet_id USING ERRCODE = '23503';
    END IF;

    IF v_timesheet.status = 'paid' THEN
        RETURN v_timesheet;
    END IF;

    v_amount := v_timesheet.total_amount;

    -- 1. Safely update payment_attempts if exists
    BEGIN
        UPDATE public.payment_attempts
           SET status = 'captured',
               razorpay_payment_id = p_razorpay_payment_id,
               razorpay_signature = p_razorpay_signature,
               updated_at = clock_timestamp()
         WHERE timesheet_id = p_timesheet_id
            OR razorpay_order_id = p_razorpay_order_id;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 2. Mark timesheet as paid
    UPDATE public.timesheets
       SET status = 'paid',
           updated_at = clock_timestamp()
     WHERE id = p_timesheet_id
    RETURNING * INTO v_timesheet;

    -- 3. Safely insert ledger audit record if ledger table exists
    BEGIN
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
            p_currency,
            'hourly_funded',
            'succeeded',
            'Hourly Invoice Payment for Week of ' || v_timesheet.week_start_date::text,
            jsonb_build_object(
                'provider', 'razorpay',
                'environment', p_environment,
                'razorpay_payment_id', p_razorpay_payment_id,
                'razorpay_order_id', p_razorpay_order_id
            ) || p_metadata
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN v_timesheet;
END;
$$;

-- 2. Grant permissions
GRANT EXECUTE ON FUNCTION public.fund_timesheet_with_payment TO authenticated, service_role, anon;
GRANT ALL ON public.timesheets TO authenticated, service_role;
GRANT ALL ON public.payment_attempts TO authenticated, service_role;
GRANT ALL ON public.payment_ledger TO authenticated, service_role;

-- 3. Reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';

