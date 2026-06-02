/**
 * Collapse Whisper hallucination loops in transcribed text.
 *
 * Whisper frequently produces repeating n-grams like "jala, jala, jala…" or
 * "sí, sí, sí…" or "muchas gracias muchas gracias muchas gracias" when the
 * audio has low-level noise, silence padding, music, or abrupt endings. Once
 * it starts looping it rarely recovers.
 *
 * Strategy:
 *  - For n-grams of length 1..8, find runs where the same n-gram appears 4+
 *    times back-to-back (allowing punctuation/whitespace between repeats)
 *    and keep only the first occurrence.
 *  - Iterate to convergence (a 1-gram loop can hide inside a 2-gram loop).
 */

const MAX_NGRAM = 8;
const MIN_REPEATS = 4;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseOnce(text: string): { text: string; changed: boolean } {
  let result = text;
  let changed = false;

  for (let n = 1; n <= MAX_NGRAM; n++) {
    // Match n words (where "word" = run of non-whitespace), followed by the
    // same n words repeated MIN_REPEATS-1 or more times. Allow punctuation
    // and whitespace between repeats.
    // Build the pattern as a string so we can reuse it per n.
    const word = "\\S+";
    const sep = "[\\s,;.!?¡¿—–-]*";
    const group = `(${word}(?:${sep}${word}){${n - 1}})`;
    const repeat = `(?:${sep}\\1){${MIN_REPEATS - 1},}`;
    const pattern = new RegExp(`${group}${repeat}`, "gi");

    const next = result.replace(pattern, (_match, captured) => {
      changed = true;
      // Keep just the first instance; add ellipsis hint so the user knows
      // something was removed.
      return captured + " […]";
    });

    if (next !== result) {
      result = next;
    }
  }

  // Dedup obvious repeated single-token punctuation runs (commas etc.)
  const punctCollapsed = result.replace(/(\s*\[…\])(?:\s*\[…\])+/g, " […]");
  if (punctCollapsed !== result) {
    result = punctCollapsed;
    changed = true;
  }

  return { text: result, changed };
}

export function deloopText(text: string): string {
  if (!text) return text;
  let current = text;
  // Iterate up to 5 times — most loops collapse in 1 pass, but nested
  // patterns (a 2-gram loop hiding inside a 4-gram loop) may need more.
  for (let i = 0; i < 5; i++) {
    const { text: next, changed } = collapseOnce(current);
    current = next;
    if (!changed) break;
  }
  return current.replace(/\s+/g, " ").trim();
}

/**
 * Drop transcript segments whose text is part of a hallucination run.
 * After deloopText, the raw text shrinks dramatically; segments don't,
 * so we use the same logic per-segment-sequence to drop the duplicates.
 */
export function deloopSegments<T extends { text: string }>(
  segments: T[]
): T[] {
  if (segments.length < MIN_REPEATS) return segments;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[\s,.;:!?¡¿—–\-]+/g, " ").trim();

  const out: T[] = [];
  let i = 0;
  while (i < segments.length) {
    let kept = false;
    // Look ahead for n-gram loops in the segment sequence.
    for (let n = 1; n <= Math.min(MAX_NGRAM, segments.length - i); n++) {
      const window = segments.slice(i, i + n).map((s) => normalize(s.text));
      let repeats = 1;
      let j = i + n;
      while (j + n <= segments.length) {
        const next = segments.slice(j, j + n).map((s) => normalize(s.text));
        if (next.every((t, k) => t === window[k] && t.length > 0)) {
          repeats++;
          j += n;
        } else {
          break;
        }
      }
      if (repeats >= MIN_REPEATS) {
        // Keep only the first occurrence of the n-gram window
        out.push(...segments.slice(i, i + n));
        i = j;
        kept = true;
        break;
      }
    }
    if (!kept) {
      out.push(segments[i]);
      i++;
    }
  }
  return out;
}
