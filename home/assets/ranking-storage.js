/* Local-only IndexedDB persistence; save snapshots are queued in call order. */
(function (root, factory) {
  'use strict';
  const model = typeof module === 'object' && module.exports ? require('./ranking-model.js') : root.RankingModel;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RankingStorage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Model) {
  'use strict';
  class StorageError extends Error {
    constructor(code, message, cause) { super(message); this.name = 'RankingStorageError'; this.code = code; this.cause = cause; }
  }
  function storageError(error) {
    if (error instanceof StorageError) return error;
    if (error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'))
      return new StorageError('quota', '浏览器本地存储空间不足，本次修改尚未自动保存。请先导出 JSON 备份，再减少图片。', error);
    if (error && (error.name === 'SecurityError' || error.name === 'InvalidStateError' || error.name === 'NotAllowedError'))
      return new StorageError('unavailable', '此浏览器未允许本地保存。修改仍可使用，请及时导出 JSON 备份。', error);
    return new StorageError('failed', '本地保存未完成，请导出 JSON 备份后重试。', error);
  }
  function createStore(options) {
    options = options || {};
    const driver = Object.prototype.hasOwnProperty.call(options, 'indexedDB') ? options.indexedDB :
      (typeof indexedDB !== 'undefined' ? indexedDB : null);
    const dbName = options.dbName || 'xieyuqing-ranking-v1';
    const storeName = 'rankings';
    const key = 'current';
    const templateIds = Model.TEMPLATES ? Object.keys(Model.TEMPLATES) : ['food', 'sport'];
    function templateKey(templateId) {
      if (typeof templateId !== 'string' || !templateIds.includes(templateId))
        throw new StorageError('template', '未知排行模板，原存档仍保留，请刷新页面后重试。');
      return 'template:' + templateId;
    }
    let connection = null;
    let opening = null;
    let queue = Promise.resolve();
    function open() {
      if (connection) return Promise.resolve(connection);
      if (opening) return opening;
      if (!driver || typeof driver.open !== 'function')
        return Promise.reject(new StorageError('unavailable', '此浏览器无法使用本地自动保存，请使用 JSON 文件备份。'));
      const pending = new Promise((resolve, reject) => {
        let finished = false;
        let request;
        const timer = setTimeout(() => finish(new StorageError('unavailable', '打开本地存储超时，请关闭旧标签页后重试，或导出 JSON 备份。')), 8000);
        function finish(error, db) {
          if (finished) { if (db && db !== connection) db.close(); return; }
          finished = true;
          clearTimeout(timer);
          if (error) { reject(storageError(error)); }
          else {
            connection = db;
            db.onversionchange = () => { db.close(); connection = null; opening = null; };
            db.onclose = () => { connection = null; opening = null; };
            resolve(db);
          }
        }
        try { request = driver.open(dbName, 1); } catch (error) { finish(error); return; }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        };
        request.onsuccess = () => finish(null, request.result);
        request.onerror = () => finish(request.error);
        request.onblocked = () => finish(new StorageError('unavailable', '本地存储被旧标签页占用，请关闭旧页面后重试或导出 JSON 备份。'));
      });
      opening = pending.catch(error => { opening = null; throw error; });
      return opening;
    }
    function enqueue(operation) {
      const pending = queue.then(operation, operation);
      queue = pending.catch(() => undefined);
      return pending;
    }
    async function transact(mode, action) {
      const db = await open();
      return new Promise((resolve, reject) => {
        let transaction;
        let requests;
        let requestError;
        try {
          transaction = db.transaction(storeName, mode);
          const result = action(transaction.objectStore(storeName));
          requests = Array.isArray(result) ? result : [result];
          requests.forEach(request => { request.onerror = () => { if (!requestError) requestError = request.error; }; });
          transaction.oncomplete = () => resolve(requests[0].result);
          transaction.onerror = () => reject(storageError(requestError || transaction.error));
          transaction.onabort = () => reject(storageError(requestError || transaction.error));
        } catch (error) {
          // A synchronous error on the second write must also roll back the first write.
          if (transaction) { try { transaction.abort(); } catch (_) { /* Already inactive or aborted. */ } }
          if (error && error.name === 'InvalidStateError') { connection = null; opening = null; }
          reject(storageError(error));
        }
      });
    }
    return {
      save(state) {
        let snapshot, destination;
        try {
          const validated = Model.validateState(state);
          destination = templateKey(validated.templateId || 'food');
          snapshot = Model.serialize(validated);
        } catch (error) { return Promise.reject(error); }
        return enqueue(() => transact('readwrite', store => [store.put(snapshot, key), store.put(snapshot, destination)]));
      },
      saveTemplate(state) {
        let snapshot, destination;
        try {
          const validated = Model.validateState(state);
          destination = templateKey(validated.templateId || 'food');
          snapshot = Model.serialize(validated);
        } catch (error) { return Promise.reject(error); }
        return enqueue(() => transact('readwrite', store => store.put(snapshot, destination)));
      },
      load() {
        return enqueue(async () => {
          const snapshot = await transact('readonly', store => store.get(key));
          if (snapshot === undefined) return null;
          try { return Model.deserialize(snapshot); }
          catch (error) { throw new StorageError('corrupt', '已保存的排行无法读取，原记录仍保留。可导入其他 JSON 备份，或确认重置。' + error.message, error); }
        });
      },
      loadTemplate(templateId) {
        let destination;
        try { destination = templateKey(templateId); } catch (error) { return Promise.reject(error); }
        return enqueue(async () => {
          const snapshot = await transact('readonly', store => store.get(destination));
          if (snapshot === undefined) return null;
          try {
            const restored = Model.deserialize(snapshot);
            if ((restored.templateId || 'food') !== templateId) throw new Error('模板标识与存档位置不一致。');
            return restored;
          } catch (error) {
            throw new StorageError('corrupt', '此模板存档无法读取，原记录仍保留，未自动覆盖。请导出 JSON 备份，或确认重置此模板。' + error.message, error);
          }
        });
      },
      clear() {
        return enqueue(() => transact('readwrite', store => [key, ...templateIds.map(templateKey)].map(entry => store.delete(entry))));
      }
    };
  }
  return { createStore, StorageError };
}));
