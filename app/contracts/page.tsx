'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getContracts } from '@/lib/actions/contracts';
import { Contract, ContractStatus } from '@/lib/types';
import {
  Layers,
  Clock,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Search,
} from 'lucide-react';

export default function ContractsIndexPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | ContractStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadContracts = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    const res = await getContracts({
      status: statusFilter === 'all' ? undefined : statusFilter,
    });

    if (res.success) {
      setContracts(res.contracts);
    } else {
      setError(res.error || 'Failed to load contracts.');
    }

    setRefreshing(false);
  }, [statusFilter]);

  useEffect(() => {
    let isMounted = true;
    getContracts({
      status: statusFilter === 'all' ? undefined : statusFilter,
    }).then((res) => {
      if (!isMounted) return;
      if (res.success) {
        setContracts(res.contracts);
      } else {
        setError(res.error || 'Failed to load contracts.');
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [statusFilter]);

  const filteredContracts = contracts.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      (c.jobTitle && c.jobTitle.toLowerCase().includes(q)) ||
      (c.clientName && c.clientName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <ShieldCheck className="w-4 h-4" />
            <span>Workspace Escrow & Contract Management</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Your Contracts & Milestones</h1>
              <p className="text-xs text-slate-500 mt-1">
                Manage your active engagements, review deliverables, fund escrow, and disburse verified payouts.
              </p>
            </div>
            <button
              onClick={() => loadContracts()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer w-fit"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Filter & Search Bar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {(['all', 'active', 'completed', 'paused'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all cursor-pointer whitespace-nowrap ${
                  statusFilter === status
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {status}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contracts by title or client..."
              className="w-full text-xs pl-9 pr-3 py-2 rounded-xl border border-slate-200 focus:border-emerald-600 outline-hidden"
            />
          </div>
        </div>

        {/* Contracts List */}
        {loading ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500 font-medium">Loading your contracts...</p>
          </div>
        ) : error ? (
          <div className="p-8 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-2 text-rose-900 text-xs">
            <p className="font-bold">Error loading contracts</p>
            <p>{error}</p>
          </div>
        ) : filteredContracts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3 shadow-xs">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">No Contracts Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              When a client accepts an offer or proposal, a contractual agreement is established with milestone escrow tracking.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredContracts.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-emerald-300 hover:shadow-sm transition-all space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        c.contractType === 'fixed' ? 'bg-purple-50 text-purple-800 border border-purple-200' : 'bg-blue-50 text-blue-800 border border-blue-200'
                      }`}>
                        {c.contractType === 'fixed' ? 'Fixed-Price' : 'Hourly'}
                      </span>
                      <span className={`inline-block px-2 py-0.2 rounded-md text-[10px] font-bold uppercase ${
                        c.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {c.status}
                      </span>
                      <span className="text-xs text-slate-400">
                        Established {new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>

                    <h2 className="text-base font-bold text-slate-900 hover:text-emerald-700 transition-colors">
                      <Link href={`/contracts/${c.id}`}>{c.title}</Link>
                    </h2>
                    <p className="text-xs text-slate-500">{c.jobTitle}</p>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <span className="text-xs text-slate-400 block font-semibold">Terms</span>
                    <span className="text-lg font-black text-slate-900">
                      {c.contractType === 'fixed' && c.fixedPrice
                        ? `$${c.fixedPrice.toFixed(2)}`
                        : c.hourlyRate
                        ? `$${c.hourlyRate.toFixed(2)}/hr`
                        : '—'}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <div className="text-slate-500">
                    {c.clientName && <span>Client: <strong className="text-slate-800">{c.clientName}</strong></span>}
                  </div>

                  <div className="flex items-center gap-3">
                    {c.contractType === 'hourly' && (
                      <Link
                        href="/freelancer/time-tracking"
                        className="font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>Track Time</span>
                      </Link>
                    )}
                    <Link
                      href={`/contracts/${c.id}`}
                      className="font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
                    >
                      <span>{c.contractType === 'hourly' ? 'View Contract' : 'Manage Milestones'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
