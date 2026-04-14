import { NextRequest, NextResponse } from 'next/server';
import { directNodeLookup } from '@/services/retrieval/directNodeLookup';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const query = typeof body.query === 'string' ? body.query : '';

    if (!query.trim()) {
      return NextResponse.json({
        success: false,
        error: 'Missing required field: query',
      }, { status: 400 });
    }

    const result = await directNodeLookup({
      search: query,
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      context_name: typeof body.context_name === 'string' ? body.context_name : undefined,
      contextId: typeof body.contextId === 'number' ? body.contextId : undefined,
      createdAfter: typeof body.createdAfter === 'string' ? body.createdAfter : undefined,
      createdBefore: typeof body.createdBefore === 'string' ? body.createdBefore : undefined,
      eventAfter: typeof body.eventAfter === 'string' ? body.eventAfter : undefined,
      eventBefore: typeof body.eventBefore === 'string' ? body.eventBefore : undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        count: result.count,
        nodes: result.nodes,
        filters_applied: result.filtersApplied,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run direct node lookup',
    }, { status: 500 });
  }
}
