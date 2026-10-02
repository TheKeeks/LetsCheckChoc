// Firebase compat SDK stub for tests. Served by tests/e2e/run.js in place of
// https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js (the
// auth/firestore/storage compat scripts are served empty), and evaluated by
// tests/helpers/load-app.js when loadApp({ firebase: ... }) is used. It
// implements just the surface firebase-config.js and app.js touch.
//
// Knobs (set on window BEFORE this script runs; the e2e runner and
// loadApp({ firebase: {...} }) do this for you):
//   __FB_MODE        'new_anon' (default) | 'returning_anon' | 'google'
//   __FB_FIRST_AUTH_MS  delay of the first onAuthStateChanged event (default 30)
//   __FB_ANON_MS     signInAnonymously() latency (default 250)
//   __FB_FS_MS       Firestore get() latency (default 100)
//   __FB_LOGS        array of surf_logs documents returned by get()
//   __FB_FAIL        { get, set, delete, put } → that call rejects
//   __FB_NO_STORAGE  truthy → firebase.storage is missing (blocked script)
//   __FB_RULES       truthy → Firestore keeps its docs (seeded from
//                    __FB_LOGS; get() serves them) and checks each write's
//                    owner the way firestore.rules does: create claims the
//                    writer's uid, update needs the stored AND the new owner
//                    to be the writer, delete needs the stored owner to be
//                    the writer (a missing doc cannot be deleted). A refused
//                    write rejects with permission-denied and is not recorded.
// Read at call time, so a test can set them after load:
//   __FB_LINK_ERROR  error code linkWithPopup() rejects with (default
//                    'auth/popup-closed-by-user'), e.g.
//                    'auth/credential-already-in-use'
//   __FB_POPUP_USER  { uid, displayName } → signInWithPopup() signs that
//                    Google user in (default: rejects, popup closed). With
//                    an '...-already-in-use' __FB_LINK_ERROR, the link error
//                    also carries that user's Google credential (as the
//                    real SDK's err.credential), for signInWithCredential().
//   __FB_CREDENTIAL_ERROR  error code signInWithCredential() rejects with
// Every write is recorded on window.__FB_WRITES as
//   { op: 'set'|'update'|'delete'|'put', path, data, uid } (uid = the
//   signed-in writer, so a test can replay it as that principal).
(function () {
  'use strict';
  var w = window;
  var fail = w.__FB_FAIL || {};
  var writes = w.__FB_WRITES = w.__FB_WRITES || [];
  var listeners = [];
  var currentUser = null;

  function later(ms, fn) { return new Promise(function (resolve, reject) { setTimeout(function () { try { resolve(fn()); } catch (e) { reject(e); } }, ms); }); }
  function stubError(code) { var e = new Error('firebase stub: ' + code); e.code = code; return e; }
  function makeUser(uid, isAnonymous, displayName) {
    return {
      uid: uid, isAnonymous: isAnonymous, displayName: displayName || null, email: null,
      linkWithPopup: function () {
        var e = stubError(w.__FB_LINK_ERROR || 'auth/popup-closed-by-user');
        if (/already-in-use$/.test(e.code) && w.__FB_POPUP_USER) {
          e.credential = { providerId: 'google.com', _stubUser: w.__FB_POPUP_USER };
        }
        return Promise.reject(e);
      }
    };
  }
  function emit() { listeners.slice().forEach(function (cb) { cb(currentUser); }); }

  var auth = {
    get currentUser() { return currentUser; },
    onAuthStateChanged: function (cb) {
      listeners.push(cb);
      var mode = w.__FB_MODE || 'new_anon';
      setTimeout(function () {
        if (!currentUser && mode === 'returning_anon') currentUser = makeUser('anon-1', true);
        if (!currentUser && mode === 'google') currentUser = makeUser('google-1', false, 'Test Surfer');
        cb(currentUser);
      }, +(w.__FB_FIRST_AUTH_MS != null ? w.__FB_FIRST_AUTH_MS : 30));
      return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
    },
    signInAnonymously: function () {
      return later(+(w.__FB_ANON_MS != null ? w.__FB_ANON_MS : 250), function () {
        currentUser = makeUser('anon-1', true);
        emit();
        return { user: currentUser };
      });
    },
    signOut: function () { currentUser = null; emit(); return Promise.resolve(); },
    signInWithPopup: function () {
      var p = w.__FB_POPUP_USER;
      if (!p) return Promise.reject(stubError('auth/popup-closed-by-user'));
      return later(10, function () {
        currentUser = makeUser(p.uid, false, p.displayName);
        emit();
        return { user: currentUser };
      });
    },
    signInWithCredential: function (cred) {
      var p = cred && cred._stubUser;
      if (w.__FB_CREDENTIAL_ERROR || !p) return Promise.reject(stubError(w.__FB_CREDENTIAL_ERROR || 'auth/invalid-credential'));
      return later(10, function () {
        currentUser = makeUser(p.uid, false, p.displayName);
        emit();
        return { user: currentUser };
      });
    }
  };
  function authFn() { return auth; }
  authFn.GoogleAuthProvider = function GoogleAuthProvider() {};

  // __FB_RULES: the stored docs, by path, and firestore.rules' owner checks.
  var rules = !!w.__FB_RULES;
  var store = {};
  if (rules) (w.__FB_LOGS || []).forEach(function (d) { store['surf_logs/' + d.id] = d; });
  function ownerAllows(op, path, data) {
    var uid = currentUser && currentUser.uid, stored = store[path];
    if (!uid) return false;
    if (op === 'delete') return !!stored && stored.userId === uid;
    if (stored && stored.userId !== uid) return false;
    var next = op === 'update' ? Object.assign({}, stored, data) : data;
    return !!next && next.userId === uid;
  }
  function storedDocs(collection) {
    if (!rules) return w.__FB_LOGS || [];
    return Object.keys(store).filter(function (k) { return k.indexOf(collection + '/') === 0; })
      .map(function (k) { return store[k]; });
  }

  function docRef(collection, id) {
    var path = collection + '/' + id;
    function write(op, data) {
      if (fail[op]) return Promise.reject(stubError('permission-denied'));
      if (rules && !ownerAllows(op, path, data)) return Promise.reject(stubError('permission-denied'));
      writes.push({ op: op, path: path, data: data, uid: currentUser ? currentUser.uid : null });
      if (rules) {
        if (op === 'delete') delete store[path];
        else store[path] = op === 'update' ? Object.assign({}, store[path], data) : data;
      }
      return Promise.resolve();
    }
    return {
      id: id,
      set: function (data) { return write('set', data); },
      update: function (data) { return write('update', data); },
      delete: function () { return write('delete', null); },
      get: function () {
        var d = storedDocs(collection).find(function (x) { return x.id === id; });
        return Promise.resolve({ id: id, exists: !!d, data: function () { return d; } });
      }
    };
  }
  function query(collection) {
    var q = {
      where: function () { return q; },
      orderBy: function () { return q; },
      limit: function () { return q; },
      doc: function (id) { return docRef(collection, id); },
      get: function () {
        return later(+(w.__FB_FS_MS != null ? w.__FB_FS_MS : 100), function () {
          if (fail.get) throw stubError('permission-denied');
          var docs = storedDocs(collection).map(function (d) {
            return { id: d.id, data: function () { return d; } };
          });
          return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (f) { docs.forEach(f); } };
        });
      }
    };
    return q;
  }
  var firestore = { collection: function (name) { return query(name); } };
  function firestoreFn() { return firestore; }
  firestoreFn.FieldValue = { serverTimestamp: function () { return new Date(); } };

  function storageRef(path) {
    return {
      fullPath: path,
      child: function (p) { return storageRef(path ? path + '/' + p : p); },
      put: function (data) {
        if (fail.put) return Promise.reject(stubError('storage/unauthorized'));
        writes.push({ op: 'put', path: path, data: null, uid: currentUser ? currentUser.uid : null });
        return Promise.resolve({ ref: this });
      },
      getDownloadURL: function () { return Promise.resolve('https://firebasestorage.test/' + encodeURIComponent(path)); },
      delete: function () { writes.push({ op: 'delete', path: path, data: null }); return Promise.resolve(); }
    };
  }
  var storage = { ref: function (path) { return storageRef(path || ''); } };

  w.firebase = {
    initializeApp: function () { return {}; },
    auth: authFn,
    firestore: firestoreFn,
    storage: function () { return storage; }
  };
  if (w.__FB_NO_STORAGE) delete w.firebase.storage;
})();
