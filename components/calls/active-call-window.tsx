'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  MonitorUp,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import type { ActiveCallInfo, CallUIState } from './call-provider';

interface ActiveCallWindowProps {
  callState: CallUIState;
  activeCall: ActiveCallInfo;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isPeerMuted: boolean;
  isPeerCameraOff: boolean;
  elapsedSeconds: number;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onEndCall: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function ActiveCallWindow({
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
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onEndCall,
}: ActiveCallWindowProps) {
  const [isExpanded, setIsExpanded] = useState(activeCall.callType === 'video');
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isExpanded, isCameraOff, isScreenSharing]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, isExpanded]);

  const initials =
    activeCall.peerName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('') || 'U';

  const statusText =
    callState === 'outgoing_ringing'
      ? 'Ringing...'
      : callState === 'connecting'
      ? 'Connecting...'
      : formatDuration(elapsedSeconds);

  const hasRemoteVideo =
    activeCall.callType === 'video' && !isPeerCameraOff && Boolean(remoteStream);

  return (
    <>
      {/* Hidden audio element ensures remote audio always plays even in audio-only or minimized mode */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      <div
        className={
          isExpanded
            ? 'fixed inset-4 sm:inset-8 z-50 bg-[#0b140b] rounded-3xl border border-white/10 shadow-2xl flex flex-col overflow-hidden text-white'
            : 'fixed bottom-5 right-5 z-50 w-80 bg-[#0b140b] rounded-2xl border border-white/15 shadow-2xl flex flex-col overflow-hidden text-white'
        }
      >
        {/* Top Bar */}
        <div className="px-4 py-3 flex items-center justify-between bg-black/40 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                callState === 'active' ? 'bg-[#14a800]' : 'bg-amber-400 animate-pulse'
              }`}
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate">{activeCall.peerName}</p>
              <p className="text-[11px] text-white/70 font-mono">{statusText}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isPeerMuted && (
              <span
                title="Participant is muted"
                className="p-1 rounded-full bg-rose-500/20 text-rose-300"
              >
                <MicOff className="w-3.5 h-3.5" />
              </span>
            )}
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title={isExpanded ? 'Minimize' : 'Expand'}
            >
              {isExpanded ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Media Stage */}
        <div
          className={`relative flex-1 flex items-center justify-center bg-[#121c12] ${
            isExpanded ? 'min-h-[300px]' : 'h-44'
          }`}
        >
          {hasRemoteVideo ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 p-4 text-center">
              {activeCall.peerAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeCall.peerAvatar}
                  alt={activeCall.peerName}
                  className={`${
                    isExpanded ? 'w-24 h-24' : 'w-14 h-14'
                  } rounded-full object-cover border-2 border-white/20`}
                />
              ) : (
                <div
                  className={`${
                    isExpanded ? 'w-24 h-24 text-2xl' : 'w-14 h-14 text-base'
                  } rounded-full bg-[#108a00] text-white font-bold flex items-center justify-center`}
                >
                  {initials}
                </div>
              )}
              <span className="text-xs text-white/70">
                {callState === 'active'
                  ? activeCall.callType === 'audio'
                    ? 'Audio connected'
                    : 'Camera is off'
                  : statusText}
              </span>
            </div>
          )}

          {/* Local PiP Video */}
          {(activeCall.callType === 'video' || isScreenSharing) &&
            localStream &&
            (!isCameraOff || isScreenSharing) && (
              <div
                className={`absolute bottom-3 right-3 rounded-xl overflow-hidden border border-white/20 shadow-lg bg-black ${
                  isExpanded ? 'w-44 h-28' : 'w-24 h-16'
                }`}
              >
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
            )}
        </div>

        {/* Controls Bar */}
        <div className="px-4 py-3 bg-black/50 border-t border-white/10 flex items-center justify-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleMute}
            className={`p-2.5 rounded-full transition-colors cursor-pointer ${
              isMuted
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {activeCall.callType === 'video' && (
            <button
              type="button"
              onClick={onToggleCamera}
              className={`p-2.5 rounded-full transition-colors cursor-pointer ${
                isCameraOff
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
              title={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
            >
              {isCameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleScreenShare}
            className={`p-2.5 rounded-full transition-colors cursor-pointer ${
              isScreenSharing
                ? 'bg-[#108a00] text-white hover:bg-[#14a800]'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
            title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
          >
            <MonitorUp className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onEndCall}
            className="p-2.5 px-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer inline-flex items-center gap-1.5 text-xs font-semibold"
            title="End call"
          >
            <PhoneOff className="w-4 h-4" />
            {isExpanded && <span>End</span>}
          </button>
        </div>
      </div>
    </>
  );
}
