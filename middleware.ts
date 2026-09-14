import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireActor, authError } from '@/lib/authz';
import { requireEstimateDb } from '@/lib/estimates-db';

// All API traffic must originate from an authenticated ChatGPT session. Individual
// handlers still apply their organisation and role checks before reading or writing.
export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const id = request.headers.get('oai-authenticated-user-id');
    const email = request.headers.get('oai-authenticated-user-email');
    if (!id || !email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    try {
      const path=request.nextUrl.pathname;
      const read=['GET','HEAD','OPTIONS'].includes(request.method);
      // Financial and record-status endpoints require approval rights even
      // when a legacy handler does not yet have its own fine-grained guard.
      const permission=read?'read':/\/estimates\/rates|\/dockets\/profiles/.test(path)?'admin':/\/commercial|\/estimates\/award|\/dockets$/.test(path)?'approve':'write';
      await requireActor(request,requireEstimateDb(),permission);
    } catch(e) { return authError(e); }
  }
  return NextResponse.next();
}
export const config = { matcher: ['/api/:path*'] };
