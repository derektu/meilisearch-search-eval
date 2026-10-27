import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { ManagedMeilisearch, MeiliClient, assertPortAvailable } from '../src/meili.mjs';

test('Meili adapter clears API dictionary and exhausts exact membership', async () => {
  const requests = [];
  let nextTask = 1;
  const fetchImplementation = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    requests.push({ pathname, method: init.method ?? 'GET', body });
    if (/^\/tasks\/\d+$/u.test(pathname)) return json({ status: 'succeeded' });
    if (pathname.endsWith('/search')) {
      if (body.hitsPerPage === 20) return json({ totalHits: 101, hits: hits(0, 20) });
      if (body.page === 1) return json({ totalHits: 101, hits: hits(0, 100) });
      return json({ totalHits: 101, hits: hits(100, 101) });
    }
    return json({ taskUid: nextTask += 1 });
  };
  const client = new MeiliClient('http://example.invalid', fetchImplementation);
  const uid = await client.createEvaluationIndex([{
    id: 'doc', title: 'Title', bodyMarkdown: 'Body', publisher: { id: 'p', name: 'Publisher' },
  }], { normalize: (text) => text.toLowerCase() });
  const result = await client.search(uid, 'QUERY', { normalize: (text) => text.toLowerCase() });

  const settings = requests.find((request) => request.pathname.endsWith('/settings') && request.method === 'PATCH');
  assert.deepEqual(settings.body.searchableAttributes,
    ['searchTitle', 'searchPublisherName', 'searchBodyMarkdown']);
  const dictionary = requests.find((request) => request.pathname.endsWith('/settings/dictionary'));
  assert.deepEqual(dictionary.body, []);
  const indexed = requests.find((request) => request.pathname.endsWith('/documents'));
  assert.equal(indexed.body[0].searchTitle, 'title');
  assert.equal(indexed.body[0].searchPublisherName, 'publisher');
  assert.equal(indexed.body[0].searchBodyMarkdown, 'body');
  assert.equal(result.normalizedQuery, 'query');
  assert.equal(result.topIds.length, 20);
  assert.equal(result.allIds.length, 101);
  assert.equal(result.totalHits, 101);
  const searchRequests = requests.filter((request) => request.pathname.endsWith('/search'));
  assert.deepEqual(searchRequests.map((request) => request.body.hitsPerPage), [20, 100, 100]);
  assert(searchRequests.every((request) => request.body.matchingStrategy === 'all'));
  assert(searchRequests.every((request) => request.body.showMatchesPosition === true));
});

test('managed engine refuses an occupied port before spawning', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await assert.rejects(assertPortAvailable(port), /port .* is unavailable/u);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('spawn ENOENT is handled and owned temporary state can be stopped', async () => {
  const port = await availableEphemeralPort();
  const engine = new ManagedMeilisearch({ binary: '/definitely/missing/meilisearch', port });
  await assert.rejects(engine.start(), /failed to start Meilisearch/u);
  await engine.stop();
});

async function availableEphemeralPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function hits(start, end) {
  return Array.from({ length: end - start }, (_, offset) => ({
    id: `doc-${start + offset}`,
    _matchesPosition: { searchBodyMarkdown: [{ start: 0, length: 3 }] },
  }));
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
