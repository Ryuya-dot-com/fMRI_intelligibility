import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {validateManifest, validatePractice, participantList, makeOrder, csv} from '../site/core.mjs';

const root = new URL('../', import.meta.url);
const manifest = validateManifest(JSON.parse(await readFile(new URL('site/stimuli.json', root))));
const practice = validatePractice(JSON.parse(await readFile(new URL('site/practice.json', root))), manifest);
await mkdir(new URL('lists/', root), {recursive: true});
const all = [];
for (let id = 1; id <= 6; id++) {
  const selected = participantList(manifest, id);
  const lookup = new Map(selected.stimuli.map(s => [s.id, s]));
  const rows = makeOrder(selected.stimuli, id, manifest.version).map((key, i) => ({
    list: id, example_participant_id: id, example_trial_number: i + 1,
    ...lookup.get(key), reference_source: undefined,
  }));
  await writeFile(new URL(`lists/list_${id}.csv`, root), csv(rows));
  all.push(...rows);
}
await writeFile(new URL('lists/all_six_lists.csv', root), csv(all));
await writeFile(new URL('lists/common_anchors.csv', root), csv(practice.stimuli.map((s, i) => ({trial_number: i + 1, ...s}))));
await writeFile(new URL('lists/references_review.csv', root), csv([...practice.stimuli, ...manifest.stimuli].map(s => ({
  stimulus_id: s.id, audio_sha256: s.sha256, phase: s.condition === 'practice' ? 'practice' : 'main',
  sentence_id: s.sentence_id, script_text: s.text, script_kana: s.reference_kana,
  reviewed_reference_kana: '', reviewer: '', note: '',
}))));
console.log('Exported six lists, 288 combined rows, ten common anchors, and reference review template.');
