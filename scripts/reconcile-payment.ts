#!/usr/bin/env node
/**
 * Operator CLI Tool: Safe Razorpay Captured Payment Reconciliation
 * 
 * Safety Rules:
 * - Read-only inspection is the default mode.
 * - Explicit flag --execute is required to perform reconciliation.
 * - Never creates a new Razorpay order.
 * - Never retries payment charging.
 * - Atomic reconciliation using reconcile_webhook_payment.
 * 
 * Usage:
 *   npx tsx scripts/reconcile-payment.ts <PAYMENT_ID> [--inspect | --execute] [--operator <ID>] [--notes <TEXT>]
 */

import { inspectCapturedPayment, reconcileCapturedPayment } from '../lib/services/payment-recovery';

function printHelp() {
  console.log(`
Razorpay Captured Payment Recovery & Reconciliation Tool

Usage:
  npx tsx scripts/reconcile-payment.ts <PAYMENT_ID> [options]

Modes:
  --inspect     (Default) Read-only inspection against Razorpay and Database.
                Does not modify any state.
  --execute     Explicit execution mode. Reconciles verified captured payment
                into escrow via atomic database procedure.

Options:
  --operator    Operator identity tag (default: 'ops_engineer')
  --notes       Operational notes for the audit ledger
  --help        Show this help message

Examples:
  # 1. Read-only inspection
  npx tsx scripts/reconcile-payment.ts pay_TtFqzAaVOs8kBN

  # 2. Explicit recovery
  npx tsx scripts/reconcile-payment.ts pay_TtFqzAaVOs8kBN --execute --operator admin_alice --notes "Interrupted checkout recovery"
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const paymentId = args[0].startsWith('--') ? undefined : args[0];
  const isExecute = args.includes('--execute');
  const operatorIdx = args.indexOf('--operator');
  const operator = operatorIdx !== -1 && args[operatorIdx + 1] ? args[operatorIdx + 1] : 'ops_engineer';
  const notesIdx = args.indexOf('--notes');
  const notes = notesIdx !== -1 && args[notesIdx + 1] ? args[notesIdx + 1] : 'Manual operator recovery for captured payment';

  if (!paymentId) {
    console.error('Error: A Razorpay Payment ID (e.g. pay_...) is required as the first argument.');
    printHelp();
    process.exit(1);
  }

  console.log('================================================================');
  console.log('         WORKSPACE PAYMENT RECONCILIATION ENGINE');
  console.log('================================================================');
  console.log(`Target Payment ID : ${paymentId}`);
  console.log(`Execution Mode    : ${isExecute ? '⚡ EXPLICIT EXECUTION' : '🔍 READ-ONLY INSPECTION'}`);
  console.log(`Operator ID       : ${operator}`);
  console.log('----------------------------------------------------------------\n');

  try {
    if (!isExecute) {
      console.log('🔍 Executing Read-Only Inspection...');
      const inspection = await inspectCapturedPayment(paymentId);

      console.log('\n--- GATEWAY STATUS ---');
      console.log(`Payment Status : ${inspection.gateway.status || 'unknown'}`);
      console.log(`Order ID       : ${inspection.gateway.orderId || 'none'}`);
      console.log(`Amount         : ${inspection.gateway.amountSubunits != null ? inspection.gateway.amountSubunits / 100 : 'unknown'} ${inspection.gateway.currency || ''}`);
      console.log(`Milestone ID   : ${inspection.gateway.milestoneId || 'missing'}`);

      console.log('\n--- DATABASE STATUS ---');
      console.log(`Attempt Found  : ${inspection.database.attemptFound ? 'Yes' : 'No'}`);
      if (inspection.database.attemptFound) {
        console.log(`Attempt Status : ${inspection.database.attemptStatus}`);
        console.log(`Attempt Amount : ${(inspection.database.attemptAmountSubunits || 0) / 100} ${inspection.database.attemptCurrency}`);
      }
      console.log(`Milestone Found: ${inspection.database.milestoneFound ? 'Yes' : 'No'}`);
      if (inspection.database.milestoneFound) {
        console.log(`Milestone State: ${inspection.database.milestoneStatus}`);
        console.log(`Milestone Cost : ${inspection.database.milestoneAmount} ${inspection.database.milestoneCurrency}`);
      }
      console.log(`Funded Ledger  : ${inspection.database.fundedLedgerEntryExists ? 'Already recorded' : 'Not recorded'}`);

      console.log('\n--- VERIFICATION RESULT ---');
      if (inspection.discrepancies.length > 0) {
        console.log('❌ Discrepancies Detected:');
        inspection.discrepancies.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
      } else {
        console.log('✓ All attributes match exactly.');
      }

      console.log(`\nAssessment: ${inspection.reason}`);

      if (inspection.canReconcile) {
        console.log('\n✅ Safe to reconcile. To execute, re-run with:');
        console.log(`   npx tsx scripts/reconcile-payment.ts ${paymentId} --execute\n`);
      } else if (inspection.alreadyReconciled) {
        console.log('\nℹ️ No action needed: Payment is already fully reconciled.\n');
      } else {
        console.log('\n⛔ Action blocked: Discrepant state requires manual financial review.\n');
      }
    } else {
      console.log('⚡ Performing Safe Atomic Reconciliation...');
      const result = await reconcileCapturedPayment(paymentId, { operatorId: operator, notes });

      if (result.success) {
        console.log(`\n🎉 Success: ${result.message}`);
        console.log(`Action: ${result.actionTaken}`);
        if (result.rpcResult) {
          console.log('RPC Result:', JSON.stringify(result.rpcResult, null, 2));
        }
      } else {
        console.error(`\n❌ Failed: ${result.message}`);
        process.exit(1);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n❌ Fatal Error during reconciliation process:', msg);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
