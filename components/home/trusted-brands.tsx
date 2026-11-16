import React from 'react';
import { ShieldCheck, Lock, FileCheck2, Receipt, MessageSquareCode, Award } from 'lucide-react';

export default function TrustedBrands() {
  const trustFeatures = [
    {
      icon: ShieldCheck,
      title: 'Escrow Protection',
      description: 'Funds held securely until milestones are approved',
    },
    {
      icon: Lock,
      title: 'Secure Payments',
      description: 'Encrypted checkout and automated fee deductions',
    },
    {
      icon: FileCheck2,
      title: 'Milestone Delivery',
      description: 'Inspect deliverables before approving disbursements',
    },
    {
      icon: Receipt,
      title: 'Transparent Ledger',
      description: 'Full financial audit trail for every contract',
    },
    {
      icon: MessageSquareCode,
      title: 'Authenticated Chat',
      description: 'Direct messaging and real-time project rooms',
    },
    {
      icon: Award,
      title: 'Verified Reviews',
      description: 'Authentic feedback tied directly to completed contracts',
    },
  ];

  return (
    <div className="w-full pt-10 sm:pt-12 pb-6 sm:pb-8 text-center border-b border-slate-100">
      <p className="text-[11px] sm:text-[12px] font-semibold tracking-[0.22em] text-[#5e6d55] uppercase mb-6 sm:mb-8">
        Enterprise-Grade Marketplace Assurance & Trust
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 px-2">
        {trustFeatures.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="group flex flex-col items-center text-center p-3 sm:p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/60 hover:bg-white hover:border-emerald-200 hover:shadow-xs transition-all duration-200"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-2 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <Icon className="w-4 h-4" />
              </div>
              <span className="font-bold text-slate-800 text-xs tracking-tight">
                {feature.title}
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 leading-snug line-clamp-2">
                {feature.description}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
