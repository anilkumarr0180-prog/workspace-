'use server';

import { createClient } from '@/lib/supabase/server';
import { MilestoneStatus, LedgerEventType, LedgerStatus } from '@/lib/types';

export interface ClientBillingStats {
  totalEscrowFunded: number;
  totalReleased: number;
  totalPendingFunding: number;
  totalSpent: number;
  totalContractsCount: number;
  unfundedMilestonesCount: number;
  activeEscrowMilestonesCount: number;
  awaitingReviewCount: number;
  ledgerDepositedTotal: number;
  ledgerReleasedTotal: number;
}

export interface ClientPendingMilestoneItem {
  id: string;
  contractId: string;
  contractTitle: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  sequenceOrder: number;
  dueDate?: string | null;
  freelancerId: string;
  freelancerName: string;
  freelancerAvatar?: string | null;
  createdAt: string;
}

export interface ClientActiveMilestoneItem {
  id: string;
  contractId: string;
  contractTitle: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  sequenceOrder: number;
  status: MilestoneStatus;
  dueDate?: string | null;
  freelancerId: string;
  freelancerName: string;
  freelancerAvatar?: string | null;
  updatedAt: string;
  hasActiveDelivery: boolean;
  deliverySubmittedAt?: string | null;
}

export interface ClientBillingTransactionItem {
  id: string;
  contractId: string;
  contractTitle: string;
  milestoneId?: string | null;
  milestoneTitle?: string | null;
  amount: number;
  currency: string;
  eventType: LedgerEventType;
  status: LedgerStatus;
  description: string;
  createdAt: string;
  toUserName?: string | null;
  fromUserName?: string | null;
  metadata?: Record<string, unknown>;
  paymentMethod: 'razorpay' | 'simulated' | 'escrow';
}

export interface ClientPaymentAttemptItem {
  id: string;
  contractId: string;
  contractTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  provider: string;
  environment: string;
  razorpayOrderId: string;
  razorpayPaymentId?: string | null;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
}

export interface ClientBillingDataResult {
  success: boolean;
  client?: {
    id: string;
    fullName: string;
    email?: string;
  };
  stats?: ClientBillingStats;
  pendingMilestones?: ClientPendingMilestoneItem[];
  activeMilestones?: ClientActiveMilestoneItem[];
  transactions?: ClientBillingTransactionItem[];
  paymentAttempts?: ClientPaymentAttemptItem[];
  error?: string;
  code?: string;
}

interface RawProfileJoin {
  id?: string;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
}

interface RawContractJoin {
  id: string;
  title: string;
  status?: string;
  contract_type?: string;
}

interface RawDeliveryJoin {
  id: string;
  submitted_at: string;
  review_status: string;
  version: number;
}

interface RawMilestoneRow {
  id: string;
  contract_id: string;
  client_id: string;
  freelancer_id: string;
  title: string;
  description: string;
  amount: number | string;
  currency: string;
  sequence_order: number;
  due_date?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  contracts?: RawContractJoin | RawContractJoin[] | null;
  profiles?: RawProfileJoin | RawProfileJoin[] | null;
  milestone_deliveries?: RawDeliveryJoin[] | null;
}

interface RawLedgerRow {
  id: string;
  contract_id: string;
  milestone_id?: string | null;
  from_user_id?: string | null;
  to_user_id?: string | null;
  amount: number | string;
  currency: string;
  event_type: string;
  status: string;
  description: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  from_profile?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  to_profile?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  milestones?: { title?: string | null } | Array<{ title?: string | null }> | null;
  contracts?: { id: string; title: string } | Array<{ id: string; title: string }> | null;
}

interface RawPaymentAttemptRow {
  id: string;
  contract_id: string;
  milestone_id: string;
  client_id: string;
  provider: string;
  environment: string;
  razorpay_order_id: string;
  razorpay_payment_id?: string | null;
  amount: number | string;
  currency: string;
  status: string;
  created_at: string;
  contracts?: { id: string; title: string } | Array<{ id: string; title: string }> | null;
  contract_milestones?: { id: string; title: string } | Array<{ id: string; title: string }> | null;
}

export async function getClientBillingData(): Promise<ClientBillingDataResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: 'Authentication required to access client billing.',
      code: 'UNAUTHENTICATED',
    };
  }

  try {
    // 1. Fetch Client Profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', user.id)
      .maybeSingle();

    // 2. Fetch all Contracts owned by this Client
    const { data: contractsData, error: contractsError } = await supabase
      .from('contracts')
      .select('id, title, contract_type, status, fixed_price, freelancer_id, created_at')
      .eq('client_id', user.id);

    if (contractsError) {
      return { success: false, error: contractsError.message, code: contractsError.code };
    }

    const contracts = contractsData || [];
    const contractMap = new Map<string, string>();
    for (const c of contracts) {
      contractMap.set(c.id, c.title);
    }

    // 3. Fetch Milestones belonging to Client
    const { data: milestonesData, error: milestonesError } = await supabase
      .from('contract_milestones')
      .select(`
        id,
        contract_id,
        client_id,
        freelancer_id,
        title,
        description,
        amount,
        currency,
        sequence_order,
        due_date,
        status,
        created_at,
        updated_at,
        contracts:contract_id (id, title, status, contract_type),
        profiles:freelancer_id (id, full_name, username, avatar_url),
        milestone_deliveries (id, submitted_at, review_status, version)
      `)
      .eq('client_id', user.id)
      .order('sequence_order', { ascending: true });

    if (milestonesError) {
      return { success: false, error: milestonesError.message, code: milestonesError.code };
    }

    const rawMilestones = (milestonesData as unknown as RawMilestoneRow[]) || [];

    const pendingMilestones: ClientPendingMilestoneItem[] = [];
    const activeMilestones: ClientActiveMilestoneItem[] = [];

    let totalEscrowFunded = 0;
    let totalReleased = 0;
    let totalPendingFunding = 0;
    let awaitingReviewCount = 0;

    for (const m of rawMilestones) {
      const contractObj = Array.isArray(m.contracts) ? m.contracts[0] : m.contracts;
      const freelancerObj = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      const contractTitle = contractObj?.title || contractMap.get(m.contract_id) || 'Contract Project';
      const freelancerName = freelancerObj?.full_name || freelancerObj?.username || 'Freelancer';
      const freelancerAvatar = freelancerObj?.avatar_url || null;
      const numAmount = Number(m.amount) || 0;
      const deliveries = m.milestone_deliveries || [];
      const hasActiveDelivery = deliveries.some((d) => d.review_status === 'pending');
      const latestDelivery = deliveries[0];

      if (m.status === 'planned') {
        totalPendingFunding += numAmount;
        pendingMilestones.push({
          id: m.id,
          contractId: m.contract_id,
          contractTitle,
          title: m.title,
          description: m.description,
          amount: numAmount,
          currency: m.currency,
          sequenceOrder: m.sequence_order,
          dueDate: m.due_date || null,
          freelancerId: m.freelancer_id,
          freelancerName,
          freelancerAvatar,
          createdAt: m.created_at,
        });
      } else {
        if (
          m.status === 'funded' ||
          m.status === 'in_progress' ||
          m.status === 'submitted' ||
          m.status === 'revision_requested' ||
          m.status === 'approved'
        ) {
          totalEscrowFunded += numAmount;
          if (m.status === 'submitted') {
            awaitingReviewCount += 1;
          }
        } else if (m.status === 'released') {
          totalReleased += numAmount;
        }

        activeMilestones.push({
          id: m.id,
          contractId: m.contract_id,
          contractTitle,
          title: m.title,
          description: m.description,
          amount: numAmount,
          currency: m.currency,
          sequenceOrder: m.sequence_order,
          status: m.status as MilestoneStatus,
          dueDate: m.due_date || null,
          freelancerId: m.freelancer_id,
          freelancerName,
          freelancerAvatar,
          updatedAt: m.updated_at,
          hasActiveDelivery,
          deliverySubmittedAt: latestDelivery?.submitted_at || null,
        });
      }
    }

    // Sort pending milestones by sequence order, then creation date
    pendingMilestones.sort((a, b) => a.sequenceOrder - b.sequenceOrder);

    // 4. Fetch Payment Ledger Records for client's contracts
    const contractIds = contracts.map((c) => c.id);
    const transactions: ClientBillingTransactionItem[] = [];
    let ledgerDepositedTotal = 0;
    let ledgerReleasedTotal = 0;

    if (contractIds.length > 0) {
      const { data: ledgerData } = await supabase
        .from('payment_ledger')
        .select(`
          id,
          contract_id,
          milestone_id,
          from_user_id,
          to_user_id,
          amount,
          currency,
          event_type,
          status,
          description,
          metadata,
          created_at,
          from_profile:profiles!from_user_id (full_name),
          to_profile:profiles!to_user_id (full_name),
          milestones:contract_milestones!milestone_id (title),
          contracts:contract_id (id, title)
        `)
        .in('contract_id', contractIds)
        .order('created_at', { ascending: false });

      const rawLedger = (ledgerData as unknown as RawLedgerRow[]) || [];

      for (const row of rawLedger) {
        const fromObj = Array.isArray(row.from_profile) ? row.from_profile[0] : row.from_profile;
        const toObj = Array.isArray(row.to_profile) ? row.to_profile[0] : row.to_profile;
        const milestoneObj = Array.isArray(row.milestones) ? row.milestones[0] : row.milestones;
        const contractObj = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;

        const contractTitle = contractObj?.title || contractMap.get(row.contract_id) || 'Contract';
        const numAmount = Number(row.amount) || 0;

        if (row.event_type === 'escrow_funded' && row.status === 'succeeded') {
          ledgerDepositedTotal += numAmount;
        } else if (row.event_type === 'escrow_released' && row.status === 'succeeded') {
          ledgerReleasedTotal += numAmount;
        }

        const meta = (row.metadata || {}) as Record<string, unknown>;
        const provider = meta?.provider === 'razorpay' ? 'razorpay' : meta?.provider === 'simulated' ? 'simulated' : 'escrow';

        transactions.push({
          id: row.id,
          contractId: row.contract_id,
          contractTitle,
          milestoneId: row.milestone_id || null,
          milestoneTitle: milestoneObj?.title || null,
          amount: numAmount,
          currency: row.currency,
          eventType: row.event_type as LedgerEventType,
          status: row.status as LedgerStatus,
          description: row.description,
          createdAt: row.created_at,
          fromUserName: fromObj?.full_name || (row.from_user_id === user.id ? 'You (Client)' : 'Escrow Pool'),
          toUserName: toObj?.full_name || (row.to_user_id ? 'Freelancer' : 'Workspace Escrow Hold'),
          metadata: meta,
          paymentMethod: provider,
        });
      }
    }

    // 5. Fetch Payment Attempts (Razorpay Checkouts)
    let paymentAttempts: ClientPaymentAttemptItem[] = [];
    const { data: attemptsData } = await supabase
      .from('payment_attempts')
      .select(`
        id,
        contract_id,
        milestone_id,
        client_id,
        provider,
        environment,
        razorpay_order_id,
        razorpay_payment_id,
        amount,
        currency,
        status,
        created_at,
        contracts:contract_id (id, title),
        contract_milestones:milestone_id (id, title)
      `)
      .eq('client_id', user.id)
      .order('created_at', { ascending: false });

    if (attemptsData) {
      const rawAttempts = attemptsData as unknown as RawPaymentAttemptRow[];
      paymentAttempts = rawAttempts.map((att) => {
        const cObj = Array.isArray(att.contracts) ? att.contracts[0] : att.contracts;
        const mObj = Array.isArray(att.contract_milestones) ? att.contract_milestones[0] : att.contract_milestones;
        return {
          id: att.id,
          contractId: att.contract_id,
          contractTitle: cObj?.title || contractMap.get(att.contract_id) || 'Contract',
          milestoneId: att.milestone_id,
          milestoneTitle: mObj?.title || 'Milestone',
          provider: att.provider,
          environment: att.environment,
          razorpayOrderId: att.razorpay_order_id,
          razorpayPaymentId: att.razorpay_payment_id || null,
          amount: Number(att.amount) || 0,
          currency: att.currency,
          status: att.status,
          createdAt: att.created_at,
        };
      });
    }

    const stats: ClientBillingStats = {
      totalEscrowFunded,
      totalReleased,
      totalPendingFunding,
      totalSpent: totalEscrowFunded + totalReleased,
      totalContractsCount: contracts.length,
      unfundedMilestonesCount: pendingMilestones.length,
      activeEscrowMilestonesCount: activeMilestones.length,
      awaitingReviewCount,
      ledgerDepositedTotal,
      ledgerReleasedTotal,
    };

    return {
      success: true,
      client: {
        id: user.id,
        fullName: profile?.full_name || 'Client',
        email: user.email || '',
      },
      stats,
      pendingMilestones,
      activeMilestones,
      transactions,
      paymentAttempts,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve client billing records.';
    return {
      success: false,
      error: message,
    };
  }
}
