import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { SampleReviewAssetIndex } from './sample-review-types.ts';

const BASE = '/api/local-sample-review';
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
};
type LocalSampleResponse = { status: number; headers: Record<string,string>; body: Buffer };
const message = (status: number, error: string): LocalSampleResponse => ({ status, headers: { ...headers, 'Content-Type':'application/json; charset=utf-8' }, body:Buffer.from(JSON.stringify({error})) });
const types: Record<string,string> = {
  '.pdf':'application/pdf', '.xls':'application/vnd.ms-excel',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc':'application/msword', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.tif':'image/tiff', '.tiff':'image/tiff', '.bmp':'image/bmp',
};

/** Called only after the existing local socket, host and origin gate.
 * This reader has no workspace mutation or AI/provider path. */
export async function localSampleResponse(root: string, method: string, pathname: string): Promise<LocalSampleResponse | null> {
  if (pathname !== BASE && !pathname.startsWith(BASE+'/')) return null;
  if (!['GET','HEAD'].includes(method)) return { ...message(405,'Sample results are read-only.'), headers:{ ...headers, Allow:'GET, HEAD', 'Content-Type':'application/json; charset=utf-8' } };
  const directory = path.join(root,'.aicd-local/sample-review');
  try {
    if (pathname === BASE) {
      const file = path.join(directory,'data.json');
      if ((await stat(file)).size > 64*1024*1024) return message(503,'Sample data exceeds the local limit.');
      const body=await readFile(file);
      return { status:200, headers:{ ...headers, 'Content-Type':'application/json; charset=utf-8', 'Content-Length':String(body.length) }, body:method==='HEAD'?Buffer.alloc(0):body };
    }
    const match = /^\/api\/local-sample-review\/assets\/((?:source|employee_answer)-[a-f0-9]{64})$/.exec(pathname);
    if (!match) return message(404,'Sample file not found.');
    const index=JSON.parse(await readFile(path.join(directory,'asset-index.json'),'utf8')) as SampleReviewAssetIndex;
    const asset=index.assets[match[1]];
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256)) return message(404,'Sample file not found.');
    const allowed=await realpath(path.join(directory,'originals'));
    const filename=await realpath(asset.path);
    const extension=path.extname(filename).toLowerCase();
    if (!filename.startsWith(allowed+path.sep) || !types[extension]) return message(404,'Sample file not found.');
    const info=await stat(filename);
    if (!info.isFile() || info.size!==asset.size || info.size>64*1024*1024) return message(409,'The original sample file has changed.');
    const body=await readFile(filename);
    if (createHash('sha256').update(body).digest('hex')!==asset.sha256) return message(409,'The original sample file has changed.');
    const disposition=['.pdf','.png','.jpg','.jpeg','.webp'].includes(extension)?'inline':'attachment';
    const safeName=path.basename(asset.name).replace(/[\r\n"\\]/g,'_');
    return { status:200, headers:{ ...headers, 'Content-Type':types[extension], 'Content-Length':String(body.length),
      'Content-Disposition':`${disposition}; filename="original${extension}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      'Content-Security-Policy':"sandbox; default-src 'none'" }, body:method==='HEAD'?Buffer.alloc(0):body };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code==='ENOENT') return message(404,'Sample results are not available on this Mac.');
    return message(503,'The local sample results could not be read.');
  }
}
