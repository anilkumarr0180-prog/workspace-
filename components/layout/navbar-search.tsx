'use client';

import React, { useState, useRef, useEffect, useId } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ChevronDown, Check } from 'lucide-react';

export type SearchCategory = 'Talent' | 'Jobs';

const SEARCH_OPTIONS: { value: SearchCategory; label: string }[] = [
  { value: 'Talent', label: 'Talent' },
  { value: 'Jobs', label: 'Jobs' },
];

interface NavbarSearchProps {
  className?: string;
  onSearchSubmit?: () => void;
  autoFocus?: boolean;
}

export default function NavbarSearch({
  className = '',
  onSearchSubmit,
  autoFocus = false,
}: NavbarSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchCategory>('Talent');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownId = useId();

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Handle global Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleToggleDropdown = () => {
    const nextState = !isOpen;
    if (nextState) {
      const idx = SEARCH_OPTIONS.findIndex((opt) => opt.value === category);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
    setIsOpen(nextState);
  };

  const handleSelectCategory = (selected: SearchCategory) => {
    setCategory(selected);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (category === 'Talent') {
      router.push(trimmed ? `/freelancers?q=${encodeURIComponent(trimmed)}` : '/freelancers');
    } else {
      router.push(trimmed ? `/jobs?q=${encodeURIComponent(trimmed)}` : '/jobs');
    }
    onSearchSubmit?.();
  };

  const handleButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = SEARCH_OPTIONS.findIndex((opt) => opt.value === category);
      setHighlightedIndex(idx >= 0 ? idx : 0);
      setIsOpen(true);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggleDropdown();
    }
  };

  const handleDropdownKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % SEARCH_OPTIONS.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + SEARCH_OPTIONS.length) % SEARCH_OPTIONS.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const chosen = SEARCH_OPTIONS[highlightedIndex]?.value;
      if (chosen) {
        handleSelectCategory(chosen);
      }
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <form
        onSubmit={handleSubmit}
        role="search"
        className="flex items-center h-9 sm:h-[38px] rounded-full border border-slate-200 bg-white hover:border-slate-300 focus-within:border-[#14a800] focus-within:ring-2 focus-within:ring-[#14a800]/20 transition-all duration-150 shadow-2xs"
      >
        {/* Search icon button */}
        <button
          type="submit"
          aria-label={`Search ${category}`}
          className="pl-3.5 pr-2 h-full flex items-center text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer shrink-0"
        >
          <Search className="w-4 h-4 shrink-0" />
        </button>

        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          autoFocus={autoFocus}
          aria-label={`Search ${category}`}
          className="w-full bg-transparent text-[13px] sm:text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none min-w-0"
        />

        {/* Subtle vertical divider between input and category selector */}
        <div className="h-4 w-px bg-slate-200 mx-1 shrink-0" aria-hidden="true" />

        {/* Category selector container with anchored dropdown */}
        <div className="relative h-full flex items-center shrink-0">
          <button
            ref={buttonRef}
            type="button"
            onClick={handleToggleDropdown}
            onKeyDown={handleButtonKeyDown}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={dropdownId}
            aria-label={`Search category, current selection: ${category}`}
            className="flex items-center gap-1.5 pl-2.5 pr-3.5 h-full text-[12px] sm:text-[13px] font-semibold text-slate-700 hover:text-slate-900 rounded-r-full hover:bg-slate-50 transition-colors focus:outline-none cursor-pointer select-none"
          >
            <span>{category}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${
                isOpen ? 'rotate-180 text-slate-700' : ''
              }`}
            />
          </button>

          {/* Dropdown menu anchored directly beneath the selector */}
          {isOpen && (
            <div
              ref={dropdownRef}
              id={dropdownId}
              role="listbox"
              aria-label="Search categories"
              tabIndex={-1}
              onKeyDown={handleDropdownKeyDown}
              className="absolute top-[calc(100%+6px)] right-0 w-36 bg-white rounded-xl border border-slate-200 shadow-xl py-1 z-50 animate-in fade-in-0 zoom-in-95 duration-100"
            >
              {SEARCH_OPTIONS.map((opt, idx) => {
                const isSelected = category === opt.value;
                const isHighlighted = highlightedIndex === idx;

                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectCategory(opt.value)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`w-full flex items-center justify-between px-3.5 py-2 text-left text-xs sm:text-[13px] transition-colors cursor-pointer select-none ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-950 font-semibold'
                        : isHighlighted
                        ? 'bg-slate-50 text-slate-900 font-medium'
                        : 'text-slate-700 hover:bg-slate-50 font-medium'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-[#14a800] shrink-0" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
