'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Freelancer } from '@/lib/types';
import ContactModal from './contact-modal';
import {
  Star,
  Award,
  CheckCircle,
  MapPin,
  Clock,
  MessageSquare
} from 'lucide-react';

interface FreelancerCardProps {
  freelancer: Freelancer;
}

export default function FreelancerCard({ freelancer }: FreelancerCardProps) {
  const [isContactOpen, setIsContactOpen] = useState(false);

  const getBadgeDisplay = (badge: string) => {
    switch (badge) {
      case 'top_rated_plus':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <Award className="w-3.5 h-3.5 text-emerald-600" />
            Top Rated Plus
          </span>
        );
      case 'top_rated':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            <Award className="w-3.5 h-3.5 text-blue-600" />
            Top Rated
          </span>
        );
      case 'rising_talent':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
            <Award className="w-3.5 h-3.5 text-purple-600" />
            Rising Talent
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200/90 p-5 sm:p-6 transition-all duration-200 hover:border-emerald-500/60 hover:shadow-md flex flex-col justify-between">
        <div>
          {/* Top Row: Avatar, Name, Title, Rate */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={freelancer.avatarUrl}
                  alt={freelancer.name}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover border-2 border-white shadow-xs"
                />
                <span
                  className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full"
                  title="Available for projects"
                />
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/freelancers/${freelancer.username}`}
                    className="font-bold text-lg text-slate-900 hover:text-emerald-700 transition-colors"
                  >
                    {freelancer.name}
                  </Link>
                  {getBadgeDisplay(freelancer.badge)}
                </div>

                <p className="text-sm font-medium text-slate-700 mt-0.5 line-clamp-1">
                  {freelancer.title}
                </p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mt-1.5">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    {freelancer.location}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {freelancer.localTime}
                  </span>
                </div>
              </div>
            </div>

            {/* Rate & Job Success */}
            <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-1 shrink-0 bg-slate-50 sm:bg-transparent p-3 sm:p-0 rounded-xl">
              <div className="text-right">
                <span className="text-xl font-bold text-slate-900">${freelancer.hourlyRate}</span>
                <span className="text-xs text-slate-500 font-medium">/hr</span>
              </div>

              <div className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>{freelancer.jobSuccessScore}% Job Success</span>
              </div>
            </div>
          </div>

          {/* Bio snippet */}
          <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 mb-4 leading-relaxed">
            {freelancer.bio}
          </p>

          {/* Quick Metrics Bar */}
          <div className="flex items-center gap-4 py-2 px-3 rounded-lg bg-slate-50/80 border border-slate-100 text-xs text-slate-600 mb-4">
            <div className="flex items-center gap-1">
              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              <strong className="text-slate-900">{freelancer.rating.toFixed(2)}</strong>
              <span className="text-slate-400">({freelancer.reviewCount})</span>
            </div>
            <span>•</span>
            <div>
              <span className="text-slate-400">Earned:</span>{' '}
              <strong className="text-slate-900">{freelancer.totalEarnings}</strong>
            </div>
            <span>•</span>
            <div>
              <span className="text-slate-400">Completed:</span>{' '}
              <strong className="text-slate-900">{freelancer.completedJobsCount} jobs</strong>
            </div>
          </div>

          {/* Skills Badges */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            {freelancer.skills.slice(0, 5).map((skill) => (
              <span
                key={skill}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700"
              >
                {skill}
              </span>
            ))}
            {freelancer.skills.length > 5 && (
              <span className="px-2 py-1 rounded-md text-xs font-medium text-slate-500 bg-slate-50">
                +{freelancer.skills.length - 5} more
              </span>
            )}
          </div>

          {/* Portfolio Previews */}
          {freelancer.portfolio && freelancer.portfolio.length > 0 && (
            <div className="mb-5">
              <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider block mb-2">
                Recent Projects
              </span>
              <div className="grid grid-cols-2 gap-2">
                {freelancer.portfolio.slice(0, 2).map((item) => (
                  <div
                    key={item.id}
                    className="group/thumb relative rounded-lg overflow-hidden border border-slate-200 bg-slate-100 h-20"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent flex items-end p-2">
                      <span className="text-[11px] font-medium text-white truncate">
                        {item.title}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <button
            onClick={() => setIsContactOpen(true)}
            type="button"
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Contact</span>
          </button>

          <Link
            href={`/freelancers/${freelancer.username}`}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-xs"
          >
            <span>View Profile</span>
          </Link>
        </div>
      </div>

      <ContactModal
        freelancer={freelancer}
        isOpen={isContactOpen}
        onClose={() => setIsContactOpen(false)}
      />
    </>
  );
}
