'use client';

import React, { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getEditableProfile,
  updateFreelancerProfile,
  updateClientProfile,
  switchActiveRole,
  EditableProfileData,
} from '@/lib/actions/profile';
import AvatarUploader from '@/components/profile/avatar-uploader';
import {
  User,
  Briefcase,
  Building2,
  Globe,
  MapPin,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Repeat,
  Plus,
  X,
} from 'lucide-react';

export default function ProfileSettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<EditableProfileData | null>(null);
  const [availableSkills, setAvailableSkills] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [switchingRole, setSwitchingRole] = useState(false);
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

  useEffect(() => {
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
        setErrorMessage(res.error || 'Failed to load profile.');
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const isFreelancer = profile?.activeMode === 'freelancer';

  const handleRoleToggle = async () => {
    if (switchingRole || !profile) return;
    const targetRole = isFreelancer ? 'client' : 'freelancer';
    setSwitchingRole(true);
    try {
      const res = await switchActiveRole(targetRole);
      if (res.success) {
        setProfile((prev) => (prev ? { ...prev, activeMode: targetRole } : null));
        router.refresh();
      } else {
        setErrorMessage(res.error || 'Failed to switch role.');
      }
    } catch {
      setErrorMessage('Network error while switching role.');
    } finally {
      setSwitchingRole(false);
    }
  };

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
        router.refresh();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unexpected error saving profile.';
        setErrorMessage(msg);
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Back button */}
      <div>
        <Link
          href={isFreelancer ? (profile?.username ? `/freelancers/${profile.username}` : '/freelancer') : '/client'}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-emerald-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to dashboard</span>
        </Link>
      </div>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Profile Settings
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Manage your public identity, profile picture, and role-specific details.
          </p>
        </div>

        {/* Role Toggle Button */}
        {profile && (
          <button
            type="button"
            onClick={handleRoleToggle}
            disabled={switchingRole}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold shadow-2xs transition-all cursor-pointer disabled:opacity-50"
          >
            {switchingRole ? (
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            ) : (
              <Repeat className="w-4 h-4 text-emerald-600" />
            )}
            <span>
              Mode: <strong className="capitalize text-slate-900">{profile.activeMode}</strong> (Switch)
            </span>
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-sm font-medium text-slate-500">Loading profile...</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Notifications */}
          {errorMessage && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-sm flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-sm flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* 1. Profile Photo Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-slate-900">Profile Picture</h2>
            {profile && (
              <AvatarUploader
                userId={profile.id}
                currentAvatarUrl={profile.avatarUrl}
                displayName={fullName || profile.fullName}
                size="lg"
                onAvatarChanged={(newUrl) => {
                  setProfile((prev) => (prev ? { ...prev, avatarUrl: newUrl } : null));
                }}
              />
            )}
          </div>

          {/* 2. Personal & Professional Identity Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
            <h2 className="text-base font-bold text-slate-900">Identity &amp; Role</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    maxLength={80}
                    placeholder="e.g. Jane Doe"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isFreelancer ? 'Professional Title' : 'Your Position / Role'}
                </label>
                <div className="relative">
                  <Briefcase className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
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
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 3. Freelancer-Specific Section */}
          {isFreelancer && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
              <h2 className="text-base font-bold text-slate-900">Freelancer Details</h2>

              {/* Hourly Rate */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
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

                <div className="relative max-w-xs">
                  <span className="absolute left-3.5 top-2.5 text-sm font-bold text-slate-500">
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
                    className="w-full pl-8 pr-14 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs font-semibold text-slate-400">
                    / hr
                  </span>
                </div>
              </div>

              {/* Bio */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-700">Overview / Biography</label>
                  <span className="text-[11px] text-slate-400">{bio.length} / 4000</span>
                </div>
                <textarea
                  rows={5}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={4000}
                  placeholder="Highlight your experience, technologies, and past accomplishments..."
                  className="w-full p-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 leading-relaxed"
                />
              </div>

              {/* Skills */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Skills &amp; Proficiencies ({selectedSkills.length} selected)
                </label>

                <div className="flex flex-wrap gap-2 mb-3">
                  {selectedSkills.length === 0 ? (
                    <span className="text-xs text-slate-400 italic">No skills selected yet.</span>
                  ) : (
                    selectedSkills.map((skill) => (
                      <span
                        key={skill.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-medium border border-emerald-200"
                      >
                        <span>{skill.name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSkill(skill.id)}
                          className="hover:text-rose-600 transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))
                  )}
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    placeholder="Search to add skills (e.g. Next.js, Node.js, UI/UX, Python)..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />

                  {skillSearch.trim().length > 0 && filteredSkills.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 p-2 max-h-48 overflow-y-auto space-y-1">
                      {filteredSkills.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleAddSkill(s)}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs sm:text-sm text-left text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <span>{s.name}</span>
                          <Plus className="w-4 h-4 text-emerald-600" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 4. Client-Specific Section */}
          {!isFreelancer && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
              <h2 className="text-base font-bold text-slate-900">Company &amp; Organization</h2>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Company Name <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required={!isFreelancer}
                    placeholder="e.g. Acme Innovations"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Website</label>
                  <div className="relative">
                    <Globe className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="url"
                      value={companyWebsite}
                      onChange={(e) => setCompanyWebsite(e.target.value)}
                      placeholder="https://example.com"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Location</label>
                  <div className="relative">
                    <MapPin className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={companyLocation}
                      onChange={(e) => setCompanyLocation(e.target.value)}
                      placeholder="e.g. San Francisco, CA (or Remote)"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Company / Hiring Mission
                </label>
                <textarea
                  rows={4}
                  value={companyDescription}
                  onChange={(e) => setCompanyDescription(e.target.value)}
                  placeholder="Describe your organization, team, and the kind of talent you collaborate with..."
                  className="w-full p-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-4 pt-4">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{isPending ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
