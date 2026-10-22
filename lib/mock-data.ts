import { Job, Freelancer, ProposalSubmission } from './types';

export interface CategoryInfo {
  id: string;
  name: string;
  slug: string;
  icon: string;
  jobCount: number;
  avgHourlyRate: string;
  popularSkills: string[];
}

export const CATEGORIES: CategoryInfo[] = [
  {
    id: 'cat-1',
    name: 'Development & IT',
    slug: 'development-it',
    icon: 'Code2',
    jobCount: 1420,
    avgHourlyRate: '$65 - $130/hr',
    popularSkills: ['React', 'Next.js', 'Node.js', 'TypeScript', 'Python', 'AWS']
  },
  {
    id: 'cat-2',
    name: 'AI & Machine Learning',
    slug: 'ai-ml',
    icon: 'Sparkles',
    jobCount: 780,
    avgHourlyRate: '$85 - $160/hr',
    popularSkills: ['LangChain', 'OpenAI API', 'PyTorch', 'Vector DBs', 'RAG', 'HuggingFace']
  },
  {
    id: 'cat-3',
    name: 'Design & Creative',
    slug: 'design-creative',
    icon: 'Palette',
    jobCount: 940,
    avgHourlyRate: '$50 - $110/hr',
    popularSkills: ['Figma', 'UI/UX Design', 'Design Systems', 'Branding', 'Prototyping']
  },
  {
    id: 'cat-4',
    name: 'Mobile App Development',
    slug: 'mobile-development',
    icon: 'Smartphone',
    jobCount: 610,
    avgHourlyRate: '$60 - $125/hr',
    popularSkills: ['React Native', 'Flutter', 'iOS Swift', 'Android Kotlin', 'GraphQL']
  },
  {
    id: 'cat-5',
    name: 'Cloud & DevOps',
    slug: 'cloud-devops',
    icon: 'Cloud',
    jobCount: 520,
    avgHourlyRate: '$75 - $145/hr',
    popularSkills: ['Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'GCP', 'PostgreSQL']
  },
  {
    id: 'cat-6',
    name: 'Product Management',
    slug: 'product-management',
    icon: 'Briefcase',
    jobCount: 380,
    avgHourlyRate: '$70 - $135/hr',
    popularSkills: ['Scrum', 'User Research', 'Roadmapping', 'Analytics', 'Agile']
  }
];

export const INITIAL_JOBS: Job[] = [
  {
    id: 'job-101',
    title: 'Senior Next.js & TypeScript Architect for FinTech Dashboard',
    category: 'Development & IT',
    description: `We are redesigning our institutional multi-asset wealth management portal. We require a seasoned Next.js App Router specialist who can architect high-performance real-time data visualisations, secure state management, and accessible financial widget components.\n\nYou will collaborate directly with our VP of Product and our backend team to ensure sub-100ms client interactions, zero layout shifts, and bulletproof responsive layouts.`,
    responsibilities: [
      'Refactor existing legacy React dashboard to Next.js 15+ with Turbopack and React Server Components',
      'Integrate streaming data tables using TanStack Table and server-sent events (SSE)',
      'Establish a strict TypeScript domain model with zero `any` types',
      'Optimize bundle size, Web Vitals, and WCAG AA accessibility compliance'
    ],
    deliverables: [
      'Modular financial dashboard components documented in Storybook',
      'End-to-end type-safe API client wrappers',
      'Lighthouse performance audit score >= 95 across all core views'
    ],
    projectType: 'fixed',
    budget: {
      type: 'fixed',
      fixedAmount: 4800
    },
    experienceLevel: 'expert',
    duration: '1_to_3_months',
    skills: ['Next.js', 'TypeScript', 'Tailwind CSS', 'React 19', 'Performance Optimization', 'Financial Tech'],
    client: {
      id: 'cli-01',
      name: 'Vanguard Alpha Labs',
      companyName: 'Alpha Labs Financial LLC',
      location: 'San Francisco, CA, United States',
      rating: 4.95,
      reviewCount: 38,
      totalSpent: 145000,
      paymentVerified: true,
      memberSince: 'March 2021',
      hireRate: 91,
      openJobsCount: 3
    },
    postedAt: '2 hours ago',
    proposalCount: 6,
    isFeatured: true
  },
  {
    id: 'job-102',
    title: 'Design System & Mobile-First UX Redesign for HealthTech Platform',
    category: 'Design & Creative',
    description: `Our patient-doctor telehealth platform connects over 120,000 active users. We need an empathetic, elite UI/UX designer to modernize our patient onboarding, appointment booking flow, and doctor telemedicine consultation room.\n\nThe final deliverable must include an exhaustive Figma design system (tokens, components, variants, accessibility guidelines) ready for seamless developer handoff.`,
    responsibilities: [
      'Audit existing user journeys and identify friction points in patient scheduling',
      'Build a comprehensive, tokenized design system in Figma with auto-layout and variable modes',
      'Conduct 5 moderated usability walkthroughs on interactive prototypes',
      'Deliver developer-ready component specs with iOS/Android/Web responsiveness'
    ],
    deliverables: [
      'Interactive Figma Master file with documented token library',
      'High-fidelity prototypes for 14 primary telehealth user screens',
      'Executive UX research summary with usability recommendations'
    ],
    projectType: 'hourly',
    budget: {
      type: 'hourly',
      hourlyMin: 65,
      hourlyMax: 95
    },
    experienceLevel: 'expert',
    duration: '1_to_3_months',
    skills: ['Figma', 'UI/UX Design', 'Design Systems', 'User Research', 'Mobile UX', 'HealthTech'],
    client: {
      id: 'cli-02',
      name: 'Dr. Marcus Vance',
      companyName: 'Lumina Care Network',
      location: 'Boston, MA, United States',
      rating: 4.88,
      reviewCount: 19,
      totalSpent: 62000,
      paymentVerified: true,
      memberSince: 'October 2022',
      hireRate: 84,
      openJobsCount: 1
    },
    postedAt: '4 hours ago',
    proposalCount: 12,
    isFeatured: true
  },
  {
    id: 'job-103',
    title: 'Full-Stack RAG & Agentic AI Assistant Integration with Vector Search',
    category: 'AI & Machine Learning',
    description: `Seeking an experienced AI Engineer to implement an enterprise Retrieval-Augmented Generation (RAG) pipeline for internal knowledge search across 80,000 corporate documents.\n\nYou will build query routing, chunking strategies, embeddings pipeline with Pinecone/Qdrant, and an interactive chat assistant with source citations.`,
    responsibilities: [
      'Configure chunking and embedding pipeline using LangChain/LlamaIndex',
      'Implement hybrid lexical + dense vector search with re-ranking (Cohere Rerank)',
      'Build guardrails, latency monitoring, and token consumption tracking',
      'Create clean Next.js chat frontend with streamed citations and confidence tags'
    ],
    deliverables: [
      'Tested RAG retrieval service with evaluation benchmarks (>88% precision)',
      'Interactive Next.js chat interface with streaming SSE markdown rendering',
      'Deployment dockerfile and architectural documentation'
    ],
    projectType: 'fixed',
    budget: {
      type: 'fixed',
      fixedAmount: 6200
    },
    experienceLevel: 'expert',
    duration: 'less_than_1_month',
    skills: ['Python', 'OpenAI API', 'LangChain', 'Vector DBs', 'Next.js', 'FastAPI'],
    client: {
      id: 'cli-03',
      name: 'Elena Rostova',
      companyName: 'Kallisto Enterprise Solutions',
      location: 'Zurich, Switzerland',
      rating: 5.0,
      reviewCount: 24,
      totalSpent: 98000,
      paymentVerified: true,
      memberSince: 'January 2020',
      hireRate: 95,
      openJobsCount: 2
    },
    postedAt: '6 hours ago',
    proposalCount: 9,
    isFeatured: true
  },
  {
    id: 'job-104',
    title: 'Cross-Platform React Native App for Real-Time B2B Inventory Management',
    category: 'Mobile App Development',
    description: `We need a high-caliber React Native developer to build a barcode scanning and inventory audit mobile app for iOS and Android tablets. The app must function offline, queue sync mutations, and provide instant barcode feedback.`,
    responsibilities: [
      'Implement high-speed camera barcode scanning using react-native-vision-camera',
      'Setup local offline database (WatermelonDB or SQLite) with two-way sync engine',
      'Optimize rendering for barcode lists containing up to 10,000 SKUs',
      'Integrate Bluetooth hardware barcode reader peripherals'
    ],
    deliverables: [
      'Working iOS TestFlight and Android APK builds with full offline workflow',
      'Automated sync queue handler with conflict resolution logic',
      'Documentation on build pipelines with Fastlane'
    ],
    projectType: 'hourly',
    budget: {
      type: 'hourly',
      hourlyMin: 55,
      hourlyMax: 85
    },
    experienceLevel: 'intermediate',
    duration: '3_to_6_months',
    skills: ['React Native', 'TypeScript', 'Offline Sync', 'iOS', 'Android', 'Redux Toolkit'],
    client: {
      id: 'cli-04',
      name: 'Apex Logistics Inc.',
      companyName: 'Apex Supply Chain Partners',
      location: 'Chicago, IL, United States',
      rating: 4.82,
      reviewCount: 15,
      totalSpent: 41000,
      paymentVerified: true,
      memberSince: 'July 2023',
      hireRate: 80,
      openJobsCount: 1
    },
    postedAt: '1 day ago',
    proposalCount: 14,
    isFeatured: false
  },
  {
    id: 'job-105',
    title: 'Kubernetes Cluster Hardening & Automated GitOps CI/CD Pipeline',
    category: 'Cloud & DevOps',
    description: `We are preparing for SOC2 Type II certification and need a DevOps cloud infrastructure engineer to audit our AWS EKS clusters, migrate manual Helm deployments to ArgoCD GitOps, and configure secret encryption via AWS KMS and External Secrets Operator.`,
    responsibilities: [
      'Audit Kubernetes cluster security posture with Trivy and kube-bench',
      'Migrate deployment workflows to declarative GitOps with ArgoCD',
      'Setup automated blue/green canary rollouts with Argo Rollouts',
      'Refactor Prometheus & Grafana alerting dashboards for production SLA monitoring'
    ],
    deliverables: [
      'SOC2-compliant Terraform and ArgoCD repository manifests',
      'Secret management pipeline using External Secrets Operator',
      'Runbook for disaster recovery and automated cluster rollback'
    ],
    projectType: 'fixed',
    budget: {
      type: 'fixed',
      fixedAmount: 3900
    },
    experienceLevel: 'expert',
    duration: 'less_than_1_month',
    skills: ['Kubernetes', 'AWS', 'Terraform', 'ArgoCD', 'GitOps', 'DevOps'],
    client: {
      id: 'cli-05',
      name: 'CyberShield Systems',
      companyName: 'CyberShield Security Technologies',
      location: 'Austin, TX, United States',
      rating: 4.98,
      reviewCount: 42,
      totalSpent: 185000,
      paymentVerified: true,
      memberSince: 'September 2019',
      hireRate: 93,
      openJobsCount: 4
    },
    postedAt: '1 day ago',
    proposalCount: 7,
    isFeatured: false
  },
  {
    id: 'job-106',
    title: 'Frontend Developer to build Accessible Marketing Website & Blog',
    category: 'Development & IT',
    description: `Looking for a meticulous frontend engineer to build a blazingly fast marketing site and blog using Next.js, Tailwind CSS, and MDX. The site must achieve 100/100 on Google PageSpeed for desktop and mobile, with smooth Framer Motion micro-interactions.`,
    responsibilities: [
      'Implement responsive layouts matching Figma designs with pixel perfection',
      'Setup MDX blog with code syntax highlighting and reading time calculation',
      'Add SEO metadata, OpenGraph cards, and schema.org JSON-LD structured data',
      'Integrate interactive lead capture forms with validation'
    ],
    deliverables: [
      'Clean Next.js codebase with modular components',
      'Full SEO metadata and sitemap generation',
      'Perfect 100 Lighthouse performance and accessibility scores'
    ],
    projectType: 'fixed',
    budget: {
      type: 'fixed',
      fixedAmount: 2200
    },
    experienceLevel: 'intermediate',
    duration: 'less_than_1_month',
    skills: ['React', 'Next.js', 'Tailwind CSS', 'Framer Motion', 'SEO', 'Web Performance'],
    client: {
      id: 'cli-06',
      name: 'Miriam Thorne',
      companyName: 'Aura Studio Media',
      location: 'London, United Kingdom',
      rating: 4.91,
      reviewCount: 11,
      totalSpent: 28500,
      paymentVerified: true,
      memberSince: 'May 2023',
      hireRate: 88,
      openJobsCount: 1
    },
    postedAt: '2 days ago',
    proposalCount: 18,
    isFeatured: false
  },
  {
    id: 'job-107',
    title: 'Junior to Intermediate React Developer for Component Library Migration',
    category: 'Development & IT',
    description: `We are upgrading our internal back-office admin application. We need a capable developer to convert our legacy Bootstrap components into Tailwind CSS components following our new UI tokens. Great opportunity for someone looking to build their track record on Workspace!`,
    responsibilities: [
      'Convert 20 legacy form and table pages to Tailwind CSS',
      'Ensure standard keyboard navigation and form validation',
      'Write clean, readable component tests'
    ],
    deliverables: [
      'Migrated UI views with consistent spacing and color tokens',
      'Component documentation in Markdown'
    ],
    projectType: 'hourly',
    budget: {
      type: 'hourly',
      hourlyMin: 35,
      hourlyMax: 50
    },
    experienceLevel: 'entry',
    duration: '1_to_3_months',
    skills: ['React', 'JavaScript', 'HTML5', 'Tailwind CSS', 'CSS3'],
    client: {
      id: 'cli-07',
      name: 'CloudCommerce Hub',
      companyName: 'CloudCommerce Global LLC',
      location: 'Toronto, Canada',
      rating: 4.75,
      reviewCount: 8,
      totalSpent: 16000,
      paymentVerified: true,
      memberSince: 'November 2023',
      hireRate: 75,
      openJobsCount: 1
    },
    postedAt: '3 days ago',
    proposalCount: 22,
    isFeatured: false
  }
];

export const INITIAL_FREELANCERS: Freelancer[] = [
  {
    id: 'fl-01',
    username: 'alexandra-chen',
    name: 'Alexandra Chen',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
    title: 'Principal Next.js & React Architect | Full-Stack TypeScript',
    tagline: '10+ years scaling high-throughput web applications with sub-second performance.',
    bio: `Hi, I'm Alexandra! I help technology startups and global enterprises architect robust, type-safe Next.js web applications that scale smoothly to millions of active users.\n\nPreviously a Senior Staff Engineer at a Series C fintech company, I specialize in Next.js App Router, React Server Components, high-concurrency state synchronization, and bespoke Design System engineering. I pride myself on clean code, thorough documentation, and proactive communication.`,
    hourlyRate: 115,
    rating: 4.98,
    reviewCount: 47,
    jobSuccessScore: 99,
    badge: 'top_rated_plus',
    location: 'Seattle, WA, United States',
    localTime: '08:45 AM (PST)',
    totalEarnings: '$240k+',
    hoursWorked: 2180,
    completedJobsCount: 52,
    primaryCategory: 'Development & IT',
    skills: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'GraphQL', 'Node.js', 'PostgreSQL', 'Performance Tuning'],
    availability: 'Available now',
    englishLevel: 'Native / Fluent',
    portfolio: [
      {
        id: 'port-1',
        title: 'Institutional Wealth Dashboard',
        description: 'Real-time multi-currency trading portal with sub-50ms canvas charts and live WebSocket quotes.',
        category: 'Web App',
        imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80',
        tags: ['Next.js', 'TypeScript', 'WebSockets', 'Tailwind CSS']
      },
      {
        id: 'port-2',
        title: 'SaaS Design System & Component Library',
        description: 'Comprehensive tokenized UI kit with 85+ WCAG AAA compliant components used across 6 micro-frontends.',
        category: 'Design System',
        imageUrl: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=800&q=80',
        tags: ['React', 'Storybook', 'Figma Tokens', 'Radix UI']
      },
      {
        id: 'port-3',
        title: 'AI Prompt Studio & Model Hub',
        description: 'Interactive IDE for testing, caching, and evaluating LLM chain prompts with automated regression tests.',
        category: 'AI Tooling',
        imageUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=800&q=80',
        tags: ['Next.js App Router', 'Python API', 'Tailwind CSS']
      }
    ],
    experience: [
      {
        id: 'exp-1',
        title: 'Lead Full-Stack Consultant',
        company: 'Veloce Digital Systems',
        period: '2021 - Present',
        description: 'Delivered 18 enterprise Next.js solutions for FinTech and SaaS clients, driving an average 40% improvement in Core Web Vitals.'
      },
      {
        id: 'exp-2',
        title: 'Senior Frontend Engineer',
        company: 'Stripe Ecosystem Partner',
        period: '2018 - 2021',
        description: 'Led checkout integration frontend squad, handling $80M in quarterly gross volume with 99.99% uptime.'
      }
    ],
    education: [
      {
        id: 'edu-1',
        degree: 'B.S. in Computer Science',
        institution: 'University of Washington',
        year: '2017'
      }
    ],
    reviews: [
      {
        id: 'rev-1',
        clientName: 'David K., CTO at MatrixWave',
        rating: 5.0,
        date: 'Oct 2025',
        jobTitle: 'Next.js App Router Architecture Overhaul',
        comment: 'Alexandra is in the top 1% of engineers I have worked with. She finished our milestone two weeks ahead of schedule and our page load speed improved by 65%. Hire her immediately.',
        amountEarned: '$14,500'
      },
      {
        id: 'rev-2',
        clientName: 'Sofia R., VP Engineering',
        rating: 5.0,
        date: 'Aug 2025',
        jobTitle: 'Complex Financial Data Grid & Charting',
        comment: 'Phenomenal attention to detail, proactive communication, and pristine TypeScript code. Will definitely rehire for Phase 2.',
        amountEarned: '$8,200'
      }
    ]
  },
  {
    id: 'fl-02',
    username: 'mateo-silva',
    name: 'Mateo Silva',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
    title: 'Senior Product Designer & Design Systems Lead',
    tagline: 'Translating complex enterprise workflows into intuitive, elegant user interfaces.',
    bio: `Passionate UI/UX and product designer with 8 years of experience building delightful consumer applications and intricate B2B platforms.\n\nI combine deep human-centered research with pixel-perfect craft in Figma. My designs emphasize clarity, typographic rhythm, and seamless developer handoff.`,
    hourlyRate: 85,
    rating: 4.95,
    reviewCount: 36,
    jobSuccessScore: 100,
    badge: 'top_rated_plus',
    location: 'Barcelona, Spain',
    localTime: '05:45 PM (CET)',
    totalEarnings: '$165k+',
    hoursWorked: 1850,
    completedJobsCount: 41,
    primaryCategory: 'Design & Creative',
    skills: ['Figma', 'UI/UX Design', 'Design Systems', 'User Research', 'Prototyping', 'Mobile App Design', 'Wireframing'],
    availability: 'Part-time',
    englishLevel: 'Fluent',
    portfolio: [
      {
        id: 'port-4',
        title: 'HealthHub Telehealth Mobile App',
        description: 'End-to-end iOS & Android patient care app with streamlined booking and in-call prescription management.',
        category: 'Mobile UX',
        imageUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=800&q=80',
        tags: ['Figma', 'iOS', 'Design Tokens']
      },
      {
        id: 'port-5',
        title: 'Nexus Logistics Control Tower',
        description: 'Desktop operational command center visualizing global freight container routes in real time.',
        category: 'Enterprise UI',
        imageUrl: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80',
        tags: ['B2B SaaS', 'Figma', 'Dark Mode']
      }
    ],
    experience: [
      {
        id: 'exp-3',
        title: 'Principal Product Designer',
        company: 'Studio Forma UI',
        period: '2020 - Present',
        description: 'Consulted for 25+ fast-growing SaaS startups, crafting cohesive brand identities and design systems.'
      }
    ],
    education: [
      {
        id: 'edu-2',
        degree: 'Master of Interaction Design',
        institution: 'Elisava Barcelona School of Design',
        year: '2016'
      }
    ],
    reviews: [
      {
        id: 'rev-3',
        clientName: 'Chloe Bennett',
        rating: 5.0,
        date: 'Sep 2025',
        jobTitle: 'SaaS Platform Redesign & Figma Library',
        comment: 'Mateo’s work exceeded all expectations. His design system saved our developers hundreds of hours during implementation.',
        amountEarned: '$11,000'
      }
    ]
  },
  {
    id: 'fl-03',
    username: 'dr-aravind-patel',
    name: 'Dr. Aravind Patel',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
    title: 'Senior AI/ML Engineer | LLM Agents & RAG Specialist',
    tagline: 'Ph.D. in Machine Learning. Building production-grade AI pipelines and multi-agent systems.',
    bio: `I build production-grade Retrieval-Augmented Generation (RAG) workflows, fine-tuned transformer models, and autonomous AI agents for enterprise data synthesis.\n\nMy focus is on reliability, hallucination mitigation, low latency, and secure on-premise or cloud deployments.`,
    hourlyRate: 140,
    rating: 5.0,
    reviewCount: 29,
    jobSuccessScore: 100,
    badge: 'top_rated_plus',
    location: 'Austin, TX, United States',
    localTime: '10:45 AM (CST)',
    totalEarnings: '$190k+',
    hoursWorked: 1400,
    completedJobsCount: 33,
    primaryCategory: 'AI & Machine Learning',
    skills: ['Python', 'LangChain', 'OpenAI API', 'Vector DBs', 'PyTorch', 'RAG Pipelines', 'FastAPI', 'HuggingFace'],
    availability: 'Available now',
    englishLevel: 'Native / Fluent',
    portfolio: [
      {
        id: 'port-6',
        title: 'LegalIQ Document Semantic RAG',
        description: 'Sub-second search across 500k legal contracts with automatic citation attribution and risk analysis.',
        category: 'AI Pipeline',
        imageUrl: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=800&q=80',
        tags: ['Python', 'Pinecone', 'LangChain', 'OpenAI']
      }
    ],
    experience: [
      {
        id: 'exp-4',
        title: 'Staff AI Research Scientist',
        company: 'Cognitive Vector Labs',
        period: '2019 - Present',
        description: 'Led development of specialized biomedical text embedding models and contextual query classifiers.'
      }
    ],
    education: [
      {
        id: 'edu-3',
        degree: 'Ph.D. in Computer Science (Machine Learning)',
        institution: 'University of Texas at Austin',
        year: '2018'
      }
    ],
    reviews: [
      {
        id: 'rev-4',
        clientName: 'Nate Thorne, VP Product',
        rating: 5.0,
        date: 'Sep 2025',
        jobTitle: 'Enterprise RAG Search Engine Deployment',
        comment: 'Aravind solved in 3 weeks what our internal team struggled with for 6 months. Exceptional expertise and crystal clear updates.',
        amountEarned: '$16,800'
      }
    ]
  },
  {
    id: 'fl-04',
    username: 'elena-rostova',
    name: 'Elena Rostova',
    avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80',
    title: 'Senior Cloud & DevOps Engineer | Kubernetes & Terraform',
    tagline: 'Automating zero-downtime deployments, SOC2 compliance, and cloud cost optimization.',
    bio: `DevOps architect with 9+ years helping engineering organizations modernize infrastructure, migrate to AWS/GCP, implement robust GitOps pipelines with ArgoCD, and secure Kubernetes clusters.`,
    hourlyRate: 110,
    rating: 4.92,
    reviewCount: 31,
    jobSuccessScore: 98,
    badge: 'top_rated',
    location: 'Berlin, Germany',
    localTime: '05:45 PM (CET)',
    totalEarnings: '$135k+',
    hoursWorked: 1320,
    completedJobsCount: 28,
    primaryCategory: 'Cloud & DevOps',
    skills: ['Kubernetes', 'Terraform', 'AWS', 'Docker', 'CI/CD', 'ArgoCD', 'Prometheus', 'Security'],
    availability: 'Available now',
    englishLevel: 'Fluent',
    portfolio: [
      {
        id: 'port-7',
        title: 'AWS Multi-Region EKS Architecture',
        description: 'High-availability Kubernetes deployment handling 45,000 requests/sec with automated disaster failover.',
        category: 'Cloud Infrastructure',
        imageUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=800&q=80',
        tags: ['AWS EKS', 'Terraform', 'Datadog']
      }
    ],
    experience: [
      {
        id: 'exp-5',
        title: 'Lead Cloud Infrastructure Consultant',
        company: 'CloudMatrix Europe',
        period: '2020 - Present',
        description: 'Automated infrastructure for 15+ startups, cutting AWS cloud spending by an average of 34%.'
      }
    ],
    education: [
      {
        id: 'edu-4',
        degree: 'B.S. in Software Engineering',
        institution: 'Technical University of Munich',
        year: '2016'
      }
    ],
    reviews: [
      {
        id: 'rev-5',
        clientName: 'Julian Meyer',
        rating: 5.0,
        date: 'Jul 2025',
        jobTitle: 'Kubernetes Hardening & ArgoCD GitOps',
        comment: 'Elena transformed our deployment process from hours of stressful manual steps to completely automated, zero-downtime releases.',
        amountEarned: '$9,500'
      }
    ]
  },
  {
    id: 'fl-05',
    username: 'marcus-reyes',
    name: 'Marcus Reyes',
    avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=400&q=80',
    title: 'Senior React Native & Mobile App Specialist',
    tagline: 'Crafting fluid 60fps mobile experiences for iOS and Android with offline-first architecture.',
    bio: `Mobile engineer with 7 years of specialized React Native and native mobile experience. I build polished mobile apps that feel truly native, with seamless animations, offline databases, and flawless payment & push notification integrations.`,
    hourlyRate: 90,
    rating: 4.89,
    reviewCount: 27,
    jobSuccessScore: 97,
    badge: 'top_rated',
    location: 'Denver, CO, United States',
    localTime: '09:45 AM (MST)',
    totalEarnings: '$110k+',
    hoursWorked: 1250,
    completedJobsCount: 25,
    primaryCategory: 'Mobile App Development',
    skills: ['React Native', 'TypeScript', 'iOS Swift', 'Android Kotlin', 'Redux Toolkit', 'Offline Sync', 'Firebase'],
    availability: 'Available now',
    englishLevel: 'Native / Fluent',
    portfolio: [
      {
        id: 'port-8',
        title: 'FitTrack Pro Cross-Platform Fitness App',
        description: 'Real-time workout tracker with Apple HealthKit & Google Fit integration and interactive analytics.',
        category: 'Mobile App',
        imageUrl: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=800&q=80',
        tags: ['React Native', 'HealthKit', 'Tailwind']
      }
    ],
    experience: [
      {
        id: 'exp-6',
        title: 'Senior Mobile Engineer',
        company: 'Pulse Mobile Labs',
        period: '2021 - Present',
        description: 'Published 12 applications on the Apple App Store and Google Play with a combined 2M+ downloads.'
      }
    ],
    education: [
      {
        id: 'edu-5',
        degree: 'B.S. in Computer Information Systems',
        institution: 'University of Colorado',
        year: '2018'
      }
    ],
    reviews: [
      {
        id: 'rev-6',
        clientName: 'Rachel Adams',
        rating: 5.0,
        date: 'Aug 2025',
        jobTitle: 'React Native Barcode & Inventory App',
        comment: 'Marcus took our complex warehouse requirements and produced an incredibly snappy, reliable mobile app.',
        amountEarned: '$12,400'
      }
    ]
  },
  {
    id: 'fl-06',
    username: 'samantha-wu',
    name: 'Samantha Wu',
    avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=400&q=80',
    title: 'Brand Identity & Visual Designer | Typography & Web Art',
    tagline: 'Memorable brand guidelines, vector logos, and modern typography for bold startups.',
    bio: `Visual designer with a keen eye for minimalist aesthetics, editorial typography, and high-impact digital branding. I have designed identities for over 60 startups across Y Combinator, Techstars, and global venture funds.`,
    hourlyRate: 75,
    rating: 4.96,
    reviewCount: 38,
    jobSuccessScore: 99,
    badge: 'rising_talent',
    location: 'Vancouver, Canada',
    localTime: '08:45 AM (PST)',
    totalEarnings: '$95k+',
    hoursWorked: 980,
    completedJobsCount: 34,
    primaryCategory: 'Design & Creative',
    skills: ['Branding', 'Visual Identity', 'Typography', 'Figma', 'Illustrator', 'Design Systems', 'Packaging'],
    availability: 'Available now',
    englishLevel: 'Native / Fluent',
    portfolio: [
      {
        id: 'port-9',
        title: 'Aura AI Brand Identity & Guidelines',
        description: 'Complete visual identity system including logo design, color palette, typography guidelines, and digital asset kit.',
        category: 'Branding',
        imageUrl: 'https://images.unsplash.com/photo-1600132806370-bf17e65e942f?auto=format&fit=crop&w=800&q=80',
        tags: ['Branding', 'Typography', 'Identity']
      }
    ],
    experience: [
      {
        id: 'exp-7',
        title: 'Senior Visual Brand Consultant',
        company: 'Wu Creative Studio',
        period: '2021 - Present',
        description: 'Crafted brand identities and packaging for high-growth tech and consumer lifestyle products.'
      }
    ],
    education: [
      {
        id: 'edu-6',
        degree: 'Bachelor of Fine Arts (Graphic Design)',
        institution: 'Emily Carr University of Art + Design',
        year: '2019'
      }
    ],
    reviews: [
      {
        id: 'rev-7',
        clientName: 'Gregory Scott',
        rating: 5.0,
        date: 'Sep 2025',
        jobTitle: 'FinTech Brand Identity & Guidelines',
        comment: 'Samantha delivered a truly world-class brand identity. Our investors and customers constantly compliment the design.',
        amountEarned: '$7,500'
      }
    ]
  }
];

export const INITIAL_PROPOSALS: ProposalSubmission[] = [
  {
    id: 'prop-1',
    jobId: 'job-101',
    jobTitle: 'Senior Next.js & TypeScript Architect for FinTech Dashboard',
    bidAmount: 4800,
    rateType: 'fixed',
    coverLetter: 'I have extensive experience building real-time institutional trading interfaces using Next.js 15, Turbopack, and WebSocket streaming.',
    deliveryDays: 21,
    submittedAt: 'Yesterday at 3:15 PM',
    status: 'interviewing'
  },
  {
    id: 'prop-2',
    jobId: 'job-103',
    jobTitle: 'Full-Stack RAG & Agentic AI Assistant Integration with Vector Search',
    bidAmount: 6200,
    rateType: 'fixed',
    coverLetter: 'I have developed multiple enterprise RAG pipelines with Cohere re-ranking and sub-second Pinecone retrieval.',
    deliveryDays: 14,
    submittedAt: '3 days ago',
    status: 'under_review'
  }
];

export const CLIENT_DASHBOARD_DATA = {
  stats: {
    activeJobs: 3,
    totalProposals: 27,
    hiredFreelancers: 5,
    totalSpend: '$42,500'
  },
  recentActivity: [
    {
      id: 'act-1',
      title: 'New proposal received',
      description: 'Alexandra Chen submitted a proposal for Senior Next.js Architect',
      timestamp: '25 minutes ago',
      type: 'proposal'
    },
    {
      id: 'act-2',
      title: 'Milestone 2 Completed',
      description: 'Mateo Silva submitted deliverables for Telehealth Figma Design System',
      timestamp: '4 hours ago',
      type: 'milestone'
    },
    {
      id: 'act-3',
      title: 'Job Published',
      description: 'Full-Stack RAG & Agentic AI Assistant Integration is now live and accepting proposals',
      timestamp: '1 day ago',
      type: 'job'
    }
  ]
};

export const FREELANCER_DASHBOARD_DATA = {
  stats: {
    activeProposals: 4,
    activeInterviews: 2,
    earningsThisMonth: '$8,450',
    jobSuccessScore: '99%'
  },
  profileCompletion: 92,
  profileCompletionTips: [
    'Add an introductory video (adds +5%)',
    'Add one more verified client testimonial (adds +3%)'
  ],
  recentActivity: [
    {
      id: 'fa-1',
      title: 'Interview invitation received',
      description: 'Alpha Labs Financial requested an interview for Senior Next.js Architect',
      timestamp: '1 hour ago'
    },
    {
      id: 'fa-2',
      title: 'Proposal viewed by client',
      description: 'Kallisto Enterprise Solutions viewed your RAG pipeline proposal',
      timestamp: '5 hours ago'
    },
    {
      id: 'fa-3',
      title: 'Payment released',
      description: '$2,800 released for Milestone 1: Design Tokens Delivery',
      timestamp: '2 days ago'
    }
  ]
};
