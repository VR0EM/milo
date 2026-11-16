/**
 * Milo's "System One": fast, closed decisions about a note (which space, task or event) learned
 * from the person's own history, never from the internet. No text is generated: every answer
 * is one of the given choices with a confidence, or "not sure", in which case Milo asks.
 *
 * The model is naive Bayes over words and pieces of words (3 to 5 letters), so "chemie",
 * "chem" and "chemistry" share evidence, as do "fysica" and "physics". It learns in
 * microseconds, needs no download and gives the same answer every time.
 */

/** One thing she did before: a title and where it went. */
export interface Example {
  text: string;
  label: string;
  /** How much it counts (a space's own name counts more than one old note). */
  weight?: number;
}

export interface Decision {
  /** The choice, or null when it is not sure enough (then: ask, or leave it in the Inbox). */
  label: string | null;
  confidence: number;
  /** Every choice, most likely first. */
  ranked: { label: string; p: number }[];
  /** Words that weighed most for the winner, to show why. */
  why: string[];
}

const STOP = new Set(
  (
    "de het een en of van voor met op te tegen naar in aan om bij tot uit over door na als dan dat die dit is zijn " +
    "ik je mijn me we nog ook al moet maken doen " +
    "the a an and or of for with on to by at in from about my me i is are be do make get up it so"
  ).split(" "),
);

/** Lower case, no accents, letters and digits only. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words (without filler words and bare numbers) and their 3 to 5 letter pieces. */
export function features(text: string): string[] {
  const out: string[] = [];
  for (const w of normalize(text).split(" ")) {
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.push(`w:${w}`);
    const padded = `^${w}$`;
    for (let n = 3; n <= 5; n++) {
      for (let i = 0; i + n <= padded.length; i++) out.push(`c:${padded.slice(i, i + n)}`);
    }
  }
  return out;
}

interface Options {
  /** Laplace smoothing. */
  alpha?: number;
  /** How sharp the confidence is; higher is surer. */
  sharpness?: number;
  /** Below this confidence the answer is "not sure". */
  threshold?: number;
}

export class SystemOne {
  private counts = new Map<string, Map<string, number>>();
  private totals = new Map<string, number>();
  private docs = new Map<string, number>();
  private vocab = new Set<string>();
  private readonly alpha: number;
  private readonly sharpness: number;
  readonly threshold: number;

  constructor(examples: Example[] = [], { alpha = 0.1, sharpness = 3, threshold = 0.6 }: Options = {}) {
    this.alpha = alpha;
    this.sharpness = sharpness;
    this.threshold = threshold;
    for (const e of examples) this.learn(e);
  }

  /** One more example, for instance a suggestion she confirmed or corrected. */
  learn({ text, label, weight = 1 }: Example) {
    const f = features(text);
    if (!f.length) return;
    let row = this.counts.get(label);
    if (!row) this.counts.set(label, (row = new Map()));
    for (const x of f) {
      row.set(x, (row.get(x) ?? 0) + weight);
      this.vocab.add(x);
    }
    this.totals.set(label, (this.totals.get(label) ?? 0) + f.length * weight);
    this.docs.set(label, (this.docs.get(label) ?? 0) + weight);
  }

  get labels(): string[] {
    return [...this.counts.keys()];
  }

  /** The most likely choice among `allowed` (default: every label it has seen). */
  decide(text: string, allowed: string[] = this.labels): Decision {
    const f = features(text).filter((x) => this.vocab.has(x));
    const choices = allowed.filter((l) => this.counts.has(l));
    if (!f.length || !choices.length) return { label: null, confidence: 0, ranked: [], why: [] };

    const V = this.vocab.size;
    const allDocs = choices.reduce((n, l) => n + (this.docs.get(l) ?? 0), 0);
    const score = new Map<string, number>();
    for (const l of choices) {
      const row = this.counts.get(l)!;
      const denom = (this.totals.get(l) ?? 0) + this.alpha * V;
      let s = 0;
      for (const x of f) s += Math.log(((row.get(x) ?? 0) + this.alpha) / denom);
      // Per feature, so a long note is not surer than a short one; a soft prior on how often.
      const prior = Math.log(Math.sqrt(this.docs.get(l) ?? 1) / Math.sqrt(allDocs));
      score.set(l, s / f.length + prior / 10);
    }
    const max = Math.max(...score.values());
    const exp = choices.map((l) => [l, Math.exp(this.sharpness * (score.get(l)! - max))] as const);
    const sum = exp.reduce((n, [, v]) => n + v, 0);
    const ranked = exp.map(([label, v]) => ({ label, p: v / sum })).sort((a, b) => b.p - a.p);
    const best = ranked[0];

    const row = this.counts.get(best.label)!;
    const why = [...new Set(f.filter((x) => x.startsWith("w:") && (row.get(x) ?? 0) > 0).map((x) => x.slice(2)))]
      .sort((a, b) => (row.get(`w:${b}`) ?? 0) - (row.get(`w:${a}`) ?? 0))
      .slice(0, 3);

    return { label: best.p >= this.threshold ? best.label : null, confidence: best.p, ranked, why };
  }
}

/**
 * The same to-do written twice (as same_thing() in suggest.rs, without the model): the same
 * numbers, and every word of the shorter title in the longer one (two words at least, or the
 * very same words). Strict on purpose: a false "already there" is worse than a missed one.
 */
export function sameThing(a: string, b: string): boolean {
  const parts = (t: string) => {
    const words = normalize(t).split(" ").filter(Boolean);
    return {
      content: new Set(words.filter((w) => w.length >= 2 && !STOP.has(w))),
      numbers: words.filter((w) => /\d/.test(w)).sort().join(" "),
    };
  };
  const [x, y] = [parts(a), parts(b)];
  if (x.numbers !== y.numbers || !x.content.size || !y.content.size) return false;
  const [short, long] = x.content.size <= y.content.size ? [x.content, y.content] : [y.content, x.content];
  const inside = [...short].every((w) => long.has(w));
  return inside && (short.size >= 2 || short.size === long.size);
}
