import { EMBEDDING_DIMS } from '../config';

const STOP = new Set(
  'a an the and or but if then of to in on at by for with from as is are was were be been being it its this that these those you your we our i my me do does did can could should would will how what why when where which who whom into than so not no yes also use used using bicep azure file resource template'.split(' '),
);

/** crude stemmer: good enough for lexical matching in the mock provider and groundedness checks */
function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/, (m, _g, off) => (off >= 3 ? '' : m));
}

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9.\-_]*/g) ?? [])
    .map((w) => stem(w.replace(/[.\-_]+$/, '')))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function fnv(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic hashed bag-of-words (+bigrams) embedding. Offline stand-in for a real model. */
export function hashEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMS).fill(0);
  const t = tokens(text);
  for (let i = 0; i < t.length; i++) {
    v[fnv(t[i]) % EMBEDDING_DIMS] += 1;
    if (i + 1 < t.length) v[fnv(`${t[i]} ${t[i + 1]}`) % EMBEDDING_DIMS] += 0.5;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export const FAILURE_INTENT =
  /\b(fail(ed|s|ing|ure)?|error(s|ed)?|broke(n)?|stuck|crash(ed)?|not working|doesn'?t work|didn'?t work|went wrong|why did|what happened)\b/i;
