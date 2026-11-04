#!/usr/bin/env python3
"""Generate four Japanese practice sentences with independently checked mora counts."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path

import pyopenjtalk
import soundfile as sf
import unidic
import unidic_lite
from kokoro_onnx import Kokoro
from misaki.ja import JAG2P

parser = argparse.ArgumentParser()
parser.add_argument('--model', type=Path, required=True)
parser.add_argument('--voices', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
if (root / 'site/practice.json').exists() or list((root / 'site/audio').glob('practice_*.wav')):
    raise SystemExit('Existing practice recordings are preserved. Generate in a fresh copy to replace them.')

# Use the small packaged UniDic dictionary for the standard Misaki Japanese pipeline.
unidic.DICDIR = unidic_lite.DICDIR
g2p = JAG2P()
kokoro = Kokoro(str(args.model), str(args.voices))
sentences = [
    ('明日は友達と公園まで歩きます。', 'あ・し・た・は・と・も・だ・ち・と・こ・う・え・ん・ま・で・あ・る・き・ま・す'),
    ('机の上にきれいな花を飾りました。', 'つ・く・え・の・う・え・に・き・れ・い・な・は・な・を・か・ざ・り・ま・し・た'),
    ('駅の近くでおいしいパンを買ってきます。', 'え・き・の・ち・か・く・で・お・い・し・い・ぱ・ん・を・か・っ・て・き・ま・す'),
    ('弟は部屋で静かに本を読んでいた。', 'お・と・う・と・は・へ・や・で・し・ず・か・に・ほ・ん・を・よ・ん・で・い・た'),
]
stimuli, checks = [], []
for index, (text, segmented) in enumerate(sentences, 1):
    segments = segmented.split('・')
    words = pyopenjtalk.run_frontend(text)
    independent_count = sum(w['mora_size'] for w in words)
    assert len(segments) == independent_count == 20, (text, independent_count)
    phonemes, _ = g2p(text)
    assert phonemes and '❓' not in phonemes
    samples, rate = kokoro.create(phonemes, voice='jf_alpha', speed=1.0, is_phonemes=True)
    path = root / f'site/audio/practice_{index:02}.wav'
    sf.write(path, samples, rate, subtype='PCM_16')
    stimuli.append({
        'id': f'practice_{index:02}', 'sentence_id': f'practice_sentence_{index:02}',
        'speaker_id': 'practice_jf_alpha', 'condition': 'practice',
        'text': text, 'reference_kana': ''.join(segments), 'mora_segments': segments,
        'audio': f'audio/{path.name}', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'kokoro_voice': 'jf_alpha', 'sample_rate': rate, 'frames': len(samples),
        'duration_s': len(samples) / rate,
    })
    checks.append({'id': f'practice_{index:02}', 'text': text, 'mora_count_manual': len(segments),
                   'mora_count_openjtalk': independent_count,
                   'openjtalk_reading': ''.join(w['pron'] for w in words if w['mora_size']),
                   'kokoro_phonemes': phonemes})
    print(f'{index}/4 {text} 20 morae, {len(samples)/rate:.3f}s', flush=True)
(root / 'site/practice.json').write_text(json.dumps({'version': 'practice-ja-20mora-v1', 'stimuli': stimuli}, ensure_ascii=False, indent=2) + '\n')
(root / 'tools/practice_audio_provenance.json').write_text(json.dumps({
    'model_sha256': hashlib.sha256(args.model.read_bytes()).hexdigest(),
    'voices_sha256': hashlib.sha256(args.voices.read_bytes()).hexdigest(),
    'packages': {name: importlib.metadata.version(name) for name in ['kokoro-onnx', 'misaki', 'unidic-lite', 'pyopenjtalk']},
    'checks': checks,
}, ensure_ascii=False, indent=2) + '\n')
