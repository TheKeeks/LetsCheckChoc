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

var _authReadyResolve;
window._fbAuthReady = new Promise(function(resolve) { _authReadyResolve = resolve; });
var _firstAuthEvent = true;
var AUTH_RESTORE_WAIT_MS = 1500;
var ANON_SIGNIN_DELAY_MS = 2000;

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
      migrateAnonDataToUser(); // This already calls loadLogsFromFirebase() at the end
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
      _authReadyResolve();
    } else {
      // Give Firebase a moment to restore a Google session before resolving
      setTimeout(function() { _authReadyResolve(); }, AUTH_RESTORE_WAIT_MS);
    }
  }

  if (typeof updateAuthUI === 'function') updateAuthUI(user);
});

// Only sign in anonymously if no persisted session is detected after a delay
setTimeout(function() {
  if (!fbAuth.currentUser) {
    fbAuth.signInAnonymously().catch(function(err) {
      console.warn('Anonymous auth failed:', err);
    });
  }
}, ANON_SIGNIN_DELAY_MS);

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