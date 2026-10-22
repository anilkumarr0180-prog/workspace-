'use client';

import React, { createContext, useContext, useState } from 'react';
import { Job, Freelancer, ProposalSubmission } from '../types';
import { INITIAL_JOBS, INITIAL_FREELANCERS, INITIAL_PROPOSALS } from '../mock-data';

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
  const [jobs, setJobs] = useState<Job[]>(INITIAL_JOBS);
  const [freelancers] = useState<Freelancer[]>(INITIAL_FREELANCERS);
  const [savedJobIds, setSavedJobIds] = useState<string[]>(['job-101', 'job-103']);
  const [proposals, setProposals] = useState<ProposalSubmission[]>(INITIAL_PROPOSALS);
  const [contactMessagesCount, setContactMessagesCount] = useState<number>(0);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  // Safely read and validate localStorage once on client mount (prevents SSR hydration mismatches)
  React.useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const storedJobs =
          localStorage.getItem('upwork_custom_jobs') ||
          localStorage.getItem('workspace_custom_jobs') ||
          localStorage.getItem('skillbridge_custom_jobs');
        if (storedJobs) {
          const parsedCustomJobs = JSON.parse(storedJobs);
          if (Array.isArray(parsedCustomJobs)) {
            setJobs([...parsedCustomJobs, ...INITIAL_JOBS]);
          }
        }
      } catch {
        // Safe fallback if localStorage is unavailable or corrupted
      }

      try {
        const storedSaved =
          localStorage.getItem('upwork_saved_jobs') ||
          localStorage.getItem('workspace_saved_jobs') ||
          localStorage.getItem('skillbridge_saved_jobs');
        if (storedSaved) {
          const parsedSaved = JSON.parse(storedSaved);
          if (Array.isArray(parsedSaved)) {
            setSavedJobIds(parsedSaved);
          }
        }
      } catch {
        // Safe fallback
      }

      try {
        const storedProposals =
          localStorage.getItem('upwork_proposals') ||
          localStorage.getItem('workspace_proposals') ||
          localStorage.getItem('skillbridge_proposals');
        if (storedProposals) {
          const parsedProposals = JSON.parse(storedProposals);
          if (Array.isArray(parsedProposals)) {
            setProposals(parsedProposals);
          }
        }
      } catch {
        // Safe fallback
      }

      setIsHydrated(true);
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  // Reactively sync custom jobs to localStorage whenever jobs state changes (after hydration)
  React.useEffect(() => {
    if (!isHydrated) return;
    try {
      const customOnly = jobs.filter((j) => j.client.id === 'cli-user');
      localStorage.setItem('upwork_custom_jobs', JSON.stringify(customOnly));
    } catch {
      // Safe fallback
    }
  }, [jobs, isHydrated]);

  // Reactively sync saved job IDs to localStorage
  React.useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem('upwork_saved_jobs', JSON.stringify(savedJobIds));
    } catch {
      // Safe fallback
    }
  }, [savedJobIds, isHydrated]);

  // Reactively sync proposals to localStorage
  React.useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem('upwork_proposals', JSON.stringify(proposals));
    } catch {
      // Safe fallback
    }
  }, [proposals, isHydrated]);

  // Pure state updater: toggle job saved status with API synchronization
  const toggleSaveJob = (jobId: string) => {
    const isCurrentlySaved = savedJobIds.includes(jobId);
    setSavedJobIds((prev) => (prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]));

    // Background sync to /api/saved-jobs
    if (isCurrentlySaved) {
      fetch(`/api/saved-jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
    } else {
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

  const savedJobs = jobs.filter((job) => savedJobIds.includes(job.id));

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
