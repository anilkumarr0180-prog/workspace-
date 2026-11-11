import { NextRequest, NextResponse } from 'next/server';
import {
  updateProposalStatus,
  toggleProposalShortlist,
  declineProposal,
  saveProposalNotes,
} from '@/lib/actions/proposals';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!id || !id.trim()) {
      return NextResponse.json({ error: 'Proposal ID is required' }, { status: 400 });
    }

    // 1. Shortlist toggle
    if (body.action === 'toggle_shortlist' || typeof body.isShortlisted === 'boolean') {
      const isShortlisted = typeof body.isShortlisted === 'boolean' ? body.isShortlisted : true;
      const res = await toggleProposalShortlist(id, isShortlisted);
      if (!res.success) {
        return NextResponse.json({ error: res.error || 'Failed to update shortlist' }, { status: 400 });
      }
      return NextResponse.json({ success: true, isShortlisted: res.isShortlisted });
    }

    // 2. Decline with reason
    if (body.action === 'decline') {
      const res = await declineProposal(id, body.reason);
      if (!res.success) {
        return NextResponse.json({ error: res.error || 'Failed to decline proposal' }, { status: 400 });
      }
      return NextResponse.json({ success: true, status: 'rejected' });
    }

    // 3. Save internal notes
    if (body.action === 'set_notes' && typeof body.notes === 'string') {
      const res = await saveProposalNotes(id, body.notes);
      if (!res.success) {
        return NextResponse.json({ error: res.error || 'Failed to save notes' }, { status: 400 });
      }
      return NextResponse.json({ success: true, notes: res.notes });
    }

    // 4. Default: Proposal status update
    if (!body.status || typeof body.status !== 'string') {
      return NextResponse.json({ error: 'Target status string or valid action is required' }, { status: 400 });
    }

    const result = await updateProposalStatus(id, body.status.trim());

    if (!result.success) {
      let status = 400;
      if (result.code === 'UNAUTHENTICATED') status = 401;
      else if (result.code === 'FORBIDDEN') status = 403;
      else if (result.code === 'NOT_FOUND') status = 404;
      else if (result.code === 'TERMINAL_STATE_LOCKED' || result.code === 'INVALID_TRANSITION' || result.code === 'JOB_NOT_PUBLISHED') status = 422;

      return NextResponse.json(
        {
          error: result.error || 'Failed to update proposal status',
          code: result.code,
        },
        { status }
      );
    }

    return NextResponse.json({ success: true, proposal: result.proposal });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
