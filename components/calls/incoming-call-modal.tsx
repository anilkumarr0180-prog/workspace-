'use client';

import React from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import type { CallType } from '@/lib/actions/calls';

interface IncomingCallModalProps {
  callerName: string;
  callerAvatar: string | null;
  callType: CallType;
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingCallModal({
  callerName,
  callerAvatar,
  callType,
  onAccept,
  onDecline,
}: IncomingCallModalProps) {
  const initials =
    callerName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('') || 'U';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-[#e4ebe4] shadow-2xl p-6 text-center space-y-5">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <span className="absolute -inset-2 rounded-full bg-[#108a00]/20 animate-ping" />
            {callerAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={callerAvatar}
                alt={callerName}
                className="relative w-20 h-20 rounded-full object-cover border-2 border-white shadow-md"
              />
            ) : (
              <div className="relative w-20 h-20 rounded-full bg-[#108a00] text-white font-bold text-xl flex items-center justify-center shadow-md">
                {initials}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#f2f7f2] text-[#108a00] border border-[#e4ebe4]">
              {callType === 'video' ? (
                <>
                  <Video className="w-3 h-3" />
                  <span>Incoming Video Call</span>
                </>
              ) : (
                <>
                  <Phone className="w-3 h-3" />
                  <span>Incoming Audio Call</span>
                </>
              )}
            </span>
            <h3 className="text-lg font-bold text-[#001e00] pt-1">{callerName}</h3>
            <p className="text-xs text-[#5e6d55]">is calling you on Workspace</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 pt-2">
          <button
            type="button"
            onClick={onDecline}
            className="flex flex-col items-center gap-1.5 group cursor-pointer"
          >
            <span className="w-13 h-13 rounded-full bg-rose-600 group-hover:bg-rose-700 text-white flex items-center justify-center shadow-lg transition-transform group-hover:scale-105">
              <PhoneOff className="w-5 h-5" />
            </span>
            <span className="text-xs font-medium text-[#5e6d55]">Decline</span>
          </button>

          <button
            type="button"
            onClick={onAccept}
            className="flex flex-col items-center gap-1.5 group cursor-pointer"
          >
            <span className="w-13 h-13 rounded-full bg-[#108a00] group-hover:bg-[#14a800] text-white flex items-center justify-center shadow-lg transition-transform group-hover:scale-105">
              {callType === 'video' ? (
                <Video className="w-5 h-5" />
              ) : (
                <Phone className="w-5 h-5" />
              )}
            </span>
            <span className="text-xs font-medium text-[#001e00]">Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
}
