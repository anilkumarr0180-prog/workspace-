SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
      'contract_milestones',
      'milestone_deliveries',
      'payment_ledger'
  )
ORDER BY table_name;