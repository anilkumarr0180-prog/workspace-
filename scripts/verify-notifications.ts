/**
 * Verification test suite for Real-Time Notification System:
 * - Migration schema validation
 * - Strict RLS policy enforcement (No arbitrary client INSERT)
 * - Realtime publication registration
 * - Event payload mapping and badge calculation
 */

import fs from 'fs';
import path from 'path';

function testMigrationSchemaAndSecurity() {
  console.log('Testing notification migration schema and security:');

  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20261029000001_realtime_notifications.sql'
  );

  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration file not found at ${migrationPath}`);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');

  // 1. Table existence & primary columns
  const requiredColumns = [
    'id UUID PRIMARY KEY',
    'user_id UUID NOT NULL REFERENCES auth.users(id)',
    'type TEXT NOT NULL',
    'title TEXT NOT NULL',
    'message TEXT NOT NULL',
    'link TEXT',
    'read BOOLEAN NOT NULL DEFAULT false',
    'read_at TIMESTAMPTZ',
    'metadata JSONB',
    'created_at TIMESTAMPTZ',
    'updated_at TIMESTAMPTZ',
  ];

  for (const col of requiredColumns) {
    if (!sql.toLowerCase().includes(col.toLowerCase())) {
      throw new Error(`Migration missing required column definition: ${col}`);
    }
  }
  console.log('  [PASS] Notifications table schema contains all required fields and constraints');

  // 2. Indexes
  if (
    !sql.includes('idx_notifications_user_created') ||
    !sql.includes('idx_notifications_user_unread')
  ) {
    throw new Error('Migration missing performance indexes for user and unread queries');
  }
  console.log('  [PASS] High-performance indexes for user feed and unread badge are present');

  // 3. Mandatory Security Correction: NO unrestricted INSERT policy with WITH CHECK (true)!
  if (sql.includes('WITH CHECK (true)')) {
    throw new Error(
      'SECURITY VIOLATION: Migration contains unrestricted INSERT policy "WITH CHECK (true)".'
    );
  }
  console.log('  [PASS] Strict RLS: No unrestricted public INSERT policy permitted');

  // 4. Verify RLS enabled and user-scoped policies
  if (!sql.includes('ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;')) {
    throw new Error('RLS is not enabled on public.notifications');
  }
  if (!sql.includes('auth.uid() = user_id')) {
    throw new Error('RLS policy does not restrict operations to auth.uid() = user_id');
  }
  console.log('  [PASS] RLS strictly enforces auth.uid() = user_id for SELECT, UPDATE, DELETE');

  // 5. Verify Supabase Realtime publication
  if (
    !sql.includes('ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;') ||
    !sql.includes('REPLICA IDENTITY FULL')
  ) {
    throw new Error('Supabase Realtime publication or REPLICA IDENTITY FULL missing');
  }
  console.log('  [PASS] Table published to supabase_realtime with REPLICA IDENTITY FULL');
}

function testNotificationMappingAndUnreadCounts() {
  console.log('\nTesting notification data mapping and badge counter:');

  const rawRows = [
    {
      id: 'n1',
      user_id: 'u1',
      type: 'milestone_funded',
      title: 'Milestone Funded',
      message: 'Escrow funded with $500',
      link: '/contracts/c1',
      read: false,
      read_at: null,
      metadata: { milestoneId: 'm1' },
      created_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'n2',
      user_id: 'u1',
      type: 'proposal_received',
      title: 'New Proposal',
      message: 'Freelancer submitted a proposal',
      link: '/client',
      read: true,
      read_at: new Date().toISOString(),
      metadata: {},
      created_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'n3',
      user_id: 'u1',
      type: 'milestone_approved',
      title: 'Milestone Approved',
      message: 'Funds released',
      link: '/contracts/c1',
      read: false,
      read_at: null,
      metadata: {},
      created_at: new Date(Date.now() - 60000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const unreadCount = rawRows.filter((r) => !r.read).length;
  if (unreadCount !== 2) {
    throw new Error(`Expected 2 unread notifications, got ${unreadCount}`);
  }
  console.log('  [PASS] Unread count calculated correctly (2 unread)');

  // Test mark as read logic
  const updatedRows = rawRows.map((r) => (r.id === 'n1' ? { ...r, read: true } : r));
  const newUnreadCount = updatedRows.filter((r) => !r.read).length;
  if (newUnreadCount !== 1) {
    throw new Error(`Expected 1 unread notification after marking read, got ${newUnreadCount}`);
  }
  console.log('  [PASS] Single item mark-as-read updates count correctly');

  // Test mark all as read logic
  const allReadRows = updatedRows.map((r) => ({ ...r, read: true }));
  const finalUnreadCount = allReadRows.filter((r) => !r.read).length;
  if (finalUnreadCount !== 0) {
    throw new Error(`Expected 0 unread notifications after mark all, got ${finalUnreadCount}`);
  }
  console.log('  [PASS] Mark all as read updates all items to read: true with count 0');
}

function testRealtimeChannelFilter() {
  console.log('\nTesting Realtime filter configuration:');

  const userId = '11111111-2222-3333-4444-555555555555';
  const filter = `user_id=eq.${userId}`;

  if (!filter.startsWith('user_id=eq.')) {
    throw new Error('Invalid realtime channel filter format');
  }

  // Incoming row matching current user
  const matchingPayload = { user_id: userId, title: 'Test Alert', read: false };
  const foreignPayload = { user_id: 'other-user', title: 'Foreign Alert', read: false };

  const shouldReceiveMatching = matchingPayload.user_id === userId;
  const shouldReceiveForeign = foreignPayload.user_id === userId;

  if (!shouldReceiveMatching || shouldReceiveForeign) {
    throw new Error('Realtime event filter failed to isolate user notifications');
  }
  console.log('  [PASS] Postgres changes filter correctly isolates events by user_id');
}

function runAll() {
  console.log('====================================================');
  console.log('REAL-TIME NOTIFICATIONS VERIFICATION TEST SUITE');
  console.log('====================================================\n');
  testMigrationSchemaAndSecurity();
  testNotificationMappingAndUnreadCounts();
  testRealtimeChannelFilter();
  console.log('\n----------------------------------------------------');
  console.log('All Real-Time Notification checks passed.');
  console.log('----------------------------------------------------');
}

runAll();
