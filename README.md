# Workspace — Freelancing Marketplace

A modern, high-performance freelance talent marketplace built with the Next.js App Router, React 19, TypeScript, Tailwind CSS, and Supabase PostgreSQL.

---

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, Turbopack)
- **Frontend**: [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [Lucide React](https://lucide.dev/)
- **Backend / Database**: [Supabase](https://supabase.com/) (PostgreSQL, Row-Level Security, Supabase Auth, `@supabase/ssr`)
- **Language**: TypeScript 5 (Strict Mode)

---

## Getting Started Locally

### 1. Prerequisites

- **Node.js**: `v20.x` or higher recommended (compatible with Node.js 18.18+)
- **Package Manager**: `npm` (v10+), `pnpm`, or `yarn`

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

Open `.env.local` and provide your Supabase credentials:

```bash
# Your Supabase Project URL
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co

# Your Supabase Publishable / Anon Key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key-here
```

> **Note**: Both `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and the alias `NEXT_PUBLIC_SUPABASE_ANON_KEY` are supported. Never commit `.env` or `.env.local` to source control.

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts local Next.js development server with Turbopack |
| `npm run build` | Builds optimized production bundle |
| `npm run start` | Runs the compiled Next.js production server |
| `npm run lint` | Runs ESLint checks |
| `npm run type-check` | Runs TypeScript compiler checks without emitting files (`tsc --noEmit`) |

---

## Production Deployment to Vercel

### Step 1: Push Code to Git Provider

Initialize Git (if not already done) and push to GitHub, GitLab, or Bitbucket:

```bash
git init
git add .
git commit -m "feat: production ready workspace marketplace"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

> **Security Verification**: The `.gitignore` file automatically excludes `.env*`, `.next`, `node_modules`, and OS artifacts. Confirm `.env.local` is not tracked before pushing.

### Step 2: Import Project into Vercel

1. Log in to the [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** &rarr; **Project**.
3. Select your Git repository from the list and click **Import**.

### Step 3: Configure Project Settings

- **Framework Preset**: Next.js (automatically detected)
- **Root Directory**: `./` (default)
- **Build Command**: `next build` (default)
- **Output Directory**: `.next` (default)
- **Install Command**: `npm install` (default)

### Step 4: Configure Environment Variables in Vercel

Before deploying, expand the **Environment Variables** section and configure:

| Variable Name | Environment | Value Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development | Your Supabase project URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview, Development | Your public anon/publishable key from Supabase Dashboard |

*(Optional alias)*: If your Supabase dashboard specifically uses the legacy key name, you may also define `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### Step 5: Deploy

Click **Deploy**. Vercel will build the project and assign a production URL.

---

## Database Migrations (Supabase)

SQL migrations are located in `supabase/migrations/`:

1. `20261022000001_core_taxonomy_and_profiles.sql`
2. `20261022000002_companies_and_jobs.sql`
3. `20261022000003_proposals.sql`
4. `20261022000004_mvp_rls_and_security.sql`
5. `20261022000005_mvp_indexes.sql`
6. `20261022000006_taxonomy_seed.sql`

Run these in chronological order using the Supabase SQL Editor or Supabase CLI (`supabase db push`) against your target Supabase PostgreSQL instance.

---

## License

Private & Proprietary. All rights reserved.
