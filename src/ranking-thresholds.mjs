/** Probe candidate searches only: hydration scores are not query-relevance evidence. */
export function createRankingProbe(fetchImplementation = fetch) {
  const probe = { threshold: null, enabled: true, records: [] };
  probe.fetch = async (url, init = {}) => {
    if (!new URL(url).pathname.endsWith('/search')) return fetchImplementation(url, init);
    const body = JSON.parse(init.body);
    const hydration = (body.filter ?? []).some((entry) => entry.startsWith('id IN ['));
    if (probe.enabled && !hydration) {
      body.showRankingScore = true;
      body.showRankingScoreDetails = true;
      if (probe.threshold !== null) body.rankingScoreThreshold = probe.threshold;
    }
    const response = await fetchImplementation(url, { ...init, body: JSON.stringify(body) });
    if (response.ok && probe.enabled && !hydration) {
      const result = await response.clone().json();
      probe.records.push({ q: body.q, page: body.page, hits: result.hits.map((hit) => {
        if (!Number.isFinite(hit._rankingScore)) throw new Error('Candidate hit has no ranking score');
        return { id: hit.id, score: hit._rankingScore, details: hit._rankingScoreDetails };
      }) });
    }
    return response;
  };
  return probe;
}

export function summarizeThreshold(dataset, queries, baseline) {
  const summary = {
    returned: 0, expectedFound: 0, expectedTotal: 0, forbiddenReturned: 0,
    zeroViolations: 0, unjudgedReturned: 0, removedExpected: [], removedForbidden: [], removedUnjudged: [],
  };
  for (const query of dataset.queries) {
    const ids = new Set(queries.find((entry) => entry.id === query.id).ids);
    const previous = baseline.find((entry) => entry.id === query.id).ids;
    const expected = new Set(query.expectedIds);
    const forbidden = new Set(query.forbiddenIds);
    summary.returned += ids.size;
    summary.expectedTotal += expected.size;
    summary.expectedFound += [...expected].filter((id) => ids.has(id)).length;
    summary.forbiddenReturned += [...forbidden].filter((id) => ids.has(id)).length;
    summary.zeroViolations += Number(Boolean(query.expectZero) && ids.size > 0);
    summary.unjudgedReturned += [...ids].filter((id) => !expected.has(id) && !forbidden.has(id) && !query.expectZero).length;
    for (const id of previous.filter((id) => !ids.has(id))) {
      const category = expected.has(id) ? 'removedExpected'
        : forbidden.has(id) || query.expectZero ? 'removedForbidden' : 'removedUnjudged';
      summary[category].push({ queryId: query.id, documentId: id });
    }
  }
  summary.ranking = (dataset.rankingCases ?? []).map((entry) => {
    const result = queries.find((query) => entry.queryId ? query.id === entry.queryId : query.query === entry.query);
    const preferred = result?.ids.indexOf(entry.preferredId) ?? -1;
    const other = result?.ids.indexOf(entry.overId) ?? -1;
    return { queryId: result?.id ?? null, preferredId: entry.preferredId, overId: entry.overId,
      preferredRank: preferred < 0 ? null : preferred + 1, otherRank: other < 0 ? null : other + 1,
      evaluable: preferred >= 0 && other >= 0, pass: preferred >= 0 && other >= 0 && preferred < other };
  });
  return summary;
}
