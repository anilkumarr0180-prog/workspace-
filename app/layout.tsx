import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Suspense } from 'react';
import { MarketplaceProvider } from '@/lib/context/marketplace-context';
import Navbar from '@/components/layout/navbar';
import Footer from '@/components/layout/footer';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Workspace — The Modern Freelance & Talent Marketplace',
  description:
    'Workspace connects ambitious organizations with elite independent developers, AI engineers, and UI/UX designers.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-slate-50/50 text-slate-900 font-sans selection:bg-emerald-100 selection:text-emerald-900" suppressHydrationWarning>
        <MarketplaceProvider>
          <Suspense fallback={<header className="h-16 border-b border-slate-200 bg-white" />}>
            <Navbar />
          </Suspense>
          <main className="flex-1">{children}</main>
          <Footer />
        </MarketplaceProvider>
      </body>
    </html>
  );
}
