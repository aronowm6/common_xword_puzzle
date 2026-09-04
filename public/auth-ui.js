// Shared login/signup/guest overlay controller, used by every page that
// needs a player identity (index, ordering game, ...). Standardizes the
// pattern so it isn't reimplemented differently per page: a tabbed
// Log In / Sign Up form, clear error messages, and a "play as guest"
// escape hatch that warns progress won't be saved.
window.CXPAuthUI = (function () {
  'use strict';

  // options: { onLoggedIn(username, solved, claimedLegacy), onGuest() }
  function init(options) {
    var el = {
      overlay: document.getElementById('usernameOverlay'),
      loginTabBtn: document.getElementById('loginTabBtn'),
      signupTabBtn: document.getElementById('signupTabBtn'),
      loginForm: document.getElementById('loginForm'),
      signupForm: document.getElementById('signupForm'),
      loginUsernameInput: document.getElementById('loginUsernameInput'),
      loginPasswordInput: document.getElementById('loginPasswordInput'),
      signupUsernameInput: document.getElementById('signupUsernameInput'),
      signupPasswordInput: document.getElementById('signupPasswordInput'),
      authError: document.getElementById('authError'),
      guestBtn: document.getElementById('guestBtn'),
    };

    function showError(msg) {
      el.authError.textContent = msg;
      el.authError.classList.remove('hidden');
    }
    function clearError() {
      el.authError.classList.add('hidden');
    }

    function showTab(tab) {
      clearError();
      var isLogin = tab === 'login';
      el.loginForm.classList.toggle('hidden', !isLogin);
      el.signupForm.classList.toggle('hidden', isLogin);
      el.loginTabBtn.classList.toggle('active', isLogin);
      el.signupTabBtn.classList.toggle('active', !isLogin);
      (isLogin ? el.loginUsernameInput : el.signupUsernameInput).focus();
    }

    el.loginTabBtn.addEventListener('click', function () { showTab('login'); });
    el.signupTabBtn.addEventListener('click', function () { showTab('signup'); });

    el.loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearError();
      var name = el.loginUsernameInput.value.trim();
      var password = el.loginPasswordInput.value;
      if (!name) { showError('Enter your username.'); return; }
      if (!password) { showError('Enter your password.'); return; }

      var result = await CXPAuth.login(name, password);
      if (!result.ok) { showError(result.error); return; }
      el.loginPasswordInput.value = '';
      hide();
      options.onLoggedIn(result.username, result.solved, result.claimedLegacy);
    });

    el.signupForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearError();
      var name = el.signupUsernameInput.value.trim();
      var password = el.signupPasswordInput.value;
      if (!name) { showError('Choose a username.'); return; }
      if (password.length < 4) { showError('Password must be at least 4 characters.'); return; }

      var result = await CXPAuth.signup(name, password);
      if (!result.ok) { showError(result.error); return; }
      el.signupPasswordInput.value = '';
      hide();
      options.onLoggedIn(result.username, result.solved, false);
    });

    el.guestBtn.addEventListener('click', function () {
      hide();
      options.onGuest();
    });

    function show() {
      clearError();
      el.overlay.classList.remove('hidden');
      showTab('login');
    }
    function hide() {
      el.overlay.classList.add('hidden');
    }

    return { show: show, hide: hide };
  }

  return { init: init };
})();
