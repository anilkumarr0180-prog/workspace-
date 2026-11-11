'use server';

import { createClient } from '@/lib/supabase/server';
import {
  EndContractInput,
  ContractReviewsStatusResult,
  ContractReviewDisplay,
} from '@/lib/types';
import { revalidatePath } from 'next/cache';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EndContractResult {
  success: boolean;
  reviewId?: string;
  bothSubmitted?: boolean;
  contractStatus?: string;
  error?: string;
}

export interface PublicFreelancerReviewItem {
  id: string;
  rating: number;
  feedbackText: string;
  scores: Record<string, number>;
  createdAt: string;
  contractTitle: string;
  contractType: string;
  clientName: string;
  clientAvatar?: string | null;
  earningsText?: string;
}

/**
 * End an active contract and submit double-blind review.
 */
export async function endContractAndSubmitReview(
  input: EndContractInput
): Promise<EndContractResult> {
  if (!input.contractId || !UUID_REGEX.test(input.contractId.trim())) {
    return { success: false, error: 'Invalid contract ID.' };
  }

  if (!input.endReason || !input.endReason.trim()) {
    return { success: false, error: 'Reason for ending contract is required.' };
  }

  if (typeof input.rating !== 'number' || input.rating < 1 || input.rating > 5) {
    return { success: false, error: 'Overall star rating must be between 1.0 and 5.0.' };
  }

  if (!input.feedbackText || input.feedbackText.trim().length < 5) {
    return { success: false, error: 'Review text must be at least 5 characters long.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required.' };
  }

  try {
    const { data, error: rpcError } = await supabase.rpc('end_contract_and_submit_review', {
      p_contract_id: input.contractId.trim(),
      p_end_reason: input.endReason.trim(),
      p_rating: input.rating,
      p_feedback_text: input.feedbackText.trim(),
      p_scores: input.scores || {},
      p_private_nps: input.privateNps ?? null,
      p_private_feedback: input.privateFeedback?.trim() || null,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    const payload = data as {
      success?: boolean;
      review_id?: string;
      both_submitted?: boolean;
      contract_status?: string;
      error?: string;
    };

    revalidatePath(`/contracts/${input.contractId.trim()}`);
    revalidatePath('/contracts');
    revalidatePath('/client');
    revalidatePath('/freelancer');

    return {
      success: true,
      reviewId: payload?.review_id,
      bothSubmitted: payload?.both_submitted,
      contractStatus: payload?.contract_status,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error ending contract and submitting review.';
    return { success: false, error: message };
  }
}

/**
 * Fetch reviews and double-blind state for a specific contract.
 */
export async function getContractReviewsStatus(
  contractId: string
): Promise<ContractReviewsStatusResult> {
  if (!contractId || !UUID_REGEX.test(contractId.trim())) {
    return { success: false, error: 'Invalid contract ID.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Authentication required.' };
  }

  try {
    const { data, error: rpcError } = await supabase.rpc('get_contract_reviews_status', {
      p_contract_id: contractId.trim(),
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    interface RpcReviewItem {
      id?: string;
      rating?: number;
      scores?: Record<string, number>;
      feedback_text?: string;
      end_reason?: string;
      is_public?: boolean;
      is_submitted?: boolean;
      created_at?: string;
    }

    const payload = data as {
      success?: boolean;
      error?: string;
      contract_status?: string;
      both_submitted?: boolean;
      my_review?: RpcReviewItem | null;
      other_review?: RpcReviewItem | null;
    };

    if (!payload?.success) {
      return { success: false, error: payload?.error || 'Failed to retrieve feedback status.' };
    }

    // Map my_review to camelCase ContractReviewDisplay
    const myReview: ContractReviewDisplay | null = payload.my_review
      ? {
          id: payload.my_review.id,
          rating: payload.my_review.rating ? Number(payload.my_review.rating) : undefined,
          scores: payload.my_review.scores,
          feedbackText: payload.my_review.feedback_text,
          endReason: payload.my_review.end_reason,
          isPublic: Boolean(payload.my_review.is_public),
          createdAt: payload.my_review.created_at,
        }
      : null;

    // If other review is public, fetch reviewer profile info
    let enhancedOtherReview: ContractReviewDisplay | null = null;
    if (payload.other_review) {
      if (payload.other_review.is_public && payload.other_review.id) {
        // Query author of this review
        const { data: revRow } = await supabase
          .from('contract_reviews')
          .select('reviewer:profiles!reviewer_id(full_name, avatar_url)')
          .eq('id', payload.other_review.id)
          .maybeSingle();

        const reviewerProfile = revRow?.reviewer as { full_name?: string; avatar_url?: string } | null;

        enhancedOtherReview = {
          id: payload.other_review.id,
          rating: payload.other_review.rating ? Number(payload.other_review.rating) : undefined,
          scores: payload.other_review.scores,
          feedbackText: payload.other_review.feedback_text,
          endReason: payload.other_review.end_reason,
          isPublic: true,
          createdAt: payload.other_review.created_at,
          reviewerName: reviewerProfile?.full_name || 'Client',
          reviewerAvatar: reviewerProfile?.avatar_url,
        };
      } else {
        enhancedOtherReview = {
          isPublic: false,
          isSubmitted: Boolean(payload.other_review.is_submitted),
        };
      }
    }

    return {
      success: true,
      contractStatus: payload.contract_status,
      bothSubmitted: payload.both_submitted,
      myReview,
      otherReview: enhancedOtherReview,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error fetching contract reviews.';
    return { success: false, error: message };
  }
}

/**
 * Fetch verified public reviews for a freelancer's public profile.
 */
export async function getFreelancerPublicReviews(
  freelancerId: string
): Promise<{ success: boolean; reviews: PublicFreelancerReviewItem[]; error?: string }> {
  if (!freelancerId || !UUID_REGEX.test(freelancerId.trim())) {
    return { success: false, reviews: [], error: 'Invalid freelancer ID.' };
  }

  const supabase = await createClient();

  try {
    const { data, error } = await supabase
      .from('contract_reviews')
      .select(`
        id,
        rating,
        feedback_text,
        scores,
        created_at,
        contracts (
          title,
          contract_type,
          fixed_price,
          hourly_rate
        ),
        reviewer:profiles!reviewer_id (
          full_name,
          avatar_url
        )
      `)
      .eq('reviewee_id', freelancerId.trim())
      .eq('is_public', true)
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, reviews: [], error: error.message };
    }

    interface SupabaseReviewJoinRow {
      id: string;
      rating: number;
      feedback_text: string;
      scores: Record<string, number>;
      created_at: string;
      contracts?: {
        title?: string;
        contract_type?: string;
        fixed_price?: number | null;
        hourly_rate?: number | null;
      } | Array<{
        title?: string;
        contract_type?: string;
        fixed_price?: number | null;
        hourly_rate?: number | null;
      }> | null;
      reviewer?: {
        full_name?: string | null;
        avatar_url?: string | null;
      } | Array<{
        full_name?: string | null;
        avatar_url?: string | null;
      }> | null;
    }

    const items: PublicFreelancerReviewItem[] = (data || []).map((row: SupabaseReviewJoinRow) => {
      const cObj = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;
      const rObj = Array.isArray(row.reviewer) ? row.reviewer[0] : row.reviewer;

      let earningsText = '';
      if (cObj?.contract_type === 'fixed' && cObj?.fixed_price) {
        earningsText = `$${Number(cObj.fixed_price).toLocaleString()} Fixed`;
      } else if (cObj?.contract_type === 'hourly' && cObj?.hourly_rate) {
        earningsText = `$${Number(cObj.hourly_rate)}/hr`;
      }

      return {
        id: row.id,
        rating: Number(row.rating),
        feedbackText: row.feedback_text,
        scores: row.scores || {},
        createdAt: row.created_at,
        contractTitle: cObj?.title || 'Contract',
        contractType: cObj?.contract_type || 'fixed',
        clientName: rObj?.full_name || 'Client',
        clientAvatar: rObj?.avatar_url,
        earningsText,
      };
    });

    return { success: true, reviews: items };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error fetching public reviews.';
    return { success: false, reviews: [], error: message };
  }
}
