export function evaluateResults(dataset, queryResults) {
  const byId = new Map(queryResults.map((result) => [result.id, result]));
  let expectedTotal = 0;
  let expectedFound = 0;
  const missingExpected = [];
  const negativeViolations = [];
  const expectZeroViolations = [];
  let unjudgedResultCount = 0;

  for (const query of dataset.queries) {
    const result = byId.get(query.id);
    if (!result) throw new Error(`missing result for query ${query.id}`);
    const ids = new Set(result.allIds);
    for (const id of query.expectedIds) {
      expectedTotal += 1;
      if (ids.has(id)) expectedFound += 1;
      else missingExpected.push({ queryId: query.id, documentId: id });
    }
    for (const id of query.forbiddenIds) {
      if (ids.has(id)) negativeViolations.push({ queryId: query.id, documentId: id });
    }
    if (query.expectZero && result.allIds.length > 0) {
      expectZeroViolations.push({ queryId: query.id, returnedIds: result.allIds });
    }
    const judged = new Set([...query.expectedIds, ...query.forbiddenIds]);
    unjudgedResultCount += result.allIds.filter((id) => !judged.has(id)).length;
  }

  const ranking = (dataset.rankingCases ?? []).map((rankingCase, index) => {
    const result = rankingResult(rankingCase, dataset, byId);
    const preferredRank = result?.allIds.indexOf(rankingCase.preferredId) ?? -1;
    const otherRank = result?.allIds.indexOf(rankingCase.overId) ?? -1;
    return {
      id: rankingCase.id ?? `ranking-${index + 1}`,
      queryId: result?.id ?? null,
      preferredId: rankingCase.preferredId,
      overId: rankingCase.overId,
      preferredRank,
      otherRank,
      pass: preferredRank >= 0 && otherRank >= 0 && preferredRank < otherRank,
    };
  });

  const top20Timings = queryResults.flatMap((result) => result.passes.map((pass) => pass.top20Ms));
  const fullTimings = queryResults.flatMap((result) => result.passes.map((pass) => pass.fullMembershipMs));
  const firstTop20Timings = queryResults.map((result) => result.first.top20Ms);
  const firstFullTimings = queryResults.map((result) => result.first.fullMembershipMs);
  const referenceTimings = queryResults.flatMap((result) => (
    result.passes.flatMap((pass) => pass.referenceMs === undefined ? [] : [pass.referenceMs])
  ));
  return {
    judgedRecall: {
      found: expectedFound,
      total: expectedTotal,
      value: expectedTotal === 0 ? null : expectedFound / expectedTotal,
    },
    missingExpected,
    negativeViolations,
    expectZeroViolations,
    ranking,
    unjudgedResultCount,
    unjudgedResultMeaning: 'Unjudged results are not classified as relevant or irrelevant.',
    timing: {
      firstMeiliTop20: timingSummary(firstTop20Timings),
      firstMeiliFullMembership: timingSummary(firstFullTimings),
      warmMeiliTop20: timingSummary(top20Timings),
      warmMeiliFullMembership: timingSummary(fullTimings),
      ...(referenceTimings.length > 0 ? {
        inMemoryFragmentReference: {
          ...timingSummary(referenceTimings),
          meaning: 'Reference post-processing only; not production or end-to-end latency.',
        },
      } : {}),
    },
  };
}

export function timingSummary(values) {
  if (values.length === 0) return { count: 0, p50Ms: null, p95Ms: null };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50Ms: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)],
  };
}

function rankingResult(rankingCase, dataset, byId) {
  if (rankingCase.queryId) return byId.get(rankingCase.queryId);
  if (rankingCase.query) {
    const query = dataset.queries.find((entry) => entry.query === rankingCase.query);
    return query ? byId.get(query.id) : undefined;
  }
  throw new Error('ranking case must provide queryId or query');
}
