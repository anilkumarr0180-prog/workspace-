'use client';

import React, { useState } from 'react';
import { useMarketplace } from '@/lib/context/marketplace-context';
import { X, CheckCircle2, MessageSquare, Send } from 'lucide-react';

interface ContactModalProps {
  freelancer: {
    username: string;
    name?: string;
    fullName?: string;
    avatarUrl?: string | null;
    title?: string | null;
    hourlyRate?: number | null;
  };
  isOpen: boolean;
  onClose: () => void;
}

export default function ContactModal({ freelancer, isOpen, onClose }: ContactModalProps) {
  const { sendContactMessage } = useMarketplace();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const displayName = freelancer.name || freelancer.fullName || freelancer.username;
  const displayTitle = freelancer.title ? freelancer.title.split('|')[0] : 'Specialist';
  const displayRate = freelancer.hourlyRate ? `$${freelancer.hourlyRate}/hr • ` : '';
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('') || freelancer.username.slice(0, 2).toUpperCase();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      setError('Please provide both a subject and message.');
      return;
    }
    sendContactMessage(freelancer.username, subject, message);
    setSent(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            {freelancer.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={freelancer.avatarUrl}
                alt={displayName}
                className="w-10 h-10 rounded-full object-cover border border-slate-200"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-emerald-700 text-white font-bold flex items-center justify-center text-xs">
                {initials}
              </div>
            )}
            <div>
              <h3 className="text-base font-bold text-slate-900">Message {displayName}</h3>
              <p className="text-xs text-slate-500">{displayRate}{displayTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {sent ? (
            <div className="text-center py-6 space-y-3">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h4 className="text-lg font-bold text-slate-900">Message Sent!</h4>
              <p className="text-xs text-slate-600 max-w-sm mx-auto">
                Your message has been simulated and sent to <span className="font-semibold text-slate-800">{freelancer.name}</span>. In a live system, you would receive an email or in-app notification upon reply.
              </p>
              <div className="pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800"
                >
                  Close Window
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="contactSubjectInput" className="block text-xs font-semibold uppercase text-slate-700 mb-1">
                  Project or Inquiry Subject
                </label>
                <input
                  id="contactSubjectInput"
                  type="text"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setError('');
                  }}
                  placeholder="e.g. Next.js Contract Opportunity for FinTech Dashboard"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-900"
                  required
                />
              </div>

              <div>
                <label htmlFor="contactMessageInput" className="block text-xs font-semibold uppercase text-slate-700 mb-1">
                  Initial Message
                </label>
                <textarea
                  id="contactMessageInput"
                  rows={4}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setError('');
                  }}
                  placeholder={`Hi ${displayName.split(' ')[0]}, I came across your profile and would love to discuss an upcoming project...`}
                  className="w-full p-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-900 resize-none"
                  required
                />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200/60 rounded-lg text-xs text-slate-500 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Freelancers typically respond within 24 business hours.</span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Message</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
