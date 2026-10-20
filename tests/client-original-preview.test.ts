import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openOriginalPdfPreview } from '../lib/client-original-preview.ts';

const bytes = new TextEncoder().encode('%PDF synthetic original');
const source = { id: 'document/one', sha256: createHash('sha256').update(bytes).digest('hex') };
const raster = { width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) };

test('original preview reads verified original bytes and renders pixels without extraction endpoints', async () => {
  const requests: string[] = [];
  let closed = 0;
  const preview = await openOriginalPdfPreview(source, undefined, {
    fetch: async url => { requests.push(url); return new Response(bytes); },
    open: async (original, _signal, options) => {
      assert.deepEqual(new Uint8Array(original), bytes);
      assert.equal(options?.maxPages, 200);
      return { pageCount: 2, render: async () => raster, close: () => { closed++; } };
    },
  });
  assert.deepEqual(requests, ['/api/documents/document%2Fone']);
  assert.deepEqual(await preview.render(2), raster);
  await assert.rejects(() => preview.render(3), /does not exist/);
  preview.close(); preview.close();
  assert.equal(closed, 1);
});

test('changed original bytes fail before a worker opens and an aborted preview never fetches', async () => {
  let opens = 0, fetches = 0;
  const dependencies = {
    fetch: async () => { fetches++; return new Response(bytes); },
    open: async () => { opens++; return { pageCount: 1, render: async () => raster, close() {} }; },
  };
  await assert.rejects(() => openOriginalPdfPreview({ ...source, sha256: '0'.repeat(64) }, undefined, dependencies), /changed/);
  assert.equal(opens, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => openOriginalPdfPreview(source, controller.signal, dependencies), { name: 'AbortError' });
  assert.equal(fetches, 1);
});

test('rapid page switches serialize worker requests and close prevents queued work', async () => {
  const pages: number[] = [];
  let release: (() => void) | undefined;
  const preview = await openOriginalPdfPreview(source, undefined, {
    fetch: async () => new Response(bytes),
    open: async () => ({ pageCount: 3, render: async page => {
      pages.push(page);
      if (page === 1) await new Promise<void>(resolve => { release = resolve; });
      return raster;
    }, close() {} }),
  });
  const first = preview.render(1);
  const second = preview.render(2);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(pages, [1], 'a second page cannot overwrite an active worker reply handler');
  release!();
  await Promise.all([first, second]);
  assert.deepEqual(pages, [1, 2]);
  const third = preview.render(3);
  preview.close();
  await assert.rejects(() => third, /closed/);
  assert.deepEqual(pages, [1, 2]);
});
