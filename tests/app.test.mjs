// State-machine integration with simulated browser events. Real Chrome checks are recorded separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import * as core from '../site/core.mjs';

const source = readFileSync(new URL('../site/app.mjs', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const manifestText = readFileSync(new URL('../site/stimuli.json', import.meta.url), 'utf8');
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
  const el = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const panels = ['welcome', 'instructions', 'task', 'practice-done', 'finish', 'recovery'].map(el);
  let media, time = 0, saved, failSave = false, failedOnce = false, lateWrites = 0;
  const savedEvents = [], downloads = [];
  class Audio extends Element {
    constructor() { super('audio'); media = this; this.currentTime = 0; this.duration = 2; this.plays = 0; }
    play() { this.plays++; if (options.blockPlay && this.plays === 1) return Promise.reject(Object.assign(new Error('blocked'), {name: 'NotAllowedError'})); this.emit('playing'); return Promise.resolve(); }
    pause() { this.emit('pause'); }
    end() { this.currentTime = this.duration; this.emit('ended'); }
  }
  const document = {getElementById: el, querySelectorAll: () => panels, addEventListener() {}, visibilityState: 'visible'};
  const context = {...core, document, Audio, window: {scrollTo() {}, addEventListener() {}},
    navigator: {userAgent: 'simulated-browser', locks: {request: (name, opts, fn) => { fn({}); return Promise.resolve(); }}},
    performance: {now: () => ++time, timeOrigin: 1000000}, crypto: webcrypto,
    URL: {createObjectURL: () => 'blob:fixture'}, Blob, TextDecoder, structuredClone,
    fetch: async path => {
      const bytes = path === './stimuli.json' ? Buffer.from(manifestText) : readFileSync(new URL(`../site/${path}`, import.meta.url));
      return {ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
    },
    openDatabase: async () => ({}), read: async (db, store) => store === 'state' ? options.recover?.id : options.recover,
    allRecords: async () => [], clearActive: async () => {},
    save: async (db, session, event) => {
      if (failSave && !failedOnce) { failedOnce = true; throw new Error('simulated quota failure'); }
      if (failedOnce) lateWrites++;
      saved = structuredClone(session); if (event) savedEvents.push(structuredClone(event));
    },
    downloadCsv: (session, events) => downloads.push({session: structuredClone(session), events: structuredClone(events)}),
  };
  vm.runInNewContext(source, context);
  // SHA-256 calls run on the worker pool, so wait for the explicit ready state.
  for (let i = 0; i < 500 && el('setup-next').disabled; i++) await tick();
  assert.equal(el('error').textContent, undefined);
  assert.equal(el('setup-next').disabled, false);
  return {el, media, downloads, savedEvents, get saved() { return saved; }, get lateWrites() { return lateWrites; }, fail: () => { failSave = true; },
    start: async (name = '動作確認用') => { el('participant').value = '900002'; el('participant-name').value = name; el('begin').disabled = false; await el('begin').onclick(); await tick(); },
  };
}

test('4 practice + 36 main trials: gates, phase transition, identity and CSV separation', async () => {
  const h = await harness(); await h.start();
  await h.el('begin-main').onclick();
  assert.equal(h.media.plays, 1, 'cannot skip practice');
  for (let i = 1; i <= 40; i++) {
    assert.equal(h.el('progress-text').textContent, i <= 4 ? `練習 ${i} / 4` : `${i - 4} / 36`);
    assert.equal(h.el('response').disabled, false);
    assert.equal(h.el('next').disabled, true);
    await h.el('next').onclick();
    assert.equal(h.media.plays, i);
    h.el('response').emit('compositionstart');
    h.el('response').value = 'きょう';
    h.el('response').emit('compositionupdate', {data: 'きょう'});
    h.el('response').emit('input', {data: 'きょう', inputType: 'insertCompositionText', isComposing: true});
    h.media.end();
    assert.equal(h.el('next').disabled, true);
    h.el('response').emit('compositionend', {data: 'きょう'});
    assert.equal(h.el('next').disabled, false);
    h.el('response').emit('keyup', {key: 'Enter', code: 'Enter'});
    assert.equal(h.media.plays, i);
    await h.el('next').onclick(); await tick();
    if (i === 4) {
      assert.equal(h.el('practice-done').hidden, false);
      assert.equal(h.media.plays, 4, 'main audio waits for explicit start');
      assert.equal(h.saved.phase, 'main_ready');
      await h.el('begin-main').onclick(); await tick();
      await h.el('begin-main').onclick();
      assert.equal(h.media.plays, 5, 'double start does not skip a main trial');
    }
  }
  assert.equal(h.downloads.length, 1);
  const {session, events} = h.downloads[0];
  assert.equal(session.status, 'completed');
  assert.equal(session.participant_name, '動作確認用');
  assert.equal(session.trials.length, 40);
  assert.equal(session.trials.filter(t => t.trial_status === 'completed').length, 40);
  assert.equal(events.filter(e => e.event_type === 'compositionend').length, 40);
  assert.equal(events.filter(e => e.event_type === 'audio_started').length, 40);
  assert.equal(events.filter(e => e.event_type === 'audio_ended').length, 40);
  assert.ok(session.trials.every(t => t.response === 'きょう' && t.submitted_perf_ms > t.audio_ended_perf_ms && t.first_input_perf_ms > t.audio_started_perf_ms));
  assert.equal(h.savedEvents.length, events.length);
  const rows = core.exportRows(session, events);
  assert.equal(rows.filter(r => r.row_type === 'trial' && r.phase === 'main').length, 36);
  assert.equal(rows.filter(r => r.row_type === 'trial' && r.phase === 'practice').length, 4);
  assert.equal(rows.filter(r => r.row_type === 'schedule').length, 40);
  assert.equal(rows.filter(r => r.row_type === 'trial' && r.phase === 'practice' && r.reference_mora_count === 20).length, 4);
  assert.equal(rows.filter(r => r.row_type === 'trial' && r.phase === 'main' && r.score_status === 'placeholder_not_scored').length, 36);
  assert.equal(session.trials[4].trial_number, 1);
  assert.equal(session.trials[4].session_trial_number, 5);
  assert.ok(events.filter(e => e.event_type === 'input').every(e => e.phase === (e.session_trial_number <= 4 ? 'practice' : 'main')));
});

test('invalid orthography does not advance, empty submitted answer is preserved', async () => {
  const h = await harness(); await h.start(); h.media.end();
  h.el('response').value = '今日';
  await h.el('next').onclick();
  assert.equal(h.media.plays, 1);
  assert.match(h.el('response-error').textContent, /ひらがな/);
  h.el('response').value = '';
  await h.el('next').onclick(); await tick();
  assert.equal(h.saved.trials[0].response, '');
  assert.equal(h.media.plays, 2);
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

test('blank participant name blocks audio and setup; completed practice is scored out of twenty', async () => {
  const h = await harness(); await h.start('   ');
  assert.equal(h.media.plays, 0);
  assert.equal(h.el('welcome').hidden, false);
  assert.match(h.el('error').textContent, /参加者名/);
  h.el('error').textContent = '';
  await h.start();
  h.media.end();
  h.el('response').value = 'あしたはともだちとこうえんまであるきます';
  await h.el('next').onclick(); await tick();
  assert.equal(h.saved.trials[0].correct_mora_count, 20);
  assert.equal(h.saved.trials[0].proportion_correct, 1);
});
