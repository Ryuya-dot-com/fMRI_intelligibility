import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {participantId, participantName, participantList, makeOrder, morae, scoreMora, validResponse, validateManifest, validatePractice, resultScore, csv, exportRows} from '../site/core.mjs';
const manifest = JSON.parse(readFileSync(new URL('../site/stimuli.json', import.meta.url)));
const practice = JSON.parse(readFileSync(new URL('../site/practice.json', import.meta.url)));

test('ten shared anchors use different sentences and audio from all 288 main recordings', () => {
  validatePractice(practice, manifest);
  assert.equal(practice.stimuli.length, 10);
  const collision = structuredClone(practice);
  collision.stimuli[0].sha256 = manifest.stimuli[0].sha256;
  assert.throws(() => validatePractice(collision, manifest));
  collision.stimuli[0] = {...practice.stimuli[0], sentence_id: manifest.stimuli[0].sentence_id};
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

test('six complementary lists cover all recordings, with 48 unique sentences and 4 per speaker', () => {
  validateManifest(manifest);
  const used = [];
  for (let id = 1; id <= 6; id++) {
    const list = participantList(manifest, id);
    assert.equal(list.id, id);
    assert.equal(list.stimuli.length, 48);
    assert.equal(new Set(list.stimuli.map(s => s.sentence_id)).size, 48);
    for (const speaker of new Set(manifest.stimuli.map(s => s.speaker_id))) assert.equal(list.stimuli.filter(s => s.speaker_id === speaker).length, 4);
    used.push(...list.stimuli.map(s => s.id));
  }
  assert.equal(new Set(used).size, 288);
  assert.deepEqual(used.sort(), manifest.stimuli.map(s => s.id).sort());
  const bad = structuredClone(manifest);
  bad.lists[1].stimulus_ids[0] = bad.lists[0].stimulus_ids[0];
  assert.throws(() => validateManifest(bad));
  bad.lists = structuredClone(manifest.lists);
  bad.lists[0].stimulus_ids[0] = 'missing';
  assert.throws(() => validateManifest(bad));
});

test('1000 participant schedules preserve assigned lists and forbid three consecutive conditions', () => {
  const firstConditions = new Set();
  for (let id = 1; id <= 1000; id++) {
    const {stimuli, id: listId} = participantList(manifest, id);
    assert.equal(listId, (id - 1) % 6 + 1);
    const lookup = new Map(stimuli.map(s => [s.id, s]));
    const order = makeOrder(stimuli, id, manifest.version);
    assert.equal(new Set(order).size, 48);
    assert.deepEqual([...order].sort(), stimuli.map(s => s.id).sort());
    const conditions = order.map(s => lookup.get(s).condition);
    firstConditions.add(conditions[0]);
    for (let i = 2; i < 48; i++) assert.ok(!(conditions[i] === conditions[i - 1] && conditions[i] === conditions[i - 2]));
  }
  const selected = participantList(manifest, 1).stimuli;
  assert.equal(firstConditions.size, 3);
  assert.deepEqual(participantList(manifest, '001'), participantList(manifest, 1));
  assert.deepEqual(makeOrder(selected, '001', manifest.version), makeOrder(selected, 1, manifest.version));
  assert.notDeepEqual(makeOrder(selected, 1, manifest.version), makeOrder(selected, 7, manifest.version));
  assert.equal(participantList(manifest, '999999999999').id, 3);
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
  assert.equal(validResponse('学校'), true);
  assert.equal(validResponse('ガッコウ'), true);
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
  assert.equal(resultScore({reference_kana: 'ねこ'}, '猫', 'study').score_status, 'pending_reading');
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
  const session = {id: 'test', participant_id: '1', manifest, order: makeOrder(participantList(manifest, 1).stimuli, 1, manifest.version), trials: [{trial_number: 1, trial_status: 'interrupted', response: 'ねこ'}]};
  const rows = exportRows(session, [{event_type: 'input', value_json: '"ねこ"'}]);
  assert.equal(rows.filter(r => r.row_type === 'schedule').length, 48);
  assert.equal(rows.filter(r => r.row_type === 'trial').length, 1);
  assert.equal(rows.filter(r => r.row_type === 'event').length, 1);
  assert.equal(rows.find(r => r.row_type === 'trial').proportion_correct, undefined);
});


test('mixed scripts preserve raw input, normalize only kana and defer uncertain readings', () => {
  for (const answer of ['ガッコウ', 'ｶﾞｯｺｳ', 'がっこう']) {
    const score = resultScore({reference_kana: 'がっこう'}, answer, 'study');
    assert.equal(score.proportion_correct, 1);
    assert.equal(score.response_reading, 'がっこう');
  }
  for (const answer of ['学校', '学校でパン', '123', 'abc']) {
    assert.equal(validResponse(answer), true);
    const score = resultScore({reference_kana: 'がっこう'}, answer, 'study');
    assert.equal(score.reading_status, 'needs_review');
    assert.equal(score.proportion_correct, undefined);
  }
  assert.equal(validResponse('あ'.repeat(2001)), false);
  assert.equal(validResponse(String.fromCharCode(0)), false);
});

test('missing references and unverified script references are never final scores', () => {
  assert.equal(resultScore({reference_kana: '', reference_status: 'missing'}, '', 'study').score_status, 'pending_reference');
  assert.equal(resultScore({reference_kana: '', reference_status: 'missing'}, '', 'study').proportion_correct, undefined);
  const provisional = resultScore({reference_kana: 'ねこ', reference_status: 'script_unverified'}, 'ねこ', 'study');
  assert.equal(provisional.proportion_correct, 1);
  assert.equal(provisional.score_status, 'review_reference');
});
