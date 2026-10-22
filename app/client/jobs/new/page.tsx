'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useMarketplace } from '@/lib/context/marketplace-context';
import { CATEGORIES } from '@/lib/mock-data';
import { ProjectType, ExperienceLevel, ProjectDuration } from '@/lib/types';
import {
  CheckCircle2,
  Plus,
  X,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  FileCheck
} from 'lucide-react';

export default function PostJobPage() {
  const { addJob } = useMarketplace();

  // Form Fields
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0].name);
  const [description, setDescription] = useState('');
  const [deliverablesInput, setDeliverablesInput] = useState('');
  const [deliverables, setDeliverables] = useState<string[]>([
    'Clean, type-safe implementation documented with Storybook or README',
    'Lighthouse performance and accessibility audit passing scores'
  ]);
  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState<string[]>(['React', 'Next.js', 'TypeScript', 'Tailwind CSS']);
  const [projectType, setProjectType] = useState<ProjectType>('fixed');
  const [fixedAmount, setFixedAmount] = useState<number>(3500);
  const [hourlyMin, setHourlyMin] = useState<number>(50);
  const [hourlyMax, setHourlyMax] = useState<number>(90);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('expert');
  const [duration, setDuration] = useState<ProjectDuration>('1_to_3_months');
  const [clientName, setClientName] = useState('Workspace Innovation Labs');
  const [companyName, setCompanyName] = useState('Alpha Labs Financial LLC');

  // Validation & UI State
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [postSource, setPostSource] = useState<'supabase' | 'local'>('local');

  // Add a skill
  const handleAddSkill = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const trimmed = skillInput.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
      setSkillInput('');
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills(skills.filter((s) => s !== skillToRemove));
  };

  // Add a deliverable
  const handleAddDeliverable = () => {
    if (deliverablesInput.trim()) {
      setDeliverables([...deliverables, deliverablesInput.trim()]);
      setDeliverablesInput('');
    }
  };

  const handleRemoveDeliverable = (index: number) => {
    setDeliverables(deliverables.filter((_, idx) => idx !== index));
  };

  const validate = () => {
    const errs: { [key: string]: string } = {};

    if (!title.trim()) {
      errs.title = 'Job title is required.';
    } else if (title.trim().length < 10) {
      errs.title = 'Job title should be at least 10 characters.';
    }

    if (!description.trim()) {
      errs.description = 'Project description is required.';
    } else if (description.trim().length < 40) {
      errs.description = 'Please describe the project in at least 40 characters.';
    }

    if (skills.length === 0) {
      errs.skills = 'Please add at least one required skill.';
    }

    if (projectType === 'fixed') {
      if (!fixedAmount || fixedAmount <= 0) {
        errs.budget = 'Please enter a valid positive fixed budget.';
      }
    } else {
      if (!hourlyMin || !hourlyMax || hourlyMin <= 0 || hourlyMax < hourlyMin) {
        errs.budget = 'Please specify a valid hourly range (max >= min).';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);

    try {
      const payload = {
        title: title.trim(),
        category,
        description: description.trim(),
        deliverables,
        projectType,
        fixedAmount: projectType === 'fixed' ? Number(fixedAmount) : undefined,
        budgetMin: projectType === 'hourly' ? Number(hourlyMin) : Number(fixedAmount),
        budgetMax: projectType === 'hourly' ? Number(hourlyMax) : undefined,
        experienceLevel,
        duration,
        skills,
      };

      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.success && data.job) {
        setPostSource('supabase');
        setSubmittedJobId(data.job.id);
        addJob({
          title: data.job.title,
          category: data.job.category,
          description: data.job.description,
          deliverables: data.job.deliverables,
          projectType: data.job.projectType,
          budget: data.job.budget,
          experienceLevel: data.job.experienceLevel,
          duration: data.job.duration,
          skills: data.job.skills,
          clientName: data.job.client?.name || clientName,
          companyName: data.job.client?.companyName || companyName,
        });
      } else {
        // Fallback to local session if unauthenticated or database table pending
        setPostSource('local');
        const newId = addJob({
          title: title.trim(),
          category,
          description: description.trim(),
          deliverables,
          projectType,
          budget: {
            type: projectType,
            fixedAmount: projectType === 'fixed' ? Number(fixedAmount) : undefined,
            hourlyMin: projectType === 'hourly' ? Number(hourlyMin) : undefined,
            hourlyMax: projectType === 'hourly' ? Number(hourlyMax) : undefined,
          },
          experienceLevel,
          duration,
          skills,
          clientName,
          companyName,
        });
        setSubmittedJobId(newId);
      }
    } catch {
      setPostSource('local');
      const newId = addJob({
        title: title.trim(),
        category,
        description: description.trim(),
        deliverables,
        projectType,
        budget: {
          type: projectType,
          fixedAmount: projectType === 'fixed' ? Number(fixedAmount) : undefined,
          hourlyMin: projectType === 'hourly' ? Number(hourlyMin) : undefined,
          hourlyMax: projectType === 'hourly' ? Number(hourlyMax) : undefined,
        },
        experienceLevel,
        duration,
        skills,
        clientName,
        companyName,
      });
      setSubmittedJobId(newId);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Back button */}
      <div>
        <Link
          href="/client"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-emerald-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Client Dashboard</span>
        </Link>
      </div>

      {submittedJobId ? (
        /* Confirmation State */
        <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-6 shadow-sm">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
              Job Posted Successfully!
            </h1>
            <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
              Your project <strong className="text-slate-800">&ldquo;{title}&rdquo;</strong> is now active {postSource === 'supabase' ? 'in the live PostgreSQL database' : 'in the local demo session'} (Job ID: {submittedJobId}). It has been added to the Browse Jobs directory and your Client Dashboard.
            </p>
          </div>

          {/* Database / Local state demo notice */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 max-w-md mx-auto flex items-start gap-2.5 text-left">
            <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              {postSource === 'supabase' ? (
                <>
                  <strong className="text-emerald-700">Live Database Connected:</strong> This listing has been verified and persisted to Supabase PostgreSQL.
                </>
              ) : (
                <>
                  <strong>Local Session Mode:</strong> Workspace saved this listing to your active session. Sign in with Supabase Auth to persist live listings directly to PostgreSQL.
                </>
              )}
            </span>
          </div>

          {/* Quick Actions */}
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href={`/jobs/${submittedJobId}`}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 shadow-sm"
            >
              <span>View Published Job</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/client"
              className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50"
            >
              Go to Client Dashboard
            </Link>
            <button
              onClick={() => {
                setSubmittedJobId(null);
                setTitle('');
                setDescription('');
              }}
              type="button"
              className="w-full sm:w-auto px-4 py-3 text-xs text-slate-500 hover:text-slate-800"
            >
              Post Another Project
            </button>
          </div>
        </div>
      ) : (
        /* The Form */
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
              Create a Listing
            </span>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              Post a Project on Workspace
            </h1>
            <p className="text-sm text-slate-500">
              Provide thorough details to attract top-tier independent developers and specialists.
            </p>
          </div>

          {/* Card 1: Title and Category */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
              1. Title & Specialization
            </h2>

            <div>
              <label htmlFor="postJobTitleInput" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Job Title <span className="text-rose-500">*</span>
              </label>
              <input
                id="postJobTitleInput"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior Next.js & TypeScript Architect for FinTech Dashboard"
                className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-900 font-medium"
                required
              />
              {errors.title && <p className="text-xs text-rose-600 mt-1">{errors.title}</p>}
              <p className="text-[11px] text-slate-400 mt-1">
                A concise, descriptive title attracts 4x more qualified proposals.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="postJobCategorySelect" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Category <span className="text-rose-500">*</span>
                </label>
                <select
                  id="postJobCategorySelect"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 bg-white text-slate-800 cursor-pointer"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="postJobOrgInput" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Client / Contact Name
                </label>
                <input
                  id="postJobOrgInput"
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Acme Tech Labs"
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 text-slate-900"
                />
              </div>

              <div>
                <label htmlFor="postJobCompanyInput" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Company / Organization Entity
                </label>
                <input
                  id="postJobCompanyInput"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Acme Corporation Inc."
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Card 2: Description & Deliverables */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
              2. Description & Deliverables
            </h2>

            <div>
              <label htmlFor="postJobDescTextarea" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Detailed Scope <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="postJobDescTextarea"
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your product architecture, technical expectations, what problem you are solving, and what success looks like..."
                className="w-full p-3.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-900 resize-y"
                required
              />
              {errors.description && (
                <p className="text-xs text-rose-600 mt-1">{errors.description}</p>
              )}
            </div>

            {/* Expected Deliverables */}
            <div className="space-y-3">
              <label htmlFor="deliverablesInput" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Key Deliverables
              </label>

              <div className="flex gap-2">
                <input
                  id="deliverablesInput"
                  type="text"
                  value={deliverablesInput}
                  onChange={(e) => setDeliverablesInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddDeliverable();
                    }
                  }}
                  placeholder="e.g. Unit tests with 90% coverage"
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                />
                <button
                  type="button"
                  onClick={handleAddDeliverable}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold"
                >
                  Add
                </button>
              </div>

              <div className="space-y-2">
                {deliverables.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700"
                  >
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{item}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveDeliverable(idx)}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Card 3: Required Skills */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
              3. Required Skills & Tech Stack
            </h2>

            <div>
              <label htmlFor="skillsTagInput" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Add Skill Tags (Press Enter or click Add) <span className="text-rose-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="skillsTagInput"
                  type="text"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={handleAddSkill}
                  placeholder="e.g. Docker, GraphQL, Python..."
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                />
                <button
                  type="button"
                  onClick={handleAddSkill}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Skill</span>
                </button>
              </div>
              {errors.skills && <p className="text-xs text-rose-600 mt-1">{errors.skills}</p>}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80"
                >
                  <span>{skill}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skill)}
                    className="hover:text-rose-600 text-emerald-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Card 4: Project Scope & Budget */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
              4. Scope & Compensation
            </h2>

            {/* Project Type */}
            <div className="space-y-3">
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Project Pricing Model <span className="text-rose-500">*</span>
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    projectType === 'fixed'
                      ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-900">Fixed Price</span>
                    <input
                      type="radio"
                      name="projectTypeChoice"
                      checked={projectType === 'fixed'}
                      onChange={() => setProjectType('fixed')}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Set a single fixed budget with milestone approvals.
                  </p>
                </label>

                <label
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    projectType === 'hourly'
                      ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-900">Hourly Rate</span>
                    <input
                      type="radio"
                      name="projectTypeChoice"
                      checked={projectType === 'hourly'}
                      onChange={() => setProjectType('hourly')}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Pay for logged hours with weekly timesheets.
                  </p>
                </label>
              </div>
            </div>

            {/* Budget Inputs */}
            <div>
              {projectType === 'fixed' ? (
                <div>
                  <label htmlFor="fixedBudgetValueInput" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    Fixed Project Budget ($ USD) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative max-w-xs">
                    <span className="absolute left-3 top-2.5 text-slate-400 font-medium text-sm">$</span>
                    <input
                      id="fixedBudgetValueInput"
                      type="number"
                      min="50"
                      step="50"
                      value={fixedAmount}
                      onChange={(e) => setFixedAmount(Number(e.target.value))}
                      className="w-full pl-7 pr-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900 font-semibold"
                      required
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    Hourly Range ($/hr) <span className="text-rose-500">*</span>
                  </span>
                  <div className="flex items-center gap-3 max-w-sm">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-2.5 text-slate-400 text-xs">$</span>
                      <input
                        type="number"
                        min="10"
                        step="5"
                        value={hourlyMin}
                        onChange={(e) => setHourlyMin(Number(e.target.value))}
                        placeholder="Min"
                        className="w-full pl-7 pr-3 py-2 text-xs border border-slate-300 rounded-lg text-slate-900"
                        required
                      />
                    </div>
                    <span className="text-slate-400 text-xs">to</span>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-2.5 text-slate-400 text-xs">$</span>
                      <input
                        type="number"
                        min="10"
                        step="5"
                        value={hourlyMax}
                        onChange={(e) => setHourlyMax(Number(e.target.value))}
                        placeholder="Max"
                        className="w-full pl-7 pr-3 py-2 text-xs border border-slate-300 rounded-lg text-slate-900"
                        required
                      />
                    </div>
                    <span className="text-xs text-slate-500 font-medium">/hr</span>
                  </div>
                </div>
              )}
              {errors.budget && <p className="text-xs text-rose-600 mt-1">{errors.budget}</p>}
            </div>

            {/* Experience Level & Duration Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label htmlFor="experienceLevelChoiceSelect" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Experience Level Required
                </label>
                <select
                  id="experienceLevelChoiceSelect"
                  value={experienceLevel}
                  onChange={(e) => setExperienceLevel(e.target.value as ExperienceLevel)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white text-slate-800"
                >
                  <option value="entry">Entry Level ($)</option>
                  <option value="intermediate">Intermediate ($$)</option>
                  <option value="expert">Expert ($$$)</option>
                </select>
              </div>

              <div>
                <label htmlFor="durationChoiceSelect" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Expected Duration
                </label>
                <select
                  id="durationChoiceSelect"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value as ProjectDuration)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white text-slate-800"
                >
                  <option value="less_than_1_month">Less than 1 month</option>
                  <option value="1_to_3_months">1 to 3 months</option>
                  <option value="3_to_6_months">3 to 6 months</option>
                  <option value="more_than_6_months">More than 6 months</option>
                </select>
              </div>
            </div>
          </div>

          {/* Submit Actions */}
          <div className="pt-2 flex items-center justify-between">
            <Link
              href="/client"
              className="px-5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition-all hover:shadow-lg disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Submitting to API...</span>
                </>
              ) : (
                <>
                  <FileCheck className="w-4 h-4" />
                  <span>Review & Post Job</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
