if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email template types cannot be loaded in the browser.');
}

export type TemplateKey =
  | 'proposal_received_v1'
  | 'proposal_accepted_v1'
  | 'milestone_funded_v1'
  | 'milestone_released_v1'
  | 'unread_message_v1'
  | 'job_posted_v1'
  | 'proposal_submitted_v1'
  | 'proposal_under_review_v1'
  | 'meeting_scheduled_v1'
  | 'contract_offer_v1'
  | 'contract_started_v1'
  | 'password_reset_v1'
  | 'password_changed_alert_v1';

export type RecipientAccountState = 'existing_account' | 'no_account' | 'unknown';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface ProposalReceivedTemplateData {
  clientName: string;
  freelancerName: string;
  jobTitle: string;
  jobId: string;
  proposalId: string;
  submissionDate?: string;
  shortMessage?: string;
  accountState?: RecipientAccountState;
}

export interface ProposalAcceptedTemplateData {
  freelancerName: string;
  clientOrCompanyName: string;
  jobTitle: string;
  contractId: string;
  contractType: 'fixed' | 'hourly';
  rateOrAmount?: string | number;
  establishedDate?: string;
  accountState?: RecipientAccountState;
}

export interface MilestoneFundedTemplateData {
  recipientName: string;
  milestoneTitle: string;
  contractTitle: string;
  contractId: string;
  amount: number;
  currency: string;
  isSimulated?: boolean;
  fundedDate?: string;
  accountState?: RecipientAccountState;
}

export interface MilestoneReleasedTemplateData {
  recipientName: string;
  milestoneTitle: string;
  contractTitle: string;
  contractId: string;
  amount: number;
  currency: string;
  isSimulated?: boolean;
  releasedDate?: string;
  accountState?: RecipientAccountState;
}

export interface UnreadMessageTemplateData {
  recipientName: string;
  senderName: string;
  conversationId: string;
  jobOrContractTitle?: string;
  unreadCount?: number;
  lastMessageTimestamp?: string;
  accountState?: RecipientAccountState;
}

export interface JobPostedTemplateData {
  clientName: string;
  jobTitle: string;
  jobId: string;
  category?: string;
  projectType: string;
  budget?: string;
  skills?: string[];
  postedDate?: string;
  accountState?: RecipientAccountState;
}

export interface ProposalSubmittedTemplateData {
  freelancerName: string;
  jobTitle: string;
  jobId: string;
  proposalId: string;
  bidAmount: string | number;
  rateType: string;
  deliveryDays?: number | null;
  clientName?: string;
  submittedDate?: string;
  accountState?: RecipientAccountState;
}

export interface ProposalUnderReviewTemplateData {
  freelancerName: string;
  clientName: string;
  jobTitle: string;
  jobId: string;
  proposalId: string;
  reviewedDate?: string;
  accountState?: RecipientAccountState;
}

export interface MeetingScheduledTemplateData {
  recipientName: string;
  organizerName: string;
  jobTitle: string;
  meetingTopic: string;
  meetingDate: string;
  meetingTime: string;
  meetingTimezone?: string;
  durationMinutes?: number | string;
  platform: string;
  meetingLink?: string;
  notes?: string;
  conversationId?: string;
  role?: 'client' | 'freelancer';
  accountState?: RecipientAccountState;
}

export interface ContractOfferTemplateData {
  freelancerName: string;
  clientName: string;
  jobTitle: string;
  contractId: string;
  contractType: string;
  rateOrAmount: string;
  offerMessage?: string;
  expiresAt?: string;
  accountState?: RecipientAccountState;
}

export interface ContractStartedTemplateData {
  recipientName: string;
  counterpartName: string;
  jobTitle: string;
  contractId: string;
  contractType: string;
  rateOrAmount: string;
  role: 'client' | 'freelancer';
  establishedDate?: string;
  accountState?: RecipientAccountState;
}

export interface PasswordResetTemplateData {
  recipientName: string;
  email: string;
  actionUrl: string;
  expiresInMinutes?: number;
  requestedIp?: string;
  requestedDevice?: string;
  accountState?: RecipientAccountState;
}

export interface PasswordChangedAlertTemplateData {
  recipientName: string;
  email: string;
  changedAt?: string;
  changedIp?: string;
  changedDevice?: string;
  accountState?: RecipientAccountState;
}

export type TemplateDataMap = {
  proposal_received_v1: ProposalReceivedTemplateData;
  proposal_accepted_v1: ProposalAcceptedTemplateData;
  milestone_funded_v1: MilestoneFundedTemplateData;
  milestone_released_v1: MilestoneReleasedTemplateData;
  unread_message_v1: UnreadMessageTemplateData;
  job_posted_v1: JobPostedTemplateData;
  proposal_submitted_v1: ProposalSubmittedTemplateData;
  proposal_under_review_v1: ProposalUnderReviewTemplateData;
  meeting_scheduled_v1: MeetingScheduledTemplateData;
  contract_offer_v1: ContractOfferTemplateData;
  contract_started_v1: ContractStartedTemplateData;
  password_reset_v1: PasswordResetTemplateData;
  password_changed_alert_v1: PasswordChangedAlertTemplateData;
};
