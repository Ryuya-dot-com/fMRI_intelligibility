import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {morae, resultScore} from '../site/core.mjs';
import {archiveBytes} from '../site/export.mjs';
import {readArchive, analyzeArchives, parseCsv} from '../tools/analyze.mjs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const practice = JSON.parse(read('site/practice.json'));
const references = JSON.parse(read('tools/practice_references.json'));
const reviewRows = parseCsv(read('lists/anchor_references.csv'));

test('all ten supplied keys have the intended mora counts and match the exact audio', () => {
  assert.equal(Object.keys(references).length, 10);
  assert.equal(reviewRows.length, 10);
  for (const s of practice.stimuli) {
    const ref = references[s.id];
    assert.equal(ref.text, s.text);
    assert.equal(ref.audio_sha256, s.sha256);
    assert.equal(ref.kana, s.reference_kana);
    assert.equal(morae(s.reference_kana).length, ref.moras);
    assert.equal(s.reference_status, 'verified');
    const exact = resultScore(s, s.reference_kana, 'study');
    assert.equal(exact.score_status, 'automatic');
    assert.equal(exact.correct_mora_count, ref.moras);
    assert.equal(exact.proportion_correct, 1);
    assert.equal(resultScore(s, '', 'study').proportion_correct, 0);
    assert.equal(resultScore(s, s.text, 'study').score_status, 'pending_reading');
  }
  const arabic = practice.stimuli.find(s => s.speaker_id === 'KYO_M15_Arabic');
  assert.match(arabic.reference_kana, /ずっと.*じゅっと/);
  assert.ok(resultScore(arabic, arabic.reference_kana.replace('じゅっと', 'ずっと'), 'study').proportion_correct < 1);
});

test('provided keys rescore pre-registration ZIPs and yield an anchor-only summary', () => {
  const oldPractice = structuredClone(practice);
  oldPractice.version = 'shared-human-anchors-10-v1';
  oldPractice.stimuli.forEach(s => Object.assign(s, {reference_kana: '', reference_status: 'missing'}));
  const session = {id: 'old-anchor-fixture', participant_id: '900009', counterbalance_list: 3,
    practice: oldPractice, practice_order: oldPractice.stimuli.map(s => s.id),
    manifest: {mode: 'study', stimuli: []}, order: [], status: 'completed',
    trials: practice.stimuli.map((s, index) => ({phase: 'practice', trial_number: index + 1, session_trial_number: index + 1,
      stimulus_id: s.id, audio_sha256: s.sha256, trial_status: 'completed', audio_completed: true,
      response: s.reference_kana, ...resultScore(oldPractice.stimuli[index], s.reference_kana, 'study')}))};
  const archive = readArchive(archiveBytes(session, []));
  const output = analyzeArchives([archive], [], reviewRows);
  assert.equal(output.summaries[0].scored_trials, 10);
  assert.equal(output.summaries[0].all_planned_trials_scored, true);
  assert.equal(output.summaries[0].mora_weighted_accuracy, 1);
  assert.equal(output.summaries[0].reference_mora_count, 161);
  assert.equal(output.summaries[1].scored_trials, 0);
  assert.equal(output.summaries[1].mora_weighted_accuracy, '');
  assert.ok(output.analysis.every(row => row.analysis_eligible_anchor && !row.analysis_eligible_main));
  assert.ok(archive.trials.every(row => row.score_status === 'pending_reference'));
});
