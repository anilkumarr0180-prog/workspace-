'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getContractById } from '@/lib/actions/contracts';
import {
  getContractMilestones,
  getContractPaymentLedger,
  fundMilestone,
  startMilestoneWork,
  submitMilestoneDelivery,
  requestMilestoneRevision,
  approveAndReleaseMilestone,
  cancelMilestone,
  createMilestone,
} from '@/lib/actions/milestones';
import {
  createMilestoneRazorpayOrder,
  verifyAndFundMilestoneRazorpay,
} from '@/lib/actions/payments';
import {
  Contract,
  ContractMilestone,
  PaymentLedgerEntry,
  DeliveryAttachment,
} from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowLeft,
  DollarSign,
  Send,
  PlusCircle,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Layers,
  History,
  Lock,
  MessageSquare,
  AlertTriangle,
  X,
  Plus,
  Trash2,
  Sparkles,
  CreditCard,
  Zap,
} from 'lucide-react';

const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

function ContractDetailsContent() {
  const params = useParams();
  const contractId = (params?.id as string) || '';

  const [contract, setContract] = useState<Contract | null>(null);
  const [milestones, setMilestones] = useState<ContractMilestone[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<PaymentLedgerEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'milestones' | 'ledger' | 'overview'>('milestones');
  const [expandedMilestoneId, setExpandedMilestoneId] = useState<string | null>(null);

  // Modals state
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [selectedMilestoneForSubmit, setSelectedMilestoneForSubmit] = useState<ContractMilestone | null>(null);
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [deliveryAttachments, setDeliveryAttachments] = useState<DeliveryAttachment[]>([]);
  const [isSubmittingDelivery, setIsSubmittingDelivery] = useState(false);

  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [selectedMilestoneForReview, setSelectedMilestoneForReview] = useState<ContractMilestone | null>(null);
  const [reviewMode, setReviewMode] = useState<'approve' | 'revision'>('approve');
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [isProcessingReview, setIsProcessingReview] = useState(false);

  const [isCreateMilestoneModalOpen, setIsCreateMilestoneModalOpen] = useState(false);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDesc, setNewMilestoneDesc] = useState('');
  const [newMilestoneAmount, setNewMilestoneAmount] = useState('');
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState('');
  const [isCreatingMilestone, setIsCreatingMilestone] = useState(false);

  const [isFundModalOpen, setIsFundModalOpen] = useState(false);
  const [selectedMilestoneForFund, setSelectedMilestoneForFund] = useState<ContractMilestone | null>(null);
  const [isFundingWithRazorpay, setIsFundingWithRazorpay] = useState(false);
  const [isFundingSimulated, setIsFundingSimulated] = useState(false);

  const [busyMilestoneId, setBusyMilestoneId] = useState<string | null>(null);

  // Load contract, milestones, and ledger (for refresh triggers)
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    }
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }

      const [contractRes, milestonesRes, ledgerRes] = await Promise.all([
        getContractById(contractId),
        getContractMilestones(contractId),
        getContractPaymentLedger(contractId),
      ]);

      if (!contractRes.success || !contractRes.contract) {
        throw new Error(contractRes.error || 'Contract not found');
      }

      setContract(contractRes.contract);
      setMilestones(milestonesRes.milestones || []);
      setLedgerEntries(ledgerRes.entries || []);

      // Auto-expand first non-released milestone or first milestone
      if (milestonesRes.milestones && milestonesRes.milestones.length > 0) {
        const activeM = milestonesRes.milestones.find((m) => m.status !== 'released' && m.status !== 'cancelled');
        setExpandedMilestoneId((prev) => prev || activeM?.id || milestonesRes.milestones[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load contract details.';
      setError(msg);
    } finally {
      setRefreshing(false);
    }
  }, [contractId]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user && isMounted) {
          setCurrentUserId(user.id);
        }

        const [contractRes, milestonesRes, ledgerRes] = await Promise.all([
          getContractById(contractId),
          getContractMilestones(contractId),
          getContractPaymentLedger(contractId),
        ]);

        if (!isMounted) return;

        if (!contractRes.success || !contractRes.contract) {
          throw new Error(contractRes.error || 'Contract not found');
        }

        setContract(contractRes.contract);
        setMilestones(milestonesRes.milestones || []);
        setLedgerEntries(ledgerRes.entries || []);

        if (milestonesRes.milestones && milestonesRes.milestones.length > 0) {
          const activeM = milestonesRes.milestones.find((m) => m.status !== 'released' && m.status !== 'cancelled');
          setExpandedMilestoneId((prev) => prev || activeM?.id || milestonesRes.milestones[0].id);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Failed to load contract details.';
        setError(msg);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [contractId]);

  const isClient = useMemo(() => {
    if (!contract || !currentUserId) return false;
    return contract.clientId === currentUserId;
  }, [contract, currentUserId]);

  const isFreelancer = useMemo(() => {
    if (!contract || !currentUserId) return false;
    return contract.freelancerId === currentUserId;
  }, [contract, currentUserId]);

  // Financial statistics
  const stats = useMemo(() => {
    let totalBudget = contract?.fixedPrice || 0;
    let fundedEscrow = 0;
    let releasedPayouts = 0;
    let remainingPlanned = 0;

    for (const m of milestones) {
      if (m.status === 'funded' || m.status === 'in_progress' || m.status === 'submitted' || m.status === 'revision_requested' || m.status === 'approved') {
        fundedEscrow += m.amount;
      } else if (m.status === 'released') {
        releasedPayouts += m.amount;
      } else if (m.status === 'planned') {
        remainingPlanned += m.amount;
      }
    }

    if (totalBudget === 0 && milestones.length > 0) {
      totalBudget = fundedEscrow + releasedPayouts + remainingPlanned;
    }

    const progressPct = totalBudget > 0 ? Math.min(100, Math.round((releasedPayouts / totalBudget) * 100)) : 0;

    return { totalBudget, fundedEscrow, releasedPayouts, remainingPlanned, progressPct };
  }, [contract, milestones]);

  // Unallocated fixed-price contract budget available for new milestones
  const unallocatedBudget = useMemo(() => {
    if (!contract || contract.contractType !== 'fixed') return 0;
    const totalAllocated = milestones
      .filter((m) => m.status !== 'cancelled')
      .reduce((acc, m) => acc + m.amount, 0);
    const fixedBudget = Number(contract.fixedPrice) || 0;
    return Math.max(0, fixedBudget - totalAllocated);
  }, [contract, milestones]);

  const openCreateMilestoneModal = () => {
    setNewMilestoneTitle('');
    setNewMilestoneDesc('');
    setNewMilestoneAmount(unallocatedBudget > 0 ? unallocatedBudget.toFixed(2) : '');
    setNewMilestoneDueDate('');
    setActionErrorMessage(null);
    setIsCreateMilestoneModalOpen(true);
  };

  // Handlers for Milestone Operations
  const openFundModal = (milestone: ContractMilestone) => {
    setSelectedMilestoneForFund(milestone);
    setActionErrorMessage(null);
    setActionSuccessMessage(null);
    setIsFundModalOpen(true);
  };

  const handleSimulatedFunding = async (milestoneId: string) => {
    setActionErrorMessage(null);
    setActionSuccessMessage(null);
    setIsFundingSimulated(true);

    const res = await fundMilestone(milestoneId);
    setIsFundingSimulated(false);

    if (res.success) {
      setActionSuccessMessage('Milestone funded successfully! Funds are held safely in escrow.');
      setIsFundModalOpen(false);
      loadData(true);
    } else {
      setActionErrorMessage(res.error || 'Failed to fund milestone.');
    }
  };

  const handleRazorpayCheckout = async (milestone: ContractMilestone) => {
    setActionErrorMessage(null);
    setActionSuccessMessage(null);
    setIsFundingWithRazorpay(true);

    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Could not load Razorpay Checkout SDK. Please check your internet connection.');
      }

      const orderRes = await createMilestoneRazorpayOrder(milestone.id);
      if (!orderRes.success || !orderRes.orderId || !orderRes.keyId) {
        throw new Error(orderRes.error || 'Failed to initialize Razorpay payment order.');
      }

      const isTestMode = typeof orderRes.keyId === 'string' && orderRes.keyId.startsWith('rzp_test_');
      const testContact = isTestMode ? process.env.NEXT_PUBLIC_RAZORPAY_TEST_CONTACT?.trim() : undefined;

      const options = {
        key: orderRes.keyId,
        amount: orderRes.amount,
        currency: orderRes.currency || 'INR',
        name: 'Workspace Escrow',
        description: `Escrow Funding: Milestone #${milestone.sequenceOrder} (${milestone.title})`,
        order_id: orderRes.orderId,
        prefill: {
          name: orderRes.clientName || 'Client',
          email: orderRes.clientEmail || '',
          ...(testContact ? { contact: testContact } : {}),
        },
        theme: {
          color: '#059669', // Emerald 600
        },
        notes: {
          milestone_id: milestone.id,
          contract_id: contractId,
          environment: 'test',
        },
        handler: async function (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) {
          setIsFundingWithRazorpay(true);
          try {
            const verifyRes = await verifyAndFundMilestoneRazorpay({
              milestoneId: milestone.id,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });

            if (verifyRes.success) {
              setActionSuccessMessage(
                `Milestone funded successfully via Razorpay Test Mode! Payment ID: ${response.razorpay_payment_id}. Funds are locked in escrow.`
              );
              setIsFundModalOpen(false);
              loadData(true);
            } else {
              setActionErrorMessage(verifyRes.error || 'Payment signature verification failed.');
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to finalize payment.';
            setActionErrorMessage(msg);
          } finally {
            setIsFundingWithRazorpay(false);
          }
        },
        modal: {
          ondismiss: function () {
            setIsFundingWithRazorpay(false);
          },
        },
      };

      const RazorpayConstructor = (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay;
      const rzpInstance = new RazorpayConstructor(options);
      rzpInstance.open();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error launching Razorpay Checkout.';
      setActionErrorMessage(msg);
      setIsFundingWithRazorpay(false);
    }
  };

  const handleStartWork = async (milestoneId: string) => {
    setActionErrorMessage(null);
    setActionSuccessMessage(null);
    setBusyMilestoneId(milestoneId);

    const res = await startMilestoneWork(milestoneId);
    setBusyMilestoneId(null);

    if (res.success) {
      setActionSuccessMessage('Milestone marked in progress! Happy coding.');
      loadData(true);
    } else {
      setActionErrorMessage(res.error || 'Failed to start work.');
    }
  };

  const handleCancel = async (milestoneId: string) => {
    if (!window.confirm('Are you sure you want to cancel this milestone? If funded, escrow will be refunded.')) {
      return;
    }

    setActionErrorMessage(null);
    setActionSuccessMessage(null);
    setBusyMilestoneId(milestoneId);

    const res = await cancelMilestone(milestoneId, 'Cancelled by client');
    setBusyMilestoneId(null);

    if (res.success) {
      setActionSuccessMessage('Milestone cancelled. Any held escrow has been refunded.');
      loadData(true);
    } else {
      setActionErrorMessage(res.error || 'Failed to cancel milestone.');
    }
  };

  const openSubmitModal = (m: ContractMilestone) => {
    setSelectedMilestoneForSubmit(m);
    setDeliveryNotes('');
    setDeliveryAttachments([{ title: 'Live Deliverable / Repository', url: '', type: 'link' }]);
    setActionErrorMessage(null);
    setIsSubmitModalOpen(true);
  };

  const handleSubmitDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMilestoneForSubmit) return;

    if (deliveryNotes.trim().length < 5) {
      setActionErrorMessage('Please provide detailed delivery notes (min 5 characters).');
      return;
    }

    setIsSubmittingDelivery(true);
    setActionErrorMessage(null);

    const cleanAttachments = deliveryAttachments.filter((att) => att.url.trim() !== '');

    const res = await submitMilestoneDelivery(selectedMilestoneForSubmit.id, {
      deliveryNotes: deliveryNotes.trim(),
      attachments: cleanAttachments,
    });

    setIsSubmittingDelivery(false);

    if (res.success) {
      setIsSubmitModalOpen(false);
      setActionSuccessMessage('Work submitted successfully! The client has been notified to review.');
      loadData(true);
    } else {
      setActionErrorMessage(res.error || 'Failed to submit delivery.');
    }
  };

  const openReviewModal = (m: ContractMilestone, mode: 'approve' | 'revision') => {
    setSelectedMilestoneForReview(m);
    setReviewMode(mode);
    setReviewFeedback(mode === 'approve' ? 'Excellent work, deliverables approved.' : '');
    setActionErrorMessage(null);
    setIsReviewModalOpen(true);
  };

  const handleProcessReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMilestoneForReview) return;

    setIsProcessingReview(true);
    setActionErrorMessage(null);

    if (reviewMode === 'approve') {
      const res = await approveAndReleaseMilestone(selectedMilestoneForReview.id, {
        feedback: reviewFeedback.trim(),
      });
      setIsProcessingReview(false);

      if (res.success) {
        setIsReviewModalOpen(false);
        setActionSuccessMessage('Milestone approved! Escrow payment disbursed to freelancer with 10% platform fee deducted.');
        loadData(true);
      } else {
        setActionErrorMessage(res.error || 'Failed to approve milestone.');
      }
    } else {
      if (reviewFeedback.trim().length < 5) {
        setIsProcessingReview(false);
        setActionErrorMessage('Please provide clear revision instructions (minimum 5 characters).');
        return;
      }

      const res = await requestMilestoneRevision(selectedMilestoneForReview.id, {
        feedback: reviewFeedback.trim(),
      });
      setIsProcessingReview(false);

      if (res.success) {
        setIsReviewModalOpen(false);
        setActionSuccessMessage('Revision requested. The freelancer can now resubmit updated deliverables.');
        loadData(true);
      } else {
        setActionErrorMessage(res.error || 'Failed to request revision.');
      }
    }
  };

  const handleCreateMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(newMilestoneAmount);
    if (!newMilestoneTitle.trim() || isNaN(amount) || amount <= 0) {
      setActionErrorMessage('Please enter a valid milestone title and positive amount.');
      return;
    }

    if (unallocatedBudget > 0 && amount > unallocatedBudget + 0.009) {
      setActionErrorMessage(
        `Milestone amount ($${amount.toFixed(2)}) exceeds remaining unallocated budget ($${unallocatedBudget.toFixed(2)}).`
      );
      return;
    }

    setIsCreatingMilestone(true);
    setActionErrorMessage(null);

    const res = await createMilestone(contractId, {
      title: newMilestoneTitle.trim(),
      description: newMilestoneDesc.trim(),
      amount,
      dueDate: newMilestoneDueDate || null,
    });

    setIsCreatingMilestone(false);

    if (res.success) {
      setIsCreateMilestoneModalOpen(false);
      setNewMilestoneTitle('');
      setNewMilestoneDesc('');
      setNewMilestoneAmount('');
      setNewMilestoneDueDate('');
      setActionSuccessMessage('New milestone added successfully! You can fund it when ready.');
      loadData(true);
    } else {
      setActionErrorMessage(res.error || 'Failed to create milestone.');
    }
  };

  const getStatusBadge = (status: ContractMilestone['status']) => {
    switch (status) {
      case 'planned':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <Clock className="w-3 h-3 text-slate-500" />
            Planned
          </span>
        );
      case 'funded':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <Lock className="w-3 h-3 text-emerald-600" />
            Funded in Escrow
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            <RefreshCw className="w-3 h-3 text-blue-600 animate-spin" />
            In Progress
          </span>
        );
      case 'submitted':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
            <Send className="w-3 h-3 text-purple-600" />
            Work Submitted (Under Review)
          </span>
        );
      case 'revision_requested':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            Changes Requested
          </span>
        );
      case 'approved':
      case 'released':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-600 text-white shadow-sm">
            <CheckCircle2 className="w-3 h-3 text-white" />
            Released & Paid
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            Cancelled
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-700">Loading contract and escrow milestones...</p>
        </div>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Contract Error</h2>
          <p className="text-xs text-slate-600">{error || 'Contract could not be retrieved.'}</p>
          <Link
            href="/freelancer"
            className="inline-flex items-center justify-center px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Top Header Breadcrumb */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={isClient ? '/client' : '/freelancer'}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {contract.contractType === 'fixed' ? 'Fixed-Price Contract' : 'Hourly Contract'}
                </span>
                <span className="text-slate-300">•</span>
                <span className={`inline-block px-2 py-0.2 rounded-md text-[10px] font-bold uppercase ${
                  contract.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                }`}>
                  {contract.status}
                </span>
              </div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate max-w-xl">
                {contract.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            {isClient && contract.contractType === 'fixed' && (
              <button
                onClick={openCreateMilestoneModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Add Milestone</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Flash Notifications */}
        {actionSuccessMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs font-medium text-emerald-900 animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionSuccessMessage}</span>
            </div>
            <button onClick={() => setActionSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {actionErrorMessage && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-xs font-medium text-rose-900 animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{actionErrorMessage}</span>
            </div>
            <button onClick={() => setActionErrorMessage(null)} className="text-rose-700 hover:text-rose-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Escrow Milestone Progress & Financial Overview Card */}
        {contract.contractType === 'fixed' && (
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Workspace Escrow Payment Protection Enabled</span>
                </div>
                <h2 className="text-xl font-bold text-slate-900 mt-1">Project Milestone Escrow</h2>
                <p className="text-xs text-slate-500">
                  Client deposits funds into simulated escrow prior to work beginning. Funds release upon verified deliverable approval.
                </p>
              </div>

              <div className="flex items-center gap-6">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Fixed Budget</span>
                  <div className="text-xl font-black text-slate-900">${stats.totalBudget.toFixed(2)}</div>
                </div>
                <div className="h-8 w-px bg-slate-200 hidden sm:block" />
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">Funded in Escrow</span>
                  <div className="text-xl font-black text-emerald-700">${stats.fundedEscrow.toFixed(2)}</div>
                </div>
                <div className="h-8 w-px bg-slate-200 hidden sm:block" />
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Released to Freelancer</span>
                  <div className="text-xl font-black text-slate-700">${stats.releasedPayouts.toFixed(2)}</div>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500 font-semibold">
                <span>Completed & Paid: {stats.progressPct}%</span>
                <span>Remaining Planned: ${stats.remainingPlanned.toFixed(2)}</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                <div
                  className="bg-emerald-600 h-full transition-all duration-500"
                  style={{ width: `${(stats.releasedPayouts / (stats.totalBudget || 1)) * 100}%` }}
                />
                <div
                  className="bg-blue-400 h-full transition-all duration-500"
                  style={{ width: `${(stats.fundedEscrow / (stats.totalBudget || 1)) * 100}%` }}
                />
              </div>
              <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-0.5">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" /> Released ({stats.releasedPayouts > 0 ? `$${stats.releasedPayouts.toFixed(2)}` : '$0'})</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" /> Held in Escrow (${stats.fundedEscrow.toFixed(2)})</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-200 inline-block" /> Planned (${stats.remainingPlanned.toFixed(2)})</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="border-b border-slate-200 flex items-center gap-8">
          <button
            onClick={() => setActiveTab('milestones')}
            className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'milestones'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Milestones & Deliveries ({milestones.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('ledger')}
            className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'ledger'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Payment Ledger & Escrow Audit ({ledgerEntries.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Contract Terms</span>
          </button>
        </div>

        {/* TAB 1: MILESTONES & DELIVERIES */}
        {activeTab === 'milestones' && (
          <div className="space-y-4">
            {contract.contractType === 'hourly' ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                  <Clock className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Hourly Contract In Effect</h3>
                <p className="text-xs text-slate-600 max-w-md mx-auto">
                  This project operates on verified hourly billing at ${contract.hourlyRate?.toFixed(2)}/hr with a weekly limit of {contract.weeklyHourLimit || 40} hours.
                  Timer tracking and weekly timesheets govern this engagement instead of sequential milestones.
                </p>
                <div className="pt-2">
                  <Link
                    href="/freelancer/time-tracking"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                  >
                    <Clock className="w-4 h-4" />
                    <span>Open Time Tracker Console</span>
                  </Link>
                </div>
              </div>
            ) : milestones.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-6 shadow-xs max-w-2xl mx-auto">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-base font-bold text-slate-900">
                    {isClient ? 'Set Up Your First Contract Milestone' : 'Awaiting Milestone Setup by Client'}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-lg mx-auto">
                    {isClient
                      ? 'Fixed-price contracts protect both parties through sequential milestone escrow. Define Milestone 1, fund the escrow hold, and your freelancer will be notified to start work.'
                      : 'Your client will establish the initial project milestone and fund escrow. Once funded, you will be notified to start work and submit your deliverables directly here.'}
                  </p>
                </div>

                {/* 4-Step Milestone Lifecycle Overview */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left pt-2 border-t border-slate-100">
                  <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Step 1</span>
                    <p className="text-xs font-bold text-slate-800">Plan</p>
                    <p className="text-[11px] text-slate-500">Define deliverable criteria & amount</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Step 2</span>
                    <p className="text-xs font-bold text-slate-800">Fund Escrow</p>
                    <p className="text-[11px] text-slate-500">Funds locked safely in simulated escrow</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Step 3</span>
                    <p className="text-xs font-bold text-slate-800">Deliver</p>
                    <p className="text-[11px] text-slate-500">Talent works & submits live links</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Step 4</span>
                    <p className="text-xs font-bold text-slate-800">Release</p>
                    <p className="text-[11px] text-slate-500">Approve to release net payout (10% fee)</p>
                  </div>
                </div>

                {isClient && (
                  <div className="pt-2">
                    <button
                      onClick={openCreateMilestoneModal}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors cursor-pointer shadow-sm"
                    >
                      <PlusCircle className="w-4 h-4" />
                      <span>Create Milestone 1</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              milestones.map((milestone) => {
                const isExpanded = expandedMilestoneId === milestone.id;
                const isBusy = busyMilestoneId === milestone.id;
                const deliveries = milestone.deliveries || [];
                const latestDelivery = deliveries[0];

                return (
                  <div
                    key={milestone.id}
                    className={`bg-white rounded-2xl border transition-all duration-200 overflow-hidden ${
                      milestone.status === 'in_progress' || milestone.status === 'submitted'
                        ? 'border-emerald-300 shadow-sm ring-1 ring-emerald-100'
                        : 'border-slate-200/80 shadow-xs'
                    }`}
                  >
                    {/* Milestone Card Header */}
                    <div className="p-5 sm:p-6 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-md">
                              Milestone #{milestone.sequenceOrder}
                            </span>
                            {getStatusBadge(milestone.status)}
                            {milestone.dueDate && (
                              <span className="text-xs text-slate-500 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                Due {new Date(milestone.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                          </div>
                          <h3 className="text-base font-bold text-slate-900">{milestone.title}</h3>
                          {milestone.description && (
                            <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">{milestone.description}</p>
                          )}
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          <span className="text-xs text-slate-400 font-semibold block">Milestone Amount</span>
                          <span className="text-xl font-black text-slate-900">${milestone.amount.toFixed(2)}</span>
                          <span className="text-[10px] text-slate-400 block">{milestone.currency}</span>
                        </div>
                      </div>

                      {/* Milestone Action Buttons Row */}
                      <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* CLIENT ACTIONS */}
                          {isClient && milestone.status === 'planned' && (
                            <button
                              onClick={() => openFundModal(milestone)}
                              disabled={isBusy || isFundingWithRazorpay || isFundingSimulated}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>Fund Milestone Escrow</span>
                            </button>
                          )}

                          {isClient && milestone.status === 'submitted' && (
                            <>
                              <button
                                onClick={() => openReviewModal(milestone, 'approve')}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Approve & Release Payment</span>
                              </button>
                              <button
                                onClick={() => openReviewModal(milestone, 'revision')}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>Request Changes</span>
                              </button>
                            </>
                          )}

                          {isClient && (milestone.status === 'planned' || milestone.status === 'funded') && (
                            <button
                              onClick={() => handleCancel(milestone.id)}
                              disabled={isBusy}
                              className="text-xs text-slate-400 hover:text-rose-600 transition-colors cursor-pointer py-1 px-2"
                            >
                              Cancel Milestone
                            </button>
                          )}

                          {/* FREELANCER ACTIONS */}
                          {isFreelancer && milestone.status === 'funded' && (
                            <button
                              onClick={() => handleStartWork(milestone.id)}
                              disabled={isBusy}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>{isBusy ? 'Starting...' : 'Start Work'}</span>
                            </button>
                          )}

                          {isFreelancer && (milestone.status === 'funded' || milestone.status === 'in_progress' || milestone.status === 'revision_requested') && (
                            <button
                              onClick={() => openSubmitModal(milestone)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{milestone.status === 'revision_requested' ? 'Submit Revised Work' : 'Submit Completed Work'}</span>
                            </button>
                          )}

                          {milestone.status === 'released' && (
                            <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              Milestone closed and paid out
                            </span>
                          )}
                        </div>

                        {/* Expand/Collapse Deliveries History Toggle */}
                        {deliveries.length > 0 && (
                          <button
                            onClick={() => setExpandedMilestoneId(isExpanded ? null : milestone.id)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            <span>{deliveries.length} {deliveries.length === 1 ? 'Submission' : 'Submissions'}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Latest Client Feedback Banner if revision requested */}
                    {milestone.status === 'revision_requested' && latestDelivery?.clientFeedback && (
                      <div className="bg-amber-50/70 border-t border-amber-200 px-6 py-4 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          <span>Client Feedback & Change Request</span>
                        </div>
                        <p className="text-xs text-amber-950 italic pl-5.5 leading-relaxed">
                          &ldquo;{latestDelivery.clientFeedback}&rdquo;
                        </p>
                      </div>
                    )}

                    {/* Deliveries Timeline (Expandable) */}
                    {isExpanded && deliveries.length > 0 && (
                      <div className="bg-slate-50/70 border-t border-slate-100 p-6 space-y-4">
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <History className="w-3.5 h-3.5 text-slate-400" />
                          <span>Delivery Submission History (Preserved)</span>
                        </h4>

                        <div className="space-y-3">
                          {deliveries.map((delivery) => (
                            <div
                              key={delivery.id}
                              className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs"
                            >
                              <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900">Version {delivery.version}</span>
                                  <span className="text-slate-300">•</span>
                                  <span className="text-slate-500">
                                    {new Date(delivery.submittedAt).toLocaleString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: 'numeric',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                  delivery.reviewStatus === 'approved'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : delivery.reviewStatus === 'revision_requested'
                                    ? 'bg-amber-100 text-amber-800'
                                    : delivery.reviewStatus === 'superseded'
                                    ? 'bg-slate-100 text-slate-500 line-through'
                                    : 'bg-purple-100 text-purple-800'
                                }`}>
                                  {delivery.reviewStatus.replace('_', ' ').toUpperCase()}
                                </span>
                              </div>

                              <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                                {delivery.deliveryNotes}
                              </div>

                              {delivery.attachments && delivery.attachments.length > 0 && (
                                <div className="space-y-1.5 pt-1">
                                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                    Deliverable Links & Attachments
                                  </span>
                                  <div className="flex flex-wrap gap-2">
                                    {delivery.attachments.map((att, i) => (
                                      <a
                                        key={i}
                                        href={att.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-emerald-700 hover:text-emerald-800 rounded-md text-xs font-semibold transition-colors"
                                      >
                                        <ExternalLink className="w-3 h-3 text-emerald-600" />
                                        <span>{att.title || 'Deliverable Link'}</span>
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {delivery.clientFeedback && (
                                <div className="text-xs text-slate-600 bg-amber-50/50 p-2.5 rounded-lg border border-amber-100 space-y-1">
                                  <span className="font-bold text-amber-900 block">Reviewer Feedback:</span>
                                  <p className="italic">&ldquo;{delivery.clientFeedback}&rdquo;</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 2: PAYMENT LEDGER & ESCROW AUDIT */}
        {activeTab === 'ledger' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-6 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Immutable Simulated Ledger</span>
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-1">Transaction Audit Trail</h3>
                <p className="text-xs text-slate-500">
                  Every milestone deposit, platform fee, and net payout is recorded append-only in PostgreSQL.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-600">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>Standard Upwork-Style Platform Fee: <strong>10%</strong></span>
              </div>
            </div>

            {ledgerEntries.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                  <DollarSign className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-900">No Financial Events Recorded Yet</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  When a client funds a milestone into escrow or releases funds upon delivery approval, authoritative ledger transactions will appear here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                      <th className="pb-3 pr-4">Event Date</th>
                      <th className="pb-3 pr-4">Event Type</th>
                      <th className="pb-3 pr-4">Description</th>
                      <th className="pb-3 pr-4">From</th>
                      <th className="pb-3 pr-4">To</th>
                      <th className="pb-3 pr-4 text-right">Amount</th>
                      <th className="pb-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 pr-4 text-slate-500 whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-3.5 pr-4 whitespace-nowrap">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            entry.eventType === 'escrow_funded'
                              ? 'bg-blue-50 text-blue-800 border border-blue-200'
                              : entry.eventType === 'escrow_released'
                              ? 'bg-purple-50 text-purple-800 border border-purple-200'
                              : entry.eventType === 'payout_disbursed'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : entry.eventType === 'service_fee_deducted'
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {entry.eventType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3.5 pr-4 text-slate-800 font-medium">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{entry.description}</span>
                            {entry.metadata && typeof entry.metadata === 'object' && 'provider' in entry.metadata && (entry.metadata as { provider?: string }).provider === 'razorpay' && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                <Zap className="w-2.5 h-2.5 text-amber-600" />
                                <span>Razorpay Test</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 pr-4 text-slate-600 whitespace-nowrap">
                          {entry.fromUserName || '—'}
                        </td>
                        <td className="py-3.5 pr-4 text-slate-600 whitespace-nowrap">
                          {entry.toUserName || '—'}
                        </td>
                        <td className="py-3.5 pr-4 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                          {entry.eventType === 'service_fee_deducted' ? '-' : '+'}
                          ${entry.amount.toFixed(2)}
                        </td>
                        <td className="py-3.5 text-right whitespace-nowrap">
                          <span className="text-emerald-700 font-semibold flex items-center justify-end gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{entry.status}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: OVERVIEW & TERMS */}
        {activeTab === 'overview' && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
            <h3 className="text-base font-bold text-slate-900">Contract Specifications</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 text-xs">
              <div className="p-4 bg-slate-50 rounded-xl space-y-1">
                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Contract ID</span>
                <p className="font-mono text-slate-800 break-all">{contract.id}</p>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl space-y-1">
                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Job Reference</span>
                <p className="font-semibold text-slate-800">{contract.jobTitle}</p>
                <Link href={`/jobs/${contract.jobId}`} className="text-emerald-600 hover:underline flex items-center gap-1 font-semibold pt-1">
                  <span>View Original Job</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl space-y-1">
                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Client / Company</span>
                <p className="font-semibold text-slate-800">{contract.companyName || contract.clientName || 'Marketplace Client'}</p>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl space-y-1">
                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Contracted Freelancer</span>
                <p className="font-semibold text-slate-800">{milestones[0]?.freelancerName || 'Hired Talent'}</p>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl space-y-1">
                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Contract Established</span>
                <p className="font-semibold text-slate-800">
                  {new Date(contract.createdAt).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl space-y-1">
                <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Protection Mechanism</span>
                <p className="font-semibold text-emerald-800 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Workspace Escrow Guarantee
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: SUBMIT WORK (FREELANCER) */}
      {isSubmitModalOpen && selectedMilestoneForSubmit && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {selectedMilestoneForSubmit.status === 'revision_requested' ? 'Submit Revised Deliverables' : 'Submit Milestone Deliverables'}
                </h3>
                <p className="text-xs text-slate-500">
                  Milestone #{selectedMilestoneForSubmit.sequenceOrder}: {selectedMilestoneForSubmit.title} (${selectedMilestoneForSubmit.amount.toFixed(2)})
                </p>
              </div>
              <button
                onClick={() => setIsSubmitModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitDelivery} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Delivery Notes & Summary of Work <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="Describe the deliverables provided, key implementations, test coverage, and instructions for client verification..."
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 outline-hidden"
                  required
                />
              </div>

              {/* Dynamic Deliverable Links */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700">
                    Deliverable Links (GitHub, Figma, Live Preview, etc.)
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setDeliveryAttachments((prev) => [...prev, { title: 'Project Link', url: '', type: 'link' }])
                    }
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Link</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {deliveryAttachments.map((att, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={att.title}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDeliveryAttachments((prev) =>
                            prev.map((item, idx) => (idx === index ? { ...item, title: val } : item))
                          );
                        }}
                        placeholder="Link Label (e.g. GitHub PR)"
                        className="w-1/3 text-xs p-2 rounded-lg border border-slate-200 focus:border-emerald-600 outline-hidden"
                      />
                      <input
                        type="url"
                        value={att.url}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDeliveryAttachments((prev) =>
                            prev.map((item, idx) => (idx === index ? { ...item, url: val } : item))
                          );
                        }}
                        placeholder="https://..."
                        className="flex-1 text-xs p-2 rounded-lg border border-slate-200 focus:border-emerald-600 outline-hidden"
                      />
                      {deliveryAttachments.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setDeliveryAttachments((prev) => prev.filter((_, idx) => idx !== index))
                          }
                          className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsSubmitModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDelivery}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmittingDelivery ? 'Submitting...' : 'Send to Client for Review'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CLIENT REVIEW & ESCROW RELEASE */}
      {isReviewModalOpen && selectedMilestoneForReview && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Review Milestone Deliverables</h3>
                <p className="text-xs text-slate-500">
                  Milestone #{selectedMilestoneForReview.sequenceOrder}: {selectedMilestoneForReview.title}
                </p>
              </div>
              <button
                onClick={() => setIsReviewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setReviewMode('approve')}
                className={`py-2 rounded-lg transition-all cursor-pointer ${
                  reviewMode === 'approve' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Approve & Release Payment
              </button>
              <button
                type="button"
                onClick={() => setReviewMode('revision')}
                className={`py-2 rounded-lg transition-all cursor-pointer ${
                  reviewMode === 'revision' ? 'bg-white text-amber-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Request Revisions
              </button>
            </div>

            <form onSubmit={handleProcessReview} className="space-y-4">
              {reviewMode === 'approve' ? (
                <div className="space-y-3">
                  {/* Financial Breakdown */}
                  <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2 text-xs">
                    <span className="font-bold text-emerald-950 block">Payment Disbursement Breakdown</span>
                    <div className="flex justify-between text-slate-700">
                      <span>Milestone Escrow Held:</span>
                      <strong className="font-mono text-slate-900">${selectedMilestoneForReview.amount.toFixed(2)}</strong>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Standard Platform Fee (10%):</span>
                      <strong className="font-mono text-slate-700">-${(selectedMilestoneForReview.amount * 0.1).toFixed(2)}</strong>
                    </div>
                    <div className="pt-2 border-t border-emerald-200 flex justify-between font-bold text-emerald-900">
                      <span>Net Freelancer Payout:</span>
                      <span className="font-mono text-base">${(selectedMilestoneForReview.amount * 0.9).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700">Approval Message (Optional)</label>
                    <textarea
                      rows={2}
                      value={reviewFeedback}
                      onChange={(e) => setReviewFeedback(e.target.value)}
                      placeholder="Share positive feedback with the freelancer..."
                      className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-emerald-600 outline-hidden"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                    <span className="font-bold block">Need changes before releasing funds?</span>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      Escrow funds will remain safely locked in Workspace protection while the freelancer completes your requested updates.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700">
                      Revision Instructions <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      rows={4}
                      value={reviewFeedback}
                      onChange={(e) => setReviewFeedback(e.target.value)}
                      placeholder="Specify the exact adjustments, fixes, or additional details needed..."
                      className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-amber-600 outline-hidden"
                      required
                    />
                  </div>
                </div>
              )}

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReviewModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessingReview}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 shadow-sm cursor-pointer ${
                    reviewMode === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {reviewMode === 'approve' ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isProcessingReview ? 'Releasing Funds...' : 'Release Escrow Payout'}</span>
                    </>
                  ) : (
                    <>
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{isProcessingReview ? 'Sending Feedback...' : 'Request Revision'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CREATE MILESTONE (CLIENT) */}
      {isCreateMilestoneModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Add Next Contract Milestone</h3>
                <p className="text-xs text-slate-500">Plan and define project deliverables for {contract.title}</p>
              </div>
              <button
                onClick={() => setIsCreateMilestoneModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {unallocatedBudget > 0 ? (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900">
                <span className="font-semibold">Remaining Unallocated Budget:</span>
                <span className="font-mono font-bold text-emerald-950">${unallocatedBudget.toFixed(2)}</span>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                <span className="font-bold">Agreed Fixed Budget Fully Allocated</span>
                <p className="text-[11px] text-amber-800">
                  All ${(contract.fixedPrice || 0).toFixed(2)} of this contract&apos;s agreed budget has been assigned to milestones.
                </p>
              </div>
            )}

            <form onSubmit={handleCreateMilestone} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Milestone Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newMilestoneTitle}
                  onChange={(e) => setNewMilestoneTitle(e.target.value)}
                  placeholder="e.g. Milestone 2: User Authentication & Stripe Integration"
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:border-emerald-600 outline-hidden"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">
                    Amount ($ USD) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-bold">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      max={unallocatedBudget > 0 ? unallocatedBudget : undefined}
                      value={newMilestoneAmount}
                      onChange={(e) => setNewMilestoneAmount(e.target.value)}
                      placeholder={unallocatedBudget > 0 ? unallocatedBudget.toFixed(2) : "250.00"}
                      className="w-full text-xs pl-7 pr-3 py-2.5 rounded-lg border border-slate-200 focus:border-emerald-600 outline-hidden font-mono"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">Due Date (Optional)</label>
                  <input
                    type="date"
                    value={newMilestoneDueDate}
                    onChange={(e) => setNewMilestoneDueDate(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 focus:border-emerald-600 outline-hidden"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Scope & Expected Deliverables</label>
                <textarea
                  rows={3}
                  value={newMilestoneDesc}
                  onChange={(e) => setNewMilestoneDesc(e.target.value)}
                  placeholder="Outline acceptance criteria, technical details, and completion goals..."
                  className="w-full text-xs p-3 rounded-lg border border-slate-200 focus:border-emerald-600 outline-hidden"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateMilestoneModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingMilestone}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>{isCreatingMilestone ? 'Creating...' : 'Create Milestone'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: FUND ESCROW (RAZORPAY TEST MODE & SIMULATION) */}
      {isFundModalOpen && selectedMilestoneForFund && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Fund Milestone Escrow</h3>
                  <p className="text-xs text-slate-500">
                    Milestone #{selectedMilestoneForFund.sequenceOrder}: {selectedMilestoneForFund.title}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isFundingWithRazorpay && !isFundingSimulated) {
                    setIsFundModalOpen(false);
                  }
                }}
                disabled={isFundingWithRazorpay || isFundingSimulated}
                className="text-slate-400 hover:text-slate-600 p-1 disabled:opacity-40 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Escrow Deposit Summary Card */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Agreed Milestone Amount:</span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  ${selectedMilestoneForFund.amount.toFixed(2)} USD
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-200/60">
                <span>Platform Escrow Protection:</span>
                <span className="font-semibold text-emerald-700">100% Protected</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
                Your deposit is locked safely in escrow. Funds are not disbursed to the freelancer until you review and approve their deliverables.
              </p>
            </div>

            {/* Payment Method 1: Razorpay Test Mode */}
            <div className="p-4 rounded-xl border-2 border-emerald-500/30 bg-emerald-50/20 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">Pay with Razorpay</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                      <Zap className="w-2.5 h-2.5 text-amber-600" />
                      TEST MODE
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Live checkout simulation using cards, UPI, or Netbanking (no real money charged).
                  </p>
                </div>
              </div>

              <div className="p-2.5 bg-white/80 rounded-lg border border-slate-200/60 text-[11px] text-slate-600 space-y-1">
                <span className="font-semibold text-slate-800 block">Test Payment Tip:</span>
                <p>
                  In the Razorpay modal, select <strong>Card</strong> and enter test number <code className="bg-slate-100 px-1 py-0.5 rounded text-emerald-700 font-mono font-bold">4111 1111 1111 1111</code> with any future expiry &amp; CVV <code className="bg-slate-100 px-1 py-0.5 rounded text-emerald-700 font-mono font-bold">123</code>, or click <strong>Success</strong> for instant simulation.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleRazorpayCheckout(selectedMilestoneForFund)}
                disabled={isFundingWithRazorpay || isFundingSimulated}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {isFundingWithRazorpay ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing Gateway Checkout...</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" />
                    <span>Launch Razorpay Test Checkout</span>
                  </>
                )}
              </button>
            </div>

            {/* Payment Method 2: Instant Simulated Funding */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-800">Alternative: Direct Mock Deposit</span>
                  <p className="text-[11px] text-slate-500">
                    Simulate escrow funding immediately without opening the gateway modal.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleSimulatedFunding(selectedMilestoneForFund.id)}
                disabled={isFundingWithRazorpay || isFundingSimulated}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isFundingSimulated ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Simulating Deposit...</span>
                  </>
                ) : (
                  <span>Deposit via Simulation (Skip Card)</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ContractDetailsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm font-semibold text-slate-700">Loading contract and escrow milestones...</p>
          </div>
        </div>
      }
    >
      <ContractDetailsContent />
    </Suspense>
  );
}
