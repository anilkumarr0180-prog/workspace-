'use client';

import React, { useState, useEffect, useTransition } from 'react';
import {
  getEditableProfile,
  updateFreelancerProfile,
  updateClientProfile,
  EditableProfileData,
} from '@/lib/actions/profile';
import AvatarUploader from '@/components/profile/avatar-uploader';
import {
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  Building2,
  Globe,
  MapPin,
  User,
  Plus,
} from 'lucide-react';

interface ProfileEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileUpdated?: () => void;
  initialRole?: 'freelancer' | 'client';
}

export default function ProfileEditModal({
  isOpen,
  onClose,
  onProfileUpdated,
  initialRole,
}: ProfileEditModalProps) {
  const [profile, setProfile] = useState<EditableProfileData | null>(null);
  const [availableSkills, setAvailableSkills] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Freelancer form fields
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [hourlyRate, setHourlyRate] = useState<string>('');
  const [isRateNegotiable, setIsRateNegotiable] = useState(false);
  const [bio, setBio] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [skillSearch, setSkillSearch] = useState('');

  // Client form fields
  const [companyName, setCompanyName] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [companyLocation, setCompanyLocation] = useState('');
  const [companyDescription, setCompanyDescription] = useState('');

  // Load existing profile on open
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    getEditableProfile().then((res) => {
      if (!isMounted) return;
      if (res.success && res.profile) {
        setProfile(res.profile);
        setAvailableSkills(res.availableSkills || []);

        setFullName(res.profile.fullName || '');
        setTitle(res.profile.title || '');

        if (res.profile.hourlyRate) {
          setHourlyRate(res.profile.hourlyRate.toString());
          setIsRateNegotiable(false);
        } else {
          setHourlyRate('');
          setIsRateNegotiable(true);
        }

        setBio(res.profile.bio || '');
        setSelectedSkills(res.profile.skills || []);

        if (res.profile.company) {
          setCompanyName(res.profile.company.name || '');
          setCompanyWebsite(res.profile.company.website || '');
          setCompanyLocation(res.profile.company.location || '');
          setCompanyDescription(res.profile.company.description || '');
        }
      } else {
        setErrorMessage(res.error || 'Failed to load profile details.');
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentMode = initialRole || profile?.activeMode || 'freelancer';
  const isFreelancer = currentMode === 'freelancer';

  const handleAddSkill = (skill: { id: string; name: string; slug: string }) => {
    if (selectedSkills.some((s) => s.id === skill.id)) return;
    if (selectedSkills.length >= 20) {
      setErrorMessage('You can select a maximum of 20 skills.');
      return;
    }
    setSelectedSkills([...selectedSkills, skill]);
    setSkillSearch('');
  };

  const handleRemoveSkill = (skillId: string) => {
    setSelectedSkills(selectedSkills.filter((s) => s.id !== skillId));
  };

  const filteredSkills = availableSkills
    .filter(
      (s) =>
        !selectedSkills.some((sel) => sel.id === s.id) &&
        s.name.toLowerCase().includes(skillSearch.toLowerCase())
    )
    .slice(0, 10);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const trimmedName = fullName.trim();
    if (trimmedName.length < 2) {
      setErrorMessage('Full name must be at least 2 characters.');
      return;
    }

    startTransition(async () => {
      try {
        if (isFreelancer) {
          const rateVal = isRateNegotiable || !hourlyRate.trim() ? null : Number(hourlyRate);
          const res = await updateFreelancerProfile({
            fullName: trimmedName,
            title: title.trim(),
            hourlyRate: rateVal,
            bio: bio.trim(),
            skillIds: selectedSkills.map((s) => s.id),
          });

          if (!res.success) {
            setErrorMessage(res.error || 'Failed to update freelancer profile.');
            return;
          }
        } else {
          const res = await updateClientProfile({
            fullName: trimmedName,
            title: title.trim(),
            companyName: companyName.trim(),
            companyWebsite: companyWebsite.trim() || null,
            companyLocation: companyLocation.trim() || null,
            companyDescription: companyDescription.trim() || null,
          });

          if (!res.success) {
            setErrorMessage(res.error || 'Failed to update client profile.');
            return;
          }
        }

        setSuccessMessage('Profile saved successfully!');
        window.dispatchEvent(
          new CustomEvent('workspace:profile-updated', {
            detail: { fullName: trimmedName },
          })
        );
        onProfileUpdated?.();

        setTimeout(() => {
          onClose();
        }, 900);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unexpected error saving profile.';
        setErrorMessage(msg);
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-slate-50/60">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-bold text-slate-900">Edit Profile</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 capitalize">
              {currentMode} Mode
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            <p className="text-sm font-medium text-slate-500">Loading your profile details...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
            {/* Feedback Alerts */}
            {errorMessage && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs sm:text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs sm:text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* 1. Avatar Section */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Profile Photo
              </label>
              {profile && (
                <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200/80">
                  <AvatarUploader
                    userId={profile.id}
                    currentAvatarUrl={profile.avatarUrl}
                    displayName={fullName || profile.fullName}
                    size="lg"
                    onAvatarChanged={(newUrl) => {
                      setProfile((prev) => (prev ? { ...prev, avatarUrl: newUrl } : null));
                    }}
                  />
                </div>
              )}
            </div>

            {/* 2. Personal & Professional Identity */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    maxLength={80}
                    placeholder="e.g. Jane Doe"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isFreelancer ? 'Professional Title' : 'Your Position / Role'}
                </label>
                <div className="relative">
                  <Briefcase className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    placeholder={
                      isFreelancer
                        ? 'e.g. Senior Full-Stack Engineer'
                        : 'e.g. Founder & Hiring Lead'
                    }
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>
            </div>

            {/* 3. Freelancer-Specific Fields */}
            {isFreelancer && (
              <>
                {/* Hourly Rate */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">Hourly Rate</label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isRateNegotiable}
                        onChange={(e) => setIsRateNegotiable(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Rate Negotiable</span>
                    </label>
                  </div>

                  <div className="relative">
                    <span className="absolute left-3.5 top-2 text-sm font-bold text-slate-500">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="2000"
                      value={isRateNegotiable ? '' : hourlyRate}
                      onChange={(e) => {
                        setHourlyRate(e.target.value);
                        if (isRateNegotiable) setIsRateNegotiable(false);
                      }}
                      disabled={isRateNegotiable}
                      placeholder={isRateNegotiable ? 'Negotiable' : '50.00'}
                      className="w-full pl-8 pr-14 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    <span className="absolute right-3.5 top-2 text-xs font-semibold text-slate-400">
                      / hr
                    </span>
                  </div>
                </div>

                {/* Bio / Overview */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">Overview / Biography</label>
                    <span className="text-[11px] text-slate-400">{bio.length} / 4000</span>
                  </div>
                  <textarea
                    rows={4}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={4000}
                    placeholder="Describe your background, expertise, recent successes, and what makes your services stand out..."
                    className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 leading-relaxed"
                  />
                </div>

                {/* Skills Taxonomy Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Skills &amp; Proficiencies ({selectedSkills.length} selected)
                  </label>

                  {/* Selected badges */}
                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    {selectedSkills.length === 0 ? (
                      <span className="text-xs text-slate-400 italic">No skills added yet.</span>
                    ) : (
                      selectedSkills.map((skill) => (
                        <span
                          key={skill.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-medium border border-emerald-200"
                        >
                          <span>{skill.name}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveSkill(skill.id)}
                            className="hover:text-rose-600 transition-colors cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  {/* Skill Search / Add Input */}
                  <div className="relative">
                    <input
                      type="text"
                      value={skillSearch}
                      onChange={(e) => setSkillSearch(e.target.value)}
                      placeholder="Search to add skills (e.g. React, Next.js, PostgreSQL)..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                    />

                    {skillSearch.trim().length > 0 && filteredSkills.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 p-1.5 max-h-40 overflow-y-auto space-y-0.5">
                        {filteredSkills.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleAddSkill(s)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <span>{s.name}</span>
                            <Plus className="w-3.5 h-3.5 text-emerald-600" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* 4. Client-Specific Fields */}
            {!isFreelancer && (
              <div className="space-y-4 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  <span>Company / Organization Profile</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Company Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required={!isFreelancer}
                    placeholder="e.g. Acme Innovations"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Website URL</label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="url"
                        value={companyWebsite}
                        onChange={(e) => setCompanyWebsite(e.target.value)}
                        placeholder="https://example.com"
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Location</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        value={companyLocation}
                        onChange={(e) => setCompanyLocation(e.target.value)}
                        placeholder="e.g. Austin, TX (or Remote)"
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Company Description / Hiring Mission
                  </label>
                  <textarea
                    rows={3}
                    value={companyDescription}
                    onChange={(e) => setCompanyDescription(e.target.value)}
                    placeholder="Tell freelancers about your company culture, technology stack, and the projects you hire for..."
                    className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-xs shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{isPending ? 'Saving...' : 'Save Profile'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
