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

// Track authenticated user ID, type, and display name globally
window._fbUserId = null;
window._fbUserIsAnon = true;
window._fbDisplayName = '';

// Created before the SDK calls below, so it exists (and resolves) even when
// Firebase fails to load or initialise: loadSurfLog awaits it.
var _authReadyResolve;
window._fbAuthReady = new Promise(function(resolve) { _authReadyResolve = resolve; });

// Initialize Firebase and set up the global service references used by
// app.js. If the SDK did not load (blocked gstatic, ad blocker) they stay
// null and the surf log runs local-only instead of this script throwing
// (audit C03).
var fbAuth = null, fbFirestore = null, fbStorage = null;
try {
  firebase.initializeApp(firebaseConfig);
  fbAuth      = firebase.auth();
  fbFirestore = firebase.firestore();
} catch (e) {
  fbAuth = null;
  console.warn('Firebase init failed; surf log stays local-only:', e);
  _authReadyResolve();
}
// Storage is only needed for photo uploads (saveLogEntryToFirebase catches
// a missing fbStorage per photo and marks the photo for retry). A failed
// storage-compat script must not take auth and the log down with it.
try {
  if (fbAuth) fbStorage = firebase.storage();
} catch (e) {
  console.warn('Firebase Storage unavailable; photo uploads will retry later:', e);
}

var _firstAuthEvent = true;
var AUTH_RESTORE_WAIT_MS = 1500;
var ANON_SIGNIN_DELAY_MS = 2000;

var _prevUserWasAnon = false;
var _migrationDone = false;

if (fbAuth) fbAuth.onAuthStateChanged(function(user) {
  if (user) {
    var wasAnon = _prevUserWasAnon;
    var justBecameReal = wasAnon && !user.isAnonymous;
    // The anonymous uid being left behind, captured before _fbUserId is
    // overwritten: migration moves only that uid's entries (audit C26).
    var prevAnonUid = wasAnon ? window._fbUserId : null;
    window._fbUserId = user.uid;
    window._fbUserIsAnon = user.isAnonymous;
    window._fbDisplayName = user.displayName || user.email || '';
    _prevUserWasAnon = user.isAnonymous;

    if (justBecameReal && !_migrationDone && typeof migrateAnonDataToUser === 'function') {
      _migrationDone = true;
      migrateAnonDataToUser(prevAnonUid); // This already calls loadLogsFromFirebase() at the end
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
if (fbAuth) setTimeout(function() {
  if (!fbAuth.currentUser) {
    fbAuth.signInAnonymously().catch(function(err) {
      console.warn('Anonymous auth failed:', err);
    });
  }
}, ANON_SIGNIN_DELAY_MS);

// Sign in with Google; tries to link the existing anonymous account first
var _signingIn = false;
function signInWithGoogle() {
  if (_signingIn || !fbAuth) return;
  _signingIn = true;
  var provider = new firebase.auth.GoogleAuthProvider();
  var currentUser = fbAuth.currentUser;
  var done = function() { _signingIn = false; };
  if (currentUser && currentUser.isAnonymous) {
    currentUser.linkWithPopup(provider).then(done).catch(function(err) {
      if (err.code === 'auth/credential-already-in-use' ||
          err.code === 'auth/email-already-in-use') {
        // This Google account already has its own uid, and firestore.rules
        // refuse an update that changes a doc's owner. While still the
        // anonymous owner, release its synced sessions; once the Google uid
        // is in, migrateAnonDataToUser re-creates them under it.
        var release = typeof releaseAnonEntries === 'function'
          ? releaseAnonEntries(currentUser.uid) : Promise.resolve([]);
        return release.catch(function(e) {
          console.warn('Releasing anonymous entries failed:', e);
          return [];
        }).then(function(released) {
          // The link error carries the Google credential from the popup.
          // Signing in with it needs no second popup, which iOS Safari
          // blocks because no tap opened it.
          var signIn = err.credential
            ? fbAuth.signInWithCredential(err.credential)
            : fbAuth.signInWithPopup(provider);
          return signIn.then(done).catch(function(e) {
            done();
            // Still anonymous: put the released sessions back under this uid.
            if (released.length && typeof restoreReleasedEntries === 'function') {
              restoreReleasedEntries(released);
            }
            if (e.code !== 'auth/popup-closed-by-user' &&
                e.code !== 'auth/cancelled-popup-request') {
              console.warn('Google sign-in failed:', e);
            }
          });
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
  if (!fbAuth) return;
  fbAuth.signOut().then(function() {
    fbAuth.signInAnonymously().catch(function(err) {
      console.warn('Anonymous auth failed:', err);
    });
  }).catch(function(err) {
    console.warn('Sign out failed:', err);
  });
}