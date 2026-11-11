"""Copy the approved MRI WAVs unchanged and build six complementary 48-item lists."""
import csv
import hashlib
import json
import random
import re
import shutil
import wave
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MRI = ROOT.parent / 'Experiment'
VERSION = 'mri-288-six-lists-v1'
GROUPS = {'japanese': 'Japanese', 'east_asian': 'Asian', 'romance': 'Romance'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def script_references(path):
    # FINAL_B1+B2 only; the second sheet is an older selection.
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as book:
        strings = [''.join(s.itertext()) for s in ET.fromstring(book.read('xl/sharedStrings.xml'))]
        rows = ET.fromstring(book.read('xl/worksheets/sheet1.xml')).findall('s:sheetData/s:row', ns)
    result = {}
    for row in rows:
        values = {}
        for cell in row.findall('s:c', ns):
            value = cell.find('s:v', ns)
            if value is not None:
                values[re.sub(r'\d+', '', cell.get('r'))] = strings[int(value.text)] if cell.get('t') == 's' else value.text
        if values.get('A', '').isdigit() and values.get('E'):
            result[f"S{int(values['A']):03}"] = {'text': values['B'].strip(), 'kana': values['E'].strip(), 'moras': int(values['D'])}
    assert len(result) == 48
    return result


def main():
    table = MRI / 'stimuli.csv'
    workbook = MRI / 'materials/FINAL_list of selected sentences.xlsx'
    rows = list(csv.DictReader(table.open(encoding='utf-8-sig')))
    main_rows = [r for r in rows if r['phase'] == 'main']
    practice_rows = [r for r in rows if r['phase'] == 'practice']
    assert len(main_rows) == 288 and len(practice_rows) == 10
    assert len({r['sentence_id'] for r in main_rows}) == 48
    assert not {r['sentence_id'] for r in main_rows} & {r['sentence_id'] for r in practice_rows}
    references = script_references(workbook)
    # This small input file can hold verified references without editing MRI materials.
    practice_reference_path = ROOT / 'tools/practice_references.json'
    practice_references = json.loads(practice_reference_path.read_text()) if practice_reference_path.exists() else {}
    all_stimuli = []
    for row in rows:
        source = MRI / row['audio_file']
        sha = digest(source)
        assert sha == row['expected_audio_sha256'], row['stimulus_id']
        target = ROOT / 'site/audio' / source.name
        if target.exists():
            assert digest(target) == sha, f'Refusing to overwrite different audio: {target}'
        else:
            shutil.copyfile(source, target)
        with wave.open(str(source)) as wav:
            rate, frames, channels = wav.getframerate(), wav.getnframes(), wav.getnchannels()
        ref = references.get(row['sentence_id'], {}) if row['phase'] == 'main' else practice_references.get(row['stimulus_id'], {})
        if row['phase'] == 'main':
            assert re.sub(r'\s+', '', ref['text']) == re.sub(r'\s+', '', row['sentence_text'])
        all_stimuli.append({
            'id': row['stimulus_id'], 'sentence_id': row['sentence_id'], 'speaker_id': row['speaker_id'],
            'condition': GROUPS[row['language_group']] if row['phase'] == 'main' else 'practice',
            'speaker_l1': row['speaker_l1'], 'source_sentence_set': row['source_sentence_set'],
            'sentence_list': row['sentence_list'], 'text': ref.get('text', ''),
            'reference_kana': ref.get('kana', ''), 'reference_status': ref.get('status', 'script_unverified' if ref else 'missing'),
            'reference_source': ref.get('source', 'FINAL_list of selected sentences.xlsx / FINAL_B1+B2' if ref else ''),
            'audio': f'audio/{source.name}', 'sha256': sha, 'sample_rate': rate, 'frames': frames,
            'channels': channels, 'duration_s': frames / rate,
        })
    stimuli = [s for s in all_stimuli if s['condition'] != 'practice']
    lookup = {(s['sentence_id'], s['speaker_id']): s['id'] for s in stimuli}
    lists = [{'id': i + 1, 'stimulus_ids': []} for i in range(6)]
    for block in ('B1', 'B2'):
        speakers = sorted({s['speaker_id'] for s in stimuli if s['source_sentence_set'] == block})
        assert len(speakers) == 6
        for pool in ('P1', 'P2'):
            sentences = sorted({s['sentence_id'] for s in stimuli if s['source_sentence_set'] == block and s['sentence_list'] == pool})
            assert len(sentences) == 12
            random.Random(f'{VERSION}:{block}:{pool}').shuffle(sentences)
            for index, sentence in enumerate(sentences):
                for offset, item in enumerate(lists):
                    item['stimulus_ids'].append(lookup[sentence, speakers[(index + offset) % 6]])
    by_id = {s['id']: s for s in stimuli}
    assert Counter(i for item in lists for i in item['stimulus_ids']) == Counter(by_id.keys())
    for item in lists:
        selected = [by_id[i] for i in item['stimulus_ids']]
        assert len(selected) == len({s['sentence_id'] for s in selected}) == 48
        assert set(Counter(s['speaker_id'] for s in selected).values()) == {4}
        assert Counter(s['condition'] for s in selected) == Counter({c: 16 for c in GROUPS.values()})
        assert set(Counter((s['speaker_id'], s['sentence_list']) for s in selected).values()) == {2}
    anchors = sorted((s for s in all_stimuli if s['condition'] == 'practice'), key=lambda s: s['id'])
    # Fixed interleaving gives every participant the same native/non-native anchor sequence.
    native = [s for s in anchors if s['speaker_l1'] == 'Japanese']
    other = [s for s in anchors if s['speaker_l1'] != 'Japanese']
    anchors = [s for i in range(max(len(native), len(other))) for group in (native, other) for s in group[i:i + 1]]
    manifest = {'version': VERSION, 'mode': 'study', 'counterbalance_version': VERSION,
                'source_stimuli_sha256': digest(table), 'reference_workbook_sha256': digest(workbook),
                'lists': lists, 'stimuli': stimuli}
    practice = {'version': 'shared-human-anchors-10-v1', 'role': 'common_anchor', 'order_policy': 'fixed_for_all_participants', 'stimuli': anchors}
    for filename, data in [('stimuli.json', manifest), ('practice.json', practice)]:
        (ROOT / 'site' / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'main_recordings': len(stimuli), 'lists': len(lists), 'items_per_list': 48,
                      'anchors': len(anchors), 'anchors_without_reference': sum(not s['reference_kana'] for s in anchors)}))


if __name__ == '__main__':
    main()
