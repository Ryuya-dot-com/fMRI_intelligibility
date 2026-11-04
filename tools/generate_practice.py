#!/usr/bin/env python3
"""Generate Japanese practice WAVs with the official, unquantized Kokoro-82M model.

Download config.json, kokoro-v1_0.pth and voices/jf_alpha.pt from
https://huggingface.co/hexgrad/Kokoro-82M into --model-dir first.
--output must be a fresh directory. Review the files before copying into site/.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path

import numpy as np
import pyopenjtalk
import soundfile as sf
import torch
import unidic
import unidic_lite
from kokoro import KModel, KPipeline

parser = argparse.ArgumentParser()
parser.add_argument('--model-dir', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
if args.output.exists():
    raise SystemExit('Output already exists; use a fresh directory to preserve earlier recordings.')
source = json.loads((root / 'site/practice.json').read_text())
args.output.mkdir(parents=True)
(args.output / 'audio').mkdir()
unidic.DICDIR = unidic_lite.DICDIR
torch.set_num_threads(4)
model_path = args.model_dir / 'kokoro-v1_0.pth'
model_hash = hashlib.sha256(model_path.read_bytes()).hexdigest()
assert model_hash == '496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4', 'Official v1.0 model hash mismatch'
model = KModel(repo_id='hexgrad/Kokoro-82M', config=str(args.model_dir / 'config.json'), model=str(model_path)).float().eval()
pipeline = KPipeline(lang_code='j', repo_id='hexgrad/Kokoro-82M', model=model)
voice = torch.load(args.model_dir / 'jf_alpha.pt', map_location='cpu', weights_only=True)
checks = []
for index, stimulus in enumerate(source['stimuli'], 1):
    text = stimulus['text']
    words = pyopenjtalk.run_frontend(text)
    independent_count = sum(w['mora_size'] for w in words)
    assert len(stimulus['mora_segments']) == independent_count == 20
    seed = 20261104 + index
    torch.manual_seed(seed)
    with torch.inference_mode():
        chunks = list(pipeline(text, voice=voice, speed=1.0))
    assert len(chunks) == 1, 'These short practice sentences should remain one segment'
    _, phonemes, audio = chunks[0]
    samples = audio.detach().cpu().numpy()
    assert np.isfinite(samples).all() and len(samples) > 24000
    peak = float(np.max(np.abs(samples)))
    assert 0.01 < peak < 1.0, 'Silent or clipped synthesis: inspect before publishing'
    path = args.output / stimulus['audio']
    sf.write(path, samples, 24000, subtype='PCM_24')
    stimulus.update(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), sample_rate=24000,
                    frames=len(samples), duration_s=len(samples)/24000, sample_format='PCM_24',
                    generator='kokoro-0.9.4-pytorch-float32', kokoro_voice='jf_alpha')
    checks.append({'id':stimulus['id'], 'text':text, 'mora_count_manual':20,
                   'mora_count_openjtalk':independent_count,
                   'openjtalk_reading':''.join(w['pron'] for w in words if w['mora_size']),
                   'kokoro_phonemes':phonemes, 'seed':seed, 'samples_finite':True,
                   'peak':peak, 'rms':float(np.sqrt(np.mean(samples**2))),
                   'clipped_samples':int(np.count_nonzero(np.abs(samples)>=1)),
                   'first_sample':float(samples[0]), 'last_sample':float(samples[-1])})
    print(f'{index}/4 {text} {len(samples)/24000:.3f}s peak={peak:.4f}', flush=True)
source['version'] = 'practice-ja-20mora-kokoro82m-fp32-v2'
(args.output / 'practice.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
(args.output / 'practice_audio_provenance.json').write_text(json.dumps({
    'model':'hexgrad/Kokoro-82M v1.0', 'runtime':'Official Python kokoro KPipeline / PyTorch CPU float32',
    'model_url':'https://huggingface.co/hexgrad/Kokoro-82M',
    'model_sha256':model_hash,
    'voice_sha256':hashlib.sha256((args.model_dir/'jf_alpha.pt').read_bytes()).hexdigest(),
    'config_sha256':hashlib.sha256((args.model_dir/'config.json').read_bytes()).hexdigest(),
    'parameter_count':sum(p.numel() for p in model.parameters()),
    'sample_rate_hz':24000, 'sample_format':'PCM_24',
    'processing':'No quantization, compression, denoising, amplitude normalization or silence trimming',
    'packages':{name:importlib.metadata.version(name) for name in ['kokoro','torch','transformers','misaki','soundfile','numpy','unidic-lite','pyopenjtalk']},
    'checks':checks,
},ensure_ascii=False,indent=2)+'\n')
