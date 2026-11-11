import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, loginViaUI, adminClient } from './helpers';

test.describe('Real-Time Messaging System E2E Suite', () => {
  let clientUser: Awaited<ReturnType<typeof createTestUser>>;
  let freelancerUser: Awaited<ReturnType<typeof createTestUser>>;
  let thirdPartyUser: Awaited<ReturnType<typeof createTestUser>>;
  let jobId: string;
  let proposalId: string;
  let conversationId: string;

  test.beforeAll(async () => {
    // Provision 3 distinct users: client, freelancer, unrelated third-party
    clientUser = await createTestUser('client', 'msg_client');
    freelancerUser = await createTestUser('freelancer', 'msg_freelancer');
    thirdPartyUser = await createTestUser('client', 'msg_unrelated');

    // Fetch category
    const { data: category } = await adminClient
      .from('categories')
      .select('id')
      .limit(1)
      .single();

    // Create a job for the client
    const { data: job, error: jobErr } = await adminClient
      .from('jobs')
      .insert({
        client_id: clientUser.id,
        title: 'Full-Stack Messaging Feature Integration',
        description: 'Need a senior engineer to implement Supabase realtime messaging.',
        category_id: category?.id,
        project_type: 'fixed',
        experience_level: 'expert',
        budget_min: 3500,
        budget_max: 3500,
        duration: '1_to_3_months',
        status: 'published',
      })
      .select('id')
      .single();

    if (jobErr || !job) throw new Error(`Job creation failed: ${jobErr?.message}`);
    jobId = job.id;

    // Submit proposal from freelancer
    const { data: proposal, error: propErr } = await adminClient
      .from('proposals')
      .insert({
        job_id: jobId,
        freelancer_id: freelancerUser.id,
        cover_letter: 'I have extensive experience with Supabase Realtime, PostgreSQL RLS, and Next.js 16.',
        bid_amount: 3500,
        rate_type: 'fixed',
        delivery_days: 14,
        status: 'submitted',
      })
      .select('id')
      .single();

    if (propErr || !proposal) throw new Error(`Proposal creation failed: ${propErr?.message}`);
    proposalId = proposal.id;

    // Initialize conversation and participants
    const { data: conv, error: convErr } = await adminClient
      .from('conversations')
      .insert({
        created_by: freelancerUser.id,
        job_id: jobId,
        proposal_id: proposalId,
        title: 'Full-Stack Messaging Feature Integration',
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (convErr || !conv) throw new Error(`Conversation creation failed: ${convErr?.message}`);
    conversationId = conv.id;

    await adminClient.from('conversation_participants').insert([
      { conversation_id: conversationId, user_id: clientUser.id },
      { conversation_id: conversationId, user_id: freelancerUser.id },
    ]);
  });

  test.afterAll(async () => {
    // Clean up
    if (conversationId) {
      await adminClient.from('messages').delete().eq('conversation_id', conversationId);
      await adminClient.from('conversation_participants').delete().eq('conversation_id', conversationId);
      await adminClient.from('conversations').delete().eq('id', conversationId);
    }
    if (proposalId) {
      await adminClient.from('contracts').delete().eq('proposal_id', proposalId);
      await adminClient.from('proposals').delete().eq('id', proposalId);
    }
    if (jobId) {
      await adminClient.from('jobs').delete().eq('id', jobId);
    }
    if (clientUser?.id) await deleteTestUser(clientUser.id);
    if (freelancerUser?.id) await deleteTestUser(freelancerUser.id);
    if (thirdPartyUser?.id) await deleteTestUser(thirdPartyUser.id);
  });

  test('7.1 Authenticated client and freelancer messaging exchange via UI', async ({ browser }) => {
    // Create two isolated browser contexts for true multi-session testing
    const clientContext = await browser.newContext();
    const freelancerContext = await browser.newContext();

    const clientPage = await clientContext.newPage();
    const freelancerPage = await freelancerContext.newPage();

    // 1. Log in both users via UI
    await loginViaUI(clientPage, clientUser);
    await loginViaUI(freelancerPage, freelancerUser);

    // 2. Both navigate to the conversation URL
    await clientPage.goto(`/messages/${conversationId}`);
    await freelancerPage.goto(`/messages/${conversationId}`);

    // Verify chat UI loaded on both sides
    await expect(clientPage.locator('#messages-inbox-header')).toBeVisible({ timeout: 15000 });
    await expect(freelancerPage.locator('#messages-inbox-header')).toBeVisible({ timeout: 15000 });

    // Verify conversation participant details
    await expect(clientPage.locator('#chat-participant-name')).toContainText(freelancerUser.fullName);
    await expect(freelancerPage.locator('#chat-participant-name')).toContainText(clientUser.fullName);

    // 3. Freelancer sends a message
    const freelancerMsgText = 'Hello Client! I am excited to work on this real-time messaging project.';
    await freelancerPage.fill('#chat-message-textarea', freelancerMsgText);
    await freelancerPage.click('#chat-send-message-btn');

    // 4. Verify message appears in freelancer window (inside message item)
    await expect(freelancerPage.locator('div[id^="message-item-"]').getByText(freelancerMsgText).first()).toBeVisible({ timeout: 10000 });

    // 5. Client replies
    const clientReplyText = 'Welcome aboard! Let us review the milestones and kick off.';
    await clientPage.fill('#chat-message-textarea', clientReplyText);
    await clientPage.click('#chat-send-message-btn');

    // Verify message appears in client window
    await expect(clientPage.locator('div[id^="message-item-"]').getByText(clientReplyText).first()).toBeVisible({ timeout: 10000 });

    // Close contexts
    await clientContext.close();
    await freelancerContext.close();
  });

  test('7.2 Unrelated third-party user cannot access private conversation', async ({ browser }) => {
    const thirdPartyContext = await browser.newContext();
    const thirdPartyPage = await thirdPartyContext.newPage();

    await loginViaUI(thirdPartyPage, thirdPartyUser);

    // Attempt direct URL access to private conversation
    await thirdPartyPage.goto(`/messages/${conversationId}`);

    // Verify that the conversation is NOT loaded or user is redirected / shown empty state
    await thirdPartyPage.waitForTimeout(2000);
    // Chat header should not reveal the other users' conversation participant details
    const participantNameVisible = await thirdPartyPage.locator('#chat-participant-name').isVisible();
    expect(participantNameVisible).toBeFalsy();

    await thirdPartyContext.close();
  });

  test('7.3 Mobile responsiveness - inbox and chat toggle view', async ({ browser }) => {
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 }, // iPhone SE dimensions
    });
    const mobilePage = await mobileContext.newPage();

    await loginViaUI(mobilePage, freelancerUser);

    // Navigate to /messages (inbox view)
    await mobilePage.goto('/messages');
    await expect(mobilePage.locator('#messages-inbox-header')).toBeVisible({ timeout: 15000 });

    // Open conversation
    const convCard = mobilePage.locator(`button:has-text("${clientUser.fullName}")`).first();
    await expect(convCard).toBeVisible({ timeout: 10000 });
    await convCard.click();

    // Chat header should now be visible on mobile
    await expect(mobilePage.locator('#back-to-inbox-button').first()).toBeVisible({ timeout: 10000 });

    // Click back button to return to inbox
    await mobilePage.locator('#back-to-inbox-button').first().click();
    await expect(mobilePage.locator('#messages-inbox-header').first()).toBeVisible({ timeout: 10000 });

    await mobileContext.close();
  });
});
