// Shared login/session/logout logic used by every page on the site
// (index, flashback, ...). Keeps token handling in one place instead of
// duplicated per page.
window.CXPAuth = (function () {
  'use strict';

  var TOKEN_KEY = 'cxp_token';
  var token = null;
  var username = null;

  function getToken() { return token; }
  function getUsername() { return username; }

  function setSession(t, u) {
    token = t;
    username = u;
    if (t) localStorage.setItem(TOKEN_KEY, t);
  }

  function clearSession() {
    token = null;
    username = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  // Silently resumes a session from a saved token (page load / nav back).
  // Returns { username, solved } on success, null if there's no valid
  // session to resume.
  async function tryResume() {
    var saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) return null;
    try {
      var res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: saved }),
      });
      var data = await res.json();
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }
      setSession(saved, data.username);
      return { username: data.username, solved: data.solved };
    } catch (err) {
      return null;
    }
  }

  // { ok: true, username, solved, claimedLegacy } or { ok: false, error }
  async function login(name, password) {
    try {
      var res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password: password }),
      });
      var data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'Something went wrong.' };
      setSession(data.token, data.username);
      return {
        ok: true,
        username: data.username,
        solved: data.solved,
        claimedLegacy: !!data.claimedLegacy,
      };
    } catch (err) {
      return { ok: false, error: 'Network error -- try again.' };
    }
  }

  function logout() {
    var t = token;
    clearSession();
    if (t) {
      fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
      }).catch(function () {});
    }
  }

  return { getToken: getToken, getUsername: getUsername, tryResume: tryResume, login: login, logout: logout };
})();
