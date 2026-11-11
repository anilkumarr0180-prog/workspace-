if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email template types cannot be loaded in the browser.');
}

export type TemplateKey =
  | 'proposal_received_v1'
  | 'proposal_accepted_v1'
  | 'milestone_funded_v1'
  | 'milestone_released_v1'
  | 'unread_message_v1';

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

export type TemplateDataMap = {
  proposal_received_v1: ProposalReceivedTemplateData;
  proposal_accepted_v1: ProposalAcceptedTemplateData;
  milestone_funded_v1: MilestoneFundedTemplateData;
  milestone_released_v1: MilestoneReleasedTemplateData;
  unread_message_v1: UnreadMessageTemplateData;
};
