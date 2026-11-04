import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {participantId, participantName, makeOrder, morae, scoreMora, validResponse, validateManifest, validatePractice, resultScore, csv, exportRows} from '../site/core.mjs';
const manifest = JSON.parse(readFileSync(new URL('../site/stimuli.json', import.meta.url)));
const practice = JSON.parse(readFileSync(new URL('../site/practice.json', import.meta.url)));

test('four distinct practice sentences contain exactly 20 morae, verified against manual segments', () => {
  validatePractice(practice, manifest);
  for (const s of practice.stimuli) {
    assert.equal(morae(s.reference_kana).length, 20);
    assert.deepEqual(morae(s.reference_kana), s.mora_segments);
  }
  const invalid = structuredClone(practice);
  invalid.stimuli[0].reference_kana += 'ね';
  assert.throws(() => validatePractice(invalid, manifest));
  const collision = structuredClone(practice);
  collision.stimuli[0].id = manifest.stimuli[0].id;
  assert.throws(() => validatePractice(collision, manifest));
});

test('participant name required; Unicode and exact export are preserved safely', () => {
  assert.equal(participantName('  動作確認用  '), '動作確認用');
  for (const name of ['', '  ', '\n', 'あ'.repeat(101), '姓\n名', null]) assert.throws(() => participantName(name));
  const s = {participant_name: '=1+1', manifest, order: [], trials: []};
  const rows = exportRows(s, []);
  assert.equal(JSON.parse(rows[0].participant_name_json), '=1+1');
  assert.ok(csv(rows).includes("'=1+1"));
});

test('36 unique sentences, four speakers per condition, three trials per speaker', () => {
  validateManifest(manifest);
  const bad = structuredClone(manifest);
  bad.stimuli[0].speaker_id = 'bad';
  assert.throws(() => validateManifest(bad));
  const production = {...manifest, mode: 'study'};
  assert.throws(() => validateManifest(production));
});

test('1000 participant schedules preserve counts and forbid three consecutive conditions', () => {
  const firstConditions = new Set();
  const lookup = new Map(manifest.stimuli.map(s => [s.id, s]));
  for (let id = 1; id <= 1000; id++) {
    const order = makeOrder(manifest.stimuli, id, manifest.version);
    assert.equal(new Set(order).size, 36);
    assert.deepEqual([...order].sort(), manifest.stimuli.map(s => s.id).sort());
    const conditions = order.map(s => lookup.get(s).condition);
    firstConditions.add(conditions[0]);
    for (let i = 2; i < 36; i++) assert.ok(!(conditions[i] === conditions[i - 1] && conditions[i] === conditions[i - 2]));
  }
  assert.equal(firstConditions.size, 3);
  assert.deepEqual(makeOrder(manifest.stimuli, '001', manifest.version), makeOrder(manifest.stimuli, 1, manifest.version));
  assert.notDeepEqual(makeOrder(manifest.stimuli, 1, manifest.version), makeOrder(manifest.stimuli, 49, manifest.version));
  assert.throws(() => participantId('0'));
  assert.throws(() => participantId('1.2'));
});

test('all WAV hashes match and contain actual PCM audio', () => {
  for (const s of [...manifest.stimuli, ...practice.stimuli]) {
    const bytes = readFileSync(new URL(`../site/${s.audio}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), s.sha256);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.ok(s.frames > s.sample_rate / 2);
  }
});

test('mora segmentation handles contracted sounds, sokuon, nasal and long vowels', () => {
  assert.deepEqual(morae('きょう、がっこう。'), ['きょ', 'う', 'が', 'っ', 'こ', 'う']);
  assert.deepEqual(morae('しんぶんとこーひー'), ['し', 'ん', 'ぶ', 'ん', 'と', 'こ', 'ー', 'ひ', 'ー']);
  assert.deepEqual(morae('か\u3099'), ['が']);
  assert.equal(validResponse('学校'), false);
  assert.equal(validResponse('ガッコウ'), false);
  assert.throws(() => morae('ゃ'));
  assert.throws(() => morae('っゃ'));
});

test('score is matched morae / full reference, not one minus edit error rate', () => {
  assert.equal(scoreMora('ねこ', 'ねこ').proportion_correct, 1);
  assert.equal(scoreMora('ねこ', '').proportion_correct, 0);
  assert.equal(scoreMora('ねこ', 'いぬ').proportion_correct, 0);
  const insertion = scoreMora('ねこ', 'ねこだ');
  assert.equal(insertion.correct_mora_count, 2);
  assert.equal(insertion.insertions, 1);
  assert.equal(insertion.proportion_correct, 1);
  const deletion = scoreMora('ねこです', 'ねこす');
  assert.equal(deletion.deletions, 1);
  assert.equal(deletion.proportion_correct, 0.75);
  assert.equal(scoreMora('ねこ', 'ねご').substitutions, 1);
  assert.equal(scoreMora('ねこ', 'こね').alignment_ambiguous, true);
  assert.equal(scoreMora('こうこう', 'こーこー').proportion_correct, 0.5);
});

test('non-scored placeholders and invalid response never become zero performance', () => {
  assert.equal(resultScore(manifest.stimuli[0], 'ねこ', 'placeholder').proportion_correct, undefined);
  assert.equal(resultScore({reference_kana: 'ねこ'}, '猫', 'study').score_status, 'review_response');
  const alias = resultScore({reference_kana: 'こうこう', accepted_variants_kana: ['こーこー']}, 'こーこー', 'study');
  assert.equal(alias.proportion_correct, 1);
  assert.equal(alias.scored_reference_kana, 'こーこー');
});

test('CSV retains Unicode, commas, newlines, quotes and guards formulas', () => {
  const result = csv([{value: 'ねこ,\n"あ"', key: '=1+1', raw_json: JSON.stringify('=1+1')}]);
  assert.ok(result.startsWith('\uFEFF'));
  assert.ok(result.includes('ねこ,\n""あ""'));
  assert.ok(result.includes("'=1+1"));
  assert.ok(result.includes('""=1+1""'));
});

test('CSV separates scheduled, observed and event rows, and leaves unpresented trials unobserved', () => {
  const session = {id: 'test', participant_id: '1', manifest, order: makeOrder(manifest.stimuli, 1, manifest.version), trials: [{trial_number: 1, trial_status: 'interrupted', response: 'ねこ'}]};
  const rows = exportRows(session, [{event_type: 'input', value_json: '"ねこ"'}]);
  assert.equal(rows.filter(r => r.row_type === 'schedule').length, 36);
  assert.equal(rows.filter(r => r.row_type === 'trial').length, 1);
  assert.equal(rows.filter(r => r.row_type === 'event').length, 1);
  assert.equal(rows.find(r => r.row_type === 'trial').proportion_correct, undefined);
});
