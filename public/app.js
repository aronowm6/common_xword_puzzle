(function () {
  'use strict';

  var STORAGE_KEY = 'cxp_username';
  var CHECK_DEBOUNCE_MS = 120;

  var state = {
    username: null,
    words: [],                // [{num, length}] ordered 1..500
    solvedAnswers: new Map(), // num -> answer text
    lastChecked: '',           // avoid re-checking the same string twice in a row
  };

  var el = {};
  var debounceTimer = null;

  function cacheEls() {
    el.app = document.getElementById('app');
    el.overlay = document.getElementById('usernameOverlay');
    el.usernameForm = document.getElementById('usernameForm');
    el.usernameInput = document.getElementById('usernameInput');
    el.usernameError = document.getElementById('usernameError');
    el.whoami = document.getElementById('whoami');
    el.whoamiName = document.getElementById('whoamiName');
    el.switchUserBtn = document.getElementById('switchUserBtn');

    el.solvedCount = document.getElementById('solvedCount');
    el.totalCount = document.getElementById('totalCount');
    el.progressFill = document.getElementById('progressFill');

    el.entryInput = document.getElementById('entryInput');
    el.clearBtn = document.getElementById('clearBtn');
    el.feedback = document.getElementById('feedback');

    el.numberGrid = document.getElementById('numberGrid');
  }

  function bindEvents() {
    el.usernameForm.addEventListener('submit', function (e) {
      e.preventDefault();
      loginUser(el.usernameInput.value);
    });

    el.switchUserBtn.addEventListener('click', function () {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    });

    el.entryInput.addEventListener('input', handleEntryInput);
    el.entryInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') clearEntry();
    });
    el.clearBtn.addEventListener('click', clearEntry);

    // Let the player just start typing anywhere on the page -- no need to
    // click into the entry bar first, and no need to press Enter either.
    document.addEventListener('keydown', function (e) {
      if (!el.app || el.app.classList.contains('hidden')) return;
      if (document.activeElement === el.entryInput) return;
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

      if (/^[a-zA-Z]$/.test(e.key)) {
        el.entryInput.focus();
        el.entryInput.value += e.key.toUpperCase();
        handleEntryInput();
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        el.entryInput.focus();
        el.entryInput.value = el.entryInput.value.slice(0, -1);
        handleEntryInput();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        clearEntry();
      }
    });
  }

  async function init() {
    cacheEls();
    bindEvents();

    var wordsRes = await fetch('/api/words');
    var wordsData = await wordsRes.json();
    state.words = wordsData.words;
    el.totalCount.textContent = state.words.length;

    buildGrid();

    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      var ok = await loginUser(saved, true);
      if (!ok) showOverlay();
    } else {
      showOverlay();
    }
  }

  function showOverlay() {
    el.overlay.classList.remove('hidden');
    el.app.classList.add('hidden');
    el.usernameInput.focus();
  }

  function hideOverlay() {
    el.overlay.classList.add('hidden');
    el.app.classList.remove('hidden');
  }

  async function loginUser(rawName, silent) {
    var name = (rawName || '').trim();
    if (!name) {
      if (!silent) showUsernameError('Enter a username to play.');
      return false;
    }
    try {
      var res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      });
      var data = await res.json();
      if (!res.ok) {
        if (!silent) showUsernameError(data.error || 'Something went wrong.');
        return false;
      }

      state.username = data.username;
      state.solvedAnswers = new Map();
      (data.solved || []).forEach(function (entry) {
        state.solvedAnswers.set(entry.num, entry.answer);
      });
      localStorage.setItem(STORAGE_KEY, state.username);

      el.whoamiName.textContent = state.username;
      el.whoami.classList.remove('hidden');
      hideOverlay();

      renderAllCells();
      updateStats();
      el.entryInput.value = '';
      el.entryInput.focus();
      return true;
    } catch (err) {
      if (!silent) showUsernameError('Network error -- try again.');
      return false;
    }
  }

  function showUsernameError(msg) {
    el.usernameError.textContent = msg;
    el.usernameError.classList.remove('hidden');
  }

  function blanksFor(length) {
    return new Array(length).fill('_').join(' ');
  }

  function spacedWord(word) {
    return word.split('').join(' ');
  }

  function buildGrid() {
    var frag = document.createDocumentFragment();
    state.words.forEach(function (w) {
      var cell = document.createElement('div');
      cell.className = 'num-cell';
      cell.dataset.num = w.num;

      var num = document.createElement('span');
      num.className = 'cell-num';
      num.textContent = w.num;

      var word = document.createElement('span');
      word.className = 'cell-word';
      word.textContent = blanksFor(w.length);

      cell.appendChild(num);
      cell.appendChild(word);
      el.numberGrid.appendChild(cell);
    });
  }

  function renderAllCells() {
    var cells = el.numberGrid.children;
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var num = Number(cell.dataset.num);
      var word = state.words[i];
      var answer = state.solvedAnswers.get(num);
      var wordEl = cell.querySelector('.cell-word');
      if (answer) {
        cell.classList.add('solved');
        wordEl.textContent = spacedWord(answer);
      } else {
        cell.classList.remove('solved');
        wordEl.textContent = blanksFor(word.length);
      }
    }
  }

  function markCellSolved(num, answer) {
    var cell = el.numberGrid.querySelector('.num-cell[data-num="' + num + '"]');
    if (!cell) return;
    cell.classList.add('solved');
    cell.classList.add('flash');
    cell.querySelector('.cell-word').textContent = spacedWord(answer);
    setTimeout(function () { cell.classList.remove('flash'); }, 500);
  }

  function updateStats() {
    el.solvedCount.textContent = state.solvedAnswers.size;
    var pct = (state.solvedAnswers.size / state.words.length) * 100;
    el.progressFill.style.width = pct + '%';
  }

  function clearEntry() {
    el.entryInput.value = '';
    state.lastChecked = '';
    el.feedback.className = 'feedback';
    el.feedback.textContent = 'Guesses are checked live as you type.';
    el.entryInput.focus();
  }

  function handleEntryInput() {
    var v = el.entryInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (v !== el.entryInput.value) el.entryInput.value = v;

    clearTimeout(debounceTimer);
    if (!v) return;
    debounceTimer = setTimeout(function () { attemptMatch(v); }, CHECK_DEBOUNCE_MS);
  }

  async function attemptMatch(guess) {
    if (!state.username) return;
    if (guess !== el.entryInput.value.toUpperCase().replace(/[^A-Z]/g, '')) return; // stale
    if (guess === state.lastChecked) return;
    state.lastChecked = guess;

    try {
      var res = await fetch('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: state.username, guess: guess }),
      });
      var data = await res.json();
      if (!res.ok) {
        el.feedback.className = 'feedback error';
        el.feedback.textContent = data.error || 'Something went wrong.';
        return;
      }
      if (data.correct && data.alreadySolved) {
        // Silent no-op: this guess is a word you already have. Don't touch
        // the input -- it may just be a prefix of a longer word you're
        // still typing toward (e.g. "ARE" on the way to "AREA").
        return;
      }
      if (data.correct) {
        state.solvedAnswers.set(data.num, data.answer);
        markCellSolved(data.num, data.answer);
        updateStats();
        el.feedback.className = 'feedback correct';
        el.feedback.textContent = 'Got it — #' + data.num + ' ' + data.answer + ' ✓';
        el.entryInput.value = '';
        state.lastChecked = '';

        if (state.solvedAnswers.size === state.words.length) {
          el.feedback.textContent = 'All 500 solved! ☆';
        }
      }
      // No match: stay silent, keep accumulating -- matches Sporcle-style entry.
    } catch (err) {
      el.feedback.className = 'feedback error';
      el.feedback.textContent = 'Network error — try again.';
    }
  }

  init();
})();
