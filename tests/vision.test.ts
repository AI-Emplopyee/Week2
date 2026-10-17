import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithKimi, groundKimiProposals, KIMI_LIMITS, kimiRequestSchema, parseKimiContent, selectKimiPages } from '../lib/kimi.ts';
import { jpegDimensions, sha256Hex, visionBlobKey, VISION_LIMITS } from '../lib/vision.ts';
import type { AiSourceProposal, ShipmentDocument } from '../lib/types.ts';

// JPEG framing stub for boundary tests; no provider is contacted or pixel accuracy claimed.
const jpeg = (width = 100, height = 200) => Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
const sha = 'a'.repeat(64);
const source: ShipmentDocument = { id: 'doc-test', caseId: 'case-test', name: 'scan.pdf', mime: 'application/pdf', size: 100, sha256: sha, version: 1, active: true, uploadedAt: '', pages: [{ page: 1, text: '', textSource: 'ocr', ocrConfidence: .2 }], extractionStatus: 'needs_transcription', synthetic: true, type: 'invoice' };
const proposal: AiSourceProposal = { field: 'invoiceNumber', value: 'INV-100', quote: 'Invoice No: INV-100', page: 1, confidence: 'medium', evidence: 'vision', bounds: [.1, .1, .3, .05] };
const evidence = { page: 1, imageSha256: sha, width: 100, height: 200 };

test('page rasters enforce byte, frame, dimension, and storage-namespace bounds', async () => {
  assert.deepEqual(jpegDimensions(jpeg()), { width: 100, height: 200 });
  for (const bytes of [new Uint8Array(), jpeg(0, 100), jpeg(2601, 100), jpeg().slice(0, -1), new Uint8Array(VISION_LIMITS.maxImageBytes + 1)]) assert.throws(() => jpegDimensions(bytes));
  const hash = await sha256Hex(jpeg()); assert.match(hash, /^[a-f0-9]{64}$/);
  const key = visionBlobKey('ws-1', source, 1, hash);
  for (const other of [visionBlobKey('ws-2', source, 1, hash), visionBlobKey('ws-1', { ...source, version: 2 }, 1, hash), visionBlobKey('ws-1', { ...source, sha256: 'b'.repeat(64) }, 1, hash), visionBlobKey('ws-1', source, 2, hash)]) assert.notEqual(key, other);
  assert.throws(() => visionBlobKey('../ws', source, 1, hash));
  assert.throws(() => visionBlobKey('ws-1', source, 0, hash));
  assert.throws(() => visionBlobKey('ws-1', source, 1, 'https://foreign.invalid/image'));
});

test('a blank scanned page becomes eligible only when its rendered image is available', () => {
  assert.throws(() => selectKimiPages(source, [1]));
  assert.deepEqual(selectKimiPages(source, [1], [1]), source.pages);
  assert.throws(() => selectKimiPages(source, [2], [2]), /exist/);
  const request = { revision: 0, caseId: source.caseId, documentId: source.id, pages: [1], consent: true, visionPages: [{ page: 1, imageSha256: sha }] };
  assert.equal(kimiRequestSchema.safeParse(request).success, true);
  assert.equal(kimiRequestSchema.safeParse({ ...request, visionPages: [{ page: 1, imageSha256: sha, url: 'https://foreign.invalid' }] }).success, false);
});

test('visual readings require a sent image and region; OCR disagreements remain low confidence and do not rewrite source text', () => {
  const document = { ...source, pages: [{ page: 1, text: 'Invoice No: INV-1OO', textSource: 'ocr' as const, ocrConfidence: .95 }] };
  assert.equal(groundKimiProposals(document, document.pages, [proposal], 'kimi-k2.6').rejected, 1);
  const result = groundKimiProposals(document, document.pages, [proposal, { ...proposal, bounds: undefined }, { ...proposal, evidence: 'text', bounds: undefined }, { ...proposal, page: 2 }, { ...proposal, field: 'hsCode' }], 'kimi-k2.6', [evidence]);
  assert.equal(result.candidates.length, 1); assert.equal(result.rejected, 4);
  const candidate = result.candidates[0];
  assert.equal(candidate.value, 'INV-100'); assert.equal(candidate.confidence, 'low');
  assert.deepEqual(candidate.visualEvidence, { imageSha256: sha, bounds: proposal.bounds, textAgreement: false });
  assert.equal(document.pages[0].text, 'Invoice No: INV-1OO');
  const agreement = { ...document, pages: [{ ...document.pages[0], text: proposal.quote }] };
  assert.equal(groundKimiProposals(agreement, agreement.pages, [proposal], 'kimi-k2.6', [evidence]).candidates[0].confidence, 'medium');
  assert.throws(() => groundKimiProposals(document, document.pages, [{ ...proposal, bounds: [.9, .1, .3, .1] }], 'kimi-k2.6', [evidence]), /invalid/);
});

test('multimodal Kimi request sends inline JPEG with page binding and no local extraction text, never URLs or credentials in model content', async () => {
  const bytes = jpeg(); const imageSha256 = await sha256Hex(bytes); let calls = 0;
  const result = await extractWithKimi({ apiKey: 'private-test-key' }, source, [1], { images: [{ ...evidence, bytes, imageSha256 }], fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://api.moonshot.ai/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'kimi-k2.6'); assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.max_tokens, KIMI_LIMITS.maxOutputTokens); assert.equal(body.temperature, undefined);
    const parts = body.messages[1].content; assert.ok(Array.isArray(parts));
    assert.equal(JSON.parse(parts[0].text).pages[0].text, undefined);
    assert.match(parts[1].text, /Source page 1/); assert.match(parts[2].image_url.url, /^data:image\/jpeg;base64,/);
    assert.ok(!JSON.stringify(body.messages).includes('private-test-key')); assert.ok(!JSON.stringify(body.messages).includes(source.sha256));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [proposal] }) } }] });
  } });
  assert.equal(calls, 1); assert.equal(result.candidates[0].visualEvidence?.imageSha256, imageSha256); assert.equal(result.candidates[0].confidence, 'low');
});

test('named provider crop corners convert to internal rectangles without changing source evidence', async () => {
  const bounds = { left: .125, top: .625, right: .875, bottom: .75 };
  const input = { ...proposal, bounds, confidenceScore: 91.5, readability: 'clear', confidence: 'high' };
  const parsed = parseKimiContent(JSON.stringify({ candidates: [input] }));
  assert.deepEqual(parsed[0], { ...input, bounds: [.125, .625, .75, .125] });
  const result = await extractWithKimi({ apiKey: 'key' }, source, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async (_, init) => {
    const instruction = JSON.parse(String(init?.body)).messages[0].content;
    assert.match(instruction, /Always use named corner coordinates, not an array and not width\/height/);
    assert.match(instruction, /"left":0\.1,"top":0\.6,"right":0\.5,"bottom":0\.7/);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [input] }) } }] });
  } });
  assert.deepEqual(result.proposals, parsed);
  assert.deepEqual(result.candidates[0].visualEvidence, { imageSha256: sha, bounds: [.125, .625, .75, .125], textAgreement: false });
  assert.equal(result.candidates[0].originalText, proposal.quote);
  assert.equal(result.candidates[0].value, proposal.value);
  assert.equal(result.candidates[0].page, proposal.page);
  assert.equal(result.candidates[0].documentId, source.id);
  assert.equal(result.candidates[0].documentVersion, source.version);
  assert.equal(result.candidates[0].confidenceScore, 91.5);
  assert.equal(result.candidates[0].confidence, 'high');
  assert.deepEqual(parseKimiContent(JSON.stringify({ candidates: [{ ...input, bounds: { left: 0, top: 0, right: 1, bottom: 1 } }] }))[0].bounds, [0, 0, 1, 1]);
  assert.deepEqual(parseKimiContent(JSON.stringify({ candidates: [proposal] }))[0].bounds, proposal.bounds, 'Existing xywh tuples retain their exact values.');
});

test('invalid named corners and invalid legacy rectangles are rejected without guessing or clamping', () => {
  const corners = { left: .1, top: .6, right: .5, bottom: .7 };
  const invalidBounds = [
    { ...corners, left: -.01 }, { ...corners, right: 1.01 },
    { ...corners, top: -.01 }, { ...corners, bottom: 1.01 },
    { ...corners, left: corners.right }, { ...corners, left: .6 },
    { ...corners, top: corners.bottom }, { ...corners, top: .8 },
    { ...corners, right: undefined }, { ...corners, bottom: null },
    { ...corners, left: '0.1' }, { ...corners, right: Infinity },
    { ...corners, width: .4 }, [.1, .6, .5, .7],
  ];
  for (const bounds of invalidBounds) {
    assert.throws(() => parseKimiContent(JSON.stringify({ candidates: [{ ...proposal, bounds }] })), /invalid proposal format/);
    assert.throws(() => groundKimiProposals(source, source.pages, [{ ...proposal, bounds } as unknown as AiSourceProposal], 'kimi-k2.6', [evidence]), /invalid proposal format/);
  }
});

test('one schema repair keeps original image messages and saves only the strictly validated result', async () => {
  const bounds = { left: .1, top: .6, right: .5, bottom: .7 };
  const invalid = { ...proposal, bounds: { ...bounds, bottom: 'private-coordinate-text', 'private-extra-key': 'private-extra-value' } };
  const firstContent = JSON.stringify({ candidates: [invalid] });
  let calls = 0; let permissions = 0; let firstMessages: unknown;
  const result = await extractWithKimi({ apiKey: 'private-test-key' }, source, [1], {
    images: [{ ...evidence, bytes: jpeg() }], beforeRepair: async () => { permissions++; return true; },
    fetch: async (url, init) => {
      calls++; assert.equal(url, 'https://api.moonshot.ai/v1/chat/completions');
      assert.equal(init?.redirect, 'manual');
      const body = JSON.parse(String(init?.body));
      if (calls === 1) {
        firstMessages = body.messages;
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: firstContent } }] });
      }
      assert.equal(calls, 2);
      assert.deepEqual(body.messages.slice(0, 2), firstMessages);
      assert.deepEqual(body.messages[2], { role: 'assistant', content: firstContent });
      assert.equal(body.messages[3].role, 'user');
      assert.match(body.messages[3].content, /only format-repair attempt/);
      assert.match(body.messages[3].content, /candidates\.0\.bounds\.bottom:invalid_type/);
      assert.match(body.messages[3].content, /bottom:\[string\]/);
      for (const secret of ['private-coordinate-text', 'private-extra-key', 'private-extra-value', 'private-test-key', proposal.quote]) assert.ok(!body.messages[3].content.includes(secret));
      assert.equal(body.tools, undefined);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [{ ...proposal, bounds }] }) } }] });
    },
  });
  assert.equal(calls, 2); assert.equal(permissions, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].originalText, proposal.quote);
  assert.deepEqual(result.candidates[0].visualEvidence?.bounds, [.1, .6, .4, .7 - .6]);
  assert.match(result.formatRepair!.diagnostic, /left:0\.1,top:0\.6,right:0\.5,bottom:\[string\]/);
  assert.match(result.formatRepair!.diagnostic, /extra_properties/);
  assert.ok(!result.formatRepair!.diagnostic.includes('private-'));
});

test('a second invalid schema stops repair, and denied repair budget prevents its request', async () => {
  for (const permitted of [true, false]) {
    let calls = 0; let permissions = 0;
    await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, source, [1], {
      images: [{ ...evidence, bytes: jpeg() }], beforeRepair: async () => { permissions++; return permitted; },
      fetch: async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [{ ...proposal, bounds: null }] }) } }] }); },
    }), /invalid proposal format/);
    assert.equal(calls, permitted ? 2 : 1);
    assert.equal(permissions, 1);
  }
  let calls = 0;
  await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, source, [1], {
    images: [{ ...evidence, bytes: jpeg() }], fetch: async () => {
      calls++;
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: calls === 1 ? [{ ...proposal, bounds: null }] : [] }) } }] });
    },
  }), /No proposals or completed-page markers were saved/);
  assert.equal(calls, 2);
});

test('exact duplicate facts are idempotent and do not trigger a paid source repair', async () => {
  let calls = 0; let repairChecks = 0;
  const result = await extractWithKimi({ apiKey: 'key' }, source, [1], {
    images: [{ ...evidence, bytes: jpeg() }], beforeRepair: async () => { repairChecks++; return true; },
    fetch: async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [proposal, proposal] }) } }] }); },
  });
  assert.equal(calls, 1); assert.equal(repairChecks, 0);
  assert.equal(result.candidates.length, 1); assert.equal(result.rejected, 0);
  assert.deepEqual(result.rejectionDiagnostics, []);
});

test('source repair corrects literal quote mismatches and preserves previously valid facts omitted by the repair', async () => {
  const mismatched = { ...proposal, field: 'description', rowIndex: 1, value: 'Hydraulic crane', quote: 'Hydraulic-crane' };
  const diagnostic = groundKimiProposals(source, source.pages, [proposal, mismatched], 'kimi-k2.6', [evidence]);
  assert.deepEqual(diagnostic.rejectionDiagnostics, [{ index: 1, page: 1, field: 'description', reasons: ['value_not_in_quote'], whitespaceOnlyValueMismatch: false }]);
  let calls = 0;
  const result = await extractWithKimi({ apiKey: 'key' }, source, [1], {
    images: [{ ...evidence, bytes: jpeg() }], fetch: async (_, init) => {
      calls++;
      if (calls === 2) {
        const feedback = JSON.parse(String(init?.body)).messages.at(-1).content;
        assert.match(feedback, /field=description: value_not_in_quote/);
        assert.ok(!feedback.includes(mismatched.value)); assert.ok(!feedback.includes(mismatched.quote));
      }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: calls === 1 ? [proposal, mismatched] : [{ ...mismatched, value: mismatched.quote }] }) } }] });
    },
  });
  assert.equal(calls, 2); assert.equal(result.rejected, 0);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates.find(candidate => candidate.field === 'invoiceNumber')?.originalText, proposal.quote);
  assert.equal(result.proposals.find(candidate => candidate.field === 'description')?.value, mismatched.quote, 'Only Kimi can correct changed non-whitespace characters; the grounder never rewrites punctuation to pass evidence checks.');
});

test('schema and source failures share one repair budget and unresolved source rejections stay explicit', async () => {
  let calls = 0;
  const unknown = { ...proposal, field: 'private-unknown-field', page: 1 };
  const result = await extractWithKimi({ apiKey: 'key' }, source, [1], {
    images: [{ ...evidence, bytes: jpeg() }], fetch: async () => {
      calls++;
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: calls === 1 ? [{ ...proposal, bounds: null }] : [proposal, unknown] }) } }] });
    },
  });
  assert.equal(calls, 2); assert.equal(result.candidates.length, 1); assert.equal(result.rejected, 1);
  assert.deepEqual(result.rejectionDiagnostics, [{ index: 1, page: 1, field: '[unsupported]', reasons: ['unsupported_field'] }]);
  assert.ok(!JSON.stringify(result.rejectionDiagnostics).includes('private-unknown-field'));
});

test('unsupported models and unselected images are rejected before a paid request', async () => {
  let calls = 0; const fetch = async () => { calls++; throw new Error('Should not send'); };
  const image = { ...evidence, bytes: jpeg() };
  await assert.rejects(() => extractWithKimi({ apiKey: 'key', model: 'text-only-model' }, source, [1], { images: [image], fetch }), /does not support/);
  await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, source, [1], { images: [image, { ...image, page: 2 }], fetch }), /selected/);
  assert.equal(calls, 0);
});


test('entirely rejected model output cannot mark a page processed', async () => {
  await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, source, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [{ ...proposal, field: 'hsCode' }] }) } }] }) }), /None of the AI suggestions passed/);
});

const kimiSource: ShipmentDocument = { ...source, extractionPipeline: 'kimi', extractionStatus: 'pending_ai' };
const clearProposal: AiSourceProposal = { ...proposal, confidence: 'high', readability: 'clear' };
const reading = { page: 1, documentType: 'invoice', readability: 'clear' };
const modelReply = (pageReadings: unknown, candidates: unknown = [clearProposal]) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ pageReadings, candidates }) } }] });

test('Kimi alone can produce a clear visual fact without agreement from old OCR', async () => {
  const document: ShipmentDocument = { ...kimiSource, pages: [{ page: 1, text: 'OLD OCR: INV-1OO', pdfText: 'OLD PDF TEXT', textSource: 'ocr', ocrConfidence: .1 }] };
  const result = await extractWithKimi({ apiKey: 'key' }, document, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async (_, init) => {
    const messages = JSON.stringify(JSON.parse(String(init?.body)).messages);
    assert.ok(!messages.includes('OLD OCR')); assert.ok(!messages.includes('OLD PDF TEXT'));
    return modelReply([reading]);
  } });
  assert.equal(result.candidates[0].confidence, 'high');
  assert.equal(result.candidates[0].readability, 'clear');
  assert.equal(result.candidates[0].visualEvidence?.textAgreement, false);
  assert.deepEqual(result.pageReadings, [reading]);
  assert.equal(document.pages[0].text, 'OLD OCR: INV-1OO');
});

test('new visual pipeline cannot fall back to stored text or accept text evidence for an image request', async () => {
  let calls = 0;
  const document = { ...kimiSource, pages: [{ page: 1, text: proposal.quote }] };
  await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, document, [1], { fetch: async () => { calls++; return modelReply([reading]); } }), /requires an original page image/);
  assert.equal(calls, 0);
  const result = groundKimiProposals(document, document.pages, [{ ...clearProposal, evidence: 'text', bounds: undefined }], 'kimi-k2.6', [evidence]);
  assert.equal(result.candidates.length, 0); assert.equal(result.rejected, 1);
});

test('page readings must cover exactly the selected original pages before processing completes', async () => {
  for (const pageReadings of [undefined, [], [{ ...reading, page: 2 }], [reading, reading]]) {
    await assert.rejects(() => extractWithKimi({ apiKey: 'key' }, kimiSource, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async () => modelReply(pageReadings) }), /invalid proposal|complete reading/);
  }
  const result = await extractWithKimi({ apiKey: 'key' }, kimiSource, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async () => modelReply([{ ...reading, documentType: 'other' }], []) });
  assert.deepEqual(result.candidates, []); assert.deepEqual(result.pages, [1]);
});

test('uncertain pages and ambiguous printed numbers stay uncertain despite model confidence', async () => {
  const result = await extractWithKimi({ apiKey: 'key' }, kimiSource, [1], { images: [{ ...evidence, bytes: jpeg() }], fetch: async () => modelReply([{ ...reading, readability: 'uncertain' }]) });
  assert.equal(result.candidates[0].confidence, 'low'); assert.equal(result.candidates[0].readability, 'uncertain');
  const ambiguous = groundKimiProposals(kimiSource, kimiSource.pages, [
    { ...clearProposal, field: 'invoiceDate', value: '03/04/2026', quote: 'Invoice Date: 03/04/2026' },
    { ...clearProposal, field: 'grossWeight', value: '1,234', quote: 'Gross Weight: 1,234' },
  ], 'kimi-k2.6', [evidence]);
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(ambiguous.candidates[0].confidence, 'low');
  assert.notEqual(ambiguous.candidates[1].confidence, 'high');
});

test('a repair can uniquely correct a literal fact row association without duplicating the goods item', async () => {
  const item = { ...proposal, field: 'description', rowIndex: 1, value: 'CRANE MODEL X-123', quote: 'CRANE MODEL X-123' };
  const badCurrency = { ...proposal, field: 'currency', value: 'USD', quote: 'Currency: usd' };
  let calls = 0;
  const result = await extractWithKimi({ apiKey: 'key' }, source, [1], {
    images: [{ ...evidence, bytes: jpeg() }], fetch: async (_, init) => {
      calls++;
      if (calls === 2) {
        const feedback = JSON.parse(String(init?.body)).messages.at(-1).content;
        assert.match(feedback, /re-read and correct its value and quote together/);
        assert.match(feedback, /then copy value character-for-character from inside that quote/);
        assert.match(feedback, /do not concatenate separated table cells/);
        assert.match(feedback, /omit a rejected item\/component weight that has no allowed semantic field/);
        assert.match(feedback, /remove rowIndex only if the original explicitly states a shipment\/document total/);
        assert.match(feedback, /For a rejected currency row, re-read whether the source explicitly identifies the referenced invoice currency/);
        assert.match(feedback, /do not promote it to invoice currency/);
      }
      const candidates = calls === 1 ? [proposal, item, badCurrency] : [{ ...item, rowIndex: 2 }, { ...badCurrency, value: 'usd' }];
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates }) } }] });
    },
  });
  assert.equal(calls, 2); assert.equal(result.rejected, 0);
  assert.deepEqual(result.proposals.filter(candidate => candidate.field === 'description').map(candidate => candidate.rowIndex), [2]);
  assert.equal(result.candidates.filter(candidate => candidate.field === 'description').length, 1);
  assert.equal(result.candidates.find(candidate => candidate.field === 'invoiceNumber')?.originalText, proposal.quote, 'An unrelated omitted valid fact stays preserved.');
});

test('repair row reassignment preserves different values and indistinguishable repeated source rows', async () => {
  const item = { ...proposal, field: 'description', rowIndex: 1, value: 'CRANE', quote: 'CRANE' };
  const badCurrency = { ...proposal, field: 'currency', value: 'USD', quote: 'Currency: usd' };
  const scenarios = [
    { original: [item], repaired: [{ ...item, rowIndex: 2, value: 'CRANE B', quote: 'CRANE B' }], rows: [1, 2] },
    { original: [item, { ...item, rowIndex: 2 }], repaired: [{ ...item, rowIndex: 2 }], rows: [1, 2] },
    { original: [item, { ...item, rowIndex: 3 }], repaired: [{ ...item, rowIndex: 2 }, { ...item, rowIndex: 3 }], rows: [2, 3] },
    { original: [item], repaired: [{ ...item, rowIndex: 2 }, { ...item, rowIndex: 3 }], rows: [1, 2, 3] },
  ];
  for (const scenario of scenarios) {
    let calls = 0;
    const result = await extractWithKimi({ apiKey: 'key' }, source, [1], {
      images: [{ ...evidence, bytes: jpeg() }], fetch: async () => {
        calls++;
        const candidates = calls === 1 ? [...scenario.original, badCurrency] : [...scenario.repaired, { ...badCurrency, value: 'usd' }];
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates }) } }] });
      },
    });
    assert.equal(calls, 2); assert.equal(result.rejected, 0);
    assert.deepEqual(result.proposals.filter(candidate => candidate.field === 'description').map(candidate => candidate.rowIndex).sort(), scenario.rows);
  }
});

test('whitespace-only value formatting preserves literal evidence and does not trigger a paid repair', async () => {
  const quoted = 'Seller: EXAMPLE\n\tTRADING\u00a0CO., LTD.';
  const input = { ...proposal, field: 'exporter', value: 'EXAMPLE TRADING CO., LTD.', quote: quoted, confidence: 'high' as const, readability: 'clear' as const };
  const before = structuredClone(input);
  let calls = 0; let repairChecks = 0;
  const result = await extractWithKimi({ apiKey: 'key' }, source, [1], {
    images: [{ ...evidence, bytes: jpeg() }], beforeRepair: async () => { repairChecks++; return true; },
    fetch: async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidates: [input] }) } }] }); },
  });
  assert.equal(calls, 1); assert.equal(repairChecks, 0); assert.equal(result.rejected, 0);
  assert.deepEqual(input, before); assert.deepEqual(result.proposals[0], input);
  const fact = result.candidates[0];
  assert.equal(fact.value, input.value); assert.equal(fact.originalText, quoted); assert.equal(fact.confidence, 'high');
  assert.deepEqual(fact.visualEvidence?.bounds, input.bounds);
  assert.ok(fact.normalizations.some(n => n.before === 'EXAMPLE\n\tTRADING\u00a0CO., LTD.' && n.after === input.value && n.reason.includes('whitespace-normalized')));
  for (const separator of ['\n', '\r\n', '\t', '   ', '\u00a0', '\u202f']) {
    const reading = { ...input, value: `EXAMPLE${separator}TRADING CO., LTD.`, quote: 'Seller: EXAMPLE TRADING CO., LTD.' };
    const grounded = groundKimiProposals(source, source.pages, [reading], 'kimi-k2.6', [evidence]);
    assert.equal(grounded.rejected, 0); assert.equal(grounded.candidates[0].value, input.value);
    assert.equal(grounded.candidates[0].originalText, reading.quote);
  }
});

test('whitespace containment never repairs changed letters, punctuation, digits, order or intervening cell content', () => {
  const pairs = [
    ['EXAMPLE CO', 'EXAMPLE & CO'], ['EXAMPLE CO.', 'EXAMPLE CO,'], ['EXAMPLE CO', 'EXAMP1E CO'],
    ['12 34', '12 35'], ['B A', 'A B'], ['A C', 'A\tOTHER CELL\tC'], ['AB', 'A B'],
    ['A B', 'AB'], ['example co', 'EXAMPLE CO'], ['USD 1250', 'USD 1,250'],
  ];
  for (const [value, quote] of pairs) {
    const result = groundKimiProposals(source, source.pages, [{ ...proposal, field: 'exporter', value, quote }], 'kimi-k2.6', [evidence]);
    assert.equal(result.candidates.length, 0); assert.equal(result.rejected, 1);
    assert.ok(result.rejectionDiagnostics?.[0].reasons.includes('value_not_in_quote'));
  }
  const textSource = { ...source, pages: [{ page: 1, text: 'Seller: EXAMPLE\nCO', textSource: 'office' as const }] };
  const literal = { ...proposal, field: 'exporter', value: 'EXAMPLE CO', quote: textSource.pages[0].text, evidence: 'text' as const, bounds: undefined };
  assert.equal(groundKimiProposals(textSource, textSource.pages, [literal], 'kimi-k2.6').rejected, 0);
  const alteredQuote = { ...literal, quote: 'Seller: EXAMPLE CO' };
  assert.ok(groundKimiProposals(textSource, textSource.pages, [alteredQuote], 'kimi-k2.6').rejectionDiagnostics?.[0].reasons.includes('quote_not_in_source'));
});

test('only invoice and contract identifiers and dates ignore model-supplied row indices while retaining them for audit', () => {
  for (const field of ['invoiceNumber', 'invoiceDate', 'contractNumber', 'contractDate']) {
    const values = field.endsWith('Date') ? ['2026-10-12', '2026-10-13'] : ['REF-ONE', 'REF-TWO'];
    const readings = values.map((value, index) => ({ ...proposal, field, value, quote: `${field}: ${value}`, rowIndex: index + 1 }));
    const result = groundKimiProposals(source, source.pages, readings, 'kimi-k2.6', [evidence]);
    assert.equal(result.rejected, 0); assert.equal(result.candidates.length, 2, 'Different source references remain separate candidates for conflict handling.');
    result.candidates.forEach((candidate, index) => {
      assert.equal(candidate.lineId, undefined); assert.equal(candidate.value, values[index]);
      assert.equal(candidate.originalText, readings[index].quote);
      assert.ok(candidate.normalizations.some(n => n.reason.includes(`model-supplied rowIndex ${index + 1}`)));
    });
  }
  for (const field of ['currency', 'grossWeight', 'grossWeightUnit', 'netWeight', 'packageCount', 'importer']) {
    const result = groundKimiProposals(source, source.pages, [{ ...proposal, field, rowIndex: 1 }], 'kimi-k2.6', [evidence]);
    assert.ok(result.rejectionDiagnostics?.[0].reasons.includes('row_scope_mismatch'));
  }
  const goods = groundKimiProposals(source, source.pages, [{ ...proposal, field: 'description', rowIndex: 2 }], 'kimi-k2.6', [evidence]);
  assert.equal(goods.candidates[0].lineId, 'doc-test:v1:p1:ai-row2');
});

test('header row repair needs the relevant explicit label and never promotes an unlabeled goods row', () => {
  const labels = {
    invoiceNumber: ['Invoice No.', 'Invoice #', 'Number and date of invoices', '10. Number, date of Invoices', 'Số hóa đơn', '发票号码'],
    invoiceDate: ['Invoice date', 'Invoice No. and Date', 'Date of invoices', '10. Number, date of Invoices', 'Ngày hóa đơn', '發票日期'],
    contractNumber: ['Contract number', 'Contract #', 'Số hợp đồng', '合同号', '合約編號'],
    contractDate: ['Contract date', 'Ngày ký hợp đồng', '合同日期', '合約簽訂日期'],
  };
  for (const [field, fieldLabels] of Object.entries(labels)) {
    const value = field.endsWith('Date') ? '2026-10-12' : 'REF-001';
    for (const label of fieldLabels) {
      const reading = { ...proposal, field, value, quote: `${label}: ${value}`, rowIndex: 1 };
      const result = groundKimiProposals(source, source.pages, [reading], 'kimi-k2.6', [evidence]);
      assert.equal(result.rejected, 0, label); assert.equal(result.candidates[0].lineId, undefined);
      assert.equal(result.candidates[0].originalText, reading.quote);
    }
    for (const quote of [`${value} | 2 | EA | 10.00 | 20.00`, `COMMERCIAL INVOICE\nGoods ${value} | 2 | EA`, `Delivery note: ${value}`]) {
      const result = groundKimiProposals(source, source.pages, [{ ...proposal, field, value, quote, rowIndex: 1 }], 'kimi-k2.6', [evidence]);
      assert.equal(result.candidates.length, 0); assert.ok(result.rejectionDiagnostics?.[0].reasons.includes('row_scope_mismatch'));
    }
  }
  const commodity = { ...proposal, field: 'invoiceNumber', value: 'Goods A', quote: 'Goods A | 2 | EA | 10.00 | 20.00', rowIndex: 1 };
  assert.equal(groundKimiProposals(source, source.pages, [commodity], 'kimi-k2.6', [evidence]).rejected, 1);
  const wrongLabel = { ...proposal, field: 'invoiceNumber', value: 'REF-001', quote: 'Contract number: REF-001', rowIndex: 1 };
  assert.equal(groundKimiProposals(source, source.pages, [wrongLabel], 'kimi-k2.6', [evidence]).rejected, 1);
});
