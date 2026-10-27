import { readFile } from 'node:fs/promises';

export async function loadDataset(datasetPath) {
  return validateDataset(JSON.parse(await readFile(datasetPath, 'utf8')));
}

export function validateDataset(dataset) {
  if (!dataset || dataset.schemaVersion !== 1) throw new Error('dataset.schemaVersion must be 1');
  requireString(dataset.id, 'dataset.id');
  if (!Array.isArray(dataset.documents) || !Array.isArray(dataset.queries)) {
    throw new Error('dataset.documents and dataset.queries must be arrays');
  }
  const documentIds = new Set();
  for (const [index, document] of dataset.documents.entries()) {
    requireString(document?.id, `documents[${index}].id`);
    requireString(document?.title, `documents[${index}].title`);
    requireString(document?.bodyMarkdown, `documents[${index}].bodyMarkdown`);
    requireString(document?.publisher?.id, `documents[${index}].publisher.id`);
    requireString(document?.publisher?.name, `documents[${index}].publisher.name`);
    if (documentIds.has(document.id)) throw new Error(`duplicate document id: ${document.id}`);
    documentIds.add(document.id);
  }
  const queryIds = new Set();
  for (const [index, query] of dataset.queries.entries()) {
    validateQuery(query, `queries[${index}]`);
    if (queryIds.has(query.id)) throw new Error(`duplicate query id: ${query.id}`);
    queryIds.add(query.id);
  }
  for (const [index, query] of (dataset.exploratoryQueries ?? []).entries()) {
    if (typeof query === 'string') requireString(query, `exploratoryQueries[${index}]`);
    else validateQuery({ expectedIds: [], forbiddenIds: [], ...query }, `exploratoryQueries[${index}]`);
  }
  return dataset;
}

function validateQuery(query, label) {
  requireString(query?.id, `${label}.id`);
  requireString(query?.query, `${label}.query`, true);
  for (const field of ['expectedIds', 'forbiddenIds']) {
    if (!Array.isArray(query[field]) || query[field].some((id) => typeof id !== 'string')) {
      throw new Error(`${label}.${field} must be an array of strings`);
    }
  }
  if (query.expectZero !== undefined && typeof query.expectZero !== 'boolean') {
    throw new Error(`${label}.expectZero must be boolean`);
  }
}

function requireString(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
}

export function exploratoryQueries(dataset) {
  return (dataset.exploratoryQueries ?? []).map((entry, index) => (
    typeof entry === 'string'
      ? { id: `exploratory-${index + 1}`, query: entry, expectedIds: [], forbiddenIds: [], exploratory: true }
      : { expectedIds: [], forbiddenIds: [], ...entry, exploratory: true }
  ));
}
