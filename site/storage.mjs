export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('intelligibility-v1', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', {keyPath: 'id'});
        db.createObjectStore('state');
        db.createObjectStore('events', {keyPath: ['session_id', 'seq']}).createIndex('session', 'session_id');
      }
      if (!db.objectStoreNames.contains('trials')) db.createObjectStore('trials', {keyPath: ['session_id', 'session_trial_number']}).createIndex('session', 'session_id');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('同じ課題を開いている別のタブを閉じてください。'));
  });
}

export function sessionMetadata(session) {
  const {trials, ...metadata} = session;
  return {...metadata, storage_version: 2, trial_counts: {practice: trials.filter(t => t.phase === 'practice').length, main: trials.filter(t => t.phase !== 'practice').length}};
}

// One read transaction keeps the metadata, trials and events at the same point in time.
export function loadRecord(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'trials', 'events']);
    const metadata = tx.objectStore('sessions').get(id);
    const trials = tx.objectStore('trials').index('session').getAll(id);
    const events = tx.objectStore('events').index('session').getAll(id);
    tx.oncomplete = () => {
      const session = metadata.result;
      if (session?.storage_version === 2) session.trials = trials.result.sort((a, b) => a.session_trial_number - b.session_trial_number);
      resolve({session, events: events.result});
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('記録の読込が中断されました。'));
  });
}

export function save(db, session, event, trials = []) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'trials', 'events', 'state'], 'readwrite');
    if (session) {
      tx.objectStore('sessions').put(session);
      tx.objectStore('state').put(session.id, 'active');
    }
    for (const trial of trials) tx.objectStore('trials').put(trial);
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
