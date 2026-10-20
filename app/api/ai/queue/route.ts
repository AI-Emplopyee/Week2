import { pendingAiJobs } from '@/lib/server-ai-queue';
import { route } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return route(() => pendingAiJobs(request)); }
