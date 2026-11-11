// State-machine integration with simulated browser events. Real Chrome checks are recorded separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import * as core from '../site/core.mjs';
import {sessionMetadata} from '../site/storage.mjs';

const source = readFileSync(new URL('../site/app.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const manifestText = readFileSync(new URL('../site/stimuli.json', import.meta.url), 'utf8');
const practice = JSON.parse(readFileSync(new URL('../site/practice.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };

async function harness(options = {}) {
  const elements = new Map();
  class Element {
    constructor(id) { this.id = id; this.value = ''; this.disabled = ['begin', 'next', 'response', 'setup-next'].includes(id); this.hidden = id !== 'welcome'; this.open = false; this.listeners = {}; this.selectionStart = 0; this.selectionEnd = 0; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    emit(type, detail = {}) { const event = {type, timeStamp: 1, preventDefault() {}, ...detail}; for (const listener of this.listeners[type] || []) listener(event); }
    focus() { this.emit('focus'); }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit('close'); }
  }
  const el = id => { assert.ok(ids.has(id), `Element #${id} exists in the real HTML`); if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const panels = ['welcome', 'instructions', 'task', 'practice-done', 'finish', 'recovery'].map(el);
  let media, time = 0, wallOffset = 500, saved, failSave = false, failedOnce = false, lateWrites = 0;
  class SystemDate extends Date { static now() { return Math.floor(1000000 + time + wallOffset); } }
  const savedEvents = [], downloads = [], fetched = [];
  class Audio extends Element {
    constructor() { super('audio'); media = this; this.currentTime = 0; this.duration = 2; this.plays = 0; this.paused = true; this.ended = false; this.playbackRate = 1; }
    play() { this.plays++; if (options.blockPlay && this.plays === 1) return Promise.reject(Object.assign(new Error('blocked'), {name: 'NotAllowedError'})); this.paused = false; this.ended = false; this.emit('playing'); return Promise.resolve(); }
    pause() { this.paused = true; this.emit('pause'); }
    end() { this.currentTime = this.duration; this.ended = true; this.paused = true; this.emit('ended'); }
  }
  const document = {getElementById: el, querySelectorAll: () => panels, addEventListener() {}, visibilityState: 'visible'};
  const context = {...core, sessionMetadata, document, Audio, window: {scrollTo() {}, addEventListener() {}},
    navigator: {userAgent: 'simulated-browser', locks: {request: (name, opts, fn) => { fn({}); return Promise.resolve(); }}},
    performance: {now: () => time += 0.25, timeOrigin: 1000000}, Date: SystemDate, crypto: webcrypto,
    URL: {createObjectURL: () => 'blob:fixture', revokeObjectURL() {}}, Blob, TextDecoder, structuredClone,
    fetch: async (path, options) => {
      fetched.push(path);
      assert.equal(options?.cache, 'no-cache', 'Revalidate replaced audio as well as manifests');
      const bytes = path === './stimuli.json' ? Buffer.from(manifestText) : readFileSync(new URL(`../site/${path}`, import.meta.url));
      return {ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
    },
    openDatabase: async () => ({}), read: async (db, store) => store === 'state' ? options.recover?.id : options.recover,
    allRecords: async () => [], clearActive: async () => {}, loadRecord: async () => ({session: options.recover, events: []}),
    save: async (db, session, event, trials = []) => {
      if (failSave && !failedOnce) { failedOnce = true; throw new Error('simulated quota failure'); }
      if (failedOnce) lateWrites++;
      if (session) saved = {...structuredClone(session), trials: saved?.trials || []};
      for (const trial of trials) {
        const index = saved.trials.findIndex(t => t.session_trial_number === trial.session_trial_number);
        if (index < 0) saved.trials.push(structuredClone(trial));
        else saved.trials[index] = structuredClone(trial);
      }
      if (event) savedEvents.push(structuredClone(event));
    },
    downloadArchive: (session, events) => downloads.push({session: structuredClone(session), events: structuredClone(events)}),
  };
  vm.runInNewContext(source, context);
  // SHA-256 calls run on the worker pool, so wait for the explicit ready state.
  for (let i = 0; i < 500 && el('setup-next').disabled; i++) await tick();
  assert.equal(el('error').textContent, undefined);
  assert.equal(el('setup-next').disabled, false);
  return {el, media, downloads, savedEvents, fetched, get saved() { return saved; }, get lateWrites() { return lateWrites; }, fail: () => { failSave = true; },
    get time() { return time; }, advanceTime: ms => { time += ms; }, setWallOffset: value => { wallOffset = value; },
    start: async (name = '動作確認用') => { el('participant').value = options.participantId || '900002'; el('participant-name').value = name; await el('setup').onsubmit({preventDefault() {}}); el('begin').disabled = false; await el('begin').onclick(); await tick(); },
  };
}

test('10 practice + 48 main trials: gates, phase transition, identity and CSV separation', async () => {
  const h = await harness(); await h.start();
  assert.equal(h.fetched.filter(path => path.endsWith('.wav')).length, 58);
  assert.equal(h.saved.counterbalance_list, 2);
  await h.el('begin-main').onclick();
  assert.equal(h.media.plays, 1, 'cannot skip practice');
  for (let i = 1; i <= 58; i++) {
    assert.equal(h.el('progress-text').textContent, i <= 10 ? `練習 ${i} / 10` : `${i - 10} / 48`);
    assert.equal(h.el('response').disabled, false);
    assert.equal(h.el('next').disabled, true);
    await h.el('next').onclick();
    assert.equal(h.media.plays, i);
    h.el('response').emit('compositionstart');
    h.el('response').value = 'きょう';
    h.el('response').emit('compositionupdate', {data: 'きょう'});
    h.el('response').emit('input', {data: 'きょう', inputType: 'insertCompositionText', isComposing: true});
    h.media.end();
    h.advanceTime(600000);
    h.el('retry-play').onclick();
    assert.equal(h.media.plays, i, 'no replay or automatic advance after ten minutes');
    assert.equal(h.el('next').disabled, true);
    h.el('response').emit('compositionend', {data: 'きょう'});
    assert.equal(h.el('next').disabled, false);
    h.el('response').emit('keyup', {key: 'Enter', code: 'Enter'});
    assert.equal(h.media.plays, i);
    await h.el('next').onclick(); await tick();
    if (i === 10) {
      assert.equal(h.el('practice-done').hidden, false);
      assert.equal(h.media.plays, 10, 'main audio waits for explicit start');
      assert.equal(h.saved.phase, 'main_ready');
      await h.el('begin-main').onclick(); await tick();
      await h.el('begin-main').onclick();
      assert.equal(h.media.plays, 11, 'double start does not skip a main trial');
    }
  }
  assert.equal(h.downloads.length, 1);
  const {session, events} = h.downloads[0];
  assert.equal(session.status, 'completed');
  assert.equal(session.participant_name, '動作確認用');
  assert.equal(session.trials.length, 58);
  assert.equal(session.trials.filter(t => t.trial_status === 'completed').length, 58);
  assert.equal(events.filter(e => e.event_type === 'compositionend').length, 58);
  assert.equal(events.filter(e => e.event_type === 'audio_started').length, 58);
  assert.equal(events.filter(e => e.event_type === 'audio_ended').length, 58);
  assert.ok(session.trials.every(t => t.response === 'きょう' && t.submitted_perf_ms > t.audio_ended_perf_ms && t.first_input_perf_ms > t.audio_started_perf_ms));
  assert.equal(h.savedEvents.length, events.length);
  const rows = core.exportRows(session, events);
  assert.equal(rows.filter(r => r.row_type === 'trial' && r.phase === 'main').length, 48);
  assert.equal(rows.filter(r => r.row_type === 'trial' && r.phase === 'practice').length, 10);
  assert.equal(rows.filter(r => r.row_type === 'schedule').length, 58);
  assert.equal(rows.filter(r => r.row_type === 'trial' && r.phase === 'practice' && ['automatic', 'review_alignment'].includes(r.score_status)).length, 10);
  assert.equal(rows.filter(r => r.row_type === 'trial' && r.phase === 'main' && r.score_status === 'review_reference').length, 48);
  assert.equal(session.trials[10].trial_number, 1);
  assert.equal(session.trials[10].session_trial_number, 11);
  assert.ok(events.filter(e => e.event_type === 'input').every(e => e.phase === (e.session_trial_number <= 10 ? 'practice' : 'main')));
});

test('all six IDs select distinct main sets but identical common anchor order', async () => {
  const allMain = new Set();
  let anchorOrder;
  for (let id = 1; id <= 6; id++) {
    const h = await harness({participantId: String(id)}); await h.start();
    const s = h.saved;
    assert.equal(s.counterbalance_list, id);
    assert.equal(s.order.length, 48);
    assert.equal(s.practice_order.length, 10);
    if (anchorOrder) assert.deepEqual(s.practice_order, anchorOrder);
    anchorOrder = s.practice_order;
    for (const key of s.order) { assert.ok(!allMain.has(key)); allMain.add(key); }
    await h.el('confirm-stop').onclick();
  }
  assert.equal(allMain.size, 288);
});

test('system milliseconds, monotonic clocks, browser queue delay and audio positions survive CSV export', async () => {
  const h = await harness(); await h.start();
  const onset = h.savedEvents.find(e => e.event_type === 'audio_started');
  const trial = h.saved.trials[0];
  assert.equal(onset.event_system_epoch_ms, trial.audio_started_system_epoch_ms);
  assert.equal(onset.event_perf_ms, trial.audio_started_perf_ms);
  assert.equal(onset.event_monotonic_epoch_ms, 1000000 + onset.event_perf_ms);
  h.media.currentTime = 0.125;
  const originalKeyTime = h.time - 0.5;
  h.el('response').emit('keydown', {key: 'a', code: 'KeyA', timeStamp: originalKeyTime});
  await tick();
  const key = h.savedEvents.at(-1);
  assert.equal(key.browser_event_timestamp_ms, originalKeyTime);
  assert.equal(key.browser_event_monotonic_epoch_ms, 1000000 + originalKeyTime);
  assert.equal(key.browser_event_to_callback_ms, 0.75);
  assert.equal(key.browser_event_system_epoch_ms_estimate, key.event_system_epoch_ms - 0.75);
  assert.equal(key.audio_position_ms, 125);
  assert.equal(key.audio_paused, false);
  assert.equal(Date.parse(key.event_system_utc), key.event_system_epoch_ms);
  // A backwards wall-clock correction must not corrupt elapsed-time measurements.
  h.setWallOffset(-4500);
  h.el('response').emit('keyup', {key: 'a', code: 'KeyA', timeStamp: h.time});
  await tick();
  const released = h.savedEvents.at(-1);
  assert.ok(released.event_system_epoch_ms < key.event_system_epoch_ms);
  assert.ok(released.event_monotonic_epoch_ms > key.event_monotonic_epoch_ms);
  assert.ok(released.relative_to_audio_ms > key.relative_to_audio_ms);
  assert.ok(released.system_minus_monotonic_ms < key.system_minus_monotonic_ms - 4999);
  h.media.end();
  await h.el('next').onclick(); await tick();
  assert.ok(h.saved.trials[0].submitted_system_epoch_ms > 0);
  assert.ok(h.saved.trials[0].audio_ended_system_epoch_ms > 0);
  await h.el('confirm-stop').onclick(); await tick();
  const {session, events} = h.downloads[0];
  const text = core.csv(core.exportRows(session, events));
  assert.ok(text.includes('"event_system_epoch_ms"'));
  assert.ok(text.includes(`"${key.event_monotonic_epoch_ms}"`));
  assert.ok(text.includes(`"${key.event_system_utc}"`));
  assert.equal(session.trials[1].interrupted_system_epoch_ms, session.completed_system_epoch_ms);
});

test('IME composition stays editable and mixed-script answers can be submitted unchanged', async () => {
  const h = await harness(); await h.start(); h.media.end();
  assert.equal(h.saved.response_format, 'mixed-script-v1');
  h.el('response').emit('compositionstart');
  h.el('response').value = 'kyo';
  h.el('response').emit('input', {data: 'kyo', inputType: 'insertCompositionText', isComposing: true});
  assert.equal(h.el('next').disabled, true);
  assert.equal(h.el('response-error').textContent, '');
  assert.equal(h.el('response').value, 'kyo');
  h.el('response').value = '今日';
  h.el('response').emit('compositionend', {data: '今日'});
  assert.equal(h.el('next').disabled, false);
  assert.equal(h.el('response-error').textContent, '');
  await h.el('next').onclick(); await tick();
  assert.equal(h.saved.trials[0].response, '今日');
  assert.equal(h.saved.trials[0].score_status, 'pending_reading');
  for (const [i, value] of ['ガッコウ', 'ｶﾞｯｺｳ', 'abc', '１２３', '123', 'ねこ😀'].entries()) {
    h.media.end();
    h.el('response').emit('paste');
    h.el('response').value = value;
    h.el('response').emit('input', {data: value, inputType: 'insertFromPaste', isComposing: false});
    assert.equal(h.el('next').disabled, false);
    assert.equal(h.el('response-error').textContent, '');
    await h.el('next').onclick(); await tick();
    assert.equal(h.saved.trials[i + 1].response, value);
  }
  h.media.end();
  await h.el('next').onclick(); await tick();
  assert.equal(h.saved.trials[7].response, '');
  assert.equal(h.saved.trials[7].proportion_correct, 0);
});

test('aborting during audio records incomplete audio and skips scoring', async () => {
  const h = await harness(); await h.start();
  h.el('response').value = 'き'; h.el('response').emit('input');
  await h.el('confirm-stop').onclick(); await tick();
  const s = h.downloads[0].session;
  assert.equal(s.status, 'aborted');
  assert.equal(s.trials[0].audio_completed, false);
  assert.equal(s.trials[0].response, 'き');
  assert.equal(s.trials[0].score_status, 'interrupted_not_scored');
});

test('storage failure stops progression and exports in-memory data', async () => {
  const h = await harness(); await h.start(); h.fail();
  h.el('response').value = 'ねこ'; h.el('response').emit('input');
  h.el('response').emit('keyup', {key: 'o', code: 'KeyO'}); await tick();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].session.status, 'storage_error');
  assert.equal(h.downloads[0].session.trials[0].response, 'ねこ');
  assert.equal(h.el('response').disabled, true);
  assert.equal(h.lateWrites, 0);
});

test('autoplay denial permits one start after user action without replaying heard audio', async () => {
  const h = await harness({blockPlay: true}); await h.start();
  assert.equal(h.el('response').disabled, true);
  assert.equal(h.el('retry-play').hidden, false);
  h.el('retry-play').onclick(); await tick();
  assert.equal(h.el('response').disabled, false);
  h.el('retry-play').onclick();
  assert.equal(h.media.plays, 2);
});

test('reload preserves prior response and marks it interrupted without replay', async () => {
  const first = await harness(); await first.start();
  first.el('response').value = 'ほぞん'; first.el('response').emit('input'); await tick();
  const recovered = await harness({recover: first.saved});
  assert.equal(recovered.el('recovery').hidden, false);
  assert.equal(recovered.media.plays, 0);
  recovered.el('recover-download').onclick();
  const s = recovered.downloads[0].session;
  assert.equal(s.status, 'interrupted_page_closed');
  assert.equal(s.trials[0].response, 'ほぞん');
  assert.equal(s.trials[0].trial_status, 'interrupted');
  assert.equal(s.participant_name, '動作確認用');
  assert.equal(s.trials[0].phase, 'practice');
});

test('blank participant name blocks setup; the registered anchor key is scored', async () => {
  const h = await harness(); await h.start('   ');
  assert.equal(h.media.plays, 0);
  assert.equal(h.el('welcome').hidden, false);
  assert.match(h.el('error').textContent, /参加者名/);
  h.el('error').textContent = '';
  await h.start();
  h.media.end();
  h.el('response').value = practice.stimuli[0].reference_kana;
  await h.el('next').onclick(); await tick();
  assert.equal(h.saved.trials[0].correct_mora_count, core.morae(practice.stimuli[0].reference_kana).length);
  assert.equal(h.saved.trials[0].proportion_correct, 1);
});


test('name entry has no input listeners; unchanged text uses references without dropping events', async () => {
  const h = await harness();
  assert.deepEqual(h.el('participant-name').listeners, {});
  assert.deepEqual(h.el('participant').listeners, {});
  await h.start();
  h.el('response').value = '学校でパン';
  h.el('response').emit('input', {data: '学校でパン', inputType: 'insertText'});
  h.el('response').emit('keydown', {key: 'ArrowLeft', code: 'ArrowLeft'});
  h.el('response').emit('keyup', {key: 'ArrowLeft', code: 'ArrowLeft'});
  await tick();
  const [input, down, up] = h.savedEvents.slice(-3);
  assert.equal(input.value_json, JSON.stringify('学校でパン'));
  assert.equal(down.value_json, undefined);
  assert.equal(up.value_json, undefined);
  assert.equal(down.value_seq, input.seq);
  assert.equal(up.value_seq, input.seq);
  assert.equal(up.seq, input.seq + 2);
  assert.equal(h.saved.trials[0].response, '学校でパン');
});


test('submission freezes the saved answer while the storage queue completes', async () => {
  const h = await harness(); await h.start(); h.media.end();
  h.el('response').value = 'がっこう';
  const submitting = h.el('next').onclick();
  assert.equal(h.el('response').disabled, true);
  h.el('response').value = '別の回答'; h.el('response').emit('input');
  await submitting; await tick();
  assert.equal(h.saved.trials[0].response, 'がっこう');
  assert.equal(h.saved.trials[0].response_reading, 'がっこう');
});
