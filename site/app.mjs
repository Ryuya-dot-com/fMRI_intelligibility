import {VERSION, participantId, participantName, makeOrder, validateManifest, validatePractice, validResponse, resultScore, csv, exportRows} from './core.mjs';
import {openDatabase, save, read, allRecords, clearActive, downloadCsv} from './storage.mjs';

const $ = id => document.getElementById(id);
const audio = new Audio();
audio.preload = 'auto';
let db, manifest, manifestHash, practice, practiceHash, session, current, recovered;
let events = [], seq = 0, pending = Promise.resolve(), storageFailed = false;
let composing = false, advancing = false, checkPlayed = false;
let releaseLock;
const assets = new Map();
const now = () => performance.now();
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

function screen(id, stage) {
  for (const section of document.querySelectorAll('section.panel')) section.hidden = section.id !== id;
  $('stage').textContent = stage;
  window.scrollTo(0, 0);
}

function active() { return session?.status === 'running'; }
function snapshot(event) {
  if (!session || storageFailed) return;
  const value = structuredClone(session);
  pending = pending.then(() => storageFailed ? undefined : save(db, value, event)).catch(error => {
    if (storageFailed) return;
    storageFailed = true;
    session.storage_error = error.message;
    $('error').textContent = '記録をこのブラウザーに保存できませんでした。画面を閉じずに、実験者にお知らせください。';
    finish('storage_error');
  });
}

function log(type, details = {}, browserEvent) {
  if (!session) return;
  const time = now();
  const event = {
    session_id: session.id, seq: ++seq, event_type: type,
    event_perf_ms: time, browser_event_timestamp_ms: browserEvent?.timeStamp ?? '',
    phase: current?.phase ?? session.phase ?? '', trial_number: current?.trial_number ?? '', session_trial_number: current?.session_trial_number ?? '', stimulus_id: current?.stimulus_id ?? '',
    relative_to_audio_ms: current?.audio_started_perf_ms != null ? time - current.audio_started_perf_ms : '',
    audio_position_s: current ? audio.currentTime : '',
    ...details,
  };
  events.push(event);
  snapshot(event);
}

function nextEnabled() {
  $('next').disabled = !active() || !current?.audio_ended_perf_ms || composing || advancing || $('stop-dialog').open;
}

function inputDetails(event) {
  return {
    key_json: JSON.stringify(event.key ?? null), code: event.code ?? '',
    input_type: event.inputType ?? '', input_data_json: JSON.stringify(event.data ?? null),
    value_json: JSON.stringify($('response').value), selection_start: $('response').selectionStart,
    selection_end: $('response').selectionEnd, is_composing: event.isComposing ?? composing,
    repeat: event.repeat ?? false, shift: event.shiftKey ?? false, ctrl: event.ctrlKey ?? false,
    alt: event.altKey ?? false, meta: event.metaKey ?? false,
  };
}

for (const type of ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'select', 'paste', 'cut', 'drop', 'focus', 'blur']) {
  $('response').addEventListener(type, event => {
    if (!active() || !current || current.audio_started_perf_ms == null) return;
    if (type === 'compositionstart') composing = true;
    if (type === 'compositionend') composing = false;
    current.response = $('response').value;
    if (type === 'input') {
      current.first_input_perf_ms ??= now();
      current.last_input_perf_ms = now();
      $('response-error').textContent = '';
    }
    log(type, inputDetails(event), event);
    nextEnabled();
  });
}

audio.addEventListener('playing', event => {
  if (!active() || !current) return;
  if (current.audio_started_perf_ms == null) {
    current.audio_started_perf_ms = now();
    current.audio_duration_s = audio.duration;
    current.audio_timing_source = 'HTMLMediaElement_playing_callback_performance_now';
    $('response').disabled = false;
    $('response').focus();
    $('audio-status').textContent = '音声を聞きながら入力できます。';
    log('audio_started', {}, event);
  } else log('audio_playing_again', {}, event);
});
audio.addEventListener('ended', event => {
  if (!active() || !current) return;
  current.audio_ended_perf_ms = now();
  current.audio_completed = true;
  $('audio-status').textContent = '入力が終わったら、次へ進んでください。';
  log('audio_ended', {}, event);
  nextEnabled();
});
for (const type of ['waiting', 'stalled', 'pause', 'ratechange', 'volumechange', 'seeking']) {
  audio.addEventListener(type, event => { if (active()) log(`audio_${type}`, {}, event); });
}
audio.addEventListener('error', () => {
  if (active()) {
    log('audio_error', {error_code: audio.error?.code});
    finish('audio_error');
  }
});

function playCurrent() {
  $('retry-play').hidden = true;
  current.play_requested_perf_ms = now();
  log('play_requested');
  audio.play().catch(error => {
    if (!active()) return;
    log('play_rejected', {error_name: error.name, error_message: error.message});
    if (current.audio_started_perf_ms == null && error.name === 'NotAllowedError') {
      $('audio-status').textContent = 'ボタンを押して、音声を開始してください。';
      $('retry-play').hidden = false;
    } else finish('audio_error');
  });
}
$('retry-play').onclick = () => { if (active() && current.audio_started_perf_ms == null) playCurrent(); };

function startTrial() {
  const isPractice = session.phase === 'practice';
  const order = isPractice ? session.practice_order : session.order;
  const index = session.trials.filter(t => t.phase === session.phase).length;
  const s = (isPractice ? practice : manifest).stimuli.find(s => s.id === order[index]);
  current = {phase: session.phase, session_trial_number: session.trials.length + 1, trial_number: index + 1, stimulus_id: s.id, sentence_id: s.sentence_id, speaker_id: s.speaker_id, condition: s.condition, audio_file: s.audio, audio_sha256: s.sha256, reference_kana: s.reference_kana || '', trial_status: 'in_progress', response: '', audio_completed: false, trial_opened_perf_ms: now()};
  session.trials.push(current);
  composing = false;
  advancing = false;
  $('response').value = '';
  $('response').disabled = true;
  $('next').disabled = true;
  $('next').textContent = index === order.length - 1 ? (isPractice ? '練習を終える' : '回答を終える') : '次へ →';
  $('response-error').textContent = '';
  $('audio-status').textContent = '音声を準備しています…';
  $('progress-text').textContent = `${isPractice ? '練習 ' : ''}${index + 1} / ${order.length}`;
  $('progress').max = order.length;
  $('progress').value = index;
  audio.src = assets.get(s.id);
  log('trial_opened');
  playCurrent();
}

async function next() {
  if ($('next').disabled || advancing) return;
  if (!validResponse($('response').value)) {
    $('response-error').textContent = 'ひらがなで入力してください。漢字・カタカナ・英数字が残っていないか確認してください。';
    log('validation_rejected');
    $('response').focus();
    return;
  }
  advancing = true;
  nextEnabled();
  current.response = $('response').value;
  current.submitted_perf_ms = now();
  current.response_time_ms = current.submitted_perf_ms - current.audio_started_perf_ms;
  current.trial_status = 'completed';
  const isPractice = current.phase === 'practice';
  Object.assign(current, resultScore((isPractice ? practice : manifest).stimuli.find(s => s.id === current.stimulus_id), current.response, isPractice ? 'study' : manifest.mode));
  log('trial_submitted');
  await pending;
  if (!active()) return;
  if (isPractice && current.trial_number === session.practice_order.length) {
    session.phase = 'main_ready';
    current = null;
    log('practice_completed');
    await pending;
    if (active()) screen('practice-done', '練習終了');
  } else if (!isPractice && current.trial_number === session.order.length) await finish('completed');
  else startTrial();
}
$('next').onclick = next;

async function finish(status) {
  if (!active()) return;
  session.status = status;
  session.completed_at_utc = new Date().toISOString();
  if (current?.trial_status === 'in_progress') {
    current.response = $('response').value;
    current.trial_status = 'interrupted';
    current.interrupted_perf_ms = now();
    current.audio_position_at_interruption_s = audio.currentTime;
    current.score_status = 'interrupted_not_scored';
  }
  audio.pause();
  $('response').disabled = true;
  $('stop-dialog').close();
  log('session_finished', {finish_reason: status});
  screen('finish', '終了');
  if (status !== 'completed') {
    $('finish-title').textContent = 'ここまでの入力を記録しました。';
    $('finish-message').textContent = '実験者にお知らせください。画面はそのままにしてください。';
  }
  // Storage failures export the in-memory record without waiting on their own queue.
  if (!storageFailed) await pending;
  downloadCsv(session, events, csv, exportRows);
}
$('download').onclick = () => downloadCsv(session, events, csv, exportRows);
$('stop').onclick = () => { log('stop_dialog_opened'); $('stop-dialog').showModal(); nextEnabled(); };
$('cancel-stop').onclick = () => { $('stop-dialog').close(); log('stop_cancelled'); nextEnabled(); $('response').focus(); };
$('stop-dialog').addEventListener('close', nextEnabled);
$('confirm-stop').onclick = () => finish('aborted');

for (const type of ['visibilitychange', 'pagehide']) {
  (type === 'visibilitychange' ? document : window).addEventListener(type, event => {
    if (active()) log(type, {visibility: document.visibilityState}, event);
  });
}
window.addEventListener('beforeunload', event => {
  if (active()) { event.preventDefault(); event.returnValue = ''; }
});

$('setup').onsubmit = event => {
  event.preventDefault();
  try { participantId($('participant').value); participantName($('participant-name').value); $('error').textContent = ''; screen('instructions', '説明'); }
  catch (error) { $('error').textContent = error.message; }
};
$('check-sound').onclick = () => {
  const context = new AudioContext();
  const oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.frequency.value = 440;
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(0.08, context.currentTime + 0.05);
  gain.gain.setValueAtTime(0.08, context.currentTime + 0.65);
  gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.8);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(); oscillator.stop(context.currentTime + 0.85);
  oscillator.onended = () => { context.close(); checkPlayed = true; $('begin').disabled = !$('sound-ok').checked; };
};
$('sound-ok').onchange = () => { $('begin').disabled = !checkPlayed || !$('sound-ok').checked; };
$('begin').onclick = async () => {
  if ($('begin').disabled || session) return;
  $('begin').disabled = true;
  let id, name;
  try { id = participantId($('participant').value); name = participantName($('participant-name').value); }
  catch (error) { $('error').textContent = error.message; screen('welcome', '準備'); $('begin').disabled = false; return; }
  session = {id: crypto.randomUUID(), participant_id: id, participant_name: name, app_version: VERSION, manifest, manifest_sha256: manifestHash, practice, practice_sha256: practiceHash, practice_order: practice.stimuli.map(s => s.id), phase: 'practice', order: makeOrder(manifest.stimuli, id, manifest.version), seed: `${manifest.version}:order:${id}`, trials: [], status: 'running', started_at_utc: new Date().toISOString(), user_agent: navigator.userAgent, time_origin_ms: performance.timeOrigin};
  log('session_started');
  await pending;
  if (!active()) return;
  screen('task', '練習');
  startTrial();
};

$('begin-main').onclick = async () => {
  if (!active() || session.phase !== 'main_ready') return;
  $('begin-main').disabled = true;
  session.phase = 'main';
  log('main_started');
  await pending;
  if (!active()) return;
  screen('task', '本番');
  startTrial();
};

$('recover-download').onclick = () => {
  downloadCsv(recovered.session, recovered.events, csv, exportRows);
  $('fresh').disabled = false;
};
$('fresh').onclick = async () => {
  try { await clearActive(db); screen('welcome', '準備'); }
  catch { $('error').textContent = '記録の準備ができません。実験者にお知らせください。'; }
};

async function init() {
  if (!navigator.locks) throw new Error('このブラウザーは対応していません。最新版のChromeを使用してください。');
  await new Promise((resolve, reject) => {
    navigator.locks.request('intelligibility-active-tab', {ifAvailable: true}, async lock => {
      if (!lock) { reject(new Error('別のタブで課題が開かれています。そのタブを閉じてから開き直してください。')); return; }
      resolve();
      await new Promise(done => { releaseLock = done; });
    }).catch(reject);
  });
  db = await openDatabase();
  const previousId = await read(db, 'state', 'active');
  if (previousId) {
    const previous = await read(db, 'sessions', previousId);
    if (previous) {
      const previousEvents = await allRecords(db, 'events', 'session', previousId);
      if (previous.status === 'running') {
        previous.status = 'interrupted_page_closed';
        for (const trial of previous.trials) if (trial.trial_status === 'in_progress') {
          trial.trial_status = 'interrupted'; trial.score_status = 'interrupted_not_scored';
        }
        await save(db, previous);
      }
      recovered = {session: previous, events: previousEvents};
      screen('recovery', '記録の確認');
    }
  }
  const response = await fetch('./stimuli.json', {cache: 'no-cache'});
  if (!response.ok) throw new Error('刺激設定を読み込めませんでした。');
  const bytes = await response.arrayBuffer();
  manifestHash = await hash(bytes);
  manifest = validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
  const practiceResponse = await fetch('./practice.json', {cache: 'no-cache'});
  if (!practiceResponse.ok) throw new Error('練習の設定を読み込めませんでした。');
  const practiceBytes = await practiceResponse.arrayBuffer();
  practiceHash = await hash(practiceBytes);
  practice = validatePractice(JSON.parse(new TextDecoder().decode(practiceBytes)), manifest);
  let loaded = 0;
  // Limit concurrent downloads while preparing every file before the first trial.
  const remaining = [...practice.stimuli, ...manifest.stimuli];
  const totalAudio = remaining.length;
  await Promise.all(Array.from({length: 4}, async () => {
    while (remaining.length) {
      const s = remaining.shift();
      const result = await fetch(s.audio);
      if (!result.ok) throw new Error(`音声を読み込めませんでした（${s.id}）。`);
      const audioBytes = await result.arrayBuffer();
      if (await hash(audioBytes) !== s.sha256) throw new Error(`音声が登録内容と一致しません（${s.id}）。`);
      assets.set(s.id, URL.createObjectURL(new Blob([audioBytes], {type: 'audio/wav'})));
      $('loading').textContent = `音声を準備しています… ${++loaded} / ${totalAudio}`;
    }
  }));
  $('loading').textContent = '準備ができました。';
  $('setup-next').disabled = false;
}
init().catch(error => { $('error').textContent = `準備を完了できませんでした。実験者にお知らせください。\n${error.message}`; });
