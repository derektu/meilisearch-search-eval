import { Converter, Locale, Trie } from 'opencc-js';

export const NORMALIZATION_REVISION = 1;
export const OPENCC_DATA_VERSION = '1.4.2';

const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const s2t = Converter({ from: 'cn', to: 't' });
const t2tw = Converter({ from: 't', to: 'tw' });
const openCcStages = {
  s2t: buildOpenCcStages('s2t'),
  t2tw: buildOpenCcStages('t2tw'),
};

export function normalizeSearchText(raw) {
  const nfkc = raw.normalize('NFKC').replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
  return t2tw(s2t(nfkc)).replaceAll('臺', '台')
    .replace(/\p{White_Space}+/gu, ' ')
    .replace(/^ | $/gu, '');
}

export function normalizeSearchTextWithMap(raw) {
  let units = nfkcUnits(raw);
  units = units.map((unit) => ({
    ...unit,
    text: unit.text.replace(/[A-Z]/gu, (letter) => letter.toLowerCase()),
  }));
  units = applyOpenCcConfig(units, 's2t');
  units = applyOpenCcConfig(units, 't2tw');
  units = units.flatMap((unit) => [...unit.text].map((text) => ({
    text: text === '臺' ? '台' : text,
    rawStart: unit.rawStart,
    rawEnd: unit.rawEnd,
  })));
  units = collapseWhitespace(units);
  const text = units.map((unit) => unit.text).join('');
  const ranges = byteRanges(units);
  return {
    text,
    rawRange(start, length) {
      if (!Number.isInteger(start) || !Number.isInteger(length) || length <= 0) return null;
      const end = start + length;
      let rawStart = Number.POSITIVE_INFINITY;
      let rawEnd = -1;
      for (const range of ranges) {
        if (range.byteStart >= end) break;
        if (range.byteEnd <= start) continue;
        rawStart = Math.min(rawStart, range.rawStart);
        rawEnd = Math.max(rawEnd, range.rawEnd);
      }
      return rawEnd < 0 ? null : { start: rawStart, end: rawEnd };
    },
  };
}

function nfkcUnits(raw) {
  const result = [];
  for (const segment of graphemes.segment(raw)) {
    const rawStart = segment.index;
    const rawEnd = rawStart + segment.segment.length;
    for (const text of segment.segment.normalize('NFKC')) result.push({ text, rawStart, rawEnd });
  }
  return result;
}

function applyOpenCcConfig(units, name) {
  let converted = units;
  for (const trie of openCcStages[name]) converted = applyTrie(converted, trie);
  return converted;
}

function buildOpenCcStages(name) {
  const config = Locale.configs[name];
  if (!config) throw new Error(`OpenCC configuration ${name} is unavailable.`);
  const normalizationChain = config.normalizationChain ?? [];
  return [...normalizationChain, ...config.conversionChain].map((group) => {
    const trie = new Trie();
    trie.loadDictGroup(group);
    return trie;
  });
}

function applyTrie(units, trie) {
  const text = units.map((unit) => unit.text).join('');
  const starts = [];
  let cursor = 0;
  for (const unit of units) {
    starts.push(cursor);
    cursor += unit.text.length;
  }

  const output = [];
  let unitIndex = 0;
  while (unitIndex < units.length) {
    const match = trie.matchPrefix(text, starts[unitIndex]);
    if (!match) {
      output.push(units[unitIndex]);
      unitIndex += 1;
      continue;
    }
    let after = unitIndex;
    while (after < units.length && starts[after] < match.end) after += 1;
    const covered = units.slice(unitIndex, after);
    const replacements = [...match.value];
    if (replacements.length === covered.length) {
      replacements.forEach((replacement, index) => output.push({ ...covered[index], text: replacement }));
    } else {
      let rawStart = Number.POSITIVE_INFINITY;
      let rawEnd = -1;
      for (const unit of covered) {
        rawStart = Math.min(rawStart, unit.rawStart);
        rawEnd = Math.max(rawEnd, unit.rawEnd);
      }
      for (const replacement of replacements) output.push({ text: replacement, rawStart, rawEnd });
    }
    unitIndex = after;
  }
  return output;
}

function collapseWhitespace(units) {
  const output = [];
  let whitespace = [];
  const flush = () => {
    if (whitespace.length > 0 && output.length > 0) {
      let rawStart = Number.POSITIVE_INFINITY;
      let rawEnd = -1;
      for (const unit of whitespace) {
        rawStart = Math.min(rawStart, unit.rawStart);
        rawEnd = Math.max(rawEnd, unit.rawEnd);
      }
      output.push({ text: ' ', rawStart, rawEnd });
    }
    whitespace = [];
  };
  for (const unit of units) {
    if (/^\p{White_Space}$/u.test(unit.text)) whitespace.push(unit);
    else {
      flush();
      output.push(unit);
    }
  }
  return output;
}

function byteRanges(units) {
  let byteStart = 0;
  return units.map((unit) => {
    const byteEnd = byteStart + Buffer.byteLength(unit.text, 'utf8');
    const range = { byteStart, byteEnd, rawStart: unit.rawStart, rawEnd: unit.rawEnd };
    byteStart = byteEnd;
    return range;
  });
}
