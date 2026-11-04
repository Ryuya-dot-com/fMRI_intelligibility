#!/usr/bin/env python3
"""Generate demonstration WAVs with Kokoro; never alter the MRI stimuli."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

parser = argparse.ArgumentParser()
parser.add_argument('--model', type=Path, required=True)
parser.add_argument('--voices', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'site' / 'audio'
out.mkdir(parents=True, exist_ok=True)
if (root / 'site' / 'stimuli.json').exists() or list(out.glob('*.wav')):
    raise SystemExit('Existing stimuli are preserved. Generate in a fresh copy to replace them.')
kokoro = Kokoro(str(args.model), str(args.voices))
voice_ids = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'af_nova', 'af_alloy', 'af_aoede', 'am_adam', 'am_michael', 'am_echo', 'am_eric']
words = ['one', 'two', 'three', 'four']
stimuli = []
for c, condition in enumerate(['Japanese', 'Asian', 'Romance']):
    for speaker in range(4):
        voice = voice_ids[c * 4 + speaker]
        for sentence in range(3):
            stimulus_id = f'{condition.lower()}_{speaker + 1}_{sentence + 1}'
            text = f'{condition} {words[speaker]}. Sentence {words[sentence]}.'
            samples, rate = kokoro.create(text, voice=voice, speed=1.0, lang='en-us')
            path = out / f'{stimulus_id}.wav'
            sf.write(path, samples, rate, subtype='PCM_16')
            stimuli.append({
                'id': stimulus_id, 'sentence_id': f'placeholder_{len(stimuli) + 1:02}',
                'speaker_id': f'{condition[0]}{speaker + 1:02}', 'condition': condition,
                'audio': f'audio/{path.name}', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'reference_kana': None, 'placeholder_text': text, 'kokoro_voice': voice,
                'sample_rate': rate, 'frames': len(samples), 'duration_s': len(samples) / rate,
            })
            print(f'{len(stimuli):02}/36 {stimulus_id}: {len(samples) / rate:.3f}s', flush=True)
manifest = {'version': 'placeholder-en-36-v1', 'mode': 'placeholder', 'stimuli': stimuli}
(root / 'site' / 'stimuli.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
provenance = {
    'model': 'hexgrad/Kokoro-82M v1.0, ONNX int8 conversion',
    'model_source': 'https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1',
    'model_sha256': hashlib.sha256(args.model.read_bytes()).hexdigest(),
    'voices_sha256': hashlib.sha256(args.voices.read_bytes()).hexdigest(),
    'packages': {name: importlib.metadata.version(name) for name in ['kokoro-onnx', 'onnxruntime', 'soundfile', 'numpy', 'phonemizer']},
    'purpose': 'English placeholder cues only; no experimental accent or Japanese mora validity.',
}
(root / 'tools' / 'audio_provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
