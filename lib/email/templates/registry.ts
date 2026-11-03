import { renderMilestoneFundedTemplate } from './milestone-funded';
import { renderMilestoneReleasedTemplate } from './milestone-released';
import { renderProposalAcceptedTemplate } from './proposal-accepted';
import { renderProposalReceivedTemplate } from './proposal-received';
import type {
  MilestoneFundedTemplateData,
  MilestoneReleasedTemplateData,
  ProposalAcceptedTemplateData,
  ProposalReceivedTemplateData,
  RenderedEmail,
  TemplateKey,
  UnreadMessageTemplateData,
} from './types';
import { renderUnreadMessageTemplate } from './unread-message';

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

    default:
      throw new Error(`Template Error: Unhandled template_key="${templateKey}".`);
  }
}
