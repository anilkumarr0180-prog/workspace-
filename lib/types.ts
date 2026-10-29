export type ProjectType = 'fixed' | 'hourly';
export type ExperienceLevel = 'entry' | 'intermediate' | 'expert';
export type ProjectDuration = 'less_than_1_month' | '1_to_3_months' | '3_to_6_months' | 'more_than_6_months';

export interface ClientInfo {
  id: string;
  name: string;
  companyName?: string;
  location: string;
  rating: number;
  reviewCount: number;
  totalSpent: number;
  paymentVerified: boolean;
  memberSince: string;
  hireRate: number; // e.g. 85 for 85%
  openJobsCount: number;
}

export interface Job {
  id: string;
  title: string;
  category: string;
  description: string;
  responsibilities?: string[];
  deliverables?: string[];
  projectType: ProjectType;
  budget: {
    type: ProjectType;
    fixedAmount?: number;
    hourlyMin?: number;
    hourlyMax?: number;
  };
  experienceLevel: ExperienceLevel;
  duration: ProjectDuration;
  skills: string[];
  client: ClientInfo;
  postedAt: string;
  proposalCount: number;
  isFeatured?: boolean;
}

export interface PortfolioItem {
  id: string;
  title: string;
  description: string;
  category: string;
  imageUrl: string;
  tags: string[];
  projectUrl?: string;
}

export interface WorkExperience {
  id: string;
  title: string;
  company: string;
  period: string;
  description: string;
}

export interface EducationItem {
  id: string;
  degree: string;
  institution: string;
  year: string;
}

export interface FreelancerReview {
  id: string;
  clientName: string;
  rating: number;
  date: string;
  jobTitle: string;
  comment: string;
  amountEarned: string;
}

export interface Freelancer {
  id: string;
  username: string;
  name: string;
  avatarUrl: string;
  title: string;
  tagline: string;
  bio: string;
  hourlyRate: number;
  rating: number;
  reviewCount: number;
  jobSuccessScore: number; // e.g. 98 for 98%
  badge: 'top_rated' | 'top_rated_plus' | 'rising_talent';
  location: string;
  localTime: string;
  totalEarnings: string;
  hoursWorked: number;
  completedJobsCount: number;
  primaryCategory: string;
  skills: string[];
  availability: 'Full-time' | 'Part-time' | 'Available now';
  englishLevel: string;
  portfolio: PortfolioItem[];
  experience: WorkExperience[];
  education: EducationItem[];
  reviews: FreelancerReview[];
}

export interface ProposalSubmission {
  id: string;
  jobId: string;
  jobTitle: string;
  bidAmount: number;
  rateType: ProjectType;
  coverLetter: string;
  deliveryDays: number;
  submittedAt: string;
  status: 'submitted' | 'under_review' | 'interviewing' | 'accepted' | 'rejected' | 'withdrawn';
}

export interface JobFilters {
  query: string;
  category: string;
  projectType: string;
  experienceLevel: string;
  minBudget?: number;
  maxBudget?: number;
  sortBy: 'newest' | 'budget_high' | 'proposals_low';
}

export interface FreelancerFilters {
  query: string;
  category: string;
  experienceLevel: string;
  minRate?: number;
  maxRate?: number;
  availability: string;
  sortBy: 'rating' | 'hourly_rate_low' | 'hourly_rate_high' | 'success_score';
}

export interface TaxonomySkill {
  id: string;
  name: string;
  slug: string;
}

export interface TaxonomyCategory {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  skills: TaxonomySkill[];
  jobCount?: number;
}

export interface PublicFreelancer {
  id: string;
  username: string;
  fullName: string;
  avatarUrl?: string | null;
  title?: string | null;
  bio?: string | null;
  hourlyRate?: number | null;
  rating: number;
  reviewCount: number;
  totalEarnings: number;
  skills: TaxonomySkill[];
  createdAt: string;
}

export type ContractStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type TimesheetStatus = 'open' | 'submitted' | 'under_review' | 'approved' | 'disputed' | 'paid';

export interface Contract {
  id: string;
  proposalId: string;
  jobId: string;
  jobTitle: string;
  clientId: string;
  clientName?: string;
  companyId?: string | null;
  companyName?: string | null;
  freelancerId: string;
  contractType: ProjectType;
  title: string;
  hourlyRate?: number | null;
  fixedPrice?: number | null;
  weeklyHourLimit?: number | null;
  allowManualTime: boolean;
  status: ContractStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveTimerSession {
  id: string;
  contractId: string;
  freelancerId: string;
  startTime: string;
  memo: string;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  contractId: string;
  contractTitle?: string;
  timesheetId?: string | null;
  freelancerId: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  memo: string;
  source: 'timer' | 'manual';
  createdAt: string;
}

export interface Timesheet {
  id: string;
  contractId: string;
  clientId: string;
  freelancerId: string;
  weekStartDate: string;
  totalMinutes: number;
  totalAmount: number;
  status: TimesheetStatus;
  createdAt: string;
  updatedAt: string;
}

export type MilestoneStatus =
  | 'planned'
  | 'funded'
  | 'in_progress'
  | 'submitted'
  | 'revision_requested'
  | 'approved'
  | 'released'
  | 'cancelled';

export type DeliveryReviewStatus = 'pending' | 'approved' | 'revision_requested' | 'superseded';

export type LedgerEventType =
  | 'escrow_funded'
  | 'escrow_released'
  | 'payout_disbursed'
  | 'service_fee_deducted'
  | 'escrow_refund';

export type LedgerStatus = 'succeeded' | 'pending' | 'reversed';

export interface DeliveryAttachment {
  title: string;
  url: string;
  type?: string;
}

export interface MilestoneDelivery {
  id: string;
  milestoneId: string;
  freelancerId: string;
  freelancerName?: string;
  freelancerAvatar?: string | null;
  deliveryNotes: string;
  attachments: DeliveryAttachment[];
  submittedAt: string;
  reviewStatus: DeliveryReviewStatus;
  clientFeedback?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  version: number;
  createdAt: string;
}

export interface ContractMilestone {
  id: string;
  contractId: string;
  clientId: string;
  clientName?: string;
  freelancerId: string;
  freelancerName?: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  sequenceOrder: number;
  dueDate?: string | null;
  status: MilestoneStatus;
  createdAt: string;
  updatedAt: string;
  deliveries?: MilestoneDelivery[];
}

export interface PaymentLedgerEntry {
  id: string;
  contractId: string;
  milestoneId?: string | null;
  milestoneTitle?: string | null;
  fromUserId?: string | null;
  fromUserName?: string | null;
  toUserId?: string | null;
  toUserName?: string | null;
  amount: number;
  currency: string;
  eventType: LedgerEventType;
  status: LedgerStatus;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type NotificationType =
  | 'proposal_received'
  | 'proposal_status_updated'
  | 'milestone_funded'
  | 'milestone_work_submitted'
  | 'milestone_revision_requested'
  | 'milestone_approved'
  | 'contract_created'
  | 'payment_processed'
  | 'system_announcement';

export interface NotificationItem {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  read: boolean;
  readAt?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}


