import { performance } from 'node:perf_hooks';
import { normalizeSearchText, normalizeSearchTextWithMap } from './normalize.mjs';
import { tokenizeTexts } from './tokenizer.mjs';

export async function prepareQueryGroups(queries, { tokenizer, dictionary }) {
  const parsed = new Map(queries.map((query) => [query.id, queryChunks(query.query)]));
  const texts = [...new Set([...parsed.values()].flatMap((chunks) => (
    chunks.filter((chunk) => !chunk.quoted).map((chunk) => chunk.text)
  )))];
  const tokenArrays = await tokenizeTexts(tokenizer, dictionary, texts);
  const tokensByText = new Map(texts.map((text, index) => [text, tokenArrays[index]]));
  return new Map(queries.map((query) => [
    query.id,
    groupsForChunks(parsed.get(query.id), tokensByText),
  ]));
}

export function groupsForChunks(chunks, tokensByText) {
  const result = [];
  for (const chunk of chunks) {
    if (chunk.quoted) {
      if (chunk.text) result.push(chunk.text);
      continue;
    }
    let singletons = '';
    let previousEnd = null;
    const flush = () => {
      if (singletons) result.push(singletons);
      singletons = '';
      previousEnd = null;
    };
    for (const token of tokensByText.get(chunk.text) ?? []) {
      const adjacent = previousEnd === null || previousEnd === token.startByte;
      if (/^\p{Script=Han}$/u.test(token.word) && adjacent) {
        singletons += token.word;
        previousEnd = token.endByte;
        continue;
      }
      flush();
      if (/^\p{Script=Han}$/u.test(token.word)) {
        singletons = token.word;
        previousEnd = token.endByte;
      } else if (/^[\p{L}\p{N}]+$/u.test(token.word)) {
        result.push(token.word);
      }
    }
    flush();
  }
  return [...new Set(result)];
}

export function queryChunks(rawQuery) {
  const query = normalizeSearchText(rawQuery);
  return [...query.matchAll(/"([^"]*)"|([^"\s]+)/gu)]
    .map((match) => ({ text: match[1] ?? match[2], quoted: match[1] !== undefined }))
    .filter((chunk) => chunk.text.length > 0);
}

export function buildFragmentIndex(documents) {
  const started = performance.now();
  const fields = [];
  const postings = new Map();
  const documentOrder = new Map(documents.map((document, index) => [document.id, index]));
  for (const document of documents) {
    const values = [
      ['searchTitle', document.title],
      ['searchPublisherName', document.publisher.name],
      ['searchBodyMarkdown', document.bodyMarkdown],
    ];
    for (const [field, raw] of values) {
      const projection = normalizeSearchTextWithMap(raw);
      const fieldIndex = fields.length;
      fields.push({ id: document.id, field, projection });
      let utf16Start = 0;
      for (const character of projection.text) {
        const occurrences = postings.get(character) ?? [];
        occurrences.push({ fieldIndex, utf16Start });
        postings.set(character, occurrences);
        utf16Start += character.length;
      }
    }
  }

  function find(term) {
    const matches = new Map();
    const first = [...term][0];
    if (!first) return matches;
    for (const occurrence of postings.get(first) ?? []) {
      const field = fields[occurrence.fieldIndex];
      if (!field.projection.text.startsWith(term, occurrence.utf16Start)) continue;
      const startByte = Buffer.byteLength(field.projection.text.slice(0, occurrence.utf16Start));
      const lengthByte = Buffer.byteLength(term);
      const rawRange = field.projection.rawRange(startByte, lengthByte);
      if (!rawRange) throw new Error('fragment match could not be mapped to the original field');
      const positions = matches.get(field.id) ?? [];
      positions.push({
        field: field.field,
        startByte,
        lengthByte,
        rawStart: rawRange.start,
        rawEnd: rawRange.end,
      });
      matches.set(field.id, positions);
    }
    return matches;
  }

  return {
    buildMs: performance.now() - started,
    fieldCount: fields.length,
    characterCount: [...postings.values()].reduce((sum, entries) => sum + entries.length, 0),
    search(query, groups, primaryIds) {
      const startedAt = performance.now();
      if (!/\p{Script=Han}/u.test(normalizeSearchText(query))) {
        return {
          ids: primaryIds,
          positions: {},
          groups,
          referenceMs: performance.now() - startedAt,
          mode: 'meili-non-han',
        };
      }
      const byGroup = groups.map(find);
      const eligible = groups.length === 0
        ? new Set(documents.map((document) => document.id))
        : new Set([...byGroup[0].keys()].filter((id) => byGroup.every((matches) => matches.has(id))));
      const primarySet = new Set(primaryIds);
      const retainedPrimary = primaryIds.filter((id) => eligible.has(id));
      const supplement = [...eligible]
        .filter((id) => !primarySet.has(id))
        .sort((left, right) => documentOrder.get(left) - documentOrder.get(right));
      const ids = [...retainedPrimary, ...supplement];
      return {
        ids,
        groups,
        positions: Object.fromEntries(ids.map((id) => [
          id,
          byGroup.flatMap((matches) => matches.get(id) ?? []),
        ])),
        referenceMs: performance.now() - startedAt,
        mode: 'in-memory-contiguous-fragment-reference',
      };
    },
  };
}
