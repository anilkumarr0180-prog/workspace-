'use client';

import React, { useState } from 'react';
import { PublicFreelancer } from '@/lib/types';
import ContactModal from '@/components/freelancers/contact-modal';
import { Share2, Check, MessageSquare } from 'lucide-react';

export function ShareProfileButton() {
  const [copiedLink, setCopiedLink] = useState(false);

  const handleShare = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard?.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <button
      onClick={handleShare}
      type="button"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
    >
      {copiedLink ? (
        <Check className="w-3.5 h-3.5 text-emerald-600" />
      ) : (
        <Share2 className="w-3.5 h-3.5" />
      )}
      <span>{copiedLink ? 'Link Copied!' : 'Share Profile'}</span>
    </button>
  );
}

interface ContactHireButtonProps {
  freelancer: PublicFreelancer;
  className?: string;
  label?: string;
}

export function ContactHireButton({
  freelancer,
  className = '',
  label = 'Contact / Hire',
}: ContactHireButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        type="button"
        className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm shadow-emerald-600/20 transition-all cursor-pointer ${className}`}
      >
        <MessageSquare className="w-4 h-4" />
        <span>{label}</span>
      </button>

      <ContactModal
        freelancer={freelancer}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
