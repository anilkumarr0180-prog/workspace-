import React from 'react';
import AuthHeader from '@/components/auth/auth-header';
import AuthFooter from '@/components/auth/auth-footer';
import SignupForm from '@/components/auth/signup-form';

export const metadata = {
  title: 'Sign Up to Find Work | Workspace',
  description: 'Create a freelancer account on Workspace to apply to elite projects and build your freelance career.',
};

export default function FreelancerSignupPage() {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50/40">
      <AuthHeader
        rightText="Already have an account?"
        actionText="Log in"
        actionHref="/login"
      />

      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <SignupForm role="freelancer" />
      </main>

      <AuthFooter />
    </div>
  );
}
