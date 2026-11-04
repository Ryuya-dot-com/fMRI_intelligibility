import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {unzipSync, strFromU8} from '../site/vendor/fflate-0.8.2.mjs';
import {csv, resultScore, normalizeKana, validKana} from '../site/core.mjs';

export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ',' || c === '\r' || c === '\n') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else {
      if (closed || c === '"') throw new Error('Invalid CSV quoting');
      field += c;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  const columns = rows.shift() || [];
  if (new Set(columns).size !== columns.length) throw new Error('Duplicate CSV columns');
  return rows.map(values => {
    if (values.length !== columns.length) throw new Error('CSV column count mismatch');
    return Object.fromEntries(columns.map((c, i) => [c, values[i]]));
  });
}

// A reference points to a full string, never a patch or a guessed IME reading.
export function expandEventValues(events) {
  const values = new Map();
  return events.map(event => {
    if (event.value_json !== '' && event.value_json != null) {
      if (typeof JSON.parse(event.value_json) !== 'string') throw new Error('Invalid text snapshot');
      values.set(String(event.seq), event);
    }
    if (event.value_seq === '' || event.value_seq == null) return event;
    const source = values.get(String(event.value_seq));
    if (!source || source.session_trial_number !== event.session_trial_number || source.session_id !== event.session_id) throw new Error(`Broken text reference at event ${event.seq}`);
    return {...event, value_json: source.value_json};
  });
}

export function readArchive(bytes) {
  const files = unzipSync(bytes);
  for (const name of ['session.json', 'schedule.csv', 'trials.csv', 'events.csv']) if (!files[name]) throw new Error(`Missing ${name}`);
  const session = JSON.parse(strFromU8(files['session.json']));
  if (session.export_version !== 'split-tables-v1') throw new Error('Unsupported archive version');
  const trials = parseCsv(strFromU8(files['trials.csv']));
  const events = parseCsv(strFromU8(files['events.csv']));
  if (events.length !== session.event_count || trials.length !== session.observed_trial_count) throw new Error('Archive row counts disagree');
  const ids = new Set();
  for (const t of trials) {
    if (t.session_id !== session.id || ids.has(t.session_trial_number)) throw new Error('Invalid or duplicate trial identity');
    ids.add(t.session_trial_number);
  }
  for (const [index, e] of events.entries()) if (e.session_id !== session.id || Number(e.seq) !== index + 1) throw new Error('Missing, reordered or duplicate event');
  expandEventValues(events);
  return {session, trials, events};
}

const key = row => `${row.session_id}:${row.session_trial_number}`;
export function analyzeArchives(archives, readings = []) {
  const reviews = new Map();
  for (const row of readings) {
    if (!row.reviewed_reading?.trim()) continue;
    if (!row.reviewer?.trim() || !validKana(row.reviewed_reading) || !normalizeKana(row.reviewed_reading)) throw new Error('Each reviewed reading needs kana and a reviewer');
    if (reviews.has(key(row))) throw new Error(`Duplicate review: ${key(row)}`);
    reviews.set(key(row), row);
  }
  const used = new Set(), seen = new Set(), analysis = [], pending = [];
  for (const {session, trials} of archives) {
    if (seen.has(session.id)) throw new Error(`Duplicate session: ${session.id}`);
    seen.add(session.id);
    for (const trial of trials) {
      const row = {...trial, recorded_score_status: trial.score_status, review_reviewer: '', review_note: ''};
      const review = reviews.get(key(trial));
      if (review) {
        if (review.response_json !== trial.response_json) throw new Error(`Review response mismatch: ${key(trial)}`);
        if (trial.trial_status !== 'completed' || trial.audio_completed !== 'true') throw new Error('Cannot score an incomplete trial');
        const source = trial.phase === 'practice' ? session.practice : session.manifest;
        const mode = trial.phase === 'practice' ? 'study' : session.manifest.mode;
        if (mode === 'placeholder') throw new Error('Placeholder audio cannot be scored');
        const stimulus = source.stimuli.find(s => s.id === trial.stimulus_id);
        if (!stimulus) throw new Error('Missing scoring reference');
        const score = resultScore(stimulus, review.reviewed_reading, mode);
        if (!['automatic', 'review_alignment'].includes(score.score_status)) throw new Error(`Invalid reviewed reading: ${key(trial)}`);
        Object.assign(row, score, {reading_status: 'human_confirmed', reading_method: 'human_review', review_reviewer: review.reviewer, review_note: review.note || ''});
        used.add(key(trial));
      }
      row.analysis_eligible_main = trial.phase === 'main' && trial.trial_status === 'completed' && trial.audio_completed === 'true' && row.score_status === 'automatic';
      analysis.push(row);
      if (trial.trial_status === 'completed' && trial.audio_completed === 'true' && row.reading_status === 'needs_review' && row.score_status !== 'placeholder_not_scored') pending.push({session_id: session.id, session_trial_number: trial.session_trial_number, phase: trial.phase, stimulus_id: trial.stimulus_id, response_json: trial.response_json, reviewed_reading: '', reviewer: '', note: ''});
    }
  }
  for (const id of reviews.keys()) if (!used.has(id)) throw new Error(`Unmatched review: ${id}`);
  return {analysis, pending};
}

export async function main(args) {
  let output, reviewFile; const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') output = args[++i];
    else if (args[i] === '--readings') reviewFile = args[++i];
    else if (args[i].startsWith('--')) throw new Error(`Unknown option: ${args[i]}`);
    else paths.push(args[i]);
  }
  if (!output || !paths.length) throw new Error('Usage: node tools/analyze.mjs records.zip [more.zip ...] --out NEW_DIRECTORY [--readings reviewed.csv]');
  const archives = [];
  for (const path of paths) {
    const {session, trials} = readArchive(new Uint8Array(await readFile(path)));
    archives.push({session, trials}); // Detailed events are released between participants.
  }
  const readings = reviewFile ? parseCsv(await readFile(reviewFile, 'utf8')) : [];
  const {analysis, pending} = analyzeArchives(archives, readings);
  await mkdir(output); // Never overwrite a previous analysis or raw archive.
  await writeFile(join(output, 'analysis_trials.csv'), csv(analysis), {flag: 'wx'});
  await writeFile(join(output, 'readings_review.csv'), csv(pending, ['session_id', 'session_trial_number', 'phase', 'stimulus_id', 'response_json', 'reviewed_reading', 'reviewer', 'note']), {flag: 'wx'});
  return {sessions: archives.length, trials: analysis.length, pending_readings: pending.length, output: resolve(output)};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
