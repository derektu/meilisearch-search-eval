import test from 'node:test';
import assert from 'node:assert/strict';
import { createRankingProbe, summarizeThreshold } from '../src/ranking-thresholds.mjs';

test('threshold applies to every candidate page but never to hydration; hydration scores are ignored', async () => {
  const requests = [];
  const probe = createRankingProbe(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ hits: [{ id: 'doc', _rankingScore: 0.8 }] });
  });
  probe.threshold = 0.6;
  for (const body of [{ q: 'query', page: 1 }, { q: 'query', page: 2 }, { q: '', filter: ['id IN ["doc"]'] }]) {
    await probe.fetch('http://example.invalid/indexes/documents_v3/search', { method: 'POST', body: JSON.stringify(body) });
  }
  assert.deepEqual(requests.map((body) => body.rankingScoreThreshold), [0.6, 0.6, undefined]);
  assert.equal(probe.records.length, 2);
  assert.equal(probe.records[0].hits[0].score, 0.8);
  probe.enabled = false;
  await probe.fetch('http://example.invalid/indexes/documents_v3/search', { method: 'POST', body: JSON.stringify({ q: 'query' }) });
  assert.equal(requests.at(-1).showRankingScore, undefined);
});

test('removed unknown results are not counted as false positives; lost positives remain visible', () => {
  const dataset = { queries: [{ id: 'q', expectedIds: ['yes'], forbiddenIds: ['no'] }] };
  const summary = summarizeThreshold(dataset, [{ id: 'q', ids: [] }], [{ id: 'q', ids: ['yes', 'no', 'unknown'] }]);
  assert.equal(summary.expectedFound, 0);
  assert.equal(summary.expectedTotal, 1);
  assert.equal(summary.zeroViolations, 0);
  assert.deepEqual(summary.removedExpected, [{ queryId: 'q', documentId: 'yes' }]);
  assert.deepEqual(summary.removedForbidden, [{ queryId: 'q', documentId: 'no' }]);
  assert.deepEqual(summary.removedUnjudged, [{ queryId: 'q', documentId: 'unknown' }]);
});

test('membership preserved by fallback can still fail the full-word-first ranking case', () => {
  const dataset = { queries: [{ id: 'q', query: '導體', expectedIds: ['word', 'fragment'], forbiddenIds: [] }],
    rankingCases: [{ query: '導體', preferredId: 'word', overId: 'fragment' }] };
  const summary = summarizeThreshold(dataset, [{ id: 'q', query: '導體', ids: ['fragment', 'word'] }],
    [{ id: 'q', query: '導體', ids: ['word', 'fragment'] }]);
  assert.equal(summary.expectedFound, 2);
  assert.equal(summary.ranking[0].evaluable, true);
  assert.equal(summary.ranking[0].pass, false);
  assert.equal(summary.ranking[0].preferredRank, 2);
});

test('missing scores fail measurement instead of silently becoming zero', async () => {
  const probe = createRankingProbe(async () => Response.json({ hits: [{ id: 'unscored' }] }));
  await assert.rejects(probe.fetch('http://example.invalid/indexes/documents_v3/search', {
    method: 'POST', body: JSON.stringify({ q: 'query' }),
  }), /no ranking score/u);
});
