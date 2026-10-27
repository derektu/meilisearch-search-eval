#!/usr/bin/env python3
"""Export only whitelisted aggregates/IDs/hashes from local legacy artifacts.

Usage: python3 tools/datasets/export-historical.py /path/to/ticket-artifacts/162
The source artifacts are not public inputs. No snippets, document text, settings,
credentials, logs, or absolute source paths are copied to the public report.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')

def export(source):
    filenames = {
        'stockNormalized': 'coct-comparison/matched-barebone-engine/results.json',
        'embeddedCoct': 'coct-comparison/coct-main-engine/results.json',
        'dictionaryApi': 'coct-comparison/run-2/results.json',
        'externalSecond': 'coct-query-rules/a-original-secondary/results.json',
        'externalNoSecond': 'coct-query-rules/b-no-secondary/results.json',
        'fragmentReference': 'coct-query-rules/fragment-reference-results.json',
    }
    raw = {key: json.loads((source / name).read_text()) for key, name in filenames.items()}

    def query_ids(query):
        item = query.get('candidate', query)
        if 'allIds' in item:
            return item['allIds']
        return [hit['id'] for hit in item['hits']]

    def real_summary(run, ids_fn=query_ids):
        missing = []
        forbidden = []
        pairs = 0
        zero = []
        for query in run['queries']:
            ids = set(ids_fn(query))
            pairs += len(query['expectedIds'])
            missing.extend({'queryId': query['id'], 'documentId': doc} for doc in query['expectedIds'] if doc not in ids)
            forbidden.extend({'queryId': query['id'], 'documentId': doc} for doc in query['forbiddenIds'] if doc in ids)
            if query.get('expectZero') and ids:
                zero.append(query['id'])
        return {'queries': len(run['queries']), 'expectedPairs': pairs, 'expectedHits': pairs - len(missing), 'missingExpected': missing, 'forbiddenPairs': sum(len(q['forbiddenIds']) for q in run['queries']), 'forbiddenFound': forbidden, 'zeroViolationQueryIds': zero}

    def suite_summary(run):
        queries = run.get('suiteResults')
        if queries is None:
            return {'status': 'not-measured-on-this-suite'}
        misses = [{'queryId': q['id'], 'documentId': doc} for q in queries for doc in q['expectedIds'] if doc not in query_ids(q)]
        forbidden = [{'queryId': q['id'], 'documentId': doc} for q in queries for doc in q['forbiddenIds'] if doc in query_ids(q)]
        expected = sum(len(q['expectedIds']) for q in queries)
        failed = sorted({item['queryId'] for item in misses + forbidden})
        return {'status': 'measured', 'queries': len(queries), 'expectedPairs': expected, 'expectedHits': expected - len(misses), 'forbiddenPairs': sum(len(q['forbiddenIds']) for q in queries), 'falsePositivePairs': len(forbidden), 'failedQueryIds': failed, 'missingExpected': misses, 'forbiddenFound': forbidden}

    def runtime(run):
        value = run['runtime']
        return {key: value[key] for key in ['sha256', 'bytes', 'version', 'platform', 'arch'] if key in value}

    def measured(run):
        return {'status': 'historical-measurement', 'runtime': runtime(run), 'real34': real_summary(run), 'zhSemanticsV1': suite_summary(run), 'timing': {'kind': 'local-HTTP-with-snippet-mapping', **run['summary']['timings']}}

    def differences(before, after, before_ids=query_ids, after_ids=query_ids):
        result = []
        for x, y in zip(before, after):
            if x['id'] != y['id']:
                raise ValueError('Query order differs')
            left, right = before_ids(x), after_ids(y)
            if left != right:
                result.append({'queryId': x['id'], 'beforeIdsInRankOrder': left, 'afterIdsInRankOrder': right, 'addedIds': [i for i in right if i not in left], 'removedIds': [i for i in left if i not in right]})
        return result

    b1 = measured(raw['stockNormalized'])
    b2 = measured(raw['externalSecond'])
    b3 = measured(raw['externalNoSecond'])
    c = raw['fragmentReference']
    cs = c['summary']
    b4 = {
        'status': 'historical-in-memory-reference-only',
        'implementation': 'B3 recorded IDs for non-Han queries and primary ordering; independent first-character postings plus contiguous verification for Han-containing queries',
        'fullMeiliEndToEnd': False,
        'real34': real_summary({'queries': c['real']}, lambda q: q['ids']),
        'zhSemanticsV1': {'status': 'measured-in-memory-reference', 'queries': len(c['suite']), 'expectedPairs': sum(len(q['expectedIds']) for q in c['suite']), 'expectedHits': sum(len(set(q['expectedIds']) & set(q['ids'])) for q in c['suite']), 'forbiddenPairs': sum(len(q['forbiddenIds']) for q in c['suite']), 'falsePositivePairs': sum(len(set(q['forbiddenIds']) & set(q['ids'])) for q in c['suite']), 'failedQueryIds': cs['suite']['failedQueries']},
        'stockInteriorLocated': cs['stockInteriorLocated'],
        'rawMappingCheckPasses': sum(check['pass'] for check in cs['mappingChecks']),
        'rawMappingCheckCount': len(cs['mappingChecks']),
        'ranking': [{key: case[key] for key in ['query', 'preferredId', 'overId', 'preferredRank', 'otherRank', 'pass']} for case in cs['ranking']],
        'rankingLimitation': 'Retains B3 order, then appends newly recalled IDs; no general full-word-vs-fragment scoring rule was implemented.',
        'nonHanQueriesInheritedFromB3': sum(q.get('mode') == 'existing-Meili-non-Han' for q in c['real']),
        'timing': {'kind': 'in-memory-reference-function-with-recorded-B3-inputs-NOT-HTTP', 'comparableToB1B2B3': False, **cs['timing']},
    }
    api = raw['dictionaryApi']
    report = {
        'schemaVersion': 1,
        'id': 'historical-2026-10-27',
        'date': '2026-10-27',
        'historicalOnly': True,
        'newRepositoryRerun': False,
        'description': 'Sanitized legacy observations, not results from a run of this repository. No third-party document text is included.',
        'sourceArtifacts': {key: {'relativeLegacyArtifact': name, 'sha256': digest(source / name)} for key, name in filenames.items()},
        'sourceInputHashes': {key: value for key, value in raw['externalSecond']['inputs'].items() if key.endswith('Hash')},
        'originalSyntheticSuiteSha256': digest(source / 'coct-query-rules/suite.json'),
        'baselineDefinitions': {
            'B0': 'Stock Meilisearch, no application text normalization',
            'B1': 'Stock Meilisearch with application text normalization',
            'B2': 'External COCT news main lexicon, application normalization, original secondary segmentation',
            'B3': 'Same external COCT main lexicon, application normalization, secondary segmentation disabled',
            'B4': 'B3 plus independent contiguous fragment reference; historical C was not a full Meili backend',
        },
        'baselines': {'B0': {'status': 'not-measured', 'reason': 'No raw-text stock baseline was run in the legacy experiment; do not fill it from B1.'}, 'B1': b1, 'B2': b2, 'B3': b3, 'B4': b4},
        'diagnostic-full-dictionary-api': {
            'status': 'historical-diagnostic-not-a-B-baseline',
            'dictionaryTerms': api['summary']['dictionaryTerms'],
            'mainLexiconReplacement': False,
            'changedQueryCount': len(api['summary']['changed']),
            'missingExpected': api['summary']['expectedMissing'],
            'timings': api['summary']['timings'],
            'timingKind': 'alternating-paired-local-HTTP-separate-experiment',
            'knownRegression': {'queryId': 'M06', 'expectedDocumentId': 'rss:c3816ccee758da0e', 'beforeTotal': 5, 'afterTotal': 0},
        },
        'idRankDifferences': {
            'B1-to-embedded-COCT-original-secondary': differences(raw['stockNormalized']['queries'], raw['embeddedCoct']['queries']),
            'B2-to-B3': differences(raw['externalSecond']['queries'], raw['externalNoSecond']['queries']),
            'B3-to-B4': differences(raw['externalNoSecond']['queries'], c['real'], after_ids=lambda q: q['ids']),
        },
        'limits': [
            'All supplied cases were development cases used during investigation, not an independent holdout.',
            'The real set has 50 expected pairs, no forbidden pairs, and five expect-zero queries; unlabelled documents are not automatically irrelevant.',
            'Historical B1 was measured on real34 and older fixtures, not on the complete 23-document synthetic suite.',
            'B4 ranking passed one case with both candidates present; it does not establish a general complete-word ranking rule.',
            'B4 reused 26 non-Han queries from B3; mixed-language typo/prefix behavior was not independently evaluated.',
            'B4 accepted cross-COCT-boundary literal fragments in exploratory queries; those queries had no gold.',
            'In-memory B4 timings cannot be compared to HTTP timings or used as production performance claims.',
            'COCT corpus collection period and product redistribution permission were not established.',
        ],
    }
    destination = ROOT / 'reports/historical/2026-10-27.json'
    write(destination, report)
    print(json.dumps({'output': str(destination.relative_to(ROOT)), 'historicalOnly': True, 'B0': 'not-measured'}))

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: export-historical.py /path/to/ticket-artifacts/162')
    export(Path(sys.argv[1]))
