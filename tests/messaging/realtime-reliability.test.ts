import test from 'node:test';
import assert from 'node:assert/strict';

test('Realtime Reliability - Channel State Machine and Fallback Polling', async (t) => {
  class MockRealtimeManager {
    public isConnected = false;
    public fallbackPollingActive = false;
    public recoveryFetchCount = 0;
    public isRecovering = false;
    private pollInterval: NodeJS.Timeout | null = null;

    public handleStatusChange(status: string) {
      if (status === 'SUBSCRIBED') {
        this.isConnected = true;
        this.stopFallbackPolling();
        this.triggerRecovery();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.isConnected = false;
        this.startFallbackPolling();
      }
    }

    public startFallbackPolling() {
      if (this.fallbackPollingActive) return;
      this.fallbackPollingActive = true;
      this.pollInterval = setInterval(() => {
        if (!this.isConnected) {
          this.triggerRecovery();
        }
      }, 6000);
    }

    public stopFallbackPolling() {
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
      this.fallbackPollingActive = false;
    }

    public triggerRecovery() {
      if (this.isRecovering) {
        return; // Prevent overlapping recovery requests
      }
      this.isRecovering = true;
      this.recoveryFetchCount++;
      // simulate recovery complete
      this.isRecovering = false;
    }

    public cleanup() {
      this.stopFallbackPolling();
      this.isConnected = false;
    }
  }

  await t.test('handles SUBSCRIBED: enables connection, disables polling, triggers recovery', () => {
    const manager = new MockRealtimeManager();
    manager.startFallbackPolling();
    assert.strictEqual(manager.fallbackPollingActive, true);

    manager.handleStatusChange('SUBSCRIBED');
    assert.strictEqual(manager.isConnected, true);
    assert.strictEqual(manager.fallbackPollingActive, false);
    assert.strictEqual(manager.recoveryFetchCount, 1);
    manager.cleanup();
  });

  await t.test('handles CHANNEL_ERROR, TIMED_OUT, CLOSED: disables connection, enables fallback polling', () => {
    const manager = new MockRealtimeManager();
    manager.handleStatusChange('SUBSCRIBED');
    assert.strictEqual(manager.isConnected, true);
    assert.strictEqual(manager.fallbackPollingActive, false);

    // Channel error
    manager.handleStatusChange('CHANNEL_ERROR');
    assert.strictEqual(manager.isConnected, false);
    assert.strictEqual(manager.fallbackPollingActive, true);

    // Timed out
    manager.handleStatusChange('TIMED_OUT');
    assert.strictEqual(manager.isConnected, false);
    assert.strictEqual(manager.fallbackPollingActive, true);

    // Closed
    manager.handleStatusChange('CLOSED');
    assert.strictEqual(manager.isConnected, false);
    assert.strictEqual(manager.fallbackPollingActive, true);
    manager.cleanup();
  });

  await t.test('prevents overlapping recovery requests during focus or poll', () => {
    const manager = new MockRealtimeManager();
    manager.isRecovering = true; // In-flight request in progress

    // Attempt second recovery (e.g. from window focus)
    manager.triggerRecovery();
    assert.strictEqual(manager.recoveryFetchCount, 0); // Not incremented because overlapping request was blocked

    manager.isRecovering = false;
    manager.triggerRecovery();
    assert.strictEqual(manager.recoveryFetchCount, 1);
    manager.cleanup();
  });
});

test('Realtime Reliability - Duplicate Event Prevention', async (t) => {
  interface Message {
    id: string;
    content: string;
    senderId: string;
    createdAt: string;
  }

  class MessageStore {
    public messages: Message[] = [];
    public processedIds = new Set<string>();

    public handleIncomingMessage(msg: Message) {
      if (this.processedIds.has(msg.id)) {
        return; // Deduplicate
      }
      this.processedIds.add(msg.id);

      // Reconcile optimistic message
      const filtered = this.messages.filter(
        (m) =>
          m.id !== msg.id &&
          !(
            m.id.startsWith('temp-') &&
            m.senderId === msg.senderId &&
            m.content.trim() === msg.content.trim()
          )
      );

      this.messages = [...filtered, msg];
    }
  }

  await t.test('deduplicates identical message arriving via both broadcast and postgres_changes', () => {
    const store = new MessageStore();

    const incoming: Message = {
      id: 'msg-realtime-1',
      content: 'Hello Realtime',
      senderId: 'user-sender',
      createdAt: '2026-11-17T12:00:00.000Z',
    };

    // 1. Arrives via Broadcast
    store.handleIncomingMessage(incoming);
    assert.strictEqual(store.messages.length, 1);
    assert.strictEqual(store.messages[0].id, 'msg-realtime-1');

    // 2. Arrives via postgres_changes INSERT
    store.handleIncomingMessage(incoming);
    assert.strictEqual(store.messages.length, 1); // No duplicate created!

    // 3. Arrives via recovery fetch
    store.handleIncomingMessage(incoming);
    assert.strictEqual(store.messages.length, 1); // Still exactly 1 message
  });

  await t.test('reconciles optimistic temporary message when server confirmation arrives', () => {
    const store = new MessageStore();

    // Optimistic add
    store.messages.push({
      id: 'temp-12345',
      content: 'Pending message',
      senderId: 'me',
      createdAt: '2026-11-17T12:00:00.000Z',
    });
    assert.strictEqual(store.messages.length, 1);

    // Server confirmed message arrives
    store.handleIncomingMessage({
      id: 'confirmed-msg-id',
      content: 'Pending message',
      senderId: 'me',
      createdAt: '2026-11-17T12:00:01.000Z',
    });

    assert.strictEqual(store.messages.length, 1);
    assert.strictEqual(store.messages[0].id, 'confirmed-msg-id');
    assert.strictEqual(store.messages[0].content, 'Pending message');
  });
});

