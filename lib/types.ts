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
