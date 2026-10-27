import React, { Suspense } from 'react';
import Link from 'next/link';
import { Metadata } from 'next';
import { getFreelancerByUsername } from '@/lib/actions/freelancers';
import { ShareProfileButton, ContactHireButton } from '@/components/freelancers/profile-actions';
import {
  Star,
  Award,
  ArrowLeft,
  HelpCircle,
  FileCheck,
  Calendar,
} from 'lucide-react';

interface FreelancerPageProps {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({
  params,
}: FreelancerPageProps): Promise<Metadata> {
  const { username } = await params;
  const { freelancer } = await getFreelancerByUsername(username);

  if (!freelancer) {
    return {
      title: 'Freelancer Not Found | Workspace',
      description: 'The requested freelancer profile was not found on Workspace.',
    };
  }

  return {
    title: `${freelancer.fullName} (@${freelancer.username}) | Workspace`,
    description:
      freelancer.bio ||
      `${freelancer.fullName} - ${freelancer.title || 'Independent Professional'} on Workspace.`,
  };
}

function getInitials(name: string, username: string) {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (username || 'FL').slice(0, 2).toUpperCase();
}

function formatMemberSince(isoString: string) {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return 'Recently joined';
  }
}

function ProfileSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="w-32 h-5 bg-slate-200 rounded" />
        <div className="w-24 h-8 bg-slate-100 rounded-lg" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start gap-6">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-slate-200 shrink-0" />
          <div className="space-y-3 flex-1">
            <div className="w-48 h-8 bg-slate-200 rounded" />
            <div className="w-36 h-4 bg-slate-100 rounded" />
            <div className="w-52 h-4 bg-slate-100 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-slate-100">
          <div className="h-16 bg-slate-50 rounded-xl" />
          <div className="h-16 bg-slate-50 rounded-xl" />
          <div className="h-16 bg-slate-50 rounded-xl" />
          <div className="h-16 bg-slate-50 rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-44 bg-white rounded-2xl border border-slate-200" />
          <div className="h-32 bg-white rounded-2xl border border-slate-200" />
        </div>
        <div className="h-60 bg-white rounded-2xl border border-slate-200" />
      </div>
    </div>
  );
}

async function FreelancerProfileDetails({ params }: FreelancerPageProps) {
  const { username } = await params;
  const { freelancer, error, source } = await getFreelancerByUsername(username);

  // Not Found State
  if (!freelancer || error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-6">
        <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
          <HelpCircle className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            Freelancer Not Found
          </h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            The profile for <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800">@{username}</code> does not exist or is not publicly discoverable.
          </p>
        </div>
        <div>
          <Link
            href="/freelancers"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 shadow-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Browse All Freelancers</span>
          </Link>
        </div>
      </div>
    );
  }

  const hasHourlyRate = typeof freelancer.hourlyRate === 'number' && freelancer.hourlyRate > 0;
  const hasReviews = typeof freelancer.reviewCount === 'number' && freelancer.reviewCount > 0;
  const isTopRated = hasReviews && freelancer.rating >= 4.8;
  const initials = getInitials(freelancer.fullName, freelancer.username);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Demo Profile Separation Notice */}
      {source === 'fallback' && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs sm:text-sm flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-1 rounded-md font-bold bg-amber-200/80 text-amber-950 text-xs uppercase tracking-wider">
              Demo Profile
            </span>
            <span className="text-amber-800">
              This simulated profile is provided for local presentation preview and is separate from verified live marketplace records.
            </span>
          </div>
        </div>
      )}

      {/* Back button & actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/freelancers"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-emerald-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to talent search</span>
        </Link>

        <ShareProfileButton />
      </div>

      {/* Profile Header Hero Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            <div className="relative shrink-0">
              {freelancer.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={freelancer.avatarUrl}
                  alt={freelancer.fullName}
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

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {freelancer.fullName}
                </h1>
                {isTopRated ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    <Award className="w-4 h-4 text-emerald-600" />
                    <span>Top Rated Specialist</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                    <span>New Talent</span>
                  </span>
                )}
              </div>

              <p className="text-base sm:text-lg font-medium text-slate-700">
                {freelancer.title || 'Independent Professional'}
              </p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
                <span className="font-mono text-slate-600">
                  @{freelancer.username}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 text-slate-600">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Member since {formatMemberSince(freelancer.createdAt)}</span>
                </span>
                <span>•</span>
                <span className="text-emerald-700 font-semibold">
                  Workspace Verified
                </span>
              </div>
            </div>
          </div>

          {/* Action CTA & Rate Card */}
          <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-3 shrink-0 p-4 sm:p-0 bg-slate-50 sm:bg-transparent rounded-xl">
            <div className="text-left sm:text-right">
              {hasHourlyRate ? (
                <>
                  <span className="text-2xl sm:text-3xl font-black text-slate-900">
                    ${freelancer.hourlyRate}
                  </span>
                  <span className="text-xs text-slate-500 font-semibold"> / hr</span>
                </>
              ) : (
                <span className="text-sm font-semibold text-slate-700 block">
                  Rate Negotiable
                </span>
              )}
            </div>

            <ContactHireButton freelancer={freelancer} />
          </div>
        </div>

        {/* Highlight Metrics Strip (Strictly genuine database metrics) */}
        <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center sm:text-left">
          <div className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-100">
            <span className="text-slate-400 text-xs block font-medium">Rating</span>
            <div className="flex items-center justify-center sm:justify-start gap-1 mt-0.5">
              {hasReviews ? (
                <>
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <strong className="text-base font-extrabold text-slate-900">
                    {freelancer.rating.toFixed(2)}
                  </strong>
                  <span className="text-xs text-slate-400">({freelancer.reviewCount})</span>
                </>
              ) : (
                <span className="text-xs text-slate-500 font-medium">No reviews yet</span>
              )}
            </div>
          </div>

          <div className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-100">
            <span className="text-slate-400 text-xs block font-medium">Total Earned</span>
            <strong className="text-base font-extrabold text-slate-900 mt-0.5 block">
              ${freelancer.totalEarnings.toLocaleString()}
            </strong>
          </div>

          <div className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-100">
            <span className="text-slate-400 text-xs block font-medium">Specialized Skills</span>
            <strong className="text-base font-extrabold text-slate-900 mt-0.5 block">
              {freelancer.skills.length} verified
            </strong>
          </div>

          <div className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-100">
            <span className="text-slate-400 text-xs block font-medium">Account Status</span>
            <div className="flex items-center justify-center sm:justify-start gap-1 mt-0.5">
              <FileCheck className="w-4 h-4 text-emerald-600" />
              <strong className="text-sm font-extrabold text-slate-900">
                Active &amp; Eligible
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Overview & Skills (Left) + Verification & Quick Contact (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column (2 cols) */}
        <div className="lg:col-span-2 space-y-8">
          {/* About / Bio */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
            <h2 className="text-lg font-bold text-slate-900">Overview</h2>
            {freelancer.bio ? (
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line space-y-3">
                {freelancer.bio}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">
                This specialist has not published a detailed biography yet.
              </p>
            )}
          </div>

          {/* Skills Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Skills &amp; Proficiencies</h2>
              <span className="text-xs text-slate-500 font-medium">
                {freelancer.skills.length} skills listed
              </span>
            </div>

            {freelancer.skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {freelancer.skills.map((skill) => (
                  <span
                    key={skill.id}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-800 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                  >
                    {skill.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">
                No specific skills added to this profile yet.
              </p>
            )}
          </div>

          {/* Reviews Status */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Client Reviews &amp; Feedback</h2>
              {hasReviews ? (
                <div className="flex items-center gap-1 text-sm font-bold text-slate-900">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <span>{freelancer.rating.toFixed(2)}</span>
                  <span className="text-slate-400 font-normal">({freelancer.reviewCount})</span>
                </div>
              ) : (
                <span className="text-xs text-slate-400 font-medium">0 reviews</span>
              )}
            </div>

            {hasReviews ? (
              <p className="text-xs text-slate-600">
                Client feedback is recorded upon contract completion.
              </p>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500 space-y-1">
                <p className="font-semibold text-slate-700">No client reviews yet</p>
                <p>This specialist is ready for new project invitations on Workspace.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Verification Badge info */}
          <div className="bg-emerald-50/70 border border-emerald-200/60 rounded-2xl p-5 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-800 font-bold">
              <FileCheck className="w-4 h-4 text-emerald-600" />
              <span>Workspace Identity Verified</span>
            </div>
            <p className="text-emerald-700 leading-relaxed">
              This independent professional is registered on the Workspace platform with an active, compliant profile.
            </p>
          </div>

          {/* Quick Actions Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs text-xs">
            <h3 className="font-bold text-slate-900 text-sm">Collaborate</h3>
            <p className="text-slate-600 leading-relaxed">
              Interested in hiring {freelancer.fullName}? Send a message or propose a project to discuss scope and milestones.
            </p>
            <ContactHireButton
              freelancer={freelancer}
              className="w-full"
              label="Send Message"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FreelancerProfilePage({ params }: FreelancerPageProps) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <FreelancerProfileDetails params={params} />
    </Suspense>
  );
}
