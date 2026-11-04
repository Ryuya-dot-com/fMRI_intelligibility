import {downloadArchive} from './export.mjs';
import {openDatabase, allRecords, loadRecord} from './storage.mjs';
try {
  const db = await openDatabase();
  const sessions = await allRecords(db, 'sessions');
  const list = document.getElementById('records');
  if (!sessions.length) list.textContent = '記録はありません。';
  for (const session of sessions.sort((a, b) => b.started_at_utc.localeCompare(a.started_at_utc))) {
    const row = document.createElement('p');
    const button = document.createElement('button');
    button.className = 'secondary';
    const practiceCount = session.trial_counts?.practice ?? session.trials.filter(t => t.phase === 'practice').length;
    const mainCount = session.trial_counts?.main ?? session.trials.length - practiceCount;
    button.textContent = `ID ${session.participant_id} · ${session.participant_name || '氏名なし（旧記録）'} · ${session.started_at_utc} · ${session.status} · 練習 ${practiceCount} / 本番 ${mainCount} 試行`;
    button.onclick = async () => {
      try {
        const record = await loadRecord(db, session.id);
        downloadArchive(record.session, record.events);
      }
      catch (error) { document.getElementById('error').textContent = error.message; }
    };
    row.append(button); list.append(row);
  }
} catch (error) { document.getElementById('error').textContent = error.message; }
