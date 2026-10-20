import { json, mutate, readJson, requireSameOrigin, response, route, workspace, privateHeaders } from '@/lib/server';
import { parseMutation } from '@/lib/server-validation';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return route(async () => {
  const context = await workspace(request);
  const etag = `"${context.state.id}:${context.state.revision}"`;
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...privateHeaders, ETag: etag } });
  if (new URL(request.url).searchParams.get('revisionOnly') === '1') return json({ id: context.state.id, revision: context.state.revision });
  const result = json(response(context));
  result.headers.set('ETag', etag);
  return result;
}); }
export function POST(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    const context = await workspace(request);
    const { revision, action } = parseMutation(await readJson(request));
    return json(await mutate(context, revision, action));
  });
}
