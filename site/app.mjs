import {VERSION, participantId, participantName, participantList, makeOrder, validateManifest, validatePractice, validResponse, resultScore} from './core.mjs';
import {openDatabase, save, read, clearActive, loadRecord, sessionMetadata} from './storage.mjs';
import {downloadArchive} from './export.mjs';

const $ = id => document.getElementById(id);
const audio = new Audio();
audio.preload = 'auto';
let db, manifest, manifestHash, practice, practiceHash, session, current, recovered;
let events = [], seq = 0, pending = Promise.resolve(), storageFailed = false;
let composing = false, advancing = false, checkPlayed = false;
let releaseLock, lastValueJson, lastValueSeq;
let preparedId, selectedList;
const assets = new Map();
function captureTime() {
  const perf_ms = performance.now();
  const system_epoch_ms = Date.now();
  return {perf_ms, system_epoch_ms, system_utc: new Date(system_epoch_ms).toISOString(), monotonic_epoch_ms: performance.timeOrigin + perf_ms};
}
function markTime(record, prefix, stamp) {
  for (const [key, value] of Object.entries(stamp)) record[`${prefix}_${key}`] = value;
}
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

function screen(id) {
  for (const section of document.querySelectorAll('section.panel')) section.hidden = section.id !== id;
  window.scrollTo(0, 0);
}

function active() { return session?.status === 'running'; }
function snapshot(event, metadataChanged) {
  if (!session || storageFailed) return;
  const value = metadataChanged ? structuredClone(sessionMetadata(session)) : null;
  const trials = current ? [structuredClone({...current, session_id: session.id})] : [];
  pending = pending.then(() => storageFailed ? undefined : save(db, value, event, trials)).catch(error => {
    if (storageFailed) return;
    storageFailed = true;
    session.storage_error = error.message;
    $('error').textContent = '記録をこのブラウザーに保存できませんでした。画面を閉じずに、実験者にお知らせください。';
    finish('storage_error');
  });
}

function log(type, details = {}, browserEvent, stamp = captureTime()) {
  if (!session) return;
  const time = stamp.perf_ms;
  const browserTime = browserEvent?.timeStamp;
  const validBrowserTime = Number.isFinite(browserTime) && browserTime >= 0 && browserTime <= time;
  const event = {
    session_id: session.id, seq: ++seq, event_type: type,
    event_perf_ms: time, event_system_epoch_ms: stamp.system_epoch_ms, event_system_utc: stamp.system_utc,
    event_monotonic_epoch_ms: stamp.monotonic_epoch_ms,
    system_minus_monotonic_ms: stamp.system_epoch_ms - stamp.monotonic_epoch_ms,
    browser_event_timestamp_ms: browserTime ?? '',
    browser_event_monotonic_epoch_ms: validBrowserTime ? performance.timeOrigin + browserTime : '',
    browser_event_system_epoch_ms_estimate: validBrowserTime ? stamp.system_epoch_ms + browserTime - time : '',
    browser_event_to_callback_ms: validBrowserTime ? time - browserTime : '',
    phase: current?.phase ?? session.phase ?? '', trial_number: current?.trial_number ?? '', session_trial_number: current?.session_trial_number ?? '', stimulus_id: current?.stimulus_id ?? '',
    relative_to_audio_ms: current?.audio_started_perf_ms != null ? time - current.audio_started_perf_ms : '',
    browser_event_relative_to_audio_ms: validBrowserTime && current?.audio_started_perf_ms != null ? browserTime - current.audio_started_perf_ms : '',
    audio_position_s: current ? audio.currentTime : '',
    audio_position_ms: current ? audio.currentTime * 1000 : '',
    audio_paused: current ? audio.paused : '', audio_ended: current ? audio.ended : '',
    audio_playback_rate: current ? audio.playbackRate : '',
    ...details,
  };
  if (Object.hasOwn(event, 'value_json')) {
    if (event.value_json === lastValueJson) delete event.value_json;
    else { lastValueJson = event.value_json; lastValueSeq = event.seq; }
    event.value_seq = lastValueSeq;
  }
  events.push(event);
  snapshot(event, ['session_started', 'trial_opened', 'trial_submitted', 'practice_completed', 'main_started', 'session_finished'].includes(type));
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
    if (!active() || !current || advancing || current.trial_status !== 'in_progress' || current.audio_started_perf_ms == null) return;
    const stamp = captureTime();
    if (type === 'compositionstart') composing = true;
    if (type === 'compositionend') composing = false;
    current.response = $('response').value;
    if (type === 'input') {
      if (current.first_input_perf_ms == null) markTime(current, 'first_input', stamp);
      markTime(current, 'last_input', stamp);
      $('response-error').textContent = '';
    }
    log(type, inputDetails(event), event, stamp);
    nextEnabled();
  });
}

audio.addEventListener('playing', event => {
  if (!active() || !current) return;
  if (current.audio_started_perf_ms == null) {
    const stamp = captureTime();
    markTime(current, 'audio_started', stamp);
    current.audio_started_browser_event_timestamp_ms = event.timeStamp;
    current.audio_position_at_start_callback_s = audio.currentTime;
    current.audio_duration_s = audio.duration;
    current.audio_timing_source = 'HTMLMediaElement_playing_callback_performance_now';
    log('audio_started', {}, event, stamp);
    $('response').disabled = false;
    $('response').focus();
    $('audio-status').textContent = '音声を聞きながら入力できます。';
  } else log('audio_playing_again', {}, event);
});
audio.addEventListener('ended', event => {
  if (!active() || !current) return;
  const stamp = captureTime();
  markTime(current, 'audio_ended', stamp);
  current.audio_completed = true;
  $('audio-status').textContent = '入力が終わったら、次へ進んでください。';
  log('audio_ended', {}, event, stamp);
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
  const stamp = captureTime();
  markTime(current, 'play_requested', stamp);
  log('play_requested', {}, undefined, stamp);
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
  const stamp = captureTime();
  current = {phase: session.phase, counterbalance_list: session.counterbalance_list, anchor_version: practice.version, session_trial_number: session.trials.length + 1, trial_number: index + 1, stimulus_id: s.id, sentence_id: s.sentence_id, speaker_id: s.speaker_id, condition: s.condition, audio_file: s.audio, audio_sha256: s.sha256, audio_sample_rate_hz: s.sample_rate || '', audio_frames: s.frames || '', reference_kana: s.reference_kana || '', reference_status: s.reference_status, trial_status: 'in_progress', response: '', audio_completed: false};
  markTime(current, 'trial_opened', stamp);
  session.trials.push(current);
  composing = false;
  lastValueJson = undefined; lastValueSeq = undefined;
  advancing = false;
  $('response').value = '';
  $('response').disabled = true;
  $('next').disabled = true;
  $('next').textContent = index === order.length - 1 ? (isPractice ? '練習を終える' : '回答を終える') : '次へ';
  $('response-error').textContent = '';
  $('audio-status').textContent = '音声を準備しています…';
  $('progress-text').textContent = `${isPractice ? '練習 ' : ''}${index + 1} / ${order.length}`;
  audio.src = assets.get(s.id);
  log('trial_opened', {}, undefined, stamp);
  playCurrent();
}

async function next() {
  if ($('next').disabled || advancing) return;
  if (!validResponse($('response').value)) {
    $('response-error').textContent = '回答は2000文字以内で入力してください。使用できない制御文字が含まれていないか確認してください。';
    log('validation_rejected');
    $('response').focus();
    return;
  }
  advancing = true;
  $('response').disabled = true;
  nextEnabled();
  current.response = $('response').value;
  const stamp = captureTime();
  markTime(current, 'submitted', stamp);
  current.response_time_ms = current.submitted_perf_ms - current.audio_started_perf_ms;
  current.trial_status = 'completed';
  const isPractice = current.phase === 'practice';
  Object.assign(current, resultScore((isPractice ? practice : manifest).stimuli.find(s => s.id === current.stimulus_id), current.response, isPractice ? 'study' : manifest.mode));
  log('trial_submitted', {value_json: JSON.stringify(current.response)}, undefined, stamp);
  await pending;
  if (!active()) return;
  if (isPractice && current.trial_number === session.practice_order.length) {
    session.phase = 'main_ready';
    current = null;
    log('practice_completed');
    await pending;
    if (active()) screen('practice-done');
  } else if (!isPractice && current.trial_number === session.order.length) await finish('completed');
  else startTrial();
}
$('next').onclick = next;

async function finish(status) {
  if (!active()) return;
  const stamp = captureTime();
  session.status = status;
  session.completed_at_utc = stamp.system_utc;
  markTime(session, 'completed', stamp);
  if (current?.trial_status === 'in_progress') {
    current.response = $('response').value;
    current.trial_status = 'interrupted';
    markTime(current, 'interrupted', stamp);
    current.audio_position_at_interruption_s = audio.currentTime;
    current.score_status = 'interrupted_not_scored';
  }
  audio.pause();
  $('response').disabled = true;
  $('stop-dialog').close();
  log('session_finished', {finish_reason: status, ...(current ? {value_json: JSON.stringify(current.response)} : {})}, undefined, stamp);
  screen('finish');
  if (status !== 'completed') {
    $('finish-title').textContent = 'ここまでの入力を記録しました。';
    $('finish-message').textContent = '実験者にお知らせください。画面はそのままにしてください。';
  }
  // Storage failures export the in-memory record without waiting on their own queue.
  if (!storageFailed) await pending;
  exportRecord(session, events);
}
function exportRecord(record, recordEvents) {
  try { downloadArchive(record, recordEvents); return true; }
  catch (error) { $('error').textContent = `記録を出力できませんでした。画面を閉じずに実験者にお知らせください。${error.message}`; return false; }
}
$('download').onclick = () => exportRecord(session, events);
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

$('setup').onsubmit = async event => {
  event.preventDefault();
  if ($('setup-next').disabled) return;
  $('setup-next').disabled = true;
  try {
    const id = participantId($('participant').value);
    participantName($('participant-name').value);
    $('error').textContent = '';
    selectedList = participantList(manifest, id);
    await prepareAudio([...practice.stimuli, ...selectedList.stimuli]);
    preparedId = id;
    screen('instructions');
  }
  catch (error) { $('error').textContent = error.message; }
  finally { $('setup-next').disabled = false; }
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
  catch (error) { $('error').textContent = error.message; screen('welcome'); $('begin').disabled = false; return; }
  if (id !== preparedId) { screen('welcome'); $('error').textContent = '参加者IDを確認して「次へ」を押してください。'; return; }
  const stamp = captureTime();
  session = {id: crypto.randomUUID(), participant_id: id, participant_name: name, app_version: VERSION, manifest, manifest_sha256: manifestHash, counterbalance_list: selectedList.id, counterbalance_version: manifest.counterbalance_version, practice, practice_sha256: practiceHash, practice_order: practice.stimuli.map(s => s.id), phase: 'practice', order: makeOrder(selectedList.stimuli, id, manifest.version), seed: `${manifest.version}:order:${id}`, trials: [], status: 'running', started_at_utc: stamp.system_utc, user_agent: navigator.userAgent, time_origin_ms: performance.timeOrigin, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, timezone_offset_minutes: new Date(stamp.system_epoch_ms).getTimezoneOffset(), timing_version: 'dual-clock-media-v1', log_version: 'value-reference-v1'};
  markTime(session, 'started', stamp);
  log('session_started', {}, undefined, stamp);
  await pending;
  if (!active()) return;
  screen('task');
  startTrial();
};

$('begin-main').onclick = async () => {
  if (!active() || session.phase !== 'main_ready') return;
  $('begin-main').disabled = true;
  session.phase = 'main';
  log('main_started');
  await pending;
  if (!active()) return;
  screen('task');
  startTrial();
};

$('recover-download').onclick = () => {
  if (exportRecord(recovered.session, recovered.events)) $('fresh').disabled = false;
};
$('fresh').onclick = async () => {
  try { await clearActive(db); screen('welcome'); }
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
    const {session: previous, events: previousEvents} = await loadRecord(db, previousId);
    if (previous) {
      if (previous.status === 'running') {
        previous.status = 'interrupted_page_closed';
        for (const trial of previous.trials) if (trial.trial_status === 'in_progress') {
          trial.trial_status = 'interrupted'; trial.score_status = 'interrupted_not_scored';
        }
        await save(db, sessionMetadata(previous), null, previous.trials.map((trial, index) => ({session_id: previous.id, session_trial_number: index + 1, ...trial})));
      }
      recovered = {session: previous, events: previousEvents};
      screen('recovery');
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
  $('loading').hidden = true;
  $('setup-next').disabled = false;
}

async function prepareAudio(stimuli) {
  let loaded = 0;
  $('loading').hidden = false;
  for (const url of assets.values()) URL.revokeObjectURL(url);
  assets.clear();
  // Prepare only this participant's 10 anchors and 48 assigned recordings.
  const remaining = [...stimuli];
  const totalAudio = remaining.length;
  await Promise.all(Array.from({length: 4}, async () => {
    while (remaining.length) {
      const s = remaining.shift();
      const result = await fetch(s.audio, {cache: 'no-cache'});
      if (!result.ok) throw new Error(`音声を読み込めませんでした（${s.id}）。`);
      const audioBytes = await result.arrayBuffer();
      if (await hash(audioBytes) !== s.sha256) throw new Error(`音声が登録内容と一致しません（${s.id}）。`);
      assets.set(s.id, URL.createObjectURL(new Blob([audioBytes], {type: 'audio/wav'})));
      $('loading').textContent = `音声を準備しています… ${++loaded} / ${totalAudio}`;
    }
  }));
  $('loading').textContent = '';
  $('loading').hidden = true;
}
init().catch(error => { $('error').textContent = `準備を完了できませんでした。実験者にお知らせください。\n${error.message}`; });
