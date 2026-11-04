export const VERSION = 'intelligibility-2026-11-04-v4';
export const SCORE_VERSION = 'mora-levenshtein-matches-v1';
export const READING_VERSION = 'kana-normalization-v1';
export const CONDITIONS = ['Japanese', 'Asian', 'Romance'];

export function participantId(value) {
  const id = String(value).trim();
  if (!/^\d{1,12}$/.test(id) || BigInt(id) < 1n) throw new Error('参加者番号を半角の正の整数で入力してください。');
  return BigInt(id).toString();
}

export function participantName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('参加者名を100文字以内で入力してください。');
  return name;
}

export function rng(seed) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.codePointAt(0), 16777619) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function makeOrder(stimuli, id, version) {
  const random = rng(`${version}:order:${participantId(id)}`);
  // Rejection sampling preserves the requested restriction without silently relaxing it.
  for (let attempt = 0; attempt < 100000; attempt++) {
    const order = stimuli.map(s => s.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const condition = new Map(stimuli.map(s => [s.id, s.condition]));
    if (order.every((s, i) => i < 2 || condition.get(s) !== condition.get(order[i - 1]) || condition.get(s) !== condition.get(order[i - 2]))) return order;
  }
  throw new Error('提示順を作成できませんでした。実験者にお知らせください。');
}

export function normalizeKana(value) {
  return value.normalize('NFC').replace(/[\uff61-\uff9f]+/gu, s => s.normalize('NFKC'))
    .replace(/[\u30a1-\u30f6]/gu, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s。、，．,.!?！？「」『』（）()・]/gu, '');
}

export function validResponse(value) {
  return typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

export function validKana(value) {
  return /^[\u3041-\u3096ー]*$/u.test(normalizeKana(value));
}

export function morae(value) {
  const text = normalizeKana(value);
  if (!validKana(text)) throw new Error('採点用の読みをかなで指定してください。');
  const result = [];
  for (const char of text) {
    if ('ゃゅょぁぃぅぇぉゎ'.includes(char)) {
      const previous = result.at(-1);
      if (!previous || previous.length !== 1 || 'ぁぃぅぇぉゃゅょゎっんー'.includes(previous)) throw new Error('小さいかなの組合せを確認してください。');
      result[result.length - 1] += char;
    } else {
      if (char === 'ー' && !result.length) throw new Error('先頭の長音を確認してください。');
      result.push(char);
    }
  }
  return result;
}

export function scoreMora(reference, response) {
  const target = morae(reference);
  const answer = morae(response);
  if (!target.length) throw new Error('正答のモーラ列が空です。');
  if (target.length > 300 || answer.length > 2000) throw new Error('採点対象の文字数が上限を超えています。');
  const matrix = Array.from({length: target.length + 1}, () => Array(answer.length + 1));
  matrix[0][0] = {cost: 0, matches: 0, min: 0, max: 0};
  for (let i = 0; i <= target.length; i++) {
    for (let j = 0; j <= answer.length; j++) {
      if (!i && !j) continue;
      const candidates = [];
      function add(pi, pj, cost, match, op) {
        const old = matrix[pi][pj];
        candidates.push({cost: old.cost + cost, matches: old.matches + match, min: old.min + match, max: old.max + match, pi, pj, op});
      }
      if (i && j) {
        const equal = target[i - 1] === answer[j - 1];
        add(i - 1, j - 1, equal ? 0 : 1, equal ? 1 : 0, equal ? 'match' : 'substitution');
      }
      if (i) add(i - 1, j, 1, 0, 'deletion');
      if (j) add(i, j - 1, 1, 0, 'insertion');
      const cost = Math.min(...candidates.map(c => c.cost));
      const best = candidates.filter(c => c.cost === cost);
      best.sort((a, b) => b.matches - a.matches);
      matrix[i][j] = {...best[0], min: Math.min(...best.map(c => c.min)), max: Math.max(...best.map(c => c.max))};
    }
  }
  const last = matrix[target.length][answer.length];
  const alignment = [];
  for (let i = target.length, j = answer.length; i || j;) {
    const cell = matrix[i][j];
    alignment.push({op: cell.op, target: cell.pi < i ? target[i - 1] : '', response: cell.pj < j ? answer[j - 1] : ''});
    [i, j] = [cell.pi, cell.pj];
  }
  alignment.reverse();
  return {
    score_version: SCORE_VERSION, reference_mora_count: target.length,
    correct_mora_count: last.matches, proportion_correct: last.matches / target.length,
    substitutions: alignment.filter(a => a.op === 'substitution').length,
    deletions: alignment.filter(a => a.op === 'deletion').length,
    insertions: alignment.filter(a => a.op === 'insertion').length,
    alignment_ambiguous: last.min !== last.max, alignment_json: JSON.stringify(alignment),
    score_status: last.min !== last.max ? 'review_alignment' : 'automatic',
  };
}

export function validateManifest(manifest) {
  if (!manifest.version || !['placeholder', 'study'].includes(manifest.mode) || manifest.stimuli?.length !== 36) throw new Error('刺激設定には36件の音声が必要です。');
  const ids = new Set(), sentences = new Set(), speakers = new Map();
  for (const s of manifest.stimuli) {
    if (!s.id || ids.has(s.id) || !s.sentence_id || sentences.has(s.sentence_id)) throw new Error('刺激または文のIDが重複しています。');
    if (!CONDITIONS.includes(s.condition) || !/^[A-Za-z0-9_-]+$/.test(s.speaker_id)) throw new Error('話者・条件の設定が不正です。');
    if (!/^audio\/[A-Za-z0-9_-]+\.wav$/.test(s.audio) || !/^[a-f0-9]{64}$/.test(s.sha256)) throw new Error('音声ファイル・ハッシュを確認してください。');
    if (manifest.mode === 'study' && (!s.reference_kana || !morae(s.reference_kana).length)) throw new Error('本番刺激の正答が未登録です。');
    if (s.reference_kana && morae(s.reference_kana).length > 300) throw new Error('正答が長すぎます。');
    if (s.accepted_variants_kana !== undefined && (!Array.isArray(s.accepted_variants_kana) || s.accepted_variants_kana.some(v => typeof v !== 'string' || morae(v).length !== morae(s.reference_kana || '').length))) throw new Error('許容表記は正答と同じモーラ数で登録してください。');
    const speaker = speakers.get(s.speaker_id) || {condition: s.condition, count: 0};
    if (speaker.condition !== s.condition) throw new Error('同じ話者に異なる条件があります。');
    speaker.count++;
    speakers.set(s.speaker_id, speaker);
    ids.add(s.id); sentences.add(s.sentence_id);
  }
  if (speakers.size !== 12 || [...speakers.values()].some(s => s.count !== 3) || CONDITIONS.some(c => [...speakers.values()].filter(s => s.condition === c).length !== 4)) throw new Error('各条件4話者・各話者3音声の設定が必要です。');
  return manifest;
}

export function resultScore(stimulus, response, mode) {
  const kana = normalizeKana(response);
  const reading = {response_reading: validKana(kana) ? kana : '', reading_status: validKana(kana) ? 'automatic_kana' : 'needs_review', reading_method: validKana(kana) ? 'kana_normalization' : '', reading_version: READING_VERSION};
  if (mode === 'placeholder') return {...reading, score_status: 'placeholder_not_scored', score_version: SCORE_VERSION};
  if (reading.reading_status === 'needs_review') return {...reading, score_status: 'pending_reading', score_version: SCORE_VERSION, reference_mora_count: morae(stimulus.reference_kana).length};
  try {
    const references = [stimulus.reference_kana, ...(stimulus.accepted_variants_kana || [])];
    const candidates = references.map(reference => ({...scoreMora(reference, kana), scored_reference_kana: reference}));
    candidates.sort((a, b) => b.correct_mora_count - a.correct_mora_count);
    return {...reading, ...candidates[0]};
  }
  catch (error) { return {...reading, reading_status: 'needs_review', score_status: 'review_response', score_version: SCORE_VERSION, score_note: error.message}; }
}

export function validatePractice(practice, manifest) {
  if (!practice.version || practice.stimuli?.length !== 4) throw new Error('練習用の音声は4件必要です。');
  const ids = new Set(manifest.stimuli.map(s => s.id));
  const sentences = new Set(manifest.stimuli.map(s => s.sentence_id));
  for (const s of practice.stimuli) {
    if (!s.id || ids.has(s.id) || !s.sentence_id || sentences.has(s.sentence_id)) throw new Error('練習と本番の刺激ID・文IDは別にしてください。');
    if (s.condition !== 'practice' || !s.speaker_id || !/^audio\/[A-Za-z0-9_-]+\.wav$/.test(s.audio) || !/^[a-f0-9]{64}$/.test(s.sha256)) throw new Error('練習用の音声設定を確認してください。');
    if (typeof s.reference_kana !== 'string' || morae(s.reference_kana).length !== 20) throw new Error('練習文の正答は20モーラで登録してください。');
    ids.add(s.id); sentences.add(s.sentence_id);
  }
  return practice;
}

export function csv(rows, columns = [...new Set(rows.flatMap(row => Object.keys(row)))]) {
  const cell = value => {
    let text = value === undefined || value === null ? '' : String(value);
    // Protect spreadsheet users; *_json columns preserve the exact original text.
    if (typeof value === 'string' && /^[\s]*[=+@-]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [columns.map(cell).join(','), ...rows.map(row => columns.map(c => cell(row[c])).join(','))].join('\r\n') + '\r\n';
}

export function exportRows(session, events) {
  const common = {session_id: session.id, participant_id: session.participant_id, participant_name: session.participant_name || '', participant_name_json: JSON.stringify(session.participant_name || ''), app_version: session.app_version, manifest_version: session.manifest.version, manifest_sha256: session.manifest_sha256, practice_version: session.practice?.version || '', practice_sha256: session.practice_sha256 || '', mode: session.manifest.mode, session_status: session.status};
  const rows = [{...common, row_type: 'session', started_at_utc: session.started_at_utc, completed_at_utc: session.completed_at_utc, user_agent: session.user_agent, time_origin_ms: session.time_origin_ms, timezone: session.timezone || '', timezone_offset_minutes: session.timezone_offset_minutes ?? '', timing_version: session.timing_version || '', started_system_epoch_ms: session.started_system_epoch_ms ?? '', started_monotonic_epoch_ms: session.started_monotonic_epoch_ms ?? '', completed_system_epoch_ms: session.completed_system_epoch_ms ?? '', completed_monotonic_epoch_ms: session.completed_monotonic_epoch_ms ?? '', seed: session.seed, storage_error: session.storage_error || '', scoring_policy: SCORE_VERSION, manifest_json: JSON.stringify(session.manifest), practice_json: session.practice ? JSON.stringify(session.practice) : ''}];
  const practiceCount = session.practice_order?.length || 0;
  (session.practice_order || []).forEach((id, index) => {
    const s = session.practice.stimuli.find(s => s.id === id);
    rows.push({...common, row_type: 'schedule', phase: 'practice', trial_number: index + 1, session_trial_number: index + 1, stimulus_id: id, sentence_id: s.sentence_id, speaker_id: s.speaker_id, condition: s.condition, audio_file: s.audio, audio_sha256: s.sha256, reference_kana: s.reference_kana});
  });
  session.order.forEach((id, index) => {
    const s = session.manifest.stimuli.find(s => s.id === id);
    rows.push({...common, row_type: 'schedule', phase: 'main', trial_number: index + 1, session_trial_number: practiceCount + index + 1, stimulus_id: id, sentence_id: s.sentence_id, speaker_id: s.speaker_id, condition: s.condition, audio_file: s.audio, audio_sha256: s.sha256, reference_kana: s.reference_kana || ''});
  });
  for (const trial of session.trials) rows.push({...common, row_type: 'trial', phase: 'main', ...trial, response_json: JSON.stringify(trial.response)});
  for (const event of events) rows.push({...common, row_type: 'event', ...event});
  return rows;
}
