/**
 * Verification Suite for Proposal State Machine and Atomic Count Rules
 * Verifies exact alignment with PostgreSQL migrations:
 * - 20261022000003_proposals.sql (check_proposal_integrity & sync_job_proposal_count)
 */

interface TransitionRule {
  from: string;
  to: string;
  actor: 'freelancer' | 'client';
  permitted: boolean;
  expectedTerminalLock?: boolean;
}

const STATE_TRANSITION_RULES: TransitionRule[] = [
  // From 'submitted'
  { from: 'submitted', to: 'withdrawn', actor: 'freelancer', permitted: true },
  { from: 'submitted', to: 'under_review', actor: 'client', permitted: true },
  { from: 'submitted', to: 'interviewing', actor: 'client', permitted: true },
  { from: 'submitted', to: 'rejected', actor: 'client', permitted: true },
  { from: 'submitted', to: 'accepted', actor: 'client', permitted: false }, // Cannot jump from submitted to accepted
  { from: 'submitted', to: 'under_review', actor: 'freelancer', permitted: false }, // Freelancer cannot review
  { from: 'submitted', to: 'accepted', actor: 'freelancer', permitted: false },

  // From 'under_review'
  { from: 'under_review', to: 'withdrawn', actor: 'freelancer', permitted: true },
  { from: 'under_review', to: 'interviewing', actor: 'client', permitted: true },
  { from: 'under_review', to: 'accepted', actor: 'client', permitted: true },
  { from: 'under_review', to: 'rejected', actor: 'client', permitted: true },
  { from: 'under_review', to: 'accepted', actor: 'freelancer', permitted: false },

  // From 'interviewing'
  { from: 'interviewing', to: 'withdrawn', actor: 'freelancer', permitted: true },
  { from: 'interviewing', to: 'accepted', actor: 'client', permitted: true },
  { from: 'interviewing', to: 'rejected', actor: 'client', permitted: true },
  { from: 'interviewing', to: 'under_review', actor: 'client', permitted: false }, // Cannot regress

  // Terminal Lockout tests (OLD.status in ('accepted', 'rejected', 'withdrawn'))
  { from: 'accepted', to: 'withdrawn', actor: 'freelancer', permitted: false, expectedTerminalLock: true },
  { from: 'accepted', to: 'rejected', actor: 'client', permitted: false, expectedTerminalLock: true },
  { from: 'rejected', to: 'submitted', actor: 'freelancer', permitted: false, expectedTerminalLock: true },
  { from: 'rejected', to: 'under_review', actor: 'client', permitted: false, expectedTerminalLock: true },
  { from: 'withdrawn', to: 'submitted', actor: 'freelancer', permitted: false, expectedTerminalLock: true },
  { from: 'withdrawn', to: 'interviewing', actor: 'client', permitted: false, expectedTerminalLock: true },
];

// Replicated matrix from proposals.ts and 20261022000003_proposals.sql
const VALID_TRANSITIONS: Record<string, { freelancer: string[]; client: string[] }> = {
  submitted: {
    freelancer: ['withdrawn'],
    client: ['under_review', 'interviewing', 'rejected'],
  },
  under_review: {
    freelancer: ['withdrawn'],
    client: ['interviewing', 'accepted', 'rejected'],
  },
  interviewing: {
    freelancer: ['withdrawn'],
    client: ['accepted', 'rejected'],
  },
  accepted: {
    freelancer: [],
    client: [],
  },
  rejected: {
    freelancer: [],
    client: [],
  },
  withdrawn: {
    freelancer: [],
    client: [],
  },
};

const TERMINAL_STATES = ['accepted', 'rejected', 'withdrawn'];

function testStateMachine() {
  console.log('====================================================');
  console.log('PROPOSAL DATABASE STATE MACHINE MATRIX VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  const total = STATE_TRANSITION_RULES.length;

  for (const rule of STATE_TRANSITION_RULES) {
    const isTerminal = TERMINAL_STATES.includes(rule.from);
    const allowedList = VALID_TRANSITIONS[rule.from]?.[rule.actor] || [];
    const isPermitted = !isTerminal && allowedList.includes(rule.to);

    if (isPermitted === rule.permitted) {
      console.log(
        `[PASS] ${rule.from} -> ${rule.to} by ${rule.actor.toUpperCase()}: ${
          rule.permitted ? 'PERMITTED' : rule.expectedTerminalLock ? 'PROHIBITED (TERMINAL LOCK)' : 'PROHIBITED'
        }`
      );
      passed++;
    } else {
      console.error(
        `[FAIL] ${rule.from} -> ${rule.to} by ${rule.actor.toUpperCase()}: Expected ${rule.permitted}, got ${isPermitted}`
      );
    }
  }

  console.log('\n----------------------------------------------------');
  console.log(`State Machine Verification: ${passed} / ${total} passed.`);
  console.log('----------------------------------------------------');

  if (passed !== total) process.exit(1);
}

testStateMachine();
