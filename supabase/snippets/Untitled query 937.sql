SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND indexname = 'uq_payout_transfers_active_timesheet';
