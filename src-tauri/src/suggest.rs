//! Space suggestions for notes in the Inbox: Milo's small "System One" (docs/DECISIONS.md).
//!
//! No text is generated. For a note, every course and list gets a probability, learned from
//! her own history (the titles of her to-dos and events, the names of her spaces and their
//! parts). Two ways to score:
//!
//! - **Words** (always there): naive Bayes over words and their 3 to 5 letter pieces, so
//!   "chem", "chemie" and "Chemistry" share evidence. Knows only what she has written before.
//! - **Model2Vec** (after a one-time download of ~83 MB): a fixed table of vectors for pieces
//!   of words in 100 languages (potion-multilingual-128M, int8). A note becomes the average of
//!   its pieces' vectors; the space is taken from the nearest notes she filed before. This also
//!   knows that "optiek" is near "Physics" without having seen it.
//!
//! Measured on 190 test notes, played in order with learning after each (see docs): with
//! Model2Vec, 65% sure and filled in with 2% of those wrong, and the right space in the first
//! three choices for 96% of the rest. Words alone are not good enough to fill in by themselves,
//! so they only order the choices.

use crate::error::{AppError, Result};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use unicode_normalization::UnicodeNormalization;

// ---------- words ----------

const STOP: &[&str] = &[
    "de", "het", "een", "en", "of", "van", "voor", "met", "op", "te", "tegen", "naar", "in", "aan", "om", "bij", "tot",
    "uit", "over", "door", "na", "als", "dan", "dat", "die", "dit", "is", "zijn", "ik", "je", "mijn", "me", "we", "nog",
    "ook", "al", "moet", "maken", "doen", "the", "a", "an", "and", "or", "of", "for", "with", "on", "to", "by", "at",
    "in", "from", "about", "my", "me", "i", "is", "are", "be", "do", "make", "get", "up", "it", "so",
];

/// Lower case, no accents, letters and digits only (as normalize() in systemOne.ts).
pub fn normalize(text: &str) -> String {
    let plain: String = text
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() { c } else { ' ' })
        .collect();
    plain.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Words (without filler words and bare numbers) and their 3 to 5 letter pieces.
pub fn features(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for w in normalize(text).split(' ') {
        if w.len() < 2 || STOP.contains(&w) || w.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        out.push(format!("w:{w}"));
        let padded: Vec<char> = format!("^{w}$").chars().collect();
        for n in 3..=5 {
            for i in 0..padded.len().saturating_sub(n - 1) {
                out.push(format!("c:{}", padded[i..i + n].iter().collect::<String>()));
            }
        }
    }
    out
}

/// Naive Bayes over word features, learned from weighted examples.
#[derive(Default)]
pub struct Words {
    counts: HashMap<String, HashMap<String, f64>>,
    totals: HashMap<String, f64>,
    docs: HashMap<String, f64>,
    vocab: HashSet<String>,
}

const ALPHA: f64 = 0.1;
const WORD_SHARPNESS: f64 = 3.0;

impl Words {
    pub fn learn(&mut self, text: &str, label: &str, weight: f64) {
        let f = features(text);
        if f.is_empty() {
            return;
        }
        let row = self.counts.entry(label.to_string()).or_default();
        for x in &f {
            *row.entry(x.clone()).or_default() += weight;
            self.vocab.insert(x.clone());
        }
        *self.totals.entry(label.to_string()).or_default() += f.len() as f64 * weight;
        *self.docs.entry(label.to_string()).or_default() += weight;
    }

    /// A probability for each of `allowed`, in that order (0 for every one when nothing is known).
    pub fn probs(&self, text: &str, allowed: &[String]) -> Vec<f64> {
        let f: Vec<String> = features(text).into_iter().filter(|x| self.vocab.contains(x)).collect();
        if f.is_empty() {
            return vec![0.0; allowed.len()];
        }
        let v = self.vocab.len() as f64;
        let all_docs: f64 = allowed.iter().map(|l| self.docs.get(l).copied().unwrap_or(0.0)).sum();
        let scores: Vec<Option<f64>> = allowed
            .iter()
            .map(|l| {
                let row = self.counts.get(l)?;
                let denom = self.totals.get(l).copied().unwrap_or(0.0) + ALPHA * v;
                let s: f64 = f.iter().map(|x| ((row.get(x).copied().unwrap_or(0.0) + ALPHA) / denom).ln()).sum();
                let prior = (self.docs.get(l).copied().unwrap_or(1.0).sqrt() / all_docs.max(1.0).sqrt()).ln();
                Some(s / f.len() as f64 + prior / 10.0)
            })
            .collect();
        let max = scores.iter().flatten().copied().fold(f64::NEG_INFINITY, f64::max);
        let exp: Vec<f64> = scores.iter().map(|s| s.map_or(0.0, |s| (WORD_SHARPNESS * (s - max)).exp())).collect();
        let sum: f64 = exp.iter().sum();
        exp.iter().map(|e| if sum > 0.0 { e / sum } else { 0.0 }).collect()
    }

    /// The words of `text` seen most often with `label`, to show why.
    pub fn why(&self, text: &str, label: &str) -> Vec<String> {
        let Some(row) = self.counts.get(label) else { return Vec::new() };
        let mut seen: Vec<(String, f64)> = Vec::new();
        for x in features(text) {
            if let (Some(w), Some(n)) = (x.strip_prefix("w:"), row.get(&x)) {
                if !seen.iter().any(|(s, _)| s == w) {
                    seen.push((w.to_string(), *n));
                }
            }
        }
        seen.sort_by(|a, b| b.1.total_cmp(&a.1));
        seen.into_iter().take(3).map(|(w, _)| w).collect()
    }
}

// ---------- Model2Vec ----------

/// A static embedding table: one int8 vector per piece of a word, and the tokenizer that
/// splits text into those pieces.
pub struct StaticModel {
    tokenizer: Option<tokenizers::Tokenizer>,
    bytes: Vec<u8>,
    start: usize,
    rows: usize,
    dim: usize,
}

impl StaticModel {
    pub fn load(dir: &Path) -> Result<Self> {
        let tokenizer = tokenizers::Tokenizer::from_file(dir.join(TOKENIZER))
            .map_err(|e| AppError::Invalid(format!("The suggestion model's word list cannot be read: {e}")))?;
        let mut model = Self::from_safetensors(std::fs::read(dir.join(TABLE))?)?;
        model.tokenizer = Some(tokenizer);
        Ok(model)
    }

    /// Reads the one int8 tensor "embeddings" [rows, dim] from a safetensors file.
    pub fn from_safetensors(bytes: Vec<u8>) -> Result<Self> {
        let bad = |why: &str| AppError::Invalid(format!("The suggestion model is damaged ({why}); remove it and download it again"));
        let n = u64::from_le_bytes(bytes.get(..8).ok_or_else(|| bad("too short"))?.try_into().unwrap()) as usize;
        let header: serde_json::Value =
            serde_json::from_slice(bytes.get(8..8 + n).ok_or_else(|| bad("header"))?).map_err(|_| bad("header"))?;
        let e = &header["embeddings"];
        if e["dtype"] != "I8" {
            return Err(bad("not int8"));
        }
        let shape: Vec<usize> = e["shape"].as_array().ok_or_else(|| bad("shape"))?.iter().filter_map(|x| x.as_u64().map(|x| x as usize)).collect();
        let offsets: Vec<usize> = e["data_offsets"].as_array().ok_or_else(|| bad("offsets"))?.iter().filter_map(|x| x.as_u64().map(|x| x as usize)).collect();
        let (&[rows, dim], &[a, b]) = (shape.as_slice(), offsets.as_slice()) else { return Err(bad("shape")) };
        if b - a != rows * dim || 8 + n + b > bytes.len() {
            return Err(bad("size"));
        }
        Ok(Self { tokenizer: None, bytes, start: 8 + n + a, rows, dim })
    }

    /// The average of the pieces' vectors, at length 1; None when nothing is known.
    pub fn embed_ids(&self, ids: &[u32]) -> Option<Vec<f32>> {
        let mut v = vec![0f32; self.dim];
        let mut any = false;
        for &id in ids {
            let id = id as usize;
            if id >= self.rows {
                continue;
            }
            any = true;
            let row = &self.bytes[self.start + id * self.dim..self.start + (id + 1) * self.dim];
            for (x, &b) in v.iter_mut().zip(row) {
                *x += b as i8 as f32;
            }
        }
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        (any && norm > 0.0).then(|| v.into_iter().map(|x| x / norm).collect())
    }

    pub fn embed(&self, text: &str) -> Option<Vec<f32>> {
        let tok = self.tokenizer.as_ref()?;
        let enc = tok.encode(text, false).ok()?;
        self.embed_ids(enc.get_ids())
    }
}

// ---------- examples from her history ----------

/// Something she filed before, and how much it still counts.
#[derive(Debug, Clone)]
pub struct Example {
    pub text: String,
    pub space: usize,
    pub weight: f64,
}

/// How long it takes before an old title counts half (a semester moves on).
const HALF_LIFE_DAYS: f64 = 70.0;
const MAX_EXAMPLES: usize = 4000;

fn recency(at: &str, now: chrono::DateTime<chrono::Utc>) -> f64 {
    let days = chrono::DateTime::parse_from_rfc3339(at)
        .map(|t| (now - t.with_timezone(&chrono::Utc)).num_hours() as f64 / 24.0)
        .unwrap_or(0.0)
        .max(0.0);
    0.5f64.powf(days / HALF_LIFE_DAYS).max(0.05)
}

/// The spaces something can go to, and every title she filed in them. A to-do goes to a course
/// or list; an event (`events`) to any space but the Inbox, so also Work or Sleep.
pub fn history(c: &Connection, now: chrono::DateTime<chrono::Utc>, events: bool) -> Result<(Vec<(String, String)>, Vec<Example>)> {
    let kinds = if events { "kind != 'inbox'" } else { "kind IN ('project', 'list')" };
    let spaces: Vec<(String, String)> = c
        .prepare(&format!("SELECT id, name FROM spaces WHERE deleted_at IS NULL AND {kinds} ORDER BY sort_order, name"))?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let index: HashMap<&str, usize> = spaces.iter().enumerate().map(|(i, (id, _))| (id.as_str(), i)).collect();
    let mut best: HashMap<(usize, String), Example> = HashMap::new();
    let mut add = |space: &str, text: String, weight: f64| {
        let Some(&i) = index.get(space) else { return };
        let key = (i, normalize(&text));
        if key.1.is_empty() {
            return;
        }
        let e = best.entry(key).or_insert(Example { text, space: i, weight: 0.0 });
        e.weight = e.weight.max(weight);
    };
    for (i, (_, name)) in spaces.iter().enumerate() {
        add(&spaces[i].0, name.clone(), 1.0);
    }
    for row in c
        .prepare("SELECT space_id, name FROM sections WHERE deleted_at IS NULL")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
    {
        let (space, name) = row?;
        add(&space, name, 1.0);
    }
    let rows = c
        .prepare(
            "SELECT space_id, title, updated_at, source_id IS NOT NULL AND NOT locally_modified FROM tasks WHERE deleted_at IS NULL AND title != ''
             UNION ALL
             SELECT space_id, title, start_at, source_id IS NOT NULL AND NOT locally_modified FROM events WHERE deleted_at IS NULL AND title != ''
             ORDER BY 3 DESC LIMIT ?1",
        )?
        .query_map([MAX_EXAMPLES as i64], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, bool>(3)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (space, title, at, imported) in rows {
        add(&space, title, recency(&at, now) * if imported { IMPORTED } else { 1.0 });
    }
    let mut examples: Vec<Example> = best.into_values().collect();
    examples.sort_by(|a, b| a.space.cmp(&b.space).then_with(|| a.text.cmp(&b.text)));
    Ok((spaces, examples))
}

/// Within a course: its parts (`what` = "section") or the task types it can use ("type"), and
/// the to-dos she gave one. Parts are learned from this course only; types from every course.
pub fn labels_history(c: &Connection, space_id: &str, what: &str, now: chrono::DateTime<chrono::Utc>) -> Result<(Vec<(String, String)>, Vec<Example>)> {
    let (labels_sql, rows_sql) = match what {
        "section" => (
            "SELECT id, name FROM sections WHERE deleted_at IS NULL AND space_id = ?1 ORDER BY sort_order, created_at",
            "SELECT section_id, title, updated_at FROM tasks WHERE deleted_at IS NULL AND title != '' AND space_id = ?1 AND section_id IS NOT NULL ORDER BY updated_at DESC LIMIT 2000",
        ),
        "type" => (
            "SELECT id, name FROM task_types WHERE deleted_at IS NULL AND (space_id IS NULL OR space_id = ?1) ORDER BY sort_order, name",
            "SELECT type_id, title, updated_at FROM tasks WHERE deleted_at IS NULL AND title != '' AND type_id IS NOT NULL AND ?1 IS NOT NULL ORDER BY updated_at DESC LIMIT 2000",
        ),
        other => return Err(AppError::Invalid(format!("Cannot suggest a {other}"))),
    };
    let labels: Vec<(String, String)> =
        c.prepare(labels_sql)?.query_map([space_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let index: HashMap<&str, usize> = labels.iter().enumerate().map(|(i, (id, _))| (id.as_str(), i)).collect();
    let mut examples: Vec<Example> = labels.iter().enumerate().map(|(i, (_, n))| Example { text: n.clone(), space: i, weight: 1.0 }).collect();
    for row in c.prepare(rows_sql)?.query_map([space_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
        let (label, title, at) = row?;
        if let Some(&i) = index.get(label.as_str()) {
            examples.push(Example { text: title, space: i, weight: recency(&at, now) });
        }
    }
    Ok((labels, examples))
}

/// Changes whenever anything a suggestion learns from changes.
pub fn data_key(c: &Connection) -> Result<String> {
    Ok(c.query_row(
        "SELECT (SELECT COUNT(*) || '|' || IFNULL(MAX(updated_at), '') FROM tasks) || '/' ||
                (SELECT COUNT(*) || '|' || IFNULL(MAX(updated_at), '') FROM events) || '/' ||
                (SELECT COUNT(*) || '|' || IFNULL(MAX(updated_at), '') FROM spaces) || '/' ||
                (SELECT COUNT(*) || '|' || IFNULL(MAX(updated_at), '') FROM sections)",
        [],
        |r| r.get(0),
    )?)
}

// ---------- deciding ----------

const K: usize = 9;
/// At most this many of the nearest titles count per space, so a space with many titles does
/// not win only by being big.
pub const PER_SPACE: usize = 3;
/// "Sure" needs at least this many of the space's own titles close to the note: one look-alike
/// (a to-do that once landed in Personal by default) is a hint, not proof.
pub const SUPPORT: usize = 2;
/// Something that came in from a calendar link was placed by the import, not by her.
const IMPORTED: f64 = 0.3;
const VECTOR_SHARPNESS: f32 = 15.0;
/// Filled in by itself only with the model, when this likely and this far ahead of the next.
const SURE: f64 = 0.8;
const AHEAD: f64 = 0.4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub space_id: String,
    pub p: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    /// At most three, most likely first. Empty when there is nothing to go on.
    pub choices: Vec<Choice>,
    /// Likely and clearly ahead: the first choice may be offered as the answer.
    pub sure: bool,
    /// Why the first choice: words she used before, or a title she filed there.
    pub why: Option<String>,
}

pub struct Index {
    pub per_space: usize,
    pub support: usize,
    spaces: Vec<(String, String)>,
    words: Words,
    vectors: Vec<(Vec<f32>, usize, String, f64)>,
}

impl Index {
    pub fn build(spaces: Vec<(String, String)>, examples: &[Example], model: Option<&StaticModel>) -> Self {
        let mut words = Words::default();
        let ids: Vec<String> = spaces.iter().map(|(id, _)| id.clone()).collect();
        for (id, name) in &spaces {
            words.learn(name, id, 3.0);
        }
        for e in examples {
            words.learn(&e.text, &ids[e.space], e.weight);
        }
        let vectors = match model {
            Some(m) => examples.iter().filter_map(|e| Some((m.embed(&e.text)?, e.space, e.text.clone(), e.weight))).collect(),
            None => Vec::new(),
        };
        Self { per_space: PER_SPACE, support: SUPPORT, spaces, words, vectors }
    }

    pub fn suggest(&self, text: &str, model: Option<&StaticModel>) -> Suggestion {
        self.decide(text, model.and_then(|m| m.embed(text)))
    }

    /// As suggest(), with the note's vector already made (None: words only).
    fn decide(&self, text: &str, vector: Option<Vec<f32>>) -> Suggestion {
        let ids: Vec<String> = self.spaces.iter().map(|(id, _)| id.clone()).collect();
        let none = Suggestion { choices: Vec::new(), sure: false, why: None };
        if ids.is_empty() || normalize(text).is_empty() {
            return none;
        }
        let from_model = vector.filter(|_| !self.vectors.is_empty());
        let (p, nearest) = match &from_model {
            Some(q) => {
                let mut sims: Vec<(f32, usize, &str, f64)> =
                    self.vectors.iter().map(|(v, s, t, w)| (v.iter().zip(q).map(|(a, b)| a * b).sum(), *s, t.as_str(), *w)).collect();
                sims.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
                let mut taken = vec![0usize; ids.len()];
                sims.retain(|(_, i, _, _)| {
                    taken[*i] += 1;
                    taken[*i] <= self.per_space
                });
                sims.truncate(K);
                let top = sims[0].0;
                let mut p = vec![0f64; ids.len()];
                for (s, i, _, w) in &sims {
                    p[*i] += w * f64::from((VECTOR_SHARPNESS * (s - top)).exp());
                }
                let sum: f64 = p.iter().sum();
                (p.into_iter().map(|x| x / sum).collect::<Vec<_>>(), Some(sims))
            }
            None => (self.words.probs(text, &ids), None),
        };
        let mut order: Vec<usize> = (0..ids.len()).filter(|&i| p[i] > 0.0).collect();
        // Ties keep the sidebar order, so the same note always gets the same choices.
        order.sort_by(|&a, &b| p[b].total_cmp(&p[a]).then(a.cmp(&b)));
        let Some(&first) = order.first() else { return none };
        let second = order.get(1).map_or(0.0, |&i| p[i]);
        let why = match &nearest {
            Some(sims) => sims.iter().find(|(_, i, _, _)| *i == first).map(|(_, _, t, _)| format!("like “{t}”")),
            None => {
                let w = self.words.why(text, &ids[first]);
                (!w.is_empty()).then(|| format!("“{}” before", w.join("”, “")))
            }
        };
        Suggestion {
            choices: order.iter().take(3).map(|&i| Choice { space_id: ids[i].clone(), p: p[i] }).collect(),
            sure: from_model.is_some() && p[first] >= SURE && p[first] - second >= AHEAD && {
                // Close titles of the winner that she filed herself (not imported).
                let sims = nearest.as_ref().unwrap();
                let top = sims[0].0;
                sims.iter().filter(|(s, i, _, w)| *i == first && *w > IMPORTED && VECTOR_SHARPNESS * (top - s) <= 2.3).count() >= self.support
            },
            why,
        }
    }
}

// ---------- notes that are already there ----------

/// An open to-do a new note seems to repeat.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Similar {
    pub task_id: String,
    pub title: String,
    pub space_id: String,
}

/// Content words and numbers of a title.
fn word_set(text: &str) -> (HashSet<String>, Vec<String>) {
    let norm = normalize(text);
    let mut numbers: Vec<String> = norm.split(' ').filter(|w| w.chars().any(|c| c.is_ascii_digit())).map(String::from).collect();
    numbers.sort();
    let words = norm.split(' ').filter(|w| w.len() >= 2 && !STOP.contains(w)).map(String::from).collect();
    (words, numbers)
}

/// Strict on purpose: a false "this is already there" is worse than a missed one. The numbers
/// must be the same ("opdracht 2" is not "opdracht 3"), and then either every word of the shorter
/// title is in the longer one (two words at least, or the very same words), or, with the model,
/// the meaning is very close.
pub fn same_thing(a: &str, b: &str, cosine: Option<f32>) -> bool {
    let ((wa, na), (wb, nb)) = (word_set(a), word_set(b));
    if na != nb || wa.is_empty() || wb.is_empty() {
        return false;
    }
    let (short, long) = if wa.len() <= wb.len() { (&wa, &wb) } else { (&wb, &wa) };
    let contained = short.is_subset(long) && (short.len() >= 2 || short == long);
    contained || cosine.is_some_and(|c| c >= 0.83)
}

/// The open to-do (not the note itself) that each note seems to repeat, if any.
pub fn similar(c: &Connection, items: &[(String, String)], model: Option<&StaticModel>) -> Result<Vec<Option<Similar>>> {
    let open: Vec<(String, String, String)> = c
        .prepare("SELECT id, title, space_id FROM tasks WHERE deleted_at IS NULL AND completed_at IS NULL AND title != '' ORDER BY created_at")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let vectors: Vec<Option<Vec<f32>>> = open.iter().map(|(_, t, _)| model.and_then(|m| m.embed(t))).collect();
    Ok(items
        .iter()
        .map(|(id, text)| {
            let q = model.and_then(|m| m.embed(text));
            open.iter().zip(&vectors).find_map(|((oid, title, space), v)| {
                if oid == id {
                    return None;
                }
                let cosine = q.as_ref().zip(v.as_ref()).map(|(a, b)| a.iter().zip(b).map(|(x, y)| x * y).sum());
                same_thing(text, title, cosine).then(|| Similar { task_id: oid.clone(), title: title.clone(), space_id: space.clone() })
            })
        })
        .collect())
}

// ---------- the model files ----------

const TOKENIZER: &str = "tokenizer.json";
const TABLE: &str = "model.safetensors";
/// potion-multilingual-128M by Minish Lab (MIT), quantized to int8 by 777Radik (MIT); a fixed
/// version, checked against these hashes.
const SOURCE: &str = "https://huggingface.co/777Radik/potion-multilingual-128M-int8/resolve/3aa93e489e1783c41d57c587e0bbd4327ef65c62";
const FILES: [(&str, u64, &str); 2] = [
    (TOKENIZER, 18_616_131, "19f1909063da3cfe3bd83a782381f040dccea475f4816de11116444a73e1b6a1"),
    (TABLE, 64_045_272, "683024131f1258c426636e5c3022dab6176b2fa0e6fe7067ae6263f35d19d00b"),
];
pub const MODEL_BYTES: u64 = FILES[0].1 + FILES[1].1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub installed: bool,
    pub downloading: bool,
    pub bytes: u64,
}

/// Held by the app: the model once loaded, and the index for the current data.
pub struct Suggester {
    dir: PathBuf,
    model: Mutex<Option<Arc<StaticModel>>>,
    /// Per purpose (false: to-dos, true: events): the data key, with or without the model, and the index.
    index: Mutex<HashMap<bool, (String, bool, Arc<Index>)>>,
    downloading: AtomicBool,
}

impl Suggester {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            dir: data_dir.join("models").join("potion-multilingual-128M-int8"),
            model: Mutex::new(None),
            index: Mutex::new(HashMap::new()),
            downloading: AtomicBool::new(false),
        }
    }

    fn installed(&self) -> bool {
        FILES.iter().all(|(name, size, _)| std::fs::metadata(self.dir.join(name)).map(|m| m.len() == *size).unwrap_or(false))
    }

    pub fn status(&self) -> ModelStatus {
        ModelStatus { installed: self.installed(), downloading: self.downloading.load(Ordering::SeqCst), bytes: MODEL_BYTES }
    }

    /// The model, loaded once; None when it is not downloaded.
    fn model(&self) -> Result<Option<Arc<StaticModel>>> {
        let mut slot = self.model.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() && self.installed() {
            *slot = Some(Arc::new(StaticModel::load(&self.dir)?));
        }
        Ok(slot.clone())
    }

    /// Suggestions for each note. `read` gets the data key and, when it changed, her history.
    pub fn suggest(
        &self,
        texts: &[String],
        events: bool,
        key: String,
        read: impl FnOnce() -> Result<(Vec<(String, String)>, Vec<Example>)>,
    ) -> Result<Vec<Suggestion>> {
        let model = self.model()?;
        let with_model = model.is_some();
        let index = {
            let mut slot = self.index.lock().unwrap_or_else(|e| e.into_inner());
            match slot.get(&events) {
                Some((k, m, i)) if *k == key && *m == with_model => i.clone(),
                _ => {
                    let (spaces, examples) = read()?;
                    let i = Arc::new(Index::build(spaces, &examples, model.as_deref()));
                    slot.insert(events, (key, with_model, i.clone()));
                    i
                }
            }
        };
        Ok(texts.iter().map(|t| index.suggest(t, model.as_deref())).collect())
    }

    /// Open to-dos that the given notes seem to repeat.
    pub fn similar(&self, c: &Connection, items: &[(String, String)]) -> Result<Vec<Option<Similar>>> {
        let model = self.model()?;
        similar(c, items, model.as_deref())
    }

    /// Suggestions among other labels (a course's parts or types), built on the spot: small.
    pub fn suggest_among(&self, texts: &[String], labels: Vec<(String, String)>, examples: &[Example]) -> Result<Vec<Suggestion>> {
        let model = self.model()?;
        let index = Index::build(labels, examples, model.as_deref());
        Ok(texts.iter().map(|t| index.suggest(t, model.as_deref())).collect())
    }

    /// Downloads both files, checks size and hash, and only then puts them in place.
    pub fn download(&self, progress: impl Fn(u64, u64)) -> Result<()> {
        if self.downloading.swap(true, Ordering::SeqCst) {
            return Err(AppError::Invalid("The download is already running".into()));
        }
        let result = (|| {
            std::fs::create_dir_all(&self.dir)?;
            let agent = ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(20)).build();
            let mut done = 0u64;
            let last = std::cell::Cell::new(u64::MAX);
            let report = |at: u64| {
                let pct = at * 100 / MODEL_BYTES;
                if last.replace(pct) != pct {
                    progress(at, MODEL_BYTES);
                }
            };
            for (name, size, hash) in FILES {
                let part = self.dir.join(format!("{name}.part"));
                let fetched = (|| {
                    let resp = agent
                        .get(&format!("{SOURCE}/{name}"))
                        .call()
                        .map_err(|e| AppError::Network(format!("The download did not work: {e}")))?;
                    let mut body = resp.into_reader();
                    let mut file = std::fs::File::create(&part)?;
                    let mut hasher = Sha256::new();
                    let mut buf = vec![0u8; 1 << 16];
                    let mut got = 0u64;
                    loop {
                        let n = body.read(&mut buf)?;
                        if n == 0 {
                            break;
                        }
                        hasher.update(&buf[..n]);
                        file.write_all(&buf[..n])?;
                        got += n as u64;
                        report(done + got);
                    }
                    file.sync_all()?;
                    let digest: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
                    if got != size || digest != hash {
                        return Err(AppError::Network("The downloaded file is not the expected one; nothing was kept".into()));
                    }
                    std::fs::rename(&part, self.dir.join(name))?;
                    Ok(())
                })();
                if fetched.is_err() {
                    let _ = std::fs::remove_file(&part);
                }
                fetched?;
                done += size;
            }
            Ok(())
        })();
        self.downloading.store(false, Ordering::SeqCst);
        result
    }

    /// Back to suggestions from words alone; the files are removed.
    pub fn remove(&self) -> Result<()> {
        *self.model.lock().unwrap_or_else(|e| e.into_inner()) = None;
        self.index.lock().unwrap_or_else(|e| e.into_inner()).clear();
        if self.dir.exists() {
            std::fs::remove_dir_all(&self.dir)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn features_match_the_interface_version() {
        assert_eq!(normalize("Café  één! Labo-verslag"), "cafe een labo verslag");
        let f = features("de les van 10");
        assert_eq!(f.iter().filter(|x| x.starts_with("w:")).collect::<Vec<_>>(), ["w:les"]);
        assert!(f.contains(&"c:^le".to_string()) && f.contains(&"c:les$".to_string()));
        let fysica: HashSet<String> = features("fysica").into_iter().collect();
        assert!(features("physics").iter().any(|x| fysica.contains(x)), "Dutch and English share pieces");
    }

    fn words() -> (Vec<String>, Words) {
        let ids = vec!["chem".to_string(), "work".to_string()];
        let mut w = Words::default();
        for (t, l) in [("Chemistry", "chem"), ("Work", "work"), ("labo chemie verslag", "chem"), ("titratie oefeningen", "chem"), ("shift zaterdag", "work"), ("rooster naar baas", "work")] {
            w.learn(t, l, 1.0);
        }
        (ids, w)
    }

    #[test]
    fn words_learn_from_her_titles() {
        let (ids, w) = words();
        let p = w.probs("chemie samenvatting", &ids);
        assert!(p[0] > p[1]);
        let p = w.probs("shift maandag", &ids);
        assert!(p[1] > p[0]);
        assert_eq!(w.probs("zzz qqq", &ids), vec![0.0, 0.0], "nothing known, nothing claimed");
        assert_eq!(w.why("titratie labo", "chem"), ["titratie", "labo"]);
    }

    /// A tiny table: piece 0 points one way, piece 1 another, piece 2 in between.
    fn tiny_model() -> StaticModel {
        let header = br#"{"embeddings":{"dtype":"I8","shape":[3,2],"data_offsets":[0,6]}}"#;
        let mut bytes = (header.len() as u64).to_le_bytes().to_vec();
        bytes.extend_from_slice(header);
        bytes.extend_from_slice(&[100u8, 0, 0, 100, 50, 50]);
        StaticModel::from_safetensors(bytes).unwrap()
    }

    #[test]
    fn a_table_is_read_and_averaged() {
        let m = tiny_model();
        assert_eq!(m.embed_ids(&[0]).unwrap(), vec![1.0, 0.0]);
        let v = m.embed_ids(&[0, 1]).unwrap();
        assert!((v[0] - v[1]).abs() < 1e-6 && (v[0] * v[0] + v[1] * v[1] - 1.0).abs() < 1e-5);
        assert!(m.embed_ids(&[7]).is_none(), "unknown pieces are skipped");
        assert!(StaticModel::from_safetensors(vec![1, 2, 3]).is_err());
    }

    #[test]
    fn old_titles_count_less() {
        let now = chrono::Utc::now();
        let recent = recency(&now.to_rfc3339(), now);
        let old = recency(&(now - chrono::Duration::days(70)).to_rfc3339(), now);
        assert!((recent - 1.0).abs() < 1e-9 && (old - 0.5).abs() < 0.01);
        assert!(recency(&(now - chrono::Duration::days(3650)).to_rfc3339(), now) >= 0.05, "never forgotten entirely");
    }

    #[test]
    fn suggestions_come_from_her_courses_and_lists() {
        let c = open_in_memory().unwrap();
        let ts = "2026-11-01T10:00:00.000Z";
        c.execute_batch(&format!(
            "INSERT INTO spaces (id, name, color, role, kind, sort_order, created_at, updated_at) VALUES
               ('chem', 'Chemistry', 'teal', 'normal', 'project', 5, '{ts}', '{ts}'),
               ('err', 'Errands', 'pink', 'normal', 'list', 6, '{ts}', '{ts}');
             INSERT INTO sections (id, space_id, name, sort_order, created_at, updated_at) VALUES ('s', 'chem', '02 Titration', 0, '{ts}', '{ts}');
             INSERT INTO tasks (id, space_id, title, notes, sort_order, created_at, updated_at) VALUES
               ('t1', 'chem', 'labo verslag', '', 0, '{ts}', '{ts}'),
               ('t2', 'err', 'boodschappen doen', '', 0, '{ts}', '{ts}'),
               ('t3', 'seed-space-inbox', 'iets in de inbox', '', 0, '{ts}', '{ts}');"
        ))
        .unwrap();
        let (spaces, examples) = history(&c, chrono::Utc::now(), false).unwrap();
        let names: Vec<&str> = spaces.iter().map(|(_, n)| n.as_str()).collect();
        // Personal is a list; Sleep, Transport (time only) and the Inbox are no choice for a to-do.
        assert_eq!(names, ["Personal", "Chemistry", "Errands"]);
        let (for_events, _) = history(&c, chrono::Utc::now(), true).unwrap();
        assert_eq!(for_events.len(), 5, "an event can also go to Sleep or Transport, never the Inbox");
        assert!(examples.iter().any(|e| e.text == "02 Titration"), "a course's parts teach its words");
        assert!(!examples.iter().any(|e| e.text.contains("inbox")));

        let index = Index::build(spaces, &examples, None);
        let s = index.suggest("titratie verslag", None);
        assert_eq!(s.choices[0].space_id, "chem");
        assert!(!s.sure, "words alone never fill in by themselves");
        assert!(s.why.unwrap().contains("verslag"));
        assert_eq!(index.suggest("boodschappen", None).choices[0].space_id, "err");
        assert!(index.suggest("  ", None).choices.is_empty());
        assert!(index.suggest("x", None).choices.len() <= 3);
    }

    #[test]
    fn the_model_decides_when_it_is_there() {
        let m = tiny_model();
        let spaces = vec![("a".to_string(), "A".to_string()), ("b".to_string(), "B".to_string())];
        // Without a tokenizer embed() is None, so it falls back to words: same answers, never sure.
        let index = Index::build(spaces, &[Example { text: "alpha".into(), space: 0, weight: 1.0 }], Some(&m));
        assert!(!index.suggest("alpha", Some(&m)).sure);
    }

    #[test]
    fn parts_and_types_are_learned_within_a_course() {
        let c = open_in_memory().unwrap();
        let ts = chrono::Utc::now().to_rfc3339();
        c.execute_batch(&format!(
            "INSERT INTO spaces (id, name, color, role, kind, sort_order, created_at, updated_at) VALUES ('chem', 'Chemistry', 'teal', 'normal', 'project', 5, '{ts}', '{ts}');
             INSERT INTO sections (id, space_id, name, sort_order, created_at, updated_at) VALUES ('acid', 'chem', '01 Acids and bases', 0, '{ts}', '{ts}'), ('titr', 'chem', '02 Titration', 1, '{ts}', '{ts}');
             INSERT INTO tasks (id, space_id, title, notes, sort_order, created_at, updated_at, section_id, type_id) VALUES
               ('a', 'chem', 'buret kalibreren', '', 0, '{ts}', '{ts}', 'titr', 'seed-type-lab'),
               ('b', 'chem', 'pH oefeningen', '', 0, '{ts}', '{ts}', 'acid', 'seed-type-assignment');"
        ))
        .unwrap();
        let (labels, examples) = labels_history(&c, "chem", "section", chrono::Utc::now()).unwrap();
        assert_eq!(labels.len(), 2);
        let index = Index::build(labels, &examples, None);
        assert_eq!(index.suggest("titratie theorie", None).choices[0].space_id, "titr", "a part's own name teaches it");
        assert_eq!(index.suggest("buret spoelen", None).choices[0].space_id, "titr");
        let (types, examples) = labels_history(&c, "chem", "type", chrono::Utc::now()).unwrap();
        assert!(types.iter().any(|(id, _)| id == "seed-type-lab"));
        let index = Index::build(types, &examples, None);
        assert_eq!(index.suggest("buret", None).choices[0].space_id, "seed-type-lab");
        assert!(labels_history(&c, "chem", "colour", chrono::Utc::now()).is_err());
    }

    #[test]
    fn the_same_thing_twice_and_only_that() {
        for (a, b) in [("matrices oefenen", "Matrices oefenen!"), ("boodschappen", "boodschappen doen"), ("pick up package", "pick up the package at post office"), ("labo chemie verslag", "verslag labo chemie")] {
            assert!(same_thing(a, b, None), "{a} = {b}");
        }
        for (a, b) in [("labo chemie verslag", "labo fysica verslag"), ("hoofdstuk 4 lezen", "hoofdstuk 5 lezen"), ("opdracht 2 indienen", "opdracht 3 indienen"), ("labo", "labo chemie verslag"), ("mama bellen", "oma bellen")] {
            assert!(!same_thing(a, b, None), "{a} != {b}");
        }
        assert!(same_thing("matrices oefenen", "matrices oefeningen maken", Some(0.935)), "close in meaning, with the model");
        assert!(!same_thing("hoofdstuk 4 lezen", "hoofdstuk 5 lezen", Some(0.871)), "numbers differ, whatever the model says");
    }

    #[test]
    fn a_note_is_found_among_open_todos() {
        let c = open_in_memory().unwrap();
        let ts = chrono::Utc::now().to_rfc3339();
        c.execute_batch(&format!(
            "INSERT INTO tasks (id, space_id, title, notes, sort_order, created_at, updated_at, completed_at) VALUES
               ('old', 'seed-space-personal', 'boodschappen doen', '', 0, '{ts}', '{ts}', NULL),
               ('done', 'seed-space-personal', 'mama bellen', '', 0, '{ts}', '{ts}', '{ts}'),
               ('new', 'seed-space-inbox', 'boodschappen', '', 0, '{ts}', '{ts}', NULL);"
        ))
        .unwrap();
        let found = similar(&c, &[("new".into(), "boodschappen".into()), ("x".into(), "mama bellen".into())], None).unwrap();
        assert_eq!(found[0].as_ref().map(|s| s.task_id.as_str()), Some("old"));
        assert!(found[1].is_none(), "a finished to-do is no reason to say so");
    }

    #[test]
    fn sure_needs_two_of_her_own_titles() {
        let spaces = vec![("prog".to_string(), "Programming".to_string()), ("pers".to_string(), "Personal".to_string())];
        let index = |vectors: Vec<(Vec<f32>, usize, String, f64)>| Index { per_space: PER_SPACE, support: SUPPORT, spaces: spaces.clone(), words: Words::default(), vectors };
        let q = vec![1.0, 0.0];
        let near = |space: usize, w: f64| (vec![0.99, 0.141], space, "x".to_string(), w);
        let far = |space: usize| (vec![0.0, 1.0], space, "y".to_string(), 1.0);
        // One look-alike: first, but only a hint.
        let one = index(vec![near(1, 1.0), far(0)]).decide("write python", Some(q.clone()));
        assert_eq!((one.choices[0].space_id.as_str(), one.sure), ("pers", false));
        // Two of her own: sure.
        assert!(index(vec![near(1, 1.0), near(1, 1.0), far(0)]).decide("write python", Some(q.clone())).sure);
        // Two imported ones do not count as her choice.
        assert!(!index(vec![near(1, IMPORTED), near(1, IMPORTED), far(0)]).decide("write python", Some(q)).sure);
    }

    #[test]
    fn imported_titles_count_less_until_she_changes_them() {
        let c = open_in_memory().unwrap();
        let ts = chrono::Utc::now().to_rfc3339();
        c.execute_batch(&format!(
            "INSERT INTO import_sources (id, kind, name, location, space_id, created_at, updated_at) VALUES ('src', 'ics_url', 'School', 'https://x', 'seed-space-personal', '{ts}', '{ts}');
             INSERT INTO tasks (id, space_id, title, notes, sort_order, created_at, updated_at, source_id, locally_modified) VALUES
               ('a', 'seed-space-personal', 'imported deadline', '', 0, '{ts}', '{ts}', 'src', 0),
               ('b', 'seed-space-personal', 'moved by her', '', 0, '{ts}', '{ts}', 'src', 1),
               ('c', 'seed-space-personal', 'typed by her', '', 0, '{ts}', '{ts}', NULL, 0);"
        ))
        .unwrap();
        let (_, examples) = history(&c, chrono::Utc::now(), false).unwrap();
        let weight = |t: &str| examples.iter().find(|e| e.text == t).unwrap().weight;
        assert!((weight("imported deadline") - IMPORTED).abs() < 0.01);
        assert!(weight("moved by her") > 0.99 && weight("typed by her") > 0.99);
    }

    /// The real model, if present (MILO_M2V_DIR=<folder with tokenizer.json and model.safetensors>).
    #[test]
    #[ignore]
    fn the_real_model_knows_subjects() {
        let dir = std::env::var("MILO_M2V_DIR").expect("MILO_M2V_DIR");
        let m = StaticModel::load(Path::new(&dir)).unwrap();
        // Nearest of a few filed notes, as the suggestions use it.
        let filed = [("chemie labo verslag", "Chemistry"), ("shift in de winkel", "Work"), ("fysica oefeningen", "Physics"), ("mama bellen", "Personal")];
        let nearest = |q: &str| -> &str {
            let v = m.embed(q).unwrap();
            filed.iter().max_by(|a, b| {
                let s = |t: &str| m.embed(t).unwrap().iter().zip(&v).map(|(x, y)| x * y).sum::<f32>();
                s(a.0).total_cmp(&s(b.0))
            }).unwrap().1
        };
        assert_eq!(nearest("titratie in het labo"), "Chemistry");
        assert_eq!(nearest("shift zaterdag"), "Work");
        assert_eq!(nearest("physics problem set"), "Physics");
    }

    /// The real download into a temporary folder: size and hash checked, then usable.
    #[test]
    #[ignore]
    fn downloads_and_checks_the_model() {
        let dir = std::env::temp_dir().join(format!("milo-model-test-{}", crate::db::new_id()));
        let s = Suggester::new(&dir);
        assert!(!s.status().installed);
        let calls = std::cell::Cell::new(0);
        s.download(|done, total| { calls.set(calls.get() + 1); assert!(done <= total); }).unwrap();
        assert!(s.status().installed && !s.status().downloading);
        assert!(calls.get() <= 101, "progress once per percent, not per chunk");
        let out = s.suggest(&["chemie labo".into()], false, "k".into(), || {
            Ok((vec![("c".into(), "Chemistry".into()), ("w".into(), "Work".into())],
                vec![Example { text: "Chemistry".into(), space: 0, weight: 1.0 }, Example { text: "Work".into(), space: 1, weight: 1.0 }]))
        }).unwrap();
        assert_eq!(out[0].choices[0].space_id, "c");
        s.remove().unwrap();
        assert!(!s.status().installed);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// One situation, printed: MILO_CASE=<json {spaces: {name: [titles]}, notes: [text]}>.
    #[test]
    #[ignore]
    fn explain_case() {
        let model = StaticModel::load(Path::new(&std::env::var("MILO_M2V_DIR").unwrap())).unwrap();
        let case: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(std::env::var("MILO_CASE").unwrap()).unwrap()).unwrap();
        let mut spaces = Vec::new();
        let mut examples = Vec::new();
        for (i, (name, titles)) in case["spaces"].as_object().unwrap().iter().enumerate() {
            spaces.push((name.clone(), name.clone()));
            examples.push(Example { text: name.clone(), space: i, weight: 1.0 });
            for t in titles.as_array().unwrap() {
                examples.push(Example { text: t.as_str().unwrap().into(), space: i, weight: 1.0 });
            }
        }
        for (cap, support) in [(9, 1), (3, 1), (3, 2)] {
            let mut index = Index::build(spaces.clone(), &examples, Some(&model));
            index.per_space = cap;
            index.support = support;
            for n in case["notes"].as_array().unwrap() {
                let s = index.suggest(n.as_str().unwrap(), Some(&model));
                let top: Vec<String> = s.choices.iter().map(|c| format!("{} {:.2}", c.space_id, c.p)).collect();
                println!("cap {cap} support {support} | {:20} | {}{} | {}", n.as_str().unwrap(), if s.sure { "SURE " } else { "" }, top.join(", "), s.why.unwrap_or_default());
            }
        }
    }

    /// The 190 test notes in order, as in docs (MILO_NOTES=<notes.json>, MILO_M2V_DIR as above).
    #[test]
    #[ignore]
    fn the_test_notes_in_order() {
        let dir = std::env::var("MILO_M2V_DIR").expect("MILO_M2V_DIR");
        let model = StaticModel::load(Path::new(&dir)).unwrap();
        let notes: Vec<(String, String)> = serde_json::from_str(&std::fs::read_to_string(std::env::var("MILO_NOTES").unwrap()).unwrap()).unwrap();
        let names = ["Analysis 2", "Physics", "Chemistry", "Programming", "Personal", "Work", "Transport"];
        let spaces: Vec<(String, String)> = names.iter().map(|n| (n.to_string(), n.to_string())).collect();
        let mut examples: Vec<Example> = names.iter().enumerate().map(|(i, n)| Example { text: n.to_string(), space: i, weight: 1.0 }).collect();
        // A skewed start: many titles in Personal already (MILO_PRE=<json list of titles>).
        if let Ok(pre) = std::env::var("MILO_PRE") {
            let titles: Vec<String> = serde_json::from_str(&std::fs::read_to_string(pre).unwrap()).unwrap();
            examples.extend(titles.into_iter().map(|t| Example { text: t, space: 4, weight: 1.0 }));
        }
        let cap: usize = std::env::var("MILO_CAP").map(|c| c.parse().unwrap()).unwrap_or(PER_SPACE);
        let (mut sure, mut wrong, mut top3, mut asked) = (0, 0, 0, 0);
        let t0 = std::time::Instant::now();
        for (text, want) in &notes {
            let mut index = Index::build(spaces.clone(), &examples, Some(&model));
            index.per_space = cap;
            index.support = std::env::var("MILO_SUPPORT").map(|c| c.parse().unwrap()).unwrap_or(SUPPORT);
            let s = index.suggest(text, Some(&model));
            if s.sure {
                sure += 1;
                if s.choices[0].space_id != *want { wrong += 1; }
            } else {
                asked += 1;
                if s.choices.iter().any(|c| c.space_id == *want) { top3 += 1; }
            }
            examples.push(Example { text: text.clone(), space: names.iter().position(|n| n == want).unwrap(), weight: 1.0 });
        }
        let n = notes.len() as f64;
        println!("sure {:.0}% (wrong {:.0}%), asked {:.0}% (in top 3 {:.0}%), {:?} in all",
            100.0 * sure as f64 / n, 100.0 * wrong as f64 / n, 100.0 * asked as f64 / n, 100.0 * top3 as f64 / n, t0.elapsed());
    }
}
