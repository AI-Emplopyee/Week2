import { currentAiPrompts } from '@/lib/ai-prompts';
import { getKimiStatus } from '@/lib/server-kimi';
import { json, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return route(async () => {
    // Status verifies workspace membership; configuration secrets are never returned.
    const status = await getKimiStatus(request);
    return json({ model: status.model, prompts: currentAiPrompts() });
  });
}
