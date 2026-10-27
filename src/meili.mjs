import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import net from 'node:net';

const TASK_TIMEOUT_MS = 120_000;
const START_TIMEOUT_MS = 30_000;

export class ManagedMeilisearch {
  constructor({ binary, port, engineEnvironment = {} }) {
    this.binary = binary;
    this.port = port;
    this.engineEnvironment = engineEnvironment;
    this.child = null;
    this.dbPath = null;
    this.stderr = '';
    this.spawnError = null;
  }

  async start() {
    if (this.child) throw new Error('managed Meilisearch is already started');
    await assertPortAvailable(this.port);
    this.dbPath = await mkdtemp(path.join(tmpdir(), 'meilisearch-search-eval-'));
    this.spawnError = null;
    const env = { ...process.env };
    delete env.SEARCH_EVAL_DICTIONARY_PATH;
    delete env.SEARCH_EVAL_DISABLE_SECONDARY_SPLIT;
    Object.assign(env, this.engineEnvironment);
    const child = spawn(this.binary, [
      '--http-addr', `127.0.0.1:${this.port}`,
      '--db-path', this.dbPath,
      '--no-analytics',
      '--env', 'development',
    ], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    child.once('error', (error) => { this.spawnError = error; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-32_768);
    });
    await this.#waitUntilReady();
    return new MeiliClient(`http://127.0.0.1:${this.port}`);
  }

  async stop() {
    const child = this.child;
    let stopError = null;
    if (child && !this.spawnError && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      if (!await waitForExit(child, 5_000)) {
        child.kill('SIGKILL');
        if (!await waitForExit(child, 5_000)) stopError = new Error('managed Meilisearch did not stop');
      }
    }
    this.child = null;
    if (this.dbPath) {
      await rm(this.dbPath, { recursive: true, force: true });
      this.dbPath = null;
    }
    if (stopError) throw stopError;
  }

  async #waitUntilReady() {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.spawnError) throw new Error(`failed to start Meilisearch: ${this.spawnError.message}`);
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        throw new Error(`Meilisearch exited before readiness: ${this.stderr}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (response.ok) {
          await delay(50);
          if (this.child.exitCode !== null || this.child.signalCode !== null) {
            throw new Error(`Meilisearch exited during readiness: ${this.stderr}`);
          }
          return;
        }
      } catch {}
      await delay(25);
    }
    throw new Error(`Meilisearch readiness timed out: ${this.stderr}`);
  }
}

export class MeiliClient {
  constructor(baseUrl, fetchImplementation = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/u, '');
    this.fetch = fetchImplementation;
  }

  async createEvaluationIndex(documents, { normalize }) {
    const uid = `eval-${randomUUID()}`;
    await this.#task('/indexes', { method: 'POST', body: { uid, primaryKey: 'key' } });
    await this.#task(`/indexes/${uid}/settings`, {
      method: 'PATCH',
      body: {
        searchableAttributes: ['searchTitle', 'searchPublisherName', 'searchBodyMarkdown'],
        pagination: { maxTotalHits: Math.max(1000, documents.length) },
      },
    });
    await this.#task(`/indexes/${uid}/settings/dictionary`, { method: 'PUT', body: [] });
    if (documents.length > 0) {
      await this.#task(`/indexes/${uid}/documents`, {
        method: 'PUT',
        body: documents.map((document) => indexedDocument(document, normalize)),
      });
    }
    return uid;
  }

  async version() {
    return this.#request('/version');
  }

  async settings(indexUid) {
    return this.#request(`/indexes/${indexUid}/settings`);
  }

  async search(indexUid, query, { normalize }) {
    const q = normalize(query);
    const topStarted = performance.now();
    const topPage = await this.#request(`/indexes/${indexUid}/search`, {
      method: 'POST',
      body: searchBody(q, 20, 1),
    });
    const top20Ms = performance.now() - topStarted;

    const fullStarted = performance.now();
    let page = 1;
    let totalHits = 0;
    const hits = [];
    do {
      const result = await this.#request(`/indexes/${indexUid}/search`, {
        method: 'POST',
        body: searchBody(q, 100, page),
      });
      totalHits = result.totalHits ?? result.hits.length;
      hits.push(...result.hits);
      if (result.hits.length === 0 && hits.length < totalHits) {
        throw new Error('Meilisearch returned an empty page before the exact total was exhausted');
      }
      page += 1;
    } while (hits.length < totalHits);
    const fullMembershipMs = performance.now() - fullStarted;

    return {
      normalizedQuery: q,
      topIds: topPage.hits.map((hit) => hit.id),
      allIds: hits.map((hit) => hit.id),
      totalHits,
      top20Ms,
      fullMembershipMs,
      positions: Object.fromEntries(hits.map((hit) => [hit.id, hitPositions(hit)])),
    };
  }

  async #task(endpoint, { method, body }) {
    const task = await this.#request(endpoint, { method, body });
    const deadline = Date.now() + TASK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await this.#request(`/tasks/${task.taskUid}`);
      if (status.status === 'succeeded') return status;
      if (status.status === 'failed' || status.status === 'canceled') {
        throw new Error(status.error?.message ?? `Meilisearch task ${task.taskUid} ${status.status}`);
      }
      await delay(25);
    }
    throw new Error(`Meilisearch task ${task.taskUid} timed out`);
  }

  async #request(endpoint, { method = 'GET', body } = {}) {
    const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message ?? `Meilisearch request failed with HTTP ${response.status}`);
    }
    return response.json();
  }
}

function searchBody(q, hitsPerPage, page) {
  return {
    q,
    hitsPerPage,
    page,
    attributesToRetrieve: ['id'],
    showMatchesPosition: true,
    matchingStrategy: 'all',
  };
}

function indexedDocument(document, normalize) {
  return {
    key: createHash('sha256').update(document.id).digest('hex'),
    id: document.id,
    searchTitle: normalize(document.title),
    searchPublisherName: normalize(document.publisher.name),
    searchBodyMarkdown: normalize(document.bodyMarkdown),
  };
}

function hitPositions(hit) {
  return Object.entries(hit._matchesPosition ?? {}).flatMap(([field, ranges]) => (
    ranges.map(({ start, length }) => ({ field, start, length }))
  ));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function assertPortAvailable(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', (error) => reject(new Error(`port ${port} is unavailable: ${error.message}`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
