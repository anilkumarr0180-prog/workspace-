import { NextRequest, NextResponse } from 'next/server';
import { getJobs, createJob, CreateJobInput } from '@/lib/actions/jobs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const query = searchParams.get('q') || undefined;
    const category = searchParams.get('category') || undefined;
    const projectType = searchParams.get('projectType') || undefined;
    const experienceLevel = searchParams.get('experienceLevel') || undefined;
    const minBudget = searchParams.get('minBudget') ? Number(searchParams.get('minBudget')) : undefined;
    const sortBy = (searchParams.get('sortBy') as 'newest' | 'budget_high' | 'proposals_low') || 'newest';
    const page = searchParams.get('page') ? Number(searchParams.get('page')) : 1;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : 20;

    const result = await getJobs({
      query,
      category,
      projectType,
      experienceLevel,
      minBudget,
      sortBy,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch jobs';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const input: CreateJobInput = {
      title: body.title,
      category: body.category,
      description: body.description,
      responsibilities: body.responsibilities,
      deliverables: body.deliverables,
      projectType: body.projectType,
      budgetMin: body.budgetMin,
      budgetMax: body.budgetMax,
      fixedAmount: body.fixedAmount,
      experienceLevel: body.experienceLevel,
      duration: body.duration,
      skills: body.skills,
      companyId: body.companyId,
    };

    const result = await createJob(input);

    if (!result.success) {
      const status = result.error?.includes('Authentication required') ? 401 : 400;
      return NextResponse.json(
        {
          error: result.error || 'Failed to create job',
          fieldErrors: result.fieldErrors,
        },
        { status }
      );
    }

    return NextResponse.json(
      { success: true, job: result.job },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    return NextResponse.json(
      { error: message },
      { status: 400 }
    );
  }
}
