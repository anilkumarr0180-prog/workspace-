'use client';

import React, { useState, useEffect, useRef } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMarketplace } from '@/lib/context/marketplace-context';
import WorkspaceLogo from '@/components/layout/workspace-logo';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import Image from 'next/image';
import {
  ChevronDown,
  Menu,
  X,
  Search,
  Bookmark,
  Briefcase,
  Users,
  Sparkles,
  Layers,
  ArrowRight,
  Bell,
  HelpCircle,
  MessageSquare,
  LogOut,
  User as UserIcon,
  Moon,
  Sun,
  DollarSign,
  FileText,
  Repeat,
  Loader2,
  Clock,
  CreditCard
} from 'lucide-react';
import { switchActiveRole } from '@/lib/actions/profile';

interface UserProfile {
  id?: string;
  full_name?: string;
  username?: string;
  avatar_url?: string;
  active_mode?: 'freelancer' | 'client';
  can_hire?: boolean;
  can_work?: boolean;
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { savedJobIds } = useMarketplace();

  // Navigation State
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Authentication & Profile State
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [switchingRole, setSwitchingRole] = useState(false);
  const [roleSwitchError, setRoleSwitchError] = useState<string | null>(null);

  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const navDropdownRef = useRef<HTMLDivElement>(null);

  // Close all open dropdowns on route changes (adjusting state during render)
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setActiveDropdown(null);
    setProfileMenuOpen(false);
    setMobileMenuOpen(false);
  }

  // Subscribe to Supabase Auth State
  useEffect(() => {
    let isMounted = true;
    try {
      const supabase = createClient();

      const fetchProfile = async (userId: string) => {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();
          if (isMounted && data) {
            setProfile(data as UserProfile);
          }
        } catch {
          // Fallback to user metadata
        }
      };

      supabase.auth.getUser().then((res: { data: { user: User | null } }) => {
        if (!isMounted) return;
        const currentUser = res.data.user;
        setUser(currentUser);
        setAuthLoaded(true);

        if (currentUser) {
          fetchProfile(currentUser.id);
        }
      }).catch(() => {
        if (isMounted) setAuthLoaded(true);
      });

      const { data: authListener } = supabase.auth.onAuthStateChange(
        (_event: unknown, session: { user: User } | null) => {
          if (!isMounted) return;
          const sessionUser = session?.user ?? null;
          setUser(sessionUser);
          setAuthLoaded(true);

          if (sessionUser) {
            fetchProfile(sessionUser.id);
          } else {
            setProfile(null);
          }
        }
      );

      return () => {
        isMounted = false;
        authListener?.subscription.unsubscribe();
      };
    } catch {
      // In case of unconfigured env or offline, gracefully stay in public mode
      setTimeout(() => {
        if (isMounted) setAuthLoaded(true);
      }, 0);
    }
  }, []);

  // Handle outside click & Escape key for dropdowns (uses click instead of mousedown to avoid swallowing links)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        profileDropdownRef.current &&
        !profileDropdownRef.current.contains(target)
      ) {
        setProfileMenuOpen(false);
      }
      if (
        navDropdownRef.current &&
        !navDropdownRef.current.contains(target)
      ) {
        setActiveDropdown(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false);
        setActiveDropdown(null);
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);


  // Derived user details
  const displayName =
    profile?.full_name ||
    (user?.user_metadata?.full_name as string) ||
    user?.email?.split('@')[0] ||
    'User';

  // Authoritative role source is database profiles.active_mode
  const currentMode =
    profile?.active_mode ||
    (user?.user_metadata?.role as 'client' | 'freelancer') ||
    'freelancer';

  const isClientMode = currentMode === 'client';

  const displayRole = isClientMode ? 'Client' : 'Freelancer';

  const initials = displayName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U';

  const profileHref = profile?.username
    ? `/freelancers/${profile.username}`
    : isClientMode
    ? '/client'
    : '/freelancer';

  // Role switcher handler with persistent database update
  const handleRoleSwitch = async () => {
    if (switchingRole) return;
    const nextRole: 'client' | 'freelancer' = isClientMode ? 'freelancer' : 'client';
    setSwitchingRole(true);
    setRoleSwitchError(null);

    try {
      const res = await switchActiveRole(nextRole);
      if (res.success) {
        setProfile((prev) => (prev ? { ...prev, active_mode: nextRole } : null));
        setProfileMenuOpen(false);
        setMobileMenuOpen(false);
        router.push(nextRole === 'client' ? '/client' : '/freelancer');
        router.refresh();
      } else {
        setRoleSwitchError(res.error || 'Failed to switch role.');
      }
    } catch {
      setRoleSwitchError('Network error while switching role.');
    } finally {
      setSwitchingRole(false);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    setProfileMenuOpen(false);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Fallback
    }
    setUser(null);
    setProfile(null);
    router.push('/login');
  };

  // Search submit handler
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/jobs?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  // Hide Navbar completely on auth flows (after all hooks)
  if (pathname === '/login' || pathname.startsWith('/signup')) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200/80 shadow-2xs w-full">
      <div className="w-full px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 2xl:px-14">
        <div className="flex items-center justify-between h-16 sm:h-[68px]">
          {/* ================= LEFT: Brand & Navigation ================= */}
          <div className="flex items-center gap-6 sm:gap-7 lg:gap-8 xl:gap-10">
            <NextLink
              href={user ? (isClientMode ? '/client' : '/freelancer') : '/'}
              className="flex items-center shrink-0"
              aria-label="Workspace Home"
            >
              <WorkspaceLogo />
            </NextLink>

            {/* ---------- NAVIGATION (UPWORK MARKETING NAV WHEN LOGGED OUT) ---------- */}
            {!user ? (
              /* Upwork Marketing Navigation matching Screenshot 1 */
              <nav
                ref={navDropdownRef}
                className="hidden lg:flex items-center gap-1 xl:gap-2 text-[14px] font-medium text-[#001e00]"
              >
                {/* 1. Hire talent Dropdown */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveDropdown('hire')}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <button
                    type="button"
                    onClick={() => setActiveDropdown(activeDropdown === 'hire' ? null : 'hire')}
                    aria-expanded={activeDropdown === 'hire'}
                    className="px-3.5 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <span>Hire talent</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  </button>

                  {activeDropdown === 'hire' && (
                    <div className="absolute top-full left-0 w-64 pt-2 shadow-xl z-50">
                      <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-lg space-y-1">
                        <NextLink
                          href="/client/jobs/new"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                            <Briefcase className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Post a Job
                            </div>
                            <div className="text-xs text-slate-500">Find talent and hire fast</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/freelancers"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Users className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Explore Freelancers
                            </div>
                            <div className="text-xs text-slate-500">Browse verified specialist profiles</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/client"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Layers className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Client Dashboard
                            </div>
                            <div className="text-xs text-slate-500">Manage posted jobs and hires</div>
                          </div>
                        </NextLink>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Get outcomes Dropdown */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveDropdown('outcomes')}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <button
                    type="button"
                    onClick={() => setActiveDropdown(activeDropdown === 'outcomes' ? null : 'outcomes')}
                    aria-expanded={activeDropdown === 'outcomes'}
                    className="px-3.5 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <span>Get outcomes</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  </button>

                  {activeDropdown === 'outcomes' && (
                    <div className="absolute top-full left-0 w-64 pt-2 shadow-xl z-50">
                      <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-lg space-y-1">
                        <NextLink
                          href="/jobs?category=AI+%26+Machine+Learning"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                            <Sparkles className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              AI & Machine Learning
                            </div>
                            <div className="text-xs text-slate-500">Generative AI, LLMs, Computer Vision</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/jobs?category=Development+%26+IT"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Layers className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Development & IT
                            </div>
                            <div className="text-xs text-slate-500">Web, Mobile, Cloud, DevOps</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/jobs?category=Design+%26+Creative"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Briefcase className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Design & Creative
                            </div>
                            <div className="text-xs text-slate-500">UI/UX, Product, Branding</div>
                          </div>
                        </NextLink>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Find work Dropdown */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveDropdown('work')}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <button
                    type="button"
                    onClick={() => setActiveDropdown(activeDropdown === 'work' ? null : 'work')}
                    aria-expanded={activeDropdown === 'work'}
                    className="px-3.5 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <span>Find work</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  </button>

                  {activeDropdown === 'work' && (
                    <div className="absolute top-full left-0 w-64 pt-2 shadow-xl z-50">
                      <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-lg space-y-1">
                        <NextLink
                          href="/jobs"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                            <Briefcase className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Browse All Jobs
                            </div>
                            <div className="text-xs text-slate-500">Search high-budget contracts</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/freelancer"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Sparkles className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Freelancer Hub
                            </div>
                            <div className="text-xs text-slate-500">Track submitted proposals and bids</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/saved"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Bookmark className="w-4 h-4" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                                Saved Jobs
                              </span>
                              {savedJobIds.length > 0 && (
                                <span className="px-1.5 py-0.2 bg-[#14a800] text-white text-[11px] font-bold rounded-full">
                                  {savedJobIds.length}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">Your bookmarked opportunities</div>
                          </div>
                        </NextLink>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Why Upwork Dropdown */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveDropdown('why_upwork')}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <button
                    type="button"
                    onClick={() => setActiveDropdown(activeDropdown === 'why_upwork' ? null : 'why_upwork')}
                    aria-expanded={activeDropdown === 'why_upwork'}
                    className="px-3.5 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <span>Why Workspace</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  </button>

                  {activeDropdown === 'why_upwork' && (
                    <div className="absolute top-full left-0 w-64 pt-2 shadow-xl z-50">
                      <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-lg space-y-1">
                        <NextLink
                          href="/freelancers"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                            <Users className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              How to Hire
                            </div>
                            <div className="text-xs text-slate-500">Learn the hiring workflow</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/jobs"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Briefcase className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              How to Find Work
                            </div>
                            <div className="text-xs text-slate-500">Build your freelance career</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/client"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Layers className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Trust & Security
                            </div>
                            <div className="text-xs text-slate-500">Escrow milestone protection</div>
                          </div>
                        </NextLink>
                      </div>
                    </div>
                  )}
                </div>

                {/* 5. Pricing Direct Link */}
                <NextLink
                  href="/jobs"
                  className="px-3.5 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors font-medium text-[#001e00]"
                >
                  Pricing
                </NextLink>

                {/* 6. Enterprise Direct Link */}
                <NextLink
                  href="/client"
                  className="px-3.5 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors font-medium text-[#001e00]"
                >
                  Enterprise
                </NextLink>
              </nav>
            ) : user && !isClientMode ? (
              /* ---------- AUTHENTICATED FREELANCER NAVIGATION (ON DASHBOARDS) ---------- */
              <nav
                ref={navDropdownRef}
                className="hidden lg:flex items-center gap-1 xl:gap-2 text-[14px] font-medium text-slate-800"
              >
                {/* Find Work Dropdown */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveDropdown('freelancer_find_work')}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setActiveDropdown(
                        activeDropdown === 'freelancer_find_work' ? null : 'freelancer_find_work'
                      )
                    }
                    aria-expanded={activeDropdown === 'freelancer_find_work'}
                    className="px-3 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <span>Find work</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  </button>

                  {activeDropdown === 'freelancer_find_work' && (
                    <div className="absolute top-full left-0 w-64 pt-2 shadow-xl z-50">
                      <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-lg space-y-1">
                        <NextLink
                          href="/jobs"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                            <Briefcase className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Find Work
                            </div>
                            <div className="text-xs text-slate-500">Search high-budget contracts</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/saved"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <Bookmark className="w-4 h-4" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                                Saved Jobs
                              </span>
                              {savedJobIds.length > 0 && (
                                <span className="px-1.5 py-0.2 bg-[#14a800] text-white text-[11px] font-bold rounded-full">
                                  {savedJobIds.length}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">Your bookmarked opportunities</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/freelancer#proposals"
                          onClick={() => {
                            setActiveDropdown(null);
                            if (pathname === '/freelancer') {
                              const el = document.getElementById('proposals');
                              el?.scrollIntoView({ behavior: 'smooth' });
                              window.dispatchEvent(new CustomEvent('refresh-freelancer-proposals'));
                            }
                          }}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Proposals & Offers
                            </div>
                            <div className="text-xs text-slate-500">Review pending client proposals</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href={profileHref}
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <UserIcon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Profile
                            </div>
                            <div className="text-xs text-slate-500">Edit skills, rate, and portfolio</div>
                          </div>
                        </NextLink>
                      </div>
                    </div>
                  )}
                </div>

                {/* Deliver Work Dropdown */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveDropdown('freelancer_deliver_work')}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setActiveDropdown(
                        activeDropdown === 'freelancer_deliver_work' ? null : 'freelancer_deliver_work'
                      )
                    }
                    aria-expanded={activeDropdown === 'freelancer_deliver_work'}
                    className="px-3 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <span>Deliver work</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  </button>

                  {activeDropdown === 'freelancer_deliver_work' && (
                    <div className="absolute top-full left-0 w-64 pt-2 shadow-xl z-50">
                      <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-lg space-y-1">
                        <NextLink
                          href="/contracts"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                            <Layers className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Your Active Contracts
                            </div>
                            <div className="text-xs text-slate-500">Track milestones and deadlines</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/freelancer/time-tracking"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Time Tracker
                            </div>
                            <div className="text-xs text-slate-500">Log hours and track active sessions</div>
                          </div>
                        </NextLink>
                      </div>
                    </div>
                  )}
                </div>

                {/* Manage Finances Dropdown */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveDropdown('freelancer_finances')}
                  onMouseLeave={() => setActiveDropdown(null)}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setActiveDropdown(
                        activeDropdown === 'freelancer_finances' ? null : 'freelancer_finances'
                      )
                    }
                    aria-expanded={activeDropdown === 'freelancer_finances'}
                    className="px-3 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <span>Manage finances</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  </button>

                  {activeDropdown === 'freelancer_finances' && (
                    <div className="absolute top-full left-0 w-64 pt-2 shadow-xl z-50">
                      <div className="bg-white rounded-xl border border-slate-200 p-2 shadow-lg space-y-1">
                        <NextLink
                          href="/freelancer"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-700">
                            <DollarSign className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Reports & Earnings
                            </div>
                            <div className="text-xs text-slate-500">Overview of paid and in-review funds</div>
                          </div>
                        </NextLink>

                        <NextLink
                          href="/freelancer"
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 group-hover:text-emerald-700">
                              Billings & Invoices
                            </div>
                            <div className="text-xs text-slate-500">Download payout receipts and taxes</div>
                          </div>
                        </NextLink>
                      </div>
                    </div>
                  )}
                </div>

                {/* Messages Link */}
                <NextLink
                  href="/freelancer"
                  onClick={() => setActiveDropdown(null)}
                  className="px-3 py-2 rounded-lg hover:text-[#14a800] hover:bg-slate-50 transition-colors flex items-center gap-1.5"
                >
                  <span>Messages</span>
                </NextLink>
              </nav>
            ) : (
              /* ---------- AUTHENTICATED CLIENT NAVIGATION (ON DASHBOARDS) ---------- */
              <nav className="hidden lg:flex items-center gap-1 xl:gap-2 text-[14px] font-medium text-slate-800">
                <NextLink
                  href="/client/jobs/new"
                  className={`px-3 py-2 rounded-lg transition-colors font-semibold ${
                    pathname === '/client/jobs/new'
                      ? 'text-[#14a800] bg-emerald-50/80'
                      : 'text-[#14a800] hover:bg-slate-50'
                  }`}
                >
                  Post a Job
                </NextLink>
                <NextLink
                  href="/client"
                  className={`px-3 py-2 rounded-lg transition-colors ${
                    pathname === '/client'
                      ? 'text-[#14a800] bg-emerald-50/80 font-semibold'
                      : 'hover:text-[#14a800] hover:bg-slate-50'
                  }`}
                >
                  All Job Posts
                </NextLink>
                <NextLink
                  href="/freelancers"
                  className={`px-3 py-2 rounded-lg transition-colors ${
                    pathname === '/freelancers' || pathname.startsWith('/freelancers/')
                      ? 'text-[#14a800] bg-emerald-50/80 font-semibold'
                      : 'hover:text-[#14a800] hover:bg-slate-50'
                  }`}
                >
                  Discover Talent
                </NextLink>
                <NextLink
                  href="/client/billing"
                  className={`px-3 py-2 rounded-lg transition-colors ${
                    pathname === '/client/billing' || pathname.startsWith('/client/billing')
                      ? 'text-[#14a800] bg-emerald-50/80 font-semibold'
                      : 'hover:text-[#14a800] hover:bg-slate-50'
                  }`}
                >
                  Billing & Payments
                </NextLink>
                <NextLink
                  href="/client/reports"
                  className={`px-3 py-2 rounded-lg transition-colors ${
                    pathname === '/client/reports' || pathname.startsWith('/client/reports')
                      ? 'text-[#14a800] bg-emerald-50/80 font-semibold'
                      : 'hover:text-[#14a800] hover:bg-slate-50'
                  }`}
                >
                  Reports
                </NextLink>
              </nav>
            )}
          </div>

          {/* ================= RIGHT: Search, Notifications & Profile ================= */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            {/* Quick Search & Saved Jobs only on authenticated dashboard routes */}
            {user && (
              <>
                <form
                  onSubmit={handleSearchSubmit}
                  className="relative hidden sm:flex items-center"
                >
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search jobs..."
                    className="w-36 md:w-48 lg:w-56 h-9 pl-9 pr-3 rounded-full border border-slate-200 bg-slate-50 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-[#14a800] focus:bg-white focus:ring-1 focus:ring-[#14a800] transition-all placeholder:text-slate-400"
                  />
                </form>

                <NextLink
                  href="/saved"
                  className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors shrink-0"
                  title="Saved jobs"
                >
                  <Bookmark className="w-4.5 h-4.5" />
                  {savedJobIds.length > 0 && (
                    <span className="absolute top-0 right-0 w-4 h-4 bg-[#14a800] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {savedJobIds.length}
                    </span>
                  )}
                </NextLink>
              </>
            )}

            {/* ---------- AUTHENTICATED OR MARKETING RIGHT ELEMENTS ---------- */}
            {!authLoaded ? (
              <div className="h-9 w-20 sm:w-28" />
            ) : user ? (
              <>
                {/* Help Icon */}
                <NextLink
                  href="/jobs"
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors hidden sm:block"
                  title="Help & Support"
                >
                  <HelpCircle className="w-4.5 h-4.5" />
                </NextLink>

                {/* Notifications Bell */}
                <button
                  type="button"
                  onClick={() => router.push(isClientMode ? '/client' : '/freelancer')}
                  className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors cursor-pointer"
                  title="Notifications"
                >
                  <Bell className="w-4.5 h-4.5" />
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#14a800] rounded-full ring-2 ring-white" />
                </button>

                {/* Direct Messages / Chat Link */}
                <NextLink
                  href={isClientMode ? '/client' : '/freelancer'}
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors hidden sm:block"
                  title="Messages"
                >
                  <MessageSquare className="w-4.5 h-4.5" />
                </NextLink>

                {/* Profile Avatar & Dark Upwork-Style Dropdown */}
                <div className="relative" ref={profileDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                    aria-expanded={profileMenuOpen}
                    aria-haspopup="true"
                    className="flex items-center gap-1.5 p-1 rounded-full hover:ring-2 hover:ring-[#14a800]/30 transition-all cursor-pointer select-none"
                    title="Account profile & settings"
                  >
                    <div className="relative">
                      {profile?.avatar_url ? (
                        <Image
                          src={profile.avatar_url}
                          alt={displayName}
                          width={36}
                          height={36}
                          unoptimized
                          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover border border-slate-300"
                        />
                      ) : (
                        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-tr from-emerald-600 to-[#14a800] text-white font-bold flex items-center justify-center text-xs sm:text-sm shadow-2xs">
                          {initials}
                        </div>
                      )}
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#14a800] border-2 border-white rounded-full" />
                    </div>
                  </button>

                  {/* ================= DARK PROFILE DROPDOWN (UPWORK STYLE) ================= */}
                  {profileMenuOpen && (
                    <div
                      className="absolute right-0 top-full mt-2 w-72 sm:w-80 rounded-2xl bg-[#141b24] text-slate-100 border border-slate-700/80 shadow-2xl py-2 z-50 text-sm animate-fadeIn"
                      role="menu"
                      aria-orientation="vertical"
                    >
                      {/* 1. User Info Header */}
                      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3">
                        <div className="relative shrink-0">
                          {profile?.avatar_url ? (
                            <Image
                              src={profile.avatar_url}
                              alt={displayName}
                              width={44}
                              height={44}
                              unoptimized
                              className="w-11 h-11 rounded-full object-cover border border-emerald-500"
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shadow-xs border border-emerald-400">
                              {initials}
                            </div>
                          )}
                          <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#14a800] border-2 border-[#141b24] rounded-full" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-white truncate text-[15px]">
                            {displayName}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <span className="inline-block w-2 h-2 rounded-full bg-[#14a800]" />
                            <span className="font-medium text-emerald-400">{displayRole}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {user.email}
                          </div>
                        </div>
                      </div>

                      {/* 2. Primary Profile Action */}
                      <div className="p-2 border-b border-slate-800/80 space-y-0.5">
                        <NextLink
                          href={profileHref}
                          onClick={() => setProfileMenuOpen(false)}
                          className="flex items-center justify-between px-3 py-2 rounded-xl text-slate-200 hover:text-white hover:bg-slate-800/80 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <UserIcon className="w-4 h-4 text-emerald-400" />
                            <span>Your profile</span>
                          </div>
                          <span className="text-[11px] text-[#14a800] font-semibold bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/40">
                            Active
                          </span>
                        </NextLink>

                        <NextLink
                          href="/saved"
                          onClick={() => setProfileMenuOpen(false)}
                          className="flex items-center justify-between px-3 py-2 rounded-xl text-slate-200 hover:text-white hover:bg-slate-800/80 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <Bookmark className="w-4 h-4 text-slate-400" />
                            <span>Saved jobs</span>
                          </div>
                          {savedJobIds.length > 0 && (
                            <span className="text-xs font-bold text-slate-400">
                              {savedJobIds.length}
                            </span>
                          )}
                        </NextLink>

                        <NextLink
                          href={isClientMode ? '/client' : '/freelancer'}
                          onClick={() => setProfileMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-200 hover:text-white hover:bg-slate-800/80 transition-colors"
                        >
                          <FileText className="w-4 h-4 text-slate-400" />
                          <span>{isClientMode ? 'Manage jobs' : 'Proposals & stats'}</span>
                        </NextLink>

                        <NextLink
                          href={isClientMode ? '/client/billing' : '/contracts'}
                          onClick={() => setProfileMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-200 hover:text-white hover:bg-slate-800/80 transition-colors"
                        >
                          <CreditCard className="w-4 h-4 text-slate-400" />
                          <span>{isClientMode ? 'Billing & Payments' : 'Contracts & Escrow'}</span>
                        </NextLink>
                      </div>

                      {/* 3. Role Switcher (Client / Freelancer) */}
                      <div className="p-2 border-b border-slate-800/80">
                        <button
                          type="button"
                          onClick={handleRoleSwitch}
                          disabled={switchingRole}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-200 hover:text-white hover:bg-slate-800/80 transition-colors group cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed text-left"
                        >
                          <div className="flex items-center gap-2.5">
                            {switchingRole ? (
                              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                            ) : (
                              <Repeat className="w-4 h-4 text-emerald-400 group-hover:rotate-180 transition-transform duration-300" />
                            )}
                            <span>
                              {isClientMode ? 'Switch to Freelancer' : 'Switch to Client'}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {isClientMode ? 'Find work' : 'Hire'}
                          </span>
                        </button>
                        {roleSwitchError && (
                          <div className="px-3 pt-1 text-[11px] text-rose-400">
                            {roleSwitchError}
                          </div>
                        )}
                      </div>

                      {/* 4. Appearance & Preferences */}
                      <div className="p-2 border-b border-slate-800/80 space-y-0.5">
                        <button
                          type="button"
                          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5">
                            {theme === 'dark' ? (
                              <Moon className="w-4 h-4 text-slate-400" />
                            ) : (
                              <Sun className="w-4 h-4 text-amber-400" />
                            )}
                            <span>Theme</span>
                          </div>
                          <span className="text-xs text-slate-400 capitalize">
                            {theme} mode
                          </span>
                        </button>
                      </div>

                      {/* 5. Logout */}
                      <div className="p-2">
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-300 hover:text-rose-200 hover:bg-rose-950/40 transition-colors text-left font-medium cursor-pointer"
                        >
                          <LogOut className="w-4 h-4 text-rose-400" />
                          <span>Log out</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* ---------- LOGGED OUT PUBLIC BUTTONS (UPWORK STYLE) ---------- */
              <>
                <NextLink
                  href="/login"
                  className="text-[14px] font-semibold text-[#001e00] hover:text-[#14a800] transition-colors hidden sm:inline-block px-3 py-2"
                >
                  Log in
                </NextLink>

                <NextLink
                  href="/signup"
                  className="inline-flex items-center justify-center px-5 py-2 sm:px-6 sm:py-2.5 rounded-full text-xs sm:text-[14px] font-semibold text-white bg-[#14a800] hover:bg-[#108a00] active:scale-[0.98] transition-all shadow-xs shrink-0"
                >
                  <span>Sign up</span>
                </NextLink>
              </>
            )}

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              type="button"
              className="p-1.5 sm:p-2 lg:hidden text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5 sm:w-6 sm:h-6" /> : <Menu className="w-5 h-5 sm:w-6 sm:h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* ================= MOBILE DRAWER MENU ================= */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 space-y-3 shadow-lg">
          {/* Authenticated Mobile User Header */}
          {user ? (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#14a800] text-white font-bold flex items-center justify-center text-sm">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{displayName}</div>
                  <div className="text-xs text-emerald-700 font-medium">{displayRole}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRoleSwitch}
                disabled={switchingRole}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer disabled:opacity-60"
              >
                {switchingRole ? (
                  <Loader2 className="w-3.5 h-3.5 text-[#14a800] animate-spin" />
                ) : (
                  <Repeat className="w-3.5 h-3.5 text-[#14a800]" />
                )}
                <span>{isClientMode ? 'Switch to Freelancer Mode' : 'Switch to Client Mode'}</span>
              </button>
              {roleSwitchError && (
                <div className="text-[11px] text-rose-600 font-medium text-center">
                  {roleSwitchError}
                </div>
              )}
            </div>
          ) : null}

          {/* Nav Links */}
          <div className="space-y-1">
            <NextLink
              href="/jobs"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Find work (Jobs)</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/freelancers"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Find talent (Freelancers)</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/freelancer#proposals"
              onClick={() => {
                setMobileMenuOpen(false);
                if (pathname === '/freelancer') {
                  const el = document.getElementById('proposals');
                  el?.scrollIntoView({ behavior: 'smooth' });
                  window.dispatchEvent(new CustomEvent('refresh-freelancer-proposals'));
                }
              }}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Freelancer Hub & Proposals</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/client"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Client Dashboard</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/client/billing"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Billing & Payments</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/client/reports"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <span>Reports & Timesheets</span>
              <ArrowRight className="w-4 h-4 text-slate-400" />
            </NextLink>

            <NextLink
              href="/saved"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between p-2.5 rounded-lg text-slate-800 font-medium hover:bg-slate-50"
            >
              <div className="flex items-center gap-2">
                <span>Saved Jobs</span>
                {savedJobIds.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-[#14a800] text-white text-[11px] font-bold rounded-full">
                    {savedJobIds.length}
                  </span>
                )}
              </div>
              <Bookmark className="w-4 h-4 text-slate-400" />
            </NextLink>
          </div>

          {/* Action buttons on mobile */}
          <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
            {user ? (
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Log out</span>
              </button>
            ) : (
              <>
                <NextLink
                  href="/signup"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white bg-[#14a800] hover:bg-[#108a00] shadow-sm"
                >
                  <span>Sign up</span>
                  <ArrowRight className="w-4 h-4" />
                </NextLink>

                <NextLink
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center justify-center py-2.5 rounded-full text-sm font-semibold text-slate-800 hover:bg-slate-100"
                >
                  Log in
                </NextLink>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
