// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBWuLMPKGS91HSOzmQALinQl3w5FwkIdIs",
  authDomain: "letscheckchoc.firebaseapp.com",
  projectId: "letscheckchoc",
  storageBucket: "letscheckchoc.firebasestorage.app",
  messagingSenderId: "801516961544",
  appId: "1:801516961544:web:c28584674e5be4643e36bd",
  measurementId: "G-JFYS74CC6D"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Set up global service references used by app.js
var fbAuth      = firebase.auth();
var fbFirestore = firebase.firestore();
var fbStorage   = firebase.storage();

// Track authenticated user ID and type globally
window._fbUserId = null;
window._fbUserIsAnon = true;

// Promise that resolves once the initial auth state is known (Google session or fallback)
var _authReadyResolve;
window._fbAuthReady = new Promise(function(resolve) { _authReadyResolve = resolve; });
var _firstAuthEvent = true;

var _prevUserWasAnon = false;
var _migrationDone = false;

fbAuth.onAuthStateChanged(function(user) {
  if (user) {
    var wasAnon = _prevUserWasAnon;
    var justBecameReal = wasAnon && !user.isAnonymous;
    window._fbUserId = user.uid;
    window._fbUserIsAnon = user.isAnonymous;
    _prevUserWasAnon = user.isAnonymous;

    if (justBecameReal && !_migrationDone && typeof migrateAnonDataToUser === 'function') {
      _migrationDone = true;
      migrateAnonDataToUser(); // already calls loadLogsFromFirebase() at the end
    } else if (!user.isAnonymous && typeof loadLogsFromFirebase === 'function') {
      // Non-anonymous user on page load (not a transition) — load their data
      loadLogsFromFirebase().then(function() {
        if (typeof updateStorageNote === 'function') updateStorageNote();
      }).catch(function(e) {
        console.warn('Log reload after auth failed:', e);
      });
    }
  } else {
    window._fbUserId = null;
    window._fbUserIsAnon = true;
    _prevUserWasAnon = false;
    _migrationDone = false;
  }

  // Resolve auth ready on first event
  if (_firstAuthEvent) {
    _firstAuthEvent = false;
    if (user && !user.isAnonymous) {
      // Google (or other real) session already restored — auth is ready now
      _authReadyResolve();
    } else {
      // Anonymous or signed-out on first event: wait briefly for Firebase to restore a
      // persisted Google session before resolving (Firebase may fire null/anonymous first,
      // then a second event with the real user). 1500ms is enough for local cache restore.
      setTimeout(function() { _authReadyResolve(); }, 1500);
    }
  }

  if (typeof updateAuthUI === 'function') updateAuthUI(user);
});

// Only sign in anonymously if no persisted session is detected after a brief delay.
// 2000ms > the 1500ms auth-ready timeout so the app can load from localStorage first;
// the anonymous session then enables local-only writes for non-signed-in users.
setTimeout(function() {
  if (!fbAuth.currentUser) {
    fbAuth.signInAnonymously().catch(function(err) {
      console.warn('Anonymous auth failed:', err);
    });
  }
}, 2000);

// Sign in with Google; tries to link the existing anonymous account first
var _signingIn = false;
function signInWithGoogle() {
  if (_signingIn) return;
  _signingIn = true;
  var provider = new firebase.auth.GoogleAuthProvider();
  var currentUser = fbAuth.currentUser;
  var done = function() { _signingIn = false; };
  if (currentUser && currentUser.isAnonymous) {
    currentUser.linkWithPopup(provider).then(done).catch(function(err) {
      if (err.code === 'auth/credential-already-in-use' ||
          err.code === 'auth/email-already-in-use') {
        return fbAuth.signInWithPopup(provider).then(done).catch(function(e) {
          done();
          if (e.code !== 'auth/popup-closed-by-user' &&
              e.code !== 'auth/cancelled-popup-request') {
            console.warn('Google sign-in failed:', e);
          }
        });
      }
      done();
      if (err.code !== 'auth/popup-closed-by-user' &&
          err.code !== 'auth/cancelled-popup-request') {
        console.warn('Google sign-in failed:', err);
      }
    });
  } else {
    fbAuth.signInWithPopup(provider).then(done).catch(function(err) {
      done();
      if (err.code !== 'auth/popup-closed-by-user' &&
          err.code !== 'auth/cancelled-popup-request') {
        console.warn('Google sign-in failed:', err);
      }
    });
  }
}

// Sign out and fall back to anonymous session
function signOutUser() {
  fbAuth.signOut().then(function() {
    fbAuth.signInAnonymously().catch(function(err) {
      console.warn('Anonymous auth failed:', err);
    });
  }).catch(function(err) {
    console.warn('Sign out failed:', err);
  });
}