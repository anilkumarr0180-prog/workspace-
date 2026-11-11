'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PublicFreelancer } from '@/lib/types';
import ContactModal from '@/components/freelancers/contact-modal';
import ProfileEditModal from '@/components/profile/profile-edit-modal';
import { Share2, Check, MessageSquare, Edit3, Camera } from 'lucide-react';

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

interface EditProfileButtonProps {
  className?: string;
  label?: string;
  initialRole?: 'freelancer' | 'client';
}

export function EditProfileButton({
  className = '',
  label = 'Edit Profile',
  initialRole = 'freelancer',
}: EditProfileButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        type="button"
        className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm shadow-xs transition-all cursor-pointer ${className}`}
      >
        <Edit3 className="w-4 h-4 text-emerald-400" />
        <span>{label}</span>
      </button>

      <ProfileEditModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        initialRole={initialRole}
        onProfileUpdated={() => {
          router.refresh();
        }}
      />
    </>
  );
}

interface OwnerAvatarInteractiveProps {
  avatarUrl?: string | null;
  fullName: string;
  initials: string;
  isOwner: boolean;
}

export function OwnerAvatarInteractive({
  avatarUrl,
  fullName,
  initials,
  isOwner,
}: OwnerAvatarInteractiveProps) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  if (!isOwner) {
    return (
      <div className="relative shrink-0">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={fullName}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border-2 border-white shadow-md"
          />
        ) : (
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white font-bold flex items-center justify-center text-2xl sm:text-3xl border-2 border-white shadow-md select-none">
            {initials}
          </div>
        )}
        <span
          className="absolute bottom-1 right-1 w-5 h-5 bg-emerald-500 border-2 border-white rounded-full"
          title="Available for projects"
        />
      </div>
    );
  }

  return (
    <>
      <div
        onClick={() => setIsOpen(true)}
        className="relative shrink-0 group cursor-pointer"
        title="Click to edit profile & change photo"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={fullName}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border-2 border-white shadow-md group-hover:brightness-90 transition-all"
          />
        ) : (
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white font-bold flex items-center justify-center text-2xl sm:text-3xl border-2 border-white shadow-md select-none group-hover:brightness-90 transition-all">
            {initials}
          </div>
        )}

        {/* Hover Camera Overlay */}
        <div className="absolute inset-0 rounded-2xl bg-slate-950/45 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white text-xs font-semibold gap-1 transition-opacity">
          <Camera className="w-5 h-5 text-white" />
          <span className="text-[11px] font-medium tracking-tight">Edit Photo</span>
        </div>

        <span
          className="absolute bottom-1 right-1 w-5 h-5 bg-emerald-500 border-2 border-white rounded-full group-hover:scale-110 transition-transform"
          title="Available for projects"
        />
      </div>

      <ProfileEditModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        initialRole="freelancer"
        onProfileUpdated={() => {
          router.refresh();
        }}
      />
    </>
  );
}
