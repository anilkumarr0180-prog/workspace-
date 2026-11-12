'use client';

import React, { createContext, useContext, useState } from 'react';
import { Job, Freelancer, ProposalSubmission } from '../types';

interface MarketplaceContextType {
  jobs: Job[];
  freelancers: Freelancer[];
  savedJobIds: string[];
  savedJobs: Job[];
  proposals: ProposalSubmission[];
  toggleSaveJob: (jobId: string) => void;
  isJobSaved: (jobId: string) => boolean;
  addProposal: (proposal: Omit<ProposalSubmission, 'id' | 'submittedAt' | 'status'>) => void;
  addJob: (newJob: Omit<Job, 'id' | 'postedAt' | 'proposalCount' | 'client'> & { clientName?: string; companyName?: string }) => string;
  hasAppliedToJob: (jobId: string) => boolean;
  sendContactMessage: (username: string, subject: string, message: string) => void;
  contactMessagesCount: number;
}

const MarketplaceContext = createContext<MarketplaceContextType | undefined>(undefined);

function generateUniqueId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MarketplaceProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [savedJobIds, setSavedJobIds] = useState<string[]>([]);
  const [persistedSavedJobs, setPersistedSavedJobs] = useState<Job[]>([]);
  const [proposals, setProposals] = useState<ProposalSubmission[]>([]);
  const [contactMessagesCount, setContactMessagesCount] = useState<number>(0);
  const isMountedRef = React.useRef(false);

  // Clear any legacy mock localStorage state on mount
  React.useEffect(() => {
    try {
      localStorage.removeItem('upwork_custom_jobs');
      localStorage.removeItem('workspace_custom_jobs');
      localStorage.removeItem('skillbridge_custom_jobs');
      localStorage.removeItem('upwork_proposals');
      localStorage.removeItem('workspace_proposals');
      localStorage.removeItem('skillbridge_proposals');
    } catch {
      // Safe fallback
    }
    isMountedRef.current = true;
  }, []);

  // Fetch genuine data strictly from Supabase API on mount
  React.useEffect(() => {
    // 1. Live Jobs
    fetch('/api/jobs?limit=50')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.jobs)) {
          setJobs(data.jobs);
        }
      })
      .catch(() => {});

    // 2. Live Freelancers
    fetch('/api/freelancers?limit=50')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.freelancers)) {
          setFreelancers(data.freelancers);
        }
      })
      .catch(() => {});

    // 3. Live Saved Jobs
    fetch('/api/saved-jobs')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.savedJobIds)) {
          setSavedJobIds(data.savedJobIds);
          if (Array.isArray(data.savedJobs)) {
            setPersistedSavedJobs(data.savedJobs);
          }
        }
      })
      .catch(() => {});

    // 4. Live Proposals
    fetch('/api/proposals')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.proposals)) {
          setProposals(
            data.proposals.map((p: {
              id: string;
              jobId: string;
              jobTitle: string;
              bidAmount: number;
              rateType: ProposalSubmission['rateType'];
              coverLetter: string;
              deliveryDays?: number;
              createdAt: string;
              status: ProposalSubmission['status'];
            }) => ({
              id: p.id,
              jobId: p.jobId,
              jobTitle: p.jobTitle,
              bidAmount: Number(p.bidAmount),
              rateType: p.rateType,
              coverLetter: p.coverLetter,
              deliveryDays: p.deliveryDays || 14,
              submittedAt: p.createdAt,
              status: p.status,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Reactively sync saved job IDs to localStorage
  React.useEffect(() => {
    if (!isMountedRef.current) return;
    try {
      localStorage.setItem('upwork_saved_jobs', JSON.stringify(savedJobIds));
    } catch {
      // Safe fallback
    }
  }, [savedJobIds]);

  // Pure state updater: toggle job saved status with API synchronization
  const toggleSaveJob = (jobId: string) => {
    const isCurrentlySaved = savedJobIds.includes(jobId);
    if (isCurrentlySaved) {
      setSavedJobIds((prev) => prev.filter((id) => id !== jobId));
      setPersistedSavedJobs((prev) => prev.filter((j) => j.id !== jobId));
      fetch(`/api/saved-jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
    } else {
      setSavedJobIds((prev) => [...prev, jobId]);
      const existingJob = jobs.find((j) => j.id === jobId);
      if (existingJob) {
        setPersistedSavedJobs((prev) => [...prev, existingJob]);
      }
      fetch('/api/saved-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      }).catch(() => {});
    }
  };

  const isJobSaved = (jobId: string) => savedJobIds.includes(jobId);

  const hasAppliedToJob = (jobId: string) => {
    return proposals.some((p) => p.jobId === jobId);
  };

  // Pure state updater: add proposal
  const addProposal = (newProposalData: Omit<ProposalSubmission, 'id' | 'submittedAt' | 'status'>) => {
    const newProposal: ProposalSubmission = {
      ...newProposalData,
      id: generateUniqueId('prop'),
      submittedAt: 'Just now',
      status: 'submitted'
    };

    setProposals((prev) => [newProposal, ...prev]);

    // Increment proposal count on the target job
    setJobs((prev) =>
      prev.map((j) => (j.id === newProposalData.jobId ? { ...j, proposalCount: j.proposalCount + 1 } : j))
    );
  };

  // Pure state updater: add job
  const addJob = (newJobData: Omit<Job, 'id' | 'postedAt' | 'proposalCount' | 'client'> & { clientName?: string; companyName?: string }): string => {
    const newId = generateUniqueId('job');
    const fullJob: Job = {
      ...newJobData,
      id: newId,
      postedAt: 'Just now',
      proposalCount: 0,
      client: {
        id: 'cli-user',
        name: newJobData.clientName || 'Demo Enterprise Client',
        companyName: newJobData.companyName || 'Workspace Innovation Labs',
        location: 'Remote / Global',
        rating: 5.0,
        reviewCount: 1,
        totalSpent: 12000,
        paymentVerified: true,
        memberSince: 'October 2026',
        hireRate: 100,
        openJobsCount: 1
      }
    };

    setJobs((prev) => [fullJob, ...prev]);
    return newId;
  };

  const sendContactMessage = (_username: string, _subject: string, _message: string) => {
    void _username;
    void _subject;
    void _message;
    setContactMessagesCount((prev) => prev + 1);
  };

  const savedJobs = React.useMemo(() => {
    const jobMap = new Map<string, Job>();
    persistedSavedJobs.forEach((j) => jobMap.set(j.id, j));
    jobs.forEach((j) => {
      if (savedJobIds.includes(j.id)) {
        jobMap.set(j.id, j);
      }
    });
    return savedJobIds.map((id) => jobMap.get(id)).filter((j): j is Job => Boolean(j));
  }, [savedJobIds, persistedSavedJobs, jobs]);

  return (
    <MarketplaceContext.Provider
      value={{
        jobs,
        freelancers,
        savedJobIds,
        savedJobs,
        proposals,
        toggleSaveJob,
        isJobSaved,
        addProposal,
        addJob,
        hasAppliedToJob,
        sendContactMessage,
        contactMessagesCount
      }}
    >
      {children}
    </MarketplaceContext.Provider>
  );
}

export function useMarketplace() {
  const context = useContext(MarketplaceContext);
  if (!context) {
    throw new Error('useMarketplace must be used within a MarketplaceProvider');
  }
  return context;
}
