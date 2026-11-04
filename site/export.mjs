import {csv} from './core.mjs';
import {zipSync, strToU8} from './vendor/fflate-0.8.2.mjs';

export const EXPORT_VERSION = 'split-tables-v1';
export const METRICS_VERSION = 'input-process-v1';
const trialKey = row => `${row.phase || 'main'}:${row.trial_number}`;
const bool = value => value === true || value === 'true';
const number = value => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;

export function trialMetrics(trial, events) {
  const onset = number(trial.audio_started_perf_ms);
  const latency = event => event && onset != null ? Number(event.event_perf_ms) - onset : '';
  const keys = events.filter(e => e.event_type === 'keydown' && !bool(e.repeat) && !['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(JSON.parse(e.key_json || 'null')));
  const input = events.filter(e => e.event_type === 'input');
  const committed = events.find(e => (e.event_type === 'compositionend' || (e.event_type === 'input' && !bool(e.is_composing) && e.input_type?.startsWith('insert'))) && !!JSON.parse(e.input_data_json || 'null'));
  const submitted = number(trial.submitted_perf_ms), ended = number(trial.audio_ended_perf_ms);
  return {metrics_version: METRICS_VERSION, event_count: events.length, keydown_nonrepeat_nonmodifier_count: keys.length,
    input_event_count: input.length, composition_count: events.filter(e => e.event_type === 'compositionstart').length,
    noncomposition_delete_event_count: input.filter(e => !bool(e.is_composing) && e.input_type?.startsWith('delete')).length,
    first_keydown_callback_latency_ms: latency(keys[0]), first_input_callback_latency_ms: latency(input[0]), first_commit_callback_latency_ms: latency(committed),
    post_audio_submit_ms: submitted != null && ended != null ? submitted - ended : '',
    visibility_hidden_count: events.filter(e => e.event_type === 'visibilitychange' && e.visibility === 'hidden').length};
}

export function scheduleRows(session) {
  const rows = [];
  for (const phase of ['practice', 'main']) {
    const order = phase === 'practice' ? session.practice_order || [] : session.order;
    const source = phase === 'practice' ? session.practice : session.manifest;
    for (const [index, id] of order.entries()) {
      const s = source.stimuli.find(s => s.id === id);
      rows.push({session_id: session.id, phase, trial_number: index + 1, session_trial_number: rows.length + 1, stimulus_id: id,
        sentence_id: s.sentence_id, speaker_id: s.speaker_id, condition: s.condition, audio_file: s.audio, audio_sha256: s.sha256, reference_kana: s.reference_kana || ''});
    }
  }
  return rows;
}

export function exportTables(session, events) {
  const grouped = new Map();
  for (const event of events) {
    const key = trialKey(event);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }
  const {trials, ...metadata} = session;
  const trialRows = trials.map((trial, index) => {
    const {response, ...rest} = trial;
    return {session_id: session.id, participant_id: session.participant_id, phase: 'main', session_trial_number: index + 1,
      ...rest, response: response ?? '', response_json: JSON.stringify(response ?? ''), ...trialMetrics(trial, grouped.get(trialKey(trial)) || [])};
  });
  return {
    'session.json': JSON.stringify({...metadata, export_version: EXPORT_VERSION, event_count: events.length, observed_trial_count: trials.length}, null, 2) + '\n',
    'schedule.csv': csv(scheduleRows(session)),
    'trials.csv': trialRows.length ? csv(trialRows) : csv([], ['session_id', 'session_trial_number', 'trial_status', 'response', 'response_json']),
    'events.csv': events.length ? csv(events) : csv([], ['session_id', 'seq', 'event_type']),
  };
}

export function archiveBytes(session, events) {
  const files = Object.fromEntries(Object.entries(exportTables(session, events)).map(([name, content]) => [name, strToU8(content)]));
  return zipSync(files, {level: 6});
}

export function downloadArchive(session, events) {
  const url = URL.createObjectURL(new Blob([archiveBytes(session, events)], {type: 'application/zip'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `intelligibility_${session.participant_id}_${session.id}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
