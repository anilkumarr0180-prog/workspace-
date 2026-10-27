/**
 * Automated Verification Test Suite for Proposals & Saved Jobs APIs
 * Runs comprehensive test cases against the live running API server.
 */

const BASE_URL = 'http://localhost:3000';

interface TestCase {
  name: string;
  run: () => Promise<{ passed: boolean; message: string; details?: unknown }>;
}

async function runTests() {
  console.log('====================================================');
  console.log('PROPOSALS & SAVED JOBS API AUTOMATED VERIFICATION');
  console.log('====================================================\n');

  const tests: TestCase[] = [
    // ----------------------------------------------------
    // PROPOSALS API TESTS
    // ----------------------------------------------------
    {
      name: '1. GET /api/proposals — Unauthenticated Access',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals`);
        const json = await res.json();
        const passed = res.status === 401 && (json.code === 'UNAUTHENTICATED' || json.error?.includes('Authentication'));
        return {
          passed,
          message: passed ? 'Successfully rejected with 401 UNAUTHENTICATED' : `Failed: HTTP ${res.status} ${JSON.stringify(json)}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '2. POST /api/proposals — Unauthenticated Proposal Submission',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: '00000000-0000-0000-0000-000000000001',
            bidAmount: 1500,
            rateType: 'fixed',
            deliveryDays: 14,
            coverLetter: 'This is a test cover letter that exceeds fifty characters in length easily.'
          })
        });
        const json = await res.json();
        const passed = res.status === 401 && json.code === 'UNAUTHENTICATED';
        return {
          passed,
          message: passed ? 'Successfully blocked with 401 UNAUTHENTICATED' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '3. POST /api/proposals — Invalid Input Validation (Short Cover Letter < 50 chars)',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: '00000000-0000-0000-0000-000000000001',
            bidAmount: 500,
            rateType: 'fixed',
            coverLetter: 'Too short'
          })
        });
        const json = await res.json();
        const passed = res.status === 400 && Boolean(json.fieldErrors?.coverLetter);
        return {
          passed,
          message: passed ? 'Validation correctly failed with 400 and coverLetter field error' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '4. POST /api/proposals — Invalid Input Validation (Negative Bid & Bad Rate Type)',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: '00000000-0000-0000-0000-000000000001',
            bidAmount: -50,
            rateType: 'invalid_type',
            coverLetter: 'This is a valid length cover letter that has more than fifty characters.'
          })
        });
        const json = await res.json();
        const passed = res.status === 400 && Boolean(json.fieldErrors?.bidAmount) && Boolean(json.fieldErrors?.rateType);
        return {
          passed,
          message: passed ? 'Validation correctly failed with 400 and bidAmount/rateType field errors' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '5. POST /api/proposals — Invalid Job ID Format',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: 'not-a-valid-uuid',
            bidAmount: 1000,
            rateType: 'fixed',
            coverLetter: 'This is a test cover letter that exceeds fifty characters in length easily.'
          })
        });
        const json = await res.json();
        const passed = (res.status === 400 && Boolean(json.fieldErrors?.jobId)) || (res.status === 404 && json.code === 'JOB_NOT_FOUND');
        return {
          passed,
          message: passed ? `Correctly rejected invalid job ID format with HTTP ${res.status}` : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '6. PATCH /api/proposals/[id] — Unauthenticated Status Modification',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals/00000000-0000-0000-0000-000000000001`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'withdrawn' })
        });
        const json = await res.json();
        const passed = res.status === 401 && json.code === 'UNAUTHENTICATED';
        return {
          passed,
          message: passed ? 'Blocked status transition with 401 UNAUTHENTICATED' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '7. PATCH /api/proposals/[id] — Invalid Target Status',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals/00000000-0000-0000-0000-000000000001`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'invalid_status_xyz' })
        });
        const json = await res.json();
        const passed = res.status === 400 && json.code === 'INVALID_STATUS';
        return {
          passed,
          message: passed ? 'Blocked invalid status string with 400 INVALID_STATUS' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '8. PATCH /api/proposals/[id] — Missing Status Body',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals/00000000-0000-0000-0000-000000000001`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const json = await res.json();
        const passed = res.status === 400;
        return {
          passed,
          message: passed ? 'Rejected empty PATCH body with 400' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },

    // ----------------------------------------------------
    // SAVED JOBS API TESTS
    // ----------------------------------------------------
    {
      name: '9. GET /api/saved-jobs — Unauthenticated Access',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/saved-jobs`);
        const json = await res.json();
        const passed = res.status === 401 && (json.code === 'UNAUTHENTICATED' || json.error?.includes('Authentication'));
        return {
          passed,
          message: passed ? 'Successfully rejected with 401 UNAUTHENTICATED' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '10. POST /api/saved-jobs — Unauthenticated Access',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/saved-jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: '00000000-0000-0000-0000-000000000001' })
        });
        const json = await res.json();
        const passed = res.status === 401 && json.code === 'UNAUTHENTICATED';
        return {
          passed,
          message: passed ? 'Blocked save job with 401 UNAUTHENTICATED' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '11. POST /api/saved-jobs — Missing or Invalid Job ID',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/saved-jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: '' })
        });
        const json = await res.json();
        const passed = res.status === 400;
        return {
          passed,
          message: passed ? 'Rejected empty jobId with 400' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '12. DELETE /api/saved-jobs/[id] — Unauthenticated Access',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/saved-jobs/00000000-0000-0000-0000-000000000001`, {
          method: 'DELETE'
        });
        const json = await res.json();
        const passed = res.status === 401 && json.code === 'UNAUTHENTICATED';
        return {
          passed,
          message: passed ? 'Blocked unsave job with 401 UNAUTHENTICATED' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '13. DELETE /api/saved-jobs/[id] — Non-UUID Job ID Format',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/saved-jobs/not-a-valid-uuid`, {
          method: 'DELETE'
        });
        const json = await res.json();
        // Since auth check runs first, it should return 401 when unauthenticated
        const passed = res.status === 401 || res.status === 400 || res.status === 404;
        return {
          passed,
          message: passed ? `Handled safely with status ${res.status}` : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '14. GET /api/proposals?jobId=...&as=client — Unauthenticated Scoped Client Access',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals?jobId=00000000-0000-0000-0000-000000000001&as=client`);
        const json = await res.json();
        const passed = res.status === 401 && (json.code === 'UNAUTHENTICATED' || json.error?.includes('Authentication'));
        return {
          passed,
          message: passed ? 'Blocked unauthenticated scoped client proposals with 401' : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    },
    {
      name: '15. GET /api/proposals?jobId=invalid-uuid&as=client — Invalid UUID Format Handling',
      run: async () => {
        const res = await fetch(`${BASE_URL}/api/proposals?jobId=invalid-uuid&as=client`);
        const json = await res.json();
        const passed = res.status === 400 || res.status === 401;
        return {
          passed,
          message: passed ? `Rejected or challenged invalid UUID with HTTP ${res.status}` : `Failed: HTTP ${res.status}`,
          details: { status: res.status, body: json }
        };
      }
    }
  ];

  let passedCount = 0;
  for (const t of tests) {
    try {
      const result = await t.run();
      if (result.passed) {
        console.log(`[PASS] ${t.name}`);
        console.log(`       ${result.message}`);
        passedCount++;
      } else {
        console.error(`[FAIL] ${t.name}`);
        console.error(`       ${result.message}`);
        console.error(`       Details:`, result.details);
      }
    } catch (err) {
      console.error(`[ERROR] ${t.name}:`, err);
    }
    console.log('');
  }

  console.log('----------------------------------------------------');
  console.log(`Results: ${passedCount} / ${tests.length} tests passed.`);
  console.log('----------------------------------------------------');

  if (passedCount !== tests.length) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
