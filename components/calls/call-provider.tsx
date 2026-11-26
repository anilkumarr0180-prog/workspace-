'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { CallType, CallSessionRecord, CallEndReason } from '@/lib/actions/calls';
import type { Message } from '@/lib/types';
import { toast } from '@/components/ui/toast';
import IncomingCallModal from './incoming-call-modal';
import ActiveCallWindow from './active-call-window';

export type CallUIState =
  | 'idle'
  | 'outgoing_ringing'
  | 'incoming_ringing'
  | 'connecting'
  | 'active';

export interface ActiveCallInfo {
  callId: string;
  conversationId: string;
  callType: CallType;
  isCaller: boolean;
  peerUserId: string;
  peerName: string;
  peerAvatar: string | null;
  answeredAt: string | null;
}

interface CallContextValue {
  callState: CallUIState;
  activeCall: ActiveCallInfo | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isPeerMuted: boolean;
  isPeerCameraOff: boolean;
  elapsedSeconds: number;
  startCall: (conversationId: string, callType: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: (reason?: CallEndReason) => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return ctx;
}

function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME || undefined,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || undefined,
    });
  }
  return servers;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallUIState>('idle');
  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isPeerMuted, setIsPeerMuted] = useState(false);
  const [isPeerCameraOff, setIsPeerCameraOff] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const supabaseRef = useRef(createClient());
  const userChannelRef = useRef<RealtimeChannel | null>(null);
  const roomChannelRef = useRef<RealtimeChannel | null>(null);
  const peerConnRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const ringTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ringtoneIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const callStateRef = useRef<CallUIState>('idle');
  const activeCallRef = useRef<ActiveCallInfo | null>(null);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // Subtle Web Audio API ringtone (no external file dependency)
  const stopRingtone = useCallback(() => {
    if (ringtoneIntervalRef.current) {
      clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(() => {
    stopRingtone();
    const playTone = () => {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.setValueAtTime(523.25, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.45);
        setTimeout(() => ctx.close().catch(() => {}), 600);
      } catch {
        // Browser may block audio before user interaction
      }
    };
    playTone();
    ringtoneIntervalRef.current = setInterval(playTone, 2400);
  }, [stopRingtone]);

  // Clean up media tracks, peer connection, and signaling room
  const cleanupCallResources = useCallback(() => {
    stopRingtone();
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (peerConnRef.current) {
      peerConnRef.current.close();
      peerConnRef.current = null;
    }
    if (roomChannelRef.current) {
      supabaseRef.current.removeChannel(roomChannelRef.current);
      roomChannelRef.current = null;
    }
    pendingIceRef.current = [];
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsScreenSharing(false);
    setIsPeerMuted(false);
    setIsPeerCameraOff(false);
    setElapsedSeconds(0);
    setActiveCall(null);
    setCallState('idle');
  }, [stopRingtone]);

  // Broadcast a system call-log message into the conversation channel so chat updates immediately
  const broadcastSystemMessage = useCallback((conversationId: string, msg?: Message) => {
    if (!msg) return;
    const convChannel = supabaseRef.current.channel(`conversation-${conversationId}`);
    convChannel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        convChannel
          .send({
            type: 'broadcast',
            event: 'new_message',
            payload: msg,
          })
          .finally(() => {
            supabaseRef.current.removeChannel(convChannel);
          });
      }
    });
  }, []);

  // Create and configure RTCPeerConnection
  const createPeerConnection = useCallback(
    (callId: string, stream: MediaStream) => {
      const pc = new RTCPeerConnection({ iceServers: getIceServers() });

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const incomingStream = new MediaStream();
      setRemoteStream(incomingStream);

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        } else {
          incomingStream.addTrack(event.track);
          setRemoteStream(new MediaStream(incomingStream.getTracks()));
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && roomChannelRef.current) {
          roomChannelRef.current.send({
            type: 'broadcast',
            event: 'webrtc_ice',
            payload: { callId, candidate: event.candidate.toJSON() },
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setCallState('active');
          setActiveCall((prev) =>
            prev ? { ...prev, answeredAt: prev.answeredAt || new Date().toISOString() } : prev
          );
        } else if (pc.connectionState === 'failed') {
          toast.error('Call connection lost');
        }
      };

      peerConnRef.current = pc;
      return pc;
    },
    []
  );

  // Subscribe to call-specific signaling room
  const joinSignalingRoom = useCallback(
    async (callId: string, isCaller: boolean) => {
      if (roomChannelRef.current) {
        supabaseRef.current.removeChannel(roomChannelRef.current);
      }

      const channel = supabaseRef.current.channel(`call-room-${callId}`, {
        config: { broadcast: { self: false } },
      });

      channel.on('broadcast', { event: 'call_ready' }, async () => {
        if (!isCaller || !localStreamRef.current) return;
        const pc = peerConnRef.current || createPeerConnection(callId, localStreamRef.current);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        channel.send({
          type: 'broadcast',
          event: 'webrtc_offer',
          payload: { callId, sdp: offer },
        });
      });

      channel.on('broadcast', { event: 'webrtc_offer' }, async ({ payload }: { payload: { sdp?: RTCSessionDescriptionInit } }) => {
        if (isCaller || !payload?.sdp || !localStreamRef.current) return;
        const pc = peerConnRef.current || createPeerConnection(callId, localStreamRef.current);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        for (const cand of pendingIceRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        pendingIceRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channel.send({
          type: 'broadcast',
          event: 'webrtc_answer',
          payload: { callId, sdp: answer },
        });
      });

      channel.on('broadcast', { event: 'webrtc_answer' }, async ({ payload }: { payload: { sdp?: RTCSessionDescriptionInit } }) => {
        if (!isCaller || !payload?.sdp || !peerConnRef.current) return;
        await peerConnRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        for (const cand of pendingIceRef.current) {
          await peerConnRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        pendingIceRef.current = [];
        if (ringTimeoutRef.current) {
          clearTimeout(ringTimeoutRef.current);
          ringTimeoutRef.current = null;
        }
        setCallState('active');
        setActiveCall((prev) =>
          prev ? { ...prev, answeredAt: prev.answeredAt || new Date().toISOString() } : prev
        );
      });

      channel.on('broadcast', { event: 'webrtc_ice' }, async ({ payload }: { payload: { candidate?: RTCIceCandidateInit } }) => {
        if (!payload?.candidate) return;
        const pc = peerConnRef.current;
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
        } else {
          pendingIceRef.current.push(payload.candidate);
        }
      });

      channel.on('broadcast', { event: 'media_state' }, ({ payload }: { payload: { isMuted?: boolean; isCameraOff?: boolean } }) => {
        if (typeof payload?.isMuted === 'boolean') setIsPeerMuted(payload.isMuted);
        if (typeof payload?.isCameraOff === 'boolean') setIsPeerCameraOff(payload.isCameraOff);
      });

      channel.on('broadcast', { event: 'call_ended' }, ({ payload }: { payload: { reason?: CallEndReason } }) => {
        if (payload?.reason === 'declined') {
          toast.info('Call was declined');
        } else if (payload?.reason === 'missed') {
          toast.info('No answer');
        }
        cleanupCallResources();
      });

      roomChannelRef.current = channel;

      await new Promise<void>((resolve) => {
        channel.subscribe((status: string) => {
          if (status === 'SUBSCRIBED') resolve();
        });
      });

      return channel;
    },
    [cleanupCallResources, createPeerConnection]
  );

  // Track authenticated user
  useEffect(() => {
    const supabase = supabaseRef.current;
    supabase.auth.getUser().then((res: { data: { user: { id: string } | null } }) => {
      setCurrentUserId(res.data.user?.id || null);
    });
    const { data: authSub } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user?: { id: string } } | null) => {
        setCurrentUserId(session?.user?.id || null);
      }
    );
    return () => {
      authSub.subscription.unsubscribe();
    };
  }, []);

  // Global listener for incoming calls on user's personal channel
  useEffect(() => {
    if (!currentUserId) return;
    const supabase = supabaseRef.current;
    const channel = supabase.channel(`user-calls-${currentUserId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'incoming_call' }, ({ payload }: { payload: CallSessionRecord }) => {
      const session = payload;
      if (!session?.id) return;

      // If already in a call, ignore or let server busy check handle
      if (callStateRef.current !== 'idle') return;

      setActiveCall({
        callId: session.id,
        conversationId: session.conversationId,
        callType: session.callType,
        isCaller: false,
        peerUserId: session.callerId,
        peerName: session.callerName,
        peerAvatar: session.callerAvatar,
        answeredAt: null,
      });
      setIsPeerCameraOff(session.callType === 'audio');
      setCallState('incoming_ringing');
      startRingtone();
    });

    channel.on('broadcast', { event: 'call_cancelled' }, ({ payload }: { payload: { callId?: string } }) => {
      if (activeCallRef.current?.callId === payload?.callId) {
        cleanupCallResources();
      }
    });

    channel.subscribe();
    userChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      userChannelRef.current = null;
    };
  }, [currentUserId, startRingtone, cleanupCallResources]);

  // Live call duration timer
  useEffect(() => {
    if (callState !== 'active') return;
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [callState]);

  // End call cleanly if user closes/reloads tab
  useEffect(() => {
    const handleUnload = () => {
      const current = activeCallRef.current;
      if (!current) return;
      const reason: CallEndReason =
        callStateRef.current === 'outgoing_ringing' ? 'cancelled' : 'hangup';
      navigator.sendBeacon?.(
        `/api/calls/${current.callId}/end`,
        new Blob([JSON.stringify({ reason })], { type: 'application/json' })
      );
    };
    window.addEventListener('pagehide', handleUnload);
    return () => window.removeEventListener('pagehide', handleUnload);
  }, []);

  // End or cancel active call
  const endCall = useCallback(
    async (reason?: CallEndReason) => {
      const current = activeCallRef.current;
      if (!current) {
        cleanupCallResources();
        return;
      }

      const resolvedReason: CallEndReason =
        reason || (callStateRef.current === 'outgoing_ringing' ? 'cancelled' : 'hangup');

      if (roomChannelRef.current) {
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'call_ended',
          payload: { callId: current.callId, reason: resolvedReason },
        });
      }

      // Notify callee's global channel if caller cancels before answer
      if (current.isCaller && callStateRef.current === 'outgoing_ringing') {
        const peerChan = supabaseRef.current.channel(`user-calls-${current.peerUserId}`);
        peerChan.subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            peerChan
              .send({
                type: 'broadcast',
                event: 'call_cancelled',
                payload: { callId: current.callId },
              })
              .finally(() => supabaseRef.current.removeChannel(peerChan));
          }
        });
      }

      cleanupCallResources();

      try {
        const res = await fetch(`/api/calls/${current.callId}/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: resolvedReason }),
        });
        if (res.ok) {
          const data = await res.json();
          broadcastSystemMessage(current.conversationId, data.systemMessage);
        }
      } catch {
        // Best-effort cleanup
      }
    },
    [cleanupCallResources, broadcastSystemMessage]
  );

  // Initiate a call
  const startCall = useCallback(
    async (conversationId: string, callType: CallType) => {
      if (callStateRef.current !== 'idle') {
        toast.error('You are already in a call');
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callType === 'video',
        });
      } catch {
        toast.error(
          callType === 'video'
            ? 'Camera/microphone permission denied'
            : 'Microphone permission denied'
        );
        return;
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsCameraOff(callType === 'audio');

      try {
        const res = await fetch('/api/calls/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, callType }),
        });
        const data = await res.json();
        if (!res.ok || !data.success || !data.callSession) {
          throw new Error(data.error || 'Could not start call');
        }

        const session: CallSessionRecord = data.callSession;
        setActiveCall({
          callId: session.id,
          conversationId: session.conversationId,
          callType: session.callType,
          isCaller: true,
          peerUserId: session.calleeId,
          peerName: session.calleeName,
          peerAvatar: session.calleeAvatar,
          answeredAt: null,
        });
        setIsPeerCameraOff(callType === 'audio');
        setCallState('outgoing_ringing');

        await joinSignalingRoom(session.id, true);
        createPeerConnection(session.id, stream);

        // Ring callee on their global channel
        const calleeChannel = supabaseRef.current.channel(`user-calls-${session.calleeId}`);
        calleeChannel.subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            calleeChannel
              .send({
                type: 'broadcast',
                event: 'incoming_call',
                payload: session,
              })
              .finally(() => supabaseRef.current.removeChannel(calleeChannel));
          }
        });

        // 35-second auto-timeout for unanswered calls
        ringTimeoutRef.current = setTimeout(() => {
          if (callStateRef.current === 'outgoing_ringing') {
            toast.info('No answer');
            endCall('missed');
          }
        }, 35_000);
      } catch (err: unknown) {
        cleanupCallResources();
        toast.error(err instanceof Error ? err.message : 'Failed to start call');
      }
    },
    [joinSignalingRoom, createPeerConnection, cleanupCallResources, endCall]
  );

  // Accept incoming call
  const acceptCall = useCallback(async () => {
    const current = activeCallRef.current;
    if (!current || callStateRef.current !== 'incoming_ringing') return;

    stopRingtone();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: current.callType === 'video',
      });
    } catch {
      toast.error('Microphone/camera permission denied');
      await endCall('declined');
      return;
    }

    localStreamRef.current = stream;
    setLocalStream(stream);
    setIsCameraOff(current.callType === 'audio');
    setCallState('connecting');

    try {
      const res = await fetch(`/api/calls/${current.callId}/answer`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Call is no longer available');
      }

      const channel = await joinSignalingRoom(current.callId, false);
      createPeerConnection(current.callId, stream);
      channel.send({
        type: 'broadcast',
        event: 'call_ready',
        payload: { callId: current.callId },
      });
    } catch (err: unknown) {
      cleanupCallResources();
      toast.error(err instanceof Error ? err.message : 'Failed to connect call');
    }
  }, [stopRingtone, endCall, joinSignalingRoom, createPeerConnection, cleanupCallResources]);

  // Decline incoming call
  const declineCall = useCallback(async () => {
    const current = activeCallRef.current;
    if (!current) return;
    stopRingtone();
    await joinSignalingRoom(current.callId, false).catch(() => {});
    await endCall('declined');
  }, [stopRingtone, joinSignalingRoom, endCall]);

  // Toggle microphone
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const nextMuted = !isMuted;
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
    roomChannelRef.current?.send({
      type: 'broadcast',
      event: 'media_state',
      payload: { isMuted: nextMuted, isCameraOff },
    });
  }, [isMuted, isCameraOff]);

  // Toggle camera
  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length === 0) return;
    const nextOff = !isCameraOff;
    videoTracks.forEach((t) => {
      t.enabled = !nextOff;
    });
    setIsCameraOff(nextOff);
    roomChannelRef.current?.send({
      type: 'broadcast',
      event: 'media_state',
      payload: { isMuted, isCameraOff: nextOff },
    });
  }, [isCameraOff, isMuted]);

  // Toggle screen sharing
  const toggleScreenShare = useCallback(async () => {
    const pc = peerConnRef.current;
    if (!pc || !localStreamRef.current) return;

    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      const camTrack = localStreamRef.current.getVideoTracks()[0];
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && camTrack) {
        await sender.replaceTrack(camTrack);
      }
      setIsScreenSharing(false);
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenStreamRef.current = displayStream;
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(screenTrack);
      } else {
        pc.addTrack(screenTrack, localStreamRef.current);
      }

      screenTrack.onended = () => {
        const camTrack = localStreamRef.current?.getVideoTracks()[0];
        if (sender && camTrack) {
          sender.replaceTrack(camTrack).catch(() => {});
        }
        screenStreamRef.current = null;
        setIsScreenSharing(false);
      };

      setIsScreenSharing(true);
    } catch {
      // User cancelled screen picker
    }
  }, [isScreenSharing]);

  return (
    <CallContext.Provider
      value={{
        callState,
        activeCall,
        localStream,
        remoteStream,
        isMuted,
        isCameraOff,
        isScreenSharing,
        isPeerMuted,
        isPeerCameraOff,
        elapsedSeconds,
        startCall,
        acceptCall,
        declineCall,
        endCall,
        toggleMute,
        toggleCamera,
        toggleScreenShare,
      }}
    >
      {children}

      {callState === 'incoming_ringing' && activeCall && (
        <IncomingCallModal
          callerName={activeCall.peerName}
          callerAvatar={activeCall.peerAvatar}
          callType={activeCall.callType}
          onAccept={acceptCall}
          onDecline={declineCall}
        />
      )}

      {(callState === 'outgoing_ringing' ||
        callState === 'connecting' ||
        callState === 'active') &&
        activeCall && (
          <ActiveCallWindow
            callState={callState}
            activeCall={activeCall}
            localStream={localStream}
            remoteStream={remoteStream}
            isMuted={isMuted}
            isCameraOff={isCameraOff}
            isScreenSharing={isScreenSharing}
            isPeerMuted={isPeerMuted}
            isPeerCameraOff={isPeerCameraOff}
            elapsedSeconds={elapsedSeconds}
            onToggleMute={toggleMute}
            onToggleCamera={toggleCamera}
            onToggleScreenShare={toggleScreenShare}
            onEndCall={() => endCall()}
          />
        )}
    </CallContext.Provider>
  );
}
