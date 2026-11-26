'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { UUID_REGEX } from '@/lib/messages-cursor';
import type { Message } from '@/lib/types';

export type CallType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'failed';
export type CallEndReason = 'hangup' | 'declined' | 'missed' | 'cancelled' | 'busy' | 'network_error';

export interface CallSessionRecord {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  callerName: string;
  callerAvatar: string | null;
  calleeName: string;
  calleeAvatar: string | null;
  callType: CallType;
  status: CallStatus;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  endReason: string | null;
}

function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function buildSystemCallSummary(callType: CallType, status: CallStatus, durationSeconds: number | null): string {
  const label = callType === 'video' ? 'Video call' : 'Audio call';
  if (status === 'ended' && durationSeconds !== null && durationSeconds >= 0) {
    return `${label} • ${formatCallDuration(durationSeconds)}`;
  }
  if (status === 'declined') {
    return `${label} declined`;
  }
  if (status === 'missed') {
    return `Missed ${callType === 'video' ? 'video' : 'audio'} call`;
  }
  return `${label} ended`;
}

/**
 * Start a new 1-on-1 audio or video call session in a conversation.
 * Validates caller authentication, conversation membership, and concurrency.
 */
export async function startCallSession(params: {
  conversationId: string;
  callType: CallType;
}): Promise<{ success: boolean; callSession?: CallSessionRecord; error?: string }> {
  try {
    const { conversationId, callType } = params;
    if (!UUID_REGEX.test(conversationId)) {
      return { success: false, error: 'Invalid conversation ID' };
    }
    if (callType !== 'audio' && callType !== 'video') {
      return { success: false, error: 'Invalid call type' };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    const admin = getAdminSupabaseClient();

    // Fetch conversation participants to verify membership & resolve callee
    const { data: participants, error: partError } = await admin
      .from('conversation_participants')
      .select(`
        user_id,
        profiles:user_id ( id, full_name, avatar_url )
      `)
      .eq('conversation_id', conversationId);

    if (partError || !participants || participants.length === 0) {
      return { success: false, error: 'Conversation not found' };
    }

    const callerRow = participants.find((p) => p.user_id === user.id);
    if (!callerRow) {
      return { success: false, error: 'Unauthorized: not a participant in this conversation' };
    }

    const calleeRow = participants.find((p) => p.user_id !== user.id);
    if (!calleeRow) {
      return { success: false, error: 'No recipient found in this conversation' };
    }

    const callerProfile = Array.isArray(callerRow.profiles) ? callerRow.profiles[0] : callerRow.profiles;
    const calleeProfile = Array.isArray(calleeRow.profiles) ? calleeRow.profiles[0] : calleeRow.profiles;

    // Auto-expire stale ringing calls older than 60s
    const staleCutoff = new Date(Date.now() - 60_000).toISOString();
    await admin
      .from('call_sessions')
      .update({
        status: 'missed',
        ended_at: new Date().toISOString(),
        end_reason: 'missed',
      })
      .eq('status', 'ringing')
      .lt('started_at', staleCutoff)
      .or(`caller_id.eq.${user.id},callee_id.eq.${user.id},caller_id.eq.${calleeRow.user_id},callee_id.eq.${calleeRow.user_id}`);

    // Check if caller or callee is currently in an active/ringing call
    const { data: activeCalls } = await admin
      .from('call_sessions')
      .select('id, caller_id, callee_id, status')
      .in('status', ['ringing', 'active'])
      .or(
        `caller_id.eq.${user.id},callee_id.eq.${user.id},caller_id.eq.${calleeRow.user_id},callee_id.eq.${calleeRow.user_id}`
      )
      .limit(1);

    if (activeCalls && activeCalls.length > 0) {
      return { success: false, error: 'User is currently on another call' };
    }

    const { data: inserted, error: insertError } = await admin
      .from('call_sessions')
      .insert({
        conversation_id: conversationId,
        caller_id: user.id,
        callee_id: calleeRow.user_id,
        call_type: callType,
        status: 'ringing',
      })
      .select('*')
      .single();

    if (insertError || !inserted) {
      return { success: false, error: insertError?.message || 'Failed to start call session' };
    }

    return {
      success: true,
      callSession: {
        id: inserted.id,
        conversationId: inserted.conversation_id,
        callerId: inserted.caller_id,
        calleeId: inserted.callee_id,
        callerName: callerProfile?.full_name || 'Participant',
        callerAvatar: callerProfile?.avatar_url || null,
        calleeName: calleeProfile?.full_name || 'Participant',
        calleeAvatar: calleeProfile?.avatar_url || null,
        callType: inserted.call_type as CallType,
        status: inserted.status as CallStatus,
        startedAt: inserted.started_at,
        answeredAt: inserted.answered_at || null,
        endedAt: inserted.ended_at || null,
        durationSeconds: inserted.duration_seconds ?? null,
        endReason: inserted.end_reason || null,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start call';
    return { success: false, error: msg };
  }
}

/**
 * Mark an incoming ringing call as active when the callee accepts.
 */
export async function answerCallSession(
  callId: string
): Promise<{ success: boolean; answeredAt?: string; error?: string }> {
  try {
    if (!UUID_REGEX.test(callId)) {
      return { success: false, error: 'Invalid call ID' };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    const admin = getAdminSupabaseClient();
    const { data: existing, error: findError } = await admin
      .from('call_sessions')
      .select('id, callee_id, status')
      .eq('id', callId)
      .maybeSingle();

    if (findError || !existing) {
      return { success: false, error: 'Call session not found' };
    }

    if (existing.callee_id !== user.id) {
      return { success: false, error: 'Unauthorized to answer this call' };
    }

    if (existing.status !== 'ringing') {
      return { success: false, error: 'Call is no longer ringing' };
    }

    const answeredAtIso = new Date().toISOString();
    const { error: updateError } = await admin
      .from('call_sessions')
      .update({
        status: 'active',
        answered_at: answeredAtIso,
      })
      .eq('id', callId)
      .eq('status', 'ringing');

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true, answeredAt: answeredAtIso };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to answer call';
    return { success: false, error: msg };
  }
}

/**
 * End, decline, cancel, or mark a call session as missed, and record a system call-log message.
 */
export async function endCallSession(
  callId: string,
  reason: CallEndReason = 'hangup'
): Promise<{
  success: boolean;
  status?: CallStatus;
  durationSeconds?: number | null;
  systemMessage?: Message;
  error?: string;
}> {
  try {
    if (!UUID_REGEX.test(callId)) {
      return { success: false, error: 'Invalid call ID' };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Authentication required' };
    }

    const admin = getAdminSupabaseClient();
    const { data: existing, error: findError } = await admin
      .from('call_sessions')
      .select('*')
      .eq('id', callId)
      .maybeSingle();

    if (findError || !existing) {
      return { success: false, error: 'Call session not found' };
    }

    if (existing.caller_id !== user.id && existing.callee_id !== user.id) {
      return { success: false, error: 'Unauthorized to end this call' };
    }

    // Idempotent return if already ended
    if (!['ringing', 'active'].includes(existing.status)) {
      return {
        success: true,
        status: existing.status as CallStatus,
        durationSeconds: existing.duration_seconds ?? null,
      };
    }

    const endedAt = new Date();
    const endedAtIso = endedAt.toISOString();

    let nextStatus: CallStatus = 'ended';
    if (reason === 'declined') {
      nextStatus = 'declined';
    } else if (reason === 'missed' || (existing.status === 'ringing' && reason === 'cancelled')) {
      nextStatus = 'missed';
    } else if (reason === 'network_error' && existing.status === 'ringing') {
      nextStatus = 'failed';
    }

    let durationSeconds: number | null = null;
    if (existing.answered_at) {
      durationSeconds = Math.max(
        0,
        Math.round((endedAt.getTime() - new Date(existing.answered_at).getTime()) / 1000)
      );
    }

    const { data: updated, error: updateError } = await admin
      .from('call_sessions')
      .update({
        status: nextStatus,
        ended_at: endedAtIso,
        duration_seconds: durationSeconds,
        end_reason: reason,
      })
      .eq('id', callId)
      .in('status', ['ringing', 'active'])
      .select('*')
      .maybeSingle();

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    if (!updated) {
      return { success: true, status: nextStatus, durationSeconds };
    }

    // Insert system call-log message into the conversation
    const summaryText = buildSystemCallSummary(
      existing.call_type as CallType,
      nextStatus,
      durationSeconds
    );

    const { data: sysMsgRow } = await admin
      .from('messages')
      .insert({
        conversation_id: existing.conversation_id,
        sender_id: existing.caller_id,
        content: summaryText,
        message_type: 'system',
      })
      .select('*')
      .single();

    const systemMessage: Message | undefined = sysMsgRow
      ? {
          id: sysMsgRow.id,
          conversationId: sysMsgRow.conversation_id,
          senderId: sysMsgRow.sender_id,
          senderName: 'System',
          senderAvatar: null,
          content: sysMsgRow.content,
          messageType: 'system',
          createdAt: sysMsgRow.created_at,
          updatedAt: sysMsgRow.updated_at,
          editedAt: null,
          deletedAt: null,
        }
      : undefined;

    return {
      success: true,
      status: nextStatus,
      durationSeconds,
      systemMessage,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to end call';
    return { success: false, error: msg };
  }
}
