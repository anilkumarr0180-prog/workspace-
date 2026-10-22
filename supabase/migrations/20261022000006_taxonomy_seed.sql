-- Migration: 20261022000006_taxonomy_seed.sql
-- Description: Idempotent marketplace taxonomy seed data for categories and standardized skills.
--              Does not contain test users or mock authentication references.

-- ============================================================================
-- 1. SEED CATEGORIES
-- ============================================================================
INSERT INTO public.categories (name, slug, icon)
VALUES 
    ('Development & IT', 'development-it', 'Code2'),
    ('AI & Machine Learning', 'ai-ml', 'Sparkles'),
    ('Design & Creative', 'design-creative', 'Palette'),
    ('Mobile App Development', 'mobile-development', 'Smartphone'),
    ('Cloud & DevOps', 'cloud-devops', 'Cloud'),
    ('Product Management', 'product-management', 'Briefcase')
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    icon = EXCLUDED.icon;

-- ============================================================================
-- 2. SEED STANDARDIZED SKILLS
-- ============================================================================
DO $$
DECLARE
    v_cat_dev uuid;
    v_cat_ai uuid;
    v_cat_design uuid;
    v_cat_mobile uuid;
    v_cat_cloud uuid;
    v_cat_pm uuid;
BEGIN
    SELECT id INTO v_cat_dev FROM public.categories WHERE slug = 'development-it';
    SELECT id INTO v_cat_ai FROM public.categories WHERE slug = 'ai-ml';
    SELECT id INTO v_cat_design FROM public.categories WHERE slug = 'design-creative';
    SELECT id INTO v_cat_mobile FROM public.categories WHERE slug = 'mobile-development';
    SELECT id INTO v_cat_cloud FROM public.categories WHERE slug = 'cloud-devops';
    SELECT id INTO v_cat_pm FROM public.categories WHERE slug = 'product-management';

    -- Development & IT Skills
    INSERT INTO public.skills (name, slug, category_id) VALUES
        ('React', 'react', v_cat_dev),
        ('Next.js', 'next-js', v_cat_dev),
        ('Node.js', 'node-js', v_cat_dev),
        ('TypeScript', 'typescript', v_cat_dev),
        ('Python', 'python', v_cat_dev),
        ('AWS', 'aws', v_cat_dev),
        ('Tailwind CSS', 'tailwind-css', v_cat_dev),
        ('React 19', 'react-19', v_cat_dev),
        ('Performance Optimization', 'performance-optimization', v_cat_dev),
        ('Financial Tech', 'financial-tech', v_cat_dev)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category_id = EXCLUDED.category_id;

    -- AI & Machine Learning Skills
    INSERT INTO public.skills (name, slug, category_id) VALUES
        ('LangChain', 'langchain', v_cat_ai),
        ('OpenAI API', 'openai-api', v_cat_ai),
        ('PyTorch', 'pytorch', v_cat_ai),
        ('Vector DBs', 'vector-dbs', v_cat_ai),
        ('RAG', 'rag', v_cat_ai),
        ('HuggingFace', 'huggingface', v_cat_ai),
        ('FastAPI', 'fastapi', v_cat_ai)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category_id = EXCLUDED.category_id;

    -- Design & Creative Skills
    INSERT INTO public.skills (name, slug, category_id) VALUES
        ('Figma', 'figma', v_cat_design),
        ('UI/UX Design', 'ui-ux-design', v_cat_design),
        ('Design Systems', 'design-systems', v_cat_design),
        ('Branding', 'branding', v_cat_design),
        ('Prototyping', 'prototyping', v_cat_design),
        ('User Research', 'user-research', v_cat_design),
        ('Mobile UX', 'mobile-ux', v_cat_design),
        ('HealthTech', 'healthtech', v_cat_design)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category_id = EXCLUDED.category_id;

    -- Mobile App Development Skills
    INSERT INTO public.skills (name, slug, category_id) VALUES
        ('React Native', 'react-native', v_cat_mobile),
        ('Flutter', 'flutter', v_cat_mobile),
        ('iOS Swift', 'ios-swift', v_cat_mobile),
        ('Android Kotlin', 'android-kotlin', v_cat_mobile),
        ('GraphQL', 'graphql', v_cat_mobile)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category_id = EXCLUDED.category_id;

    -- Cloud & DevOps Skills
    INSERT INTO public.skills (name, slug, category_id) VALUES
        ('Kubernetes', 'kubernetes', v_cat_cloud),
        ('Docker', 'docker', v_cat_cloud),
        ('Terraform', 'terraform', v_cat_cloud),
        ('CI/CD', 'ci-cd', v_cat_cloud),
        ('GCP', 'gcp', v_cat_cloud),
        ('PostgreSQL', 'postgresql', v_cat_cloud)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category_id = EXCLUDED.category_id;

    -- Product Management Skills
    INSERT INTO public.skills (name, slug, category_id) VALUES
        ('Scrum', 'scrum', v_cat_pm),
        ('Roadmapping', 'roadmapping', v_cat_pm),
        ('Analytics', 'analytics', v_cat_pm),
        ('Agile', 'agile', v_cat_pm)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category_id = EXCLUDED.category_id;

END $$;
