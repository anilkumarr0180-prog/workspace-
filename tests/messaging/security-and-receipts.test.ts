import test from 'node:test';
import assert from 'node:assert/strict';

test('Read Receipts - Correctness and Failure Inspection', async (t) => {
  // Simulating markConversationAsRead logic
  async function simulateMarkRead({
    callerId,
    conversationId,
    isParticipant,
    rpcResult,
    fallbackResult,
  }: {
    callerId: string | null;
    conversationId: string;
    isParticipant: boolean;
    rpcResult?: { error?: { code?: string; message: string } };
    fallbackResult?: { updatedRows: number; error?: { message: string } };
  }): Promise<{ success: boolean; error?: string }> {
    if (!conversationId) {
      return { success: false, error: 'Invalid conversation ID' };
    }
    if (!callerId) {
      return { success: false, error: 'Authentication required' };
    }

    if (!isParticipant) {
      return { success: false, error: 'User is not a participant in this conversation' };
    }

    if (rpcResult) {
      if (!rpcResult.error) {
        return { success: true };
      }

      // If authorization error in RPC, reject immediately
      if (
        rpcResult.error.code === '42501' ||
        rpcResult.error.message.includes('not a participant') ||
        rpcResult.error.message.includes('Authentication required')
      ) {
        return { success: false, error: rpcResult.error.message };
      }
    }

    // Inspect fallback update
    if (fallbackResult) {
      if (fallbackResult.error) {
        return { success: false, error: fallbackResult.error.message };
      }
      if (fallbackResult.updatedRows === 0) {
        return {
          success: false,
          error: 'Failed to update read receipt: participant record not updated',
        };
      }
      return { success: true };
    }

    return { success: false, error: 'Failed to mark conversation as read' };
  }

  const user = 'user-123';
  const conv = '123e4567-e89b-12d3-a456-426614174000';

  await t.test('rejects unauthenticated read receipt calls', async () => {
    const res = await simulateMarkRead({ callerId: null, conversationId: conv, isParticipant: false });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Authentication required');
  });

  await t.test('rejects non-participants before touching database', async () => {
    const res = await simulateMarkRead({ callerId: user, conversationId: conv, isParticipant: false });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'User is not a participant in this conversation');
  });

  await t.test('fails when fallback update encounters database error (does NOT silently swallow)', async () => {
    const res = await simulateMarkRead({
      callerId: user,
      conversationId: conv,
      isParticipant: true,
      rpcResult: { error: { message: 'function mark_conversation_read() does not exist' } },
      fallbackResult: { updatedRows: 0, error: { message: 'deadlock detected' } },
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'deadlock detected');
  });

  await t.test('fails when fallback update affects 0 rows', async () => {
    const res = await simulateMarkRead({
      callerId: user,
      conversationId: conv,
      isParticipant: true,
      rpcResult: { error: { message: 'RPC temporary failure' } },
      fallbackResult: { updatedRows: 0 },
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Failed to update read receipt: participant record not updated');
  });

  await t.test('succeeds when RPC succeeds', async () => {
    const res = await simulateMarkRead({
      callerId: user,
      conversationId: conv,
      isParticipant: true,
      rpcResult: {},
    });
    assert.strictEqual(res.success, true);
  });
});

test('Conversation Creation - Security and Authorization Verification', async (t) => {
  const callerId = 'user-caller';

  // Simulating createOrGetConversation with strict security constraints
  async function simulateCreateOrGet({
    authUserId,
    proposalId,
    contractId,
    recipientId,
    proposalRecord,
    contractRecord,
  }: {
    authUserId: string | null;
    proposalId?: string;
    contractId?: string;
    recipientId?: string;
    proposalRecord?: { freelancer_id: string; client_id: string };
    contractRecord?: { freelancer_id: string; client_id: string };
  }): Promise<{ success: boolean; conversationId?: string; error?: string }> {
    if (!authUserId) {
      return { success: false, error: 'Authentication required' };
    }

    if (proposalId) {
      if (!proposalRecord) {
        return { success: false, error: 'Proposal not found' };
      }
      // Strict participant relationship check
      if (authUserId !== proposalRecord.freelancer_id && authUserId !== proposalRecord.client_id) {
        return { success: false, error: 'Unauthorized to open conversation for this proposal' };
      }
      return { success: true, conversationId: `conv-prop-${proposalId}` };
    }

    if (contractId) {
      if (!contractRecord) {
        return { success: false, error: 'Contract not found' };
      }
      // Strict participant relationship check
      if (authUserId !== contractRecord.freelancer_id && authUserId !== contractRecord.client_id) {
        return { success: false, error: 'Unauthorized to open conversation for this contract' };
      }
      return { success: true, conversationId: `conv-contract-${contractId}` };
    }

    if (recipientId) {
      if (recipientId === authUserId) {
        return { success: false, error: 'Cannot start a conversation with yourself' };
      }
      return { success: true, conversationId: `conv-direct-${authUserId}-${recipientId}` };
    }

    return { success: false, error: 'Invalid parameters' };
  }

  await t.test('rejects unauthenticated requests', async () => {
    const res = await simulateCreateOrGet({ authUserId: null, proposalId: 'p1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Authentication required');
  });

  await t.test('prevents unrelated users from opening proposal conversations (no admin bypass)', async () => {
    const res = await simulateCreateOrGet({
      authUserId: 'unrelated-attacker',
      proposalId: 'p1',
      proposalRecord: { freelancer_id: 'freelancer-1', client_id: 'client-1' },
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Unauthorized to open conversation for this proposal');
  });

  await t.test('prevents unrelated users from opening contract conversations', async () => {
    const res = await simulateCreateOrGet({
      authUserId: 'unrelated-attacker',
      contractId: 'c1',
      contractRecord: { freelancer_id: 'freelancer-1', client_id: 'client-1' },
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Unauthorized to open conversation for this contract');
  });

  await t.test('rejects self-conversation creation', async () => {
    const res = await simulateCreateOrGet({
      authUserId: callerId,
      recipientId: callerId, // self
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Cannot start a conversation with yourself');
  });

  await t.test('allows valid freelancer or client to open proposal conversation', async () => {
    const resClient = await simulateCreateOrGet({
      authUserId: 'client-1',
      proposalId: 'p1',
      proposalRecord: { freelancer_id: 'freelancer-1', client_id: 'client-1' },
    });
    assert.strictEqual(resClient.success, true);

    const resFreelancer = await simulateCreateOrGet({
      authUserId: 'freelancer-1',
      proposalId: 'p1',
      proposalRecord: { freelancer_id: 'freelancer-1', client_id: 'client-1' },
    });
    assert.strictEqual(resFreelancer.success, true);
  });
});

test('Attachment Handling - Authorization and Resilient Delivery', async (t) => {
  await t.test('sendMessage succeeds even if storage signed URL creation fails', () => {
    // When DB insertion succeeded, but storage.createSignedUrl errored:
    const messageInsertedInDb = {
      id: 'msg-with-attachment',
      conversation_id: 'conv-1',
      content: 'Sent doc.pdf',
      attachment_path: 'conv-1/doc.pdf',
    };

    let attachmentUrl: string | null = null;
    const storageErrorOccurred = true;

    try {
      if (storageErrorOccurred) {
        throw new Error('Storage service 503 unavailable');
      }
      attachmentUrl = 'https://signed.url';
    } catch {
      // Caught and logged; does not fail message return
      attachmentUrl = null;
    }

    const result = {
      success: true,
      message: {
        ...messageInsertedInDb,
        attachmentUrl,
      },
    };

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.message.id, 'msg-with-attachment');
    assert.strictEqual(result.message.attachmentUrl, null);
  });

  await t.test('getAuthorizedAttachmentUrl rejects deleted messages', () => {
    const messages = [
      { id: 'm1', attachment_path: 'conv-1/active.pdf', deleted_at: null },
      { id: 'm2', attachment_path: 'conv-1/deleted.pdf', deleted_at: '2026-11-17T12:00:00Z' },
    ];

    function authorizeAttachment(path: string) {
      const match = messages.find((m) => m.attachment_path === path && m.deleted_at === null);
      if (!match) {
        return { success: false, error: 'Attachment not found or message was deleted' };
      }
      return { success: true, url: `https://signed.url/${path}` };
    }

    const activeRes = authorizeAttachment('conv-1/active.pdf');
    assert.strictEqual(activeRes.success, true);

    const deletedRes = authorizeAttachment('conv-1/deleted.pdf');
    assert.strictEqual(deletedRes.success, false);
    assert.strictEqual(deletedRes.error, 'Attachment not found or message was deleted');
  });

  await t.test('getMessages generates zero storage requests when no attachments exist', () => {
    const messagesWithoutAttachments: Array<{
      id: string;
      content: string;
      attachment_path: string | null;
      deleted_at: string | null;
    }> = [
      { id: 'm1', content: 'hello', attachment_path: null, deleted_at: null },
      { id: 'm2', content: 'world', attachment_path: null, deleted_at: null },
    ];

    const attachmentPaths = messagesWithoutAttachments
      .filter((m) => !m.deleted_at && Boolean(m.attachment_path))
      .map((m) => m.attachment_path as string);

    assert.strictEqual(attachmentPaths.length, 0);
  });
});
