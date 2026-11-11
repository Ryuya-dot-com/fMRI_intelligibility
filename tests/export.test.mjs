import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {csv, resultScore, exportRows, participantList, VERSION} from '../site/core.mjs';
import {exportTables, archiveBytes, trialMetrics} from '../site/export.mjs';
import {readArchive, analyzeArchives, parseCsv, expandEventValues, main} from '../tools/analyze.mjs';
import {sessionMetadata} from '../site/storage.mjs';
import {unzipSync} from '../site/vendor/fflate-0.8.2.mjs';
const practice = JSON.parse(readFileSync(new URL('../site/practice.json', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../site/stimuli.json', import.meta.url)));
function fixture() {
  const localPractice = structuredClone(practice);
  const s = localPractice.stimuli[0];
  Object.assign(s, {reference_kana: 'あしたはともだちとこうえんまであるきます', reference_status: 'verified'});
  const trial = {phase: 'practice', trial_number: 1, session_trial_number: 1, stimulus_id: s.id, trial_status: 'completed', response: '明日は友達と公園まで歩きます。', audio_completed: true, audio_started_perf_ms: 100, audio_ended_perf_ms: 500, submitted_perf_ms: 1000, ...resultScore(s, '明日は友達と公園まで歩きます。', 'study')};
  const session = {id: 'session-a', participant_id: '900008', participant_name: '架空氏名', app_version: VERSION, manifest, practice: localPractice, counterbalance_list: 2, practice_order: practice.stimuli.map(s => s.id), order: participantList(manifest, 2).stimuli.map(s => s.id), status: 'completed', log_version: 'value-reference-v1', trials: [trial]};
  const common = {session_id: session.id, phase: 'practice', trial_number: 1, session_trial_number: 1};
  const events = [{...common, seq: 1, event_type: 'input', event_perf_ms: 250.125, event_system_epoch_ms: 1700000000000, browser_event_timestamp_ms: 249.75, value_json: JSON.stringify(trial.response), value_seq: 1, input_data_json: JSON.stringify(trial.response), input_type: 'insertText', is_composing: false}, {...common, seq: 2, event_type: 'keyup', event_perf_ms: 251.875, value_seq: 1, key_json: '"Enter"'}];
  return {session, events};
}

test('ZIP tables preserve original text, clocks and references without copying identity', () => {
  const {session, events} = fixture();
  const tables = exportTables(session, events);
  assert.equal(Object.keys(tables).length, 4);
  for (const name of ['schedule.csv', 'trials.csv', 'events.csv']) assert.ok(!tables[name].includes('架空氏名'));
  const restored = readArchive(archiveBytes(session, events));
  assert.equal(JSON.parse(restored.trials[0].response_json), session.trials[0].response);
  assert.equal(restored.events[0].event_perf_ms, '250.125');
  assert.equal(restored.events[0].browser_event_timestamp_ms, '249.75');
  assert.equal(expandEventValues(restored.events)[1].value_json, JSON.stringify(session.trials[0].response));
  assert.throws(() => expandEventValues([{...restored.events[1], value_seq: 999}]));
  assert.throws(() => expandEventValues([restored.events[0], {...restored.events[1], session_trial_number: '2'}]));
  const metadata = sessionMetadata(session);
  assert.equal(metadata.trials, undefined);
  assert.equal(metadata.trial_counts.practice, 1);
});

test('human reading review is matched to exact raw response and never overwrites originals', () => {
  const {session, events} = fixture();
  const archive = readArchive(archiveBytes(session, events));
  const before = analyzeArchives([archive]);
  assert.equal(before.pending.length, 1);
  assert.equal(before.analysis[0].correct_mora_count, undefined);
  const review = {...before.pending[0], reviewed_reading: session.practice.stimuli[0].reference_kana, reviewer: 'r1'};
  const after = analyzeArchives([archive], [review]);
  assert.equal(after.pending.length, 0);
  assert.equal(after.analysis[0].correct_mora_count, 20);
  assert.equal(after.analysis[0].reading_status, 'human_confirmed');
  assert.equal(after.analysis[0].analysis_eligible_main, false);
  assert.equal(archive.trials[0].score_status, 'pending_reading');
  assert.throws(() => analyzeArchives([archive], [{...review, response_json: '"違う回答"'}]), /mismatch/);
  assert.throws(() => analyzeArchives([archive], [review, review]), /Duplicate/);
  assert.throws(() => analyzeArchives([archive], [{...review, reviewer: ''}]), /reviewer/);
  assert.throws(() => analyzeArchives([archive], [{...review, session_id: 'other'}]), /Unmatched/);
  assert.throws(() => analyzeArchives([archive, archive]), /Duplicate session/);
  const aborted = structuredClone(archive); aborted.trials[0].trial_status = 'interrupted';
  assert.throws(() => analyzeArchives([aborted], [review]), /incomplete/);
});

test('verified anchor references rescore saved answers and summaries keep phases separate', () => {
  const {session, events} = fixture();
  session.practice.stimuli[0].reference_kana = '';
  session.practice.stimuli[0].reference_status = 'missing';
  const anchor = session.practice.stimuli[0];
  Object.assign(session.trials[0], {response: 'ねこ', score_status: 'pending_reference', reading_status: 'automatic_kana', response_reading: 'ねこ'});
  const mainStimulus = session.manifest.stimuli.find(s => s.id === session.order[0]);
  session.trials.push({phase: 'main', trial_number: 1, session_trial_number: 11, stimulus_id: mainStimulus.id,
    trial_status: 'completed', audio_completed: true, response: mainStimulus.reference_kana,
    ...resultScore(mainStimulus, mainStimulus.reference_kana, 'study')});
  const archive = readArchive(archiveBytes(session, events));
  const before = analyzeArchives([archive]);
  assert.ok(before.summaries.every(row => row.scored_trials === 0 && row.mora_weighted_accuracy === ''));
  const target = {stimulus_id: anchor.id, audio_sha256: anchor.sha256, reviewed_reference_kana: 'ねこ', reviewer: 'r1'};
  const after = analyzeArchives([archive], [], [target]);
  assert.equal(after.analysis[0].correct_mora_count, 2);
  assert.equal(after.analysis[0].analysis_eligible_anchor, true);
  assert.equal(after.analysis[0].analysis_eligible_main, false);
  assert.equal(after.analysis[1].score_status, 'review_reference');
  assert.equal(after.summaries[0].phase_role, 'common_anchor');
  assert.equal(after.summaries[0].planned_trials, 10);
  assert.equal(after.summaries[0].scored_trials, 1);
  assert.equal(after.summaries[0].all_planned_trials_scored, false);
  assert.equal(after.summaries[0].mora_weighted_accuracy, 1);
  assert.equal(after.summaries[1].planned_trials, 48);
  assert.equal(after.summaries[1].scored_trials, 0);
  assert.equal(archive.trials[0].score_status, 'pending_reference');
  assert.throws(() => analyzeArchives([archive], [], [target, target]), /Duplicate reference/);
  assert.throws(() => analyzeArchives([archive], [], [{...target, reviewer: ''}]), /reviewer/);
  const mismatch = analyzeArchives([archive], [], [{...target, audio_sha256: '0'.repeat(64)}]);
  assert.equal(mismatch.analysis[0].score_status, 'pending_reference');
  archive.trials[0].trial_status = 'interrupted';
  const interrupted = analyzeArchives([archive], [], [target]);
  assert.equal(interrupted.summaries[0].scored_trials, 0);
});

test('CSV parsing retains multiline JSON, punctuation, quotes, BOM and empty fields', () => {
  const rows = [{response_json: JSON.stringify('猫,\n"犬"'), note: 'a\r\nb', empty: ''}];
  assert.deepEqual(parseCsv(csv(rows)), rows);
  assert.deepEqual(parseCsv(csv([], ['a', 'b'])), []);
  assert.throws(() => parseCsv('"a","a"\n"1","2"'), /Duplicate/);
  assert.throws(() => parseCsv('a,b\n1'), /count/);
  assert.throws(() => parseCsv('a\n"broken'), /Unclosed/);
});

test('metrics separate composition from deletion and preserve zero/no-input cases', () => {
  const {session, events} = fixture();
  const metrics = trialMetrics(session.trials[0], events);
  assert.equal(metrics.first_keydown_callback_latency_ms, '');
  assert.equal(metrics.first_input_callback_latency_ms, 150.125);
  assert.equal(metrics.first_commit_callback_latency_ms, 150.125);
  assert.equal(metrics.post_audio_submit_ms, 500);
  assert.equal(trialMetrics({}, []).post_audio_submit_ms, '');
  const input = (is_composing, input_type) => ({event_type: 'input', is_composing, input_type});
  assert.equal(trialMetrics({}, [input(true, 'deleteContentBackward'), input('false', 'deleteContentBackward')]).noncomposition_delete_event_count, 1);
});

test('empty early session and older events can be exported without synthetic trials/events', () => {
  const {session, events} = fixture();
  session.trials = [];
  const empty = readArchive(archiveBytes(session, []));
  assert.equal(empty.events.length, 0);
  assert.equal(empty.trials.length, 0);
  delete events[0].value_seq; delete events[1].value_seq;
  events[1].value_json = events[0].value_json;
  const older = readArchive(archiveBytes(session, events));
  assert.equal(expandEventValues(older.events)[1].value_json, events[1].value_json);
});

test('12,000 events remain intact through compact ZIP and analysis', () => {
  const {session, events} = fixture();
  const full = Array.from({length: 12000}, (_, i) => ({...events[0], seq: i + 1, event_perf_ms: 250 + i * 4.125, value_seq: 1, ...(i ? {value_json: undefined} : {})}));
  const start = performance.now();
  const bytes = archiveBytes(session, full);
  const restored = readArchive(bytes);
  assert.equal(restored.events.length, full.length);
  assert.equal(expandEventValues(restored.events).at(-1).value_json, events[0].value_json);
  const oldBytes = Buffer.byteLength(csv(exportRows(session, full)));
  assert.ok(bytes.length < oldBytes / 3);
  console.log(JSON.stringify({benchmark: '12000_synthetic_events', legacy_csv_bytes: oldBytes, zip_bytes: bytes.length, export_and_import_ms: performance.now() - start}));
});

test('analysis command creates separate outputs and refuses existing output directories', async () => {
  const {session, events} = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'intelligibility-analysis-'));
  const {writeFile} = await import('node:fs/promises');
  try {
    const path = join(dir, 'record.zip'); await writeFile(path, archiveBytes(session, events));
    const out = join(dir, 'analysis');
    const result = await main([path, '--out', out]);
    assert.equal(result.pending_readings, 1);
    assert.ok(existsSync(join(out, 'analysis_trials.csv')));
    assert.ok(existsSync(join(out, 'readings_review.csv')));
    await assert.rejects(main([path, '--out', out]), /EEXIST/);
  } finally { rmSync(dir, {recursive: true}); }
});


test('UTF-8 BOM CSV displays final answers and preserves Japanese, supplementary kanji and punctuation', () => {
  const {session, events} = fixture();
  for (const answer of ['学校でパンを買った。', 'ガッコウ・ｶﾞｯｺｳ', '髙橋𠮷野', '猫,"犬"\n鳥', '=1+1']) {
    session.trials[0].response = answer;
    const bytes = unzipSync(archiveBytes(session, events))['trials.csv'];
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const [row] = parseCsv(text);
    assert.equal(row.response, answer.startsWith('=') ? "'" + answer : answer);
    assert.equal(JSON.parse(row.response_json), answer);
  }
});
