export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('intelligibility-v1', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('sessions', {keyPath: 'id'});
      db.createObjectStore('state');
      const events = db.createObjectStore('events', {keyPath: ['session_id', 'seq']});
      events.createIndex('session', 'session_id');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('同じ課題を開いている別のタブを閉じてください。'));
  });
}

export function save(db, session, event) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'events', 'state'], 'readwrite');
    tx.objectStore('sessions').put(session);
    tx.objectStore('state').put(session.id, 'active');
    if (event) tx.objectStore('events').put(event);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました。'));
  });
}

export function read(db, store, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function allRecords(db, store, index, key) {
  return new Promise((resolve, reject) => {
    const source = db.transaction(store).objectStore(store);
    const request = index ? source.index(index).getAll(key) : source.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function clearActive(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').delete('active');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export function downloadCsv(session, events, csv, exportRows) {
  const url = URL.createObjectURL(new Blob([csv(exportRows(session, events))], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `intelligibility_${session.participant_id}_${session.id}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
