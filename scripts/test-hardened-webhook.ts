import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Read secrets directly from .env.local for local testing
const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
const secretMatch = envContent.match(/RAZORPAY_WEBHOOK_SECRET=([^\r\n]+)/);

if (!secretMatch || !secretMatch[1]) {
  console.error('Missing RAZORPAY_WEBHOOK_SECRET in .env.local');
  process.exit(1);
}

const webhookSecret = secretMatch[1].trim();
const baseUrl = 'http://localhost:3000';

interface AssertionResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: AssertionResult[] = [];

function assert(condition: boolean, name: string, details?: string) {
  if (condition) {
    results.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } else {
    results.push({ name, passed: false, details });
    console.error(`  ✗ ${name} — ${details || 'Assertion failed'}`);
  }
}

async function sendWebhook(payloadObj: Record<string, unknown>, customSig?: string) {
  const rawBody = JSON.stringify(payloadObj);
  const signature = customSig !== undefined
    ? customSig
    : crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  const res = await fetch(`${baseUrl}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signature ? { 'x-razorpay-signature': signature } : {}),
    },
    body: rawBody,
  });

  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // Non-json response
  }

  return { status: res.status, json };
}

async function runSuite() {
  console.log('\n🔒 Running Hardened Razorpay Webhook Test Suite...\n');

  const validMilestoneId = 'e09c5527-89bc-46ef-9622-eeb3eb7d5aa7';
  const validOrderId = 'order_TtFlMpjGK7GYs3';
  const validPaymentId = 'pay_TtFqzAaVOs8kBN';

  // 1. Missing Signature Header
  const res1 = await sendWebhook({ event: 'payment.captured' }, '');
  const errStr1 = typeof res1.json?.error === 'string' ? res1.json.error : '';
  assert(res1.status === 400 && errStr1.includes('Missing x-razorpay-signature'),
    'Test 1: Missing signature header rejected with HTTP 400');

  // 2. Invalid / Tampered Signature
  const res2 = await sendWebhook({ event: 'payment.captured' }, 'deadbeef_invalid_sig_1234');
  assert(res2.status === 400 && res2.json?.error === 'Invalid webhook signature',
    'Test 2: Invalid/tampered signature rejected with HTTP 400');

  // 3. Missing Milestone ID in Notes
  const res3 = await sendWebhook({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: validPaymentId,
          order_id: validOrderId,
          status: 'captured',
          amount: 50000,
          currency: 'USD',
          notes: {},
        },
      },
    },
  });
  assert(res3.status === 400 && res3.json?.code === 'MISSING_MILESTONE_ID',
    'Test 3: Missing milestone_id in notes fails closed with HTTP 400');

  // 4. Missing Order ID
  const res4 = await sendWebhook({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: validPaymentId,
          status: 'captured',
          amount: 50000,
          currency: 'USD',
          notes: { milestone_id: validMilestoneId },
        },
      },
    },
  });
  assert(res4.status === 400 && res4.json?.code === 'MISSING_ORDER_ID',
    'Test 4: Missing order_id in webhook payload fails closed with HTTP 400');

  // 5. Non-Existent Payment Attempt (Untracked Order)
  const res5 = await sendWebhook({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_untracked_99999',
          order_id: 'order_NONEXISTENT_9999',
          status: 'captured',
          amount: 50000,
          currency: 'USD',
          notes: { milestone_id: validMilestoneId },
        },
      },
    },
  });
  assert(res5.status === 400 && res5.json?.code === '23503',
    'Test 5: Non-existent order attempt fails closed with HTTP 400 (code 23503)');

  // 6. Amount Mismatch (Underpayment Tampering: 49999 instead of 50000)
  const res6 = await sendWebhook({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: validPaymentId,
          order_id: validOrderId,
          status: 'captured',
          amount: 49999, // tampered amount
          currency: 'USD',
          notes: { milestone_id: validMilestoneId },
        },
      },
    },
  });
  assert(res6.status === 400 && res6.json?.code === '22023',
    'Test 6: Amount mismatch fails closed with HTTP 400 (code 22023)');

  // 7. Currency Mismatch (EUR instead of USD)
  const res7 = await sendWebhook({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: validPaymentId,
          order_id: validOrderId,
          status: 'captured',
          amount: 50000,
          currency: 'EUR', // tampered currency
          notes: { milestone_id: validMilestoneId },
        },
      },
    },
  });
  assert(res7.status === 400 && res7.json?.code === '22023',
    'Test 7: Currency mismatch fails closed with HTTP 400 (code 22023)');

  // 8. Uncaptured Payment Status (e.g., status is 'failed')
  const res8 = await sendWebhook({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: validPaymentId,
          order_id: validOrderId,
          status: 'failed',
          amount: 50000,
          currency: 'USD',
          notes: { milestone_id: validMilestoneId },
        },
      },
    },
  });
  assert(res8.status === 200 && res8.json?.ignored === true,
    'Test 8: Uncaptured payment status is safely ignored with HTTP 200');

  // 9. Unhandled Event Type (e.g., refund.processed)
  const res9 = await sendWebhook({
    event: 'refund.processed',
    payload: {
      payment: {
        entity: {
          id: validPaymentId,
          order_id: validOrderId,
          status: 'captured',
          amount: 50000,
          currency: 'USD',
          notes: { milestone_id: validMilestoneId },
        },
      },
    },
  });
  assert(res9.status === 200 && res9.json?.ignored === true,
    'Test 9: Unhandled event type safely acknowledged with HTTP 200');

  // 10. Valid payment.captured on Already-Funded Milestone (Idempotency)
  const res10 = await sendWebhook({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: validPaymentId,
          order_id: validOrderId,
          status: 'captured',
          amount: 50000,
          currency: 'USD',
          notes: { milestone_id: validMilestoneId },
        },
      },
    },
  });
  assert(res10.status === 200 && res10.json?.received === true && res10.json?.idempotent === true,
    'Test 10: payment.captured on funded milestone returns HTTP 200 idempotent');

  // 11. Valid order.paid Event on Already-Funded Milestone (Deliberate Order Handling)
  const res11 = await sendWebhook({
    event: 'order.paid',
    payload: {
      order: {
        entity: {
          id: validOrderId,
          status: 'paid',
          amount: 50000,
          currency: 'USD',
          notes: { milestone_id: validMilestoneId },
        },
      },
      payment: {
        entity: {
          id: validPaymentId,
          order_id: validOrderId,
          status: 'captured',
          amount: 50000,
          currency: 'USD',
          notes: { milestone_id: validMilestoneId },
        },
      },
    },
  });
  assert(res11.status === 200 && res11.json?.received === true && res11.json?.idempotent === true,
    'Test 11: order.paid event returns HTTP 200 idempotent without double-processing');

  // 12. Concurrent Webhook Deliveries (Race Condition Resistance)
  const payloadToDuplicate = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: validPaymentId,
          order_id: validOrderId,
          status: 'captured',
          amount: 50000,
          currency: 'USD',
          notes: { milestone_id: validMilestoneId },
        },
      },
    },
  };

  const [conc1, conc2, conc3] = await Promise.all([
    sendWebhook(payloadToDuplicate),
    sendWebhook(payloadToDuplicate),
    sendWebhook(payloadToDuplicate),
  ]);

  const allConcSuccess = conc1.status === 200 && conc2.status === 200 && conc3.status === 200;
  assert(allConcSuccess, 'Test 12: Concurrent webhook deliveries all serialize and return HTTP 200');

  console.log('\n--- Summary ---');
  const totalPassed = results.filter((r) => r.passed).length;
  console.log(`Total Passed: ${totalPassed} / ${results.length}`);

  if (totalPassed === results.length) {
    console.log('🎉 All Hardened Webhook assertions PASSED!\n');
    process.exit(0);
  } else {
    console.error('❌ Some assertions failed.\n');
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
