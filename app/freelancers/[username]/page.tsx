'use client';

import React, { useState, Suspense } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMarketplace } from '@/lib/context/marketplace-context';
import ContactModal from '@/components/freelancers/contact-modal';
import {
  Star,
  Award,
  CheckCircle2,
  MapPin,
  Clock,
  Briefcase,
  GraduationCap,
  MessageSquare,
  ArrowLeft,
  Share2,
  Check,
  Globe,
  HelpCircle,
  FileCheck
} from 'lucide-react';

function FreelancerProfileContent() {
  const params = useParams();
  const username = params?.username as string;

  const { freelancers } = useMarketplace();
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const freelancer = freelancers.find((f) => f.username === username);

  if (!freelancer) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-6">
        <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
          <HelpCircle className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Freelancer Not Found</h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            The profile for <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-800">@{username}</code> does not exist or may have changed their username.
          </p>
        </div>
        <div>
          <Link
            href="/freelancers"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Browse All Freelancers</span>
          </Link>
        </div>
      </div>
    );
  }

  const handleShare = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard?.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const getBadgeDisplay = (badge: string) => {
    switch (badge) {
      case 'top_rated_plus':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <Award className="w-4 h-4 text-emerald-600" />
            Top Rated Plus (Top 1%)
          </span>
        );
      case 'top_rated':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            <Award className="w-4 h-4 text-blue-600" />
            Top Rated
          </span>
        );
      case 'rising_talent':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
            <Award className="w-4 h-4 text-purple-600" />
            Rising Talent
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Back button & actions */}
      <div className="flex items-center justify-between">
        <Link
          href="/freelancers"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-emerald-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to talent search</span>
        </Link>

        <button
          onClick={handleShare}
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
          <span>{copiedLink ? 'Link Copied!' : 'Share Profile'}</span>
        </button>
      </div>

      {/* Profile Header Hero Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            <div className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={freelancer.avatarUrl}
                alt={freelancer.name}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border-2 border-white shadow-md"
              />
              <span
                className="absolute bottom-1 right-1 w-5 h-5 bg-emerald-500 border-2 border-white rounded-full"
                title="Available for projects"
              />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {freelancer.name}
                </h1>
                {getBadgeDisplay(freelancer.badge)}
              </div>

              <p className="text-base sm:text-lg font-medium text-slate-700">
                {freelancer.title}
              </p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
                <span className="flex items-center gap-1 text-slate-600">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  {freelancer.location}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 text-slate-600">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Local time: {freelancer.localTime}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 text-slate-600">
                  <Globe className="w-3.5 h-3.5 text-slate-400" />
                  English: {freelancer.englishLevel}
                </span>
              </div>
            </div>
          </div>

          {/* Action CTA & Rate Card */}
          <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-3 shrink-0 p-4 sm:p-0 bg-slate-50 sm:bg-transparent rounded-xl">
            <div className="text-left sm:text-right">
              <span className="text-2xl sm:text-3xl font-black text-slate-900">
                ${freelancer.hourlyRate}
              </span>
              <span className="text-xs text-slate-500 font-semibold"> / hr</span>
              <span className="block text-[11px] font-medium text-emerald-700">
                {freelancer.availability}
              </span>
            </div>

            <button
              onClick={() => setIsContactOpen(true)}
              type="button"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm shadow-emerald-600/20 transition-all"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Contact / Hire</span>
            </button>
          </div>
        </div>

        {/* Highlight Metrics Strip */}
        <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center sm:text-left">
          <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-100">
            <span className="text-slate-400 text-xs block font-medium">Job Success</span>
            <div className="flex items-center justify-center sm:justify-start gap-1 mt-0.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <strong className="text-base font-extrabold text-slate-900">
                {freelancer.jobSuccessScore}%
              </strong>
            </div>
          </div>

          <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-100">
            <span className="text-slate-400 text-xs block font-medium">Rating</span>
            <div className="flex items-center justify-center sm:justify-start gap-1 mt-0.5">
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              <strong className="text-base font-extrabold text-slate-900">
                {freelancer.rating.toFixed(2)}
              </strong>
              <span className="text-xs text-slate-400">({freelancer.reviewCount})</span>
            </div>
          </div>

          <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-100">
            <span className="text-slate-400 text-xs block font-medium">Total Earned</span>
            <strong className="text-base font-extrabold text-slate-900 mt-0.5 block">
              {freelancer.totalEarnings}
            </strong>
          </div>

          <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-100">
            <span className="text-slate-400 text-xs block font-medium">Projects Done</span>
            <strong className="text-base font-extrabold text-slate-900 mt-0.5 block">
              {freelancer.completedJobsCount} completed
            </strong>
          </div>
        </div>
      </div>

      {/* Main Grid: Bio & Portfolio (Left) + Experience & Reviews (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column (2 cols) */}
        <div className="lg:col-span-2 space-y-8">
          {/* About / Bio */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
            <h2 className="text-lg font-bold text-slate-900">Overview</h2>
            <p className="text-sm text-slate-600 font-medium italic">
              &ldquo;{freelancer.tagline}&rdquo;
            </p>
            <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line space-y-3">
              {freelancer.bio}
            </div>
          </div>

          {/* Skills Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
            <h2 className="text-lg font-bold text-slate-900">Skills & Proficiencies</h2>
            <div className="flex flex-wrap gap-2">
              {freelancer.skills.map((skill) => (
                <span
                  key={skill}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-800 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>

          {/* Portfolio Showcase */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Portfolio Cases</h2>
              <span className="text-xs text-slate-500 font-medium">
                {freelancer.portfolio.length} verified projects
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {freelancer.portfolio.map((item) => (
                <div
                  key={item.id}
                  className="group rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex flex-col justify-between hover:shadow-md transition-shadow"
                >
                  <div className="h-44 overflow-hidden relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-900/80 text-white backdrop-blur-xs">
                      {item.category}
                    </div>
                  </div>

                  <div className="p-4 space-y-2 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 line-clamp-1">{item.title}</h3>
                      <p className="text-xs text-slate-600 line-clamp-2 mt-1 leading-relaxed">
                        {item.description}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-200/60 flex flex-wrap gap-1">
                      {item.tags.map((t) => (
                        <span key={t} className="text-[10px] font-medium text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Client Testimonials / Reviews */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Client Reviews & Feedback</h2>
              <div className="flex items-center gap-1 text-sm font-bold text-slate-900">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                <span>{freelancer.rating.toFixed(2)}</span>
                <span className="text-slate-400 font-normal">({freelancer.reviewCount})</span>
              </div>
            </div>

            <div className="space-y-4">
              {freelancer.reviews.map((rev) => (
                <div key={rev.id} className="p-4 rounded-xl bg-slate-50/70 border border-slate-100 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900">{rev.jobTitle}</span>
                    <span className="font-semibold text-emerald-700">{rev.amountEarned}</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <div className="flex items-center text-amber-500">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-3 h-3 fill-amber-500" />
                      ))}
                    </div>
                    <span>{rev.rating.toFixed(1)}</span>
                    <span>•</span>
                    <span>{rev.date}</span>
                    <span>•</span>
                    <span className="font-medium text-slate-700">{rev.clientName}</span>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed italic">
                    &ldquo;{rev.comment}&rdquo;
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Sidebar: Experience & Education */}
        <div className="space-y-6">
          {/* Work Experience */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-900 pb-2 border-b border-slate-100">
              <Briefcase className="w-4 h-4 text-emerald-600" />
              <span>Work History</span>
            </div>

            <div className="space-y-4">
              {freelancer.experience.map((exp) => (
                <div key={exp.id} className="space-y-1 text-xs">
                  <h4 className="font-bold text-slate-900 text-sm">{exp.title}</h4>
                  <div className="text-emerald-700 font-medium">{exp.company}</div>
                  <div className="text-slate-400 text-[11px]">{exp.period}</div>
                  <p className="text-slate-600 leading-relaxed pt-1">{exp.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Education & Credentials */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-900 pb-2 border-b border-slate-100">
              <GraduationCap className="w-4 h-4 text-emerald-600" />
              <span>Education & Degrees</span>
            </div>

            <div className="space-y-3">
              {freelancer.education.map((edu) => (
                <div key={edu.id} className="text-xs space-y-0.5">
                  <h4 className="font-bold text-slate-900">{edu.degree}</h4>
                  <div className="text-slate-600">{edu.institution}</div>
                  <div className="text-slate-400 text-[11px]">{edu.year}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Verification Badge info */}
          <div className="bg-emerald-50/70 border border-emerald-200/60 rounded-2xl p-5 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-800 font-bold">
              <FileCheck className="w-4 h-4 text-emerald-600" />
              <span>Workspace Identity Verified</span>
            </div>
            <p className="text-emerald-700 leading-relaxed">
              This freelancer has completed government ID verification, phone authentication, and technical assessments.
            </p>
          </div>
        </div>
      </div>

      <ContactModal
        freelancer={freelancer}
        isOpen={isContactOpen}
        onClose={() => setIsContactOpen(false)}
      />
    </div>
  );
}

export default function FreelancerProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-500">
          Loading specialist profile...
        </div>
      }
    >
      <FreelancerProfileContent />
    </Suspense>
  );
}
