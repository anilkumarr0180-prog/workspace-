import { renderMilestoneFundedTemplate } from './milestone-funded';
import { renderMilestoneReleasedTemplate } from './milestone-released';
import { renderProposalAcceptedTemplate } from './proposal-accepted';
import { renderProposalReceivedTemplate } from './proposal-received';
import { renderUnreadMessageTemplate } from './unread-message';
import { renderJobPostedTemplate } from './job-posted';
import { renderProposalSubmittedTemplate } from './proposal-submitted';
import { renderProposalUnderReviewTemplate } from './proposal-under-review';
import { renderMeetingScheduledTemplate } from './meeting-scheduled';
import { renderContractOfferTemplate } from './contract-offer';
import { renderContractStartedTemplate } from './contract-started';
import { renderPasswordResetTemplate } from './password-reset';
import { renderPasswordChangedAlertTemplate } from './password-changed-alert';
import type {
  ContractOfferTemplateData,
  ContractStartedTemplateData,
  JobPostedTemplateData,
  MeetingScheduledTemplateData,
  MilestoneFundedTemplateData,
  MilestoneReleasedTemplateData,
  PasswordChangedAlertTemplateData,
  PasswordResetTemplateData,
  ProposalAcceptedTemplateData,
  ProposalReceivedTemplateData,
  ProposalSubmittedTemplateData,
  ProposalUnderReviewTemplateData,
  RenderedEmail,
  TemplateKey,
  UnreadMessageTemplateData,
} from './types';

if (typeof window !== 'undefined') {
  throw new Error('Security Violation: Email template registry cannot be loaded in the browser.');
}

type TemplateRenderer<T> = (data: T) => RenderedEmail;

interface TemplateRegistryEntry<T> {
  key: TemplateKey;
  description: string;
  render: TemplateRenderer<T>;
}

// Internal registry mapping
const REGISTRY: {
  proposal_received_v1: TemplateRegistryEntry<ProposalReceivedTemplateData>;
  proposal_accepted_v1: TemplateRegistryEntry<ProposalAcceptedTemplateData>;
  milestone_funded_v1: TemplateRegistryEntry<MilestoneFundedTemplateData>;
  milestone_released_v1: TemplateRegistryEntry<MilestoneReleasedTemplateData>;
  unread_message_v1: TemplateRegistryEntry<UnreadMessageTemplateData>;
  job_posted_v1: TemplateRegistryEntry<JobPostedTemplateData>;
  proposal_submitted_v1: TemplateRegistryEntry<ProposalSubmittedTemplateData>;
  proposal_under_review_v1: TemplateRegistryEntry<ProposalUnderReviewTemplateData>;
  meeting_scheduled_v1: TemplateRegistryEntry<MeetingScheduledTemplateData>;
  contract_offer_v1: TemplateRegistryEntry<ContractOfferTemplateData>;
  contract_started_v1: TemplateRegistryEntry<ContractStartedTemplateData>;
  password_reset_v1: TemplateRegistryEntry<PasswordResetTemplateData>;
  password_changed_alert_v1: TemplateRegistryEntry<PasswordChangedAlertTemplateData>;
} = {
  proposal_received_v1: {
    key: 'proposal_received_v1',
    description: 'Notification sent to clients when a new proposal is submitted.',
    render: renderProposalReceivedTemplate,
  },
  proposal_accepted_v1: {
    key: 'proposal_accepted_v1',
    description: 'Notification sent to freelancers when their proposal is accepted and contract established.',
    render: renderProposalAcceptedTemplate,
  },
  milestone_funded_v1: {
    key: 'milestone_funded_v1',
    description: 'Notification sent to freelancers/clients when a milestone is funded into escrow.',
    render: renderMilestoneFundedTemplate,
  },
  milestone_released_v1: {
    key: 'milestone_released_v1',
    description: 'Notification sent to freelancers/clients when a milestone is approved and escrow released.',
    render: renderMilestoneReleasedTemplate,
  },
  unread_message_v1: {
    key: 'unread_message_v1',
    description: 'Privacy-first notification sent when an offline user receives direct messages.',
    render: renderUnreadMessageTemplate,
  },
  job_posted_v1: {
    key: 'job_posted_v1',
    description: 'Confirmation email sent to clients when their job posting is published and live.',
    render: renderJobPostedTemplate,
  },
  proposal_submitted_v1: {
    key: 'proposal_submitted_v1',
    description: 'Confirmation email sent to freelancers when their job proposal is submitted.',
    render: renderProposalSubmittedTemplate,
  },
  proposal_under_review_v1: {
    key: 'proposal_under_review_v1',
    description: 'Notification sent to freelancers when a client moves their proposal to under review.',
    render: renderProposalUnderReviewTemplate,
  },
  meeting_scheduled_v1: {
    key: 'meeting_scheduled_v1',
    description: 'Meeting invitation and details sent when a project consultation is scheduled.',
    render: renderMeetingScheduledTemplate,
  },
  contract_offer_v1: {
    key: 'contract_offer_v1',
    description: 'Notification sent to freelancers when a client extends an official contract offer.',
    render: renderContractOfferTemplate,
  },
  contract_started_v1: {
    key: 'contract_started_v1',
    description: 'Confirmation sent when a contract offer is accepted and contract becomes active.',
    render: renderContractStartedTemplate,
  },
  password_reset_v1: {
    key: 'password_reset_v1',
    description: 'Security email sent to users with a time-limited password recovery link.',
    render: renderPasswordResetTemplate,
  },
  password_changed_alert_v1: {
    key: 'password_changed_alert_v1',
    description: 'Security notification alert sent immediately when an account password is changed.',
    render: renderPasswordChangedAlertTemplate,
  },
};

/**
 * Checks whether a template key is registered in the system.
 */
export function hasTemplate(templateKey: string): templateKey is TemplateKey {
  return Object.prototype.hasOwnProperty.call(REGISTRY, templateKey);
}

/**
 * Returns all registered template keys.
 */
export function getAllTemplateKeys(): TemplateKey[] {
  return Object.keys(REGISTRY) as TemplateKey[];
}

/**
 * Dispatches template rendering for a registered template key.
 * Strictly validates template presence and required fields.
 */
export function renderTemplate(templateKey: string, data: unknown): RenderedEmail {
  if (typeof window !== 'undefined') {
    throw new Error('Security Violation: renderTemplate() cannot be executed in the browser.');
  }

  if (!hasTemplate(templateKey)) {
    throw new Error(
      `Template Error: Unknown or unregistered template_key="${templateKey}". ` +
      `Available templates: ${getAllTemplateKeys().join(', ')}.`
    );
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`Template Error [${templateKey}]: Template data payload must be a non-null object.`);
  }

  switch (templateKey) {
    case 'proposal_received_v1':
      return REGISTRY.proposal_received_v1.render(data as ProposalReceivedTemplateData);

    case 'proposal_accepted_v1':
      return REGISTRY.proposal_accepted_v1.render(data as ProposalAcceptedTemplateData);

    case 'milestone_funded_v1':
      return REGISTRY.milestone_funded_v1.render(data as MilestoneFundedTemplateData);

    case 'milestone_released_v1':
      return REGISTRY.milestone_released_v1.render(data as MilestoneReleasedTemplateData);

    case 'unread_message_v1':
      return REGISTRY.unread_message_v1.render(data as UnreadMessageTemplateData);

    case 'job_posted_v1':
      return REGISTRY.job_posted_v1.render(data as JobPostedTemplateData);

    case 'proposal_submitted_v1':
      return REGISTRY.proposal_submitted_v1.render(data as ProposalSubmittedTemplateData);

    case 'proposal_under_review_v1':
      return REGISTRY.proposal_under_review_v1.render(data as ProposalUnderReviewTemplateData);

    case 'meeting_scheduled_v1':
      return REGISTRY.meeting_scheduled_v1.render(data as MeetingScheduledTemplateData);

    case 'contract_offer_v1':
      return REGISTRY.contract_offer_v1.render(data as ContractOfferTemplateData);

    case 'contract_started_v1':
      return REGISTRY.contract_started_v1.render(data as ContractStartedTemplateData);

    case 'password_reset_v1':
      return REGISTRY.password_reset_v1.render(data as PasswordResetTemplateData);

    case 'password_changed_alert_v1':
      return REGISTRY.password_changed_alert_v1.render(data as PasswordChangedAlertTemplateData);

    default:
      throw new Error(`Template Error: Unhandled template_key="${templateKey}".`);
  }
}
