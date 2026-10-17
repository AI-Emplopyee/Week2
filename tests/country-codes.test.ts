import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { COUNTRY_CODE_NAMES, COUNTRY_CODEBOOK_SOURCE, explicitOriginCountryCode, isStandardOriginCountryCode, normalizeDeclarationCodeCandidate, explicitIncotermCode } from '../lib/country-codes.ts';

import type { Candidate } from '../lib/types.ts';

const fact = (overrides: Partial<Candidate> = {}): Candidate => ({ id: 'candidate-test', caseId: 'case-test', documentId: 'document-test', documentVersion: 1, field: 'origin', lineId: 'document-test:v1:p1:ai-row1', value: 'CHINA', originalText: 'Origin: CHINA', page: 1, location: 'Page 1', method: 'kimi:test:source_vision_proposal', confidence: 'high' as const, confidenceScore: 96, readability: 'clear' as const, visualEvidence: { imageSha256: 'a'.repeat(64), bounds: [.1, .1, .3, .1] as [number, number, number, number], textAgreement: false }, normalizations: [], ...overrides });

test('all 249 official country codes and 280 published names resolve without collisions', () => {
  assert.equal(Object.keys(COUNTRY_CODE_NAMES).length, 249);
  assert.equal(Object.values(COUNTRY_CODE_NAMES).flat().length, 280);
  const seen = new Map<string, string>();
  for (const [code, names] of Object.entries(COUNTRY_CODE_NAMES)) {
    assert.equal(explicitOriginCountryCode(code), code);
    assert.equal(isStandardOriginCountryCode(code), true);
    for (const name of names) {
      const key = name.trim().replace(/\s+/g, ' ').toUpperCase();
      assert.ok(!seen.has(key) || seen.get(key) === code);
      seen.set(key, code);
      assert.equal(explicitOriginCountryCode(` ${name.toLowerCase()} `), code);
    }
  }
  assert.equal(createHash('sha256').update(JSON.stringify(COUNTRY_CODE_NAMES)).digest('hex'), COUNTRY_CODEBOOK_SOURCE.entriesSha256);
  assert.equal(explicitOriginCountryCode('China'), 'CN');
  assert.equal(explicitOriginCountryCode('Hong Kong'), 'HK');
  assert.equal(explicitOriginCountryCode('China, Hong Kong Special Administrative Region'), 'HK');
  assert.equal(explicitOriginCountryCode('Macao'), 'MO');
  assert.equal(explicitOriginCountryCode('Taiwan (Province of China)'), 'TW');
  assert.equal(explicitOriginCountryCode('Bouvet Island'), 'BV');
});

test('country mapping does not infer from places, addresses, unknown abbreviations or multiple origins', () => {
  for (const value of ['ZZ', 'XZ', 'EU', 'PRC', 'China / Viet Nam', 'Made in China', 'SHANGHAI CHINA', 'South Korea', 'Unknown', '']) assert.equal(explicitOriginCountryCode(value), undefined);
  for (const field of ['exporterAddress', 'portOfLoading', 'description']) {
    const input = fact({ field }); assert.equal(normalizeDeclarationCodeCandidate(input), input);
  }
  const header = fact({ lineId: undefined }); assert.equal(normalizeDeclarationCodeCandidate(header), header);
  const legacy = fact({ method: 'browser_local_ocr' }); assert.equal(normalizeDeclarationCodeCandidate(legacy), legacy);
});

test('derived origin code preserves source identity, original image quote and model estimate without modifying saved facts', () => {
  const input = fact(); const before = structuredClone(input);
  const mapped = normalizeDeclarationCodeCandidate(input);
  assert.equal(mapped.value, 'CN'); assert.deepEqual(input, before);
  for (const field of ['id', 'documentId', 'documentVersion', 'page', 'lineId', 'originalText', 'confidence', 'confidenceScore', 'readability', 'visualEvidence'] as const) assert.deepEqual(mapped[field], input[field]);
  assert.deepEqual(mapped.normalizations.map(n => [n.before, n.after]), [['CHINA', 'CN']]);
  assert.match(mapped.normalizations[0].reason, /vnaccs-guide:1\.79/);
  assert.match(mapped.normalizations[0].reason, /https:\/\/unlocode\.unece\.org/);
  assert.equal(normalizeDeclarationCodeCandidate({ ...input, confidence: 'low', readability: 'uncertain' }).confidence, 'low');
});

test('explicit dotted HS digits are preserved without padding, classifying goods or repairing malformed codes', () => {
  const input = fact({ field: 'hsCode', value: '8705.10', originalText: 'HS CODE: 8705.10' });
  const mapped = normalizeDeclarationCodeCandidate(input);
  assert.equal(mapped.value, '870510'); assert.equal(input.value, '8705.10');
  assert.equal(mapped.originalText, input.originalText); assert.equal(mapped.id, input.id);
  assert.deepEqual(mapped.normalizations.map(n => [n.before, n.after]), [['8705.10', '870510']]);
  for (const value of ['8705', '870510', '8705.1', '8705..10', '8705.10 / 8705.90', '8705-10', 'HS 8705.10']) {
    const item = fact({ field: 'hsCode', value }); assert.equal(normalizeDeclarationCodeCandidate(item), item);
  }
});

test('a single explicit leading Incoterm is projected from its selected phrase with original evidence intact', () => {
  for (const value of ['CIF LOTUS PORT,VIETNAM AS PER INCOTERMS 2020', 'cif Lotus Port', 'CIF (Lotus Port)', 'CIF CIF Lotus Port']) {
    const input = fact({ field: 'incoterm', lineId: undefined, value, originalText: `Delivery: ${value}` });
    const mapped = normalizeDeclarationCodeCandidate(input);
    assert.equal(mapped.value, 'CIF'); assert.equal(input.value, value);
    assert.equal(mapped.originalText, input.originalText); assert.equal(mapped.confidenceScore, input.confidenceScore);
    assert.deepEqual(mapped.normalizations.map(n => [n.before, n.after]), [[value, 'CIF']]);
    assert.match(mapped.normalizations[0].reason, /vnaccs-guide:1\.44/);
  }
  assert.equal(explicitIncotermCode('fob'), 'FOB');
  for (const value of ['CIF / FOB', 'CIF or FOB Lotus Port', 'CIF / DDU', 'CIF / C&F', 'CIFX Lotus Port', 'CIF2020', 'Port CIF', 'CF Lotus Port', 'Unknown']) {
    assert.equal(explicitIncotermCode(value), undefined);
    const input = fact({ field: 'incoterm', lineId: undefined, value });
    assert.equal(normalizeDeclarationCodeCandidate(input), input);
  }
  for (const overrides of [{ method: 'browser_local_ocr', lineId: undefined }, { lineId: 'some-goods-row' }]) {
    const input = fact({ field: 'incoterm', value: 'CIF Lotus Port', ...overrides });
    assert.equal(normalizeDeclarationCodeCandidate(input), input);
  }
});
