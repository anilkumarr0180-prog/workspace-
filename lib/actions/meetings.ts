'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { queueAndDispatchEmail } from '@/lib/email/queue';
import { updateProposalStatus } from '@/lib/actions/proposals';
import { createNotification } from '@/lib/actions/notifications';

export interface ScheduleMeetingInput {
  proposalId: string;
  topic: string;
  date: string;
  time: string;
  timezone?: string;
  durationMinutes?: number | string;
  platform: string;
  meetingLink?: string;
  notes?: string;
  conversationId?: string;
}

export interface ScheduleMeetingResult {
  success: boolean;
  error?: string;
}

/**
 * Schedules a consultation meeting for a job proposal and immediately dispatches
 * professional calendar invitation emails to both the freelancer and the client.
 */
export async function scheduleMeetingAndSendEmail(
  input: ScheduleMeetingInput
): Promise<ScheduleMeetingResult> {
  if (!input.proposalId || !input.proposalId.trim()) {
    return { success: false, error: 'Proposal ID is required.' };
  }
  if (!input.date || !input.date.trim()) {
    return { success: false, error: 'Meeting date is required.' };
  }
  if (!input.time || !input.time.trim()) {
    return { success: false, error: 'Meeting time is required.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required to schedule a meeting.' };
  }

  try {
    const admin = getAdminSupabaseClient();

    // 1. Fetch proposal and parent job details
    const { data: proposal, error: propErr } = await admin
      .from('proposals')
      .select('id, job_id, freelancer_id, status')
      .eq('id', input.proposalId.trim())
      .single();

    if (propErr || !proposal) {
      return { success: false, error: 'Target proposal not found.' };
    }

    const { data: job, error: jobErr } = await admin
      .from('jobs')
      .select('id, client_id, company_id, title')
      .eq('id', proposal.job_id)
      .single();

    if (jobErr || !job) {
      return { success: false, error: 'Parent job not found.' };
    }

    // 2. Authorization check
    let isAuthorized = job.client_id === user.id;
    if (!isAuthorized && job.company_id) {
      const { data: member } = await admin
        .from('company_members')
        .select('id, role')
        .eq('company_id', job.company_id)
        .eq('user_id', user.id)
        .single();
      if (member && ['owner', 'admin', 'hiring_manager'].includes(member.role)) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return { success: false, error: 'Only the job client or hiring manager can schedule a meeting.' };
    }

    // 3. Resolve participant profiles & email addresses
    const { data: freelancerUser } = await admin.auth.admin.getUserById(proposal.freelancer_id);
    const { data: freelancerProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', proposal.freelancer_id)
      .maybeSingle();

    const { data: clientProfile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    const freelancerEmail = freelancerUser?.user?.email;
    const freelancerName =
      freelancerProfile?.full_name ||
      freelancerUser?.user?.user_metadata?.full_name ||
      'Candidate';

    const clientName =
      clientProfile?.full_name ||
      user.user_metadata?.full_name ||
      'Client';

    const clientEmail = user.email;

    // 4. Advance proposal status to 'interviewing' if it is 'submitted' or 'under_review'
    if (proposal.status === 'submitted' || proposal.status === 'under_review') {
      await updateProposalStatus(proposal.id, 'interviewing').catch((err) => {
        console.warn('[MEETING SCHEDULE] updateProposalStatus notice:', err);
      });
    }

    const topic = input.topic?.trim() || 'Project Consultation & Scope Discussion';

    // Format human-readable date & time strings
    let formattedDate = input.date;
    let formattedTime = input.time;
    try {
      const dt = new Date(`${input.date}T${input.time}:00`);
      formattedDate = dt.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      formattedTime = dt.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      // Keep input values as fallback
    }

    // 5. Send meeting invitation email to Freelancer
    if (freelancerEmail) {
      await queueAndDispatchEmail({
        eventType: 'meeting_scheduled',
        templateKey: 'meeting_scheduled_v1',
        recipientEmail: freelancerEmail,
        recipientUserId: proposal.freelancer_id,
        subject: `Meeting Scheduled: Consultation for "${job.title}"`,
        payload: {
          recipientName: freelancerName,
          organizerName: clientName,
          jobTitle: job.title,
          meetingTopic: topic,
          meetingDate: formattedDate,
          meetingTime: formattedTime,
          meetingTimezone: input.timezone || undefined,
          durationMinutes: input.durationMinutes || 30,
          platform: input.platform || 'Google Meet',
          meetingLink: input.meetingLink || undefined,
          notes: input.notes || undefined,
          conversationId: input.conversationId || undefined,
          role: 'freelancer',
          accountState: 'existing_account',
        },
        relatedEntityId: input.conversationId || proposal.id,
        idempotencyKey: `email:meeting:${proposal.id}:${Date.now()}:freelancer`,
        immediate: true,
      });
    }

    // 6. Send meeting confirmation email to Client
    if (clientEmail) {
      await queueAndDispatchEmail({
        eventType: 'meeting_scheduled',
        templateKey: 'meeting_scheduled_v1',
        recipientEmail: clientEmail,
        recipientUserId: user.id,
        subject: `Meeting Confirmed: Consultation with ${freelancerName} for "${job.title}"`,
        payload: {
          recipientName: clientName,
          organizerName: clientName,
          jobTitle: job.title,
          meetingTopic: topic,
          meetingDate: formattedDate,
          meetingTime: formattedTime,
          meetingTimezone: input.timezone || undefined,
          durationMinutes: input.durationMinutes || 30,
          platform: input.platform || 'Google Meet',
          meetingLink: input.meetingLink || undefined,
          notes: input.notes || undefined,
          conversationId: input.conversationId || undefined,
          role: 'client',
          accountState: 'existing_account',
        },
        relatedEntityId: input.conversationId || proposal.id,
        idempotencyKey: `email:meeting:${proposal.id}:${Date.now()}:client`,
        immediate: true,
      });
    }

    // 7. Record In-app Notification for freelancer
    await createNotification({
      userId: proposal.freelancer_id,
      type: 'proposal_status_updated',
      title: 'Consultation Meeting Scheduled',
      message: `${clientName} scheduled a consultation meeting with you for "${job.title}".`,
      link: input.conversationId ? `/messages/${input.conversationId}` : `/freelancer`,
      metadata: {
        proposalId: proposal.id,
        meetingDate: formattedDate,
        meetingTime: formattedTime,
        meetingLink: input.meetingLink,
      },
    }).catch(() => {});

    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to schedule meeting and dispatch emails.';
    console.error('[MEETING SCHEDULE ERROR]:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

