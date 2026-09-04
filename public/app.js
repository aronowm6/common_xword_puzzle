(function () {
  'use strict';

  var CHECK_DEBOUNCE_MS = 120;

  var state = {
    username: null,
    isGuest: false,
    words: [],                 // [{num, length, count}] ordered 1..N
    solvedAnswers: new Map(),  // num -> answer text
    lastChecked: '',            // avoid re-checking the same string twice in a row
  };

  var el = {};
  var debounceTimer = null;
  var authUI = null;

  function cacheEls() {
    el.app = document.getElementById('app');
    el.whoami = document.getElementById('whoami');
    el.whoamiName = document.getElementById('whoamiName');
    el.switchUserBtn = document.getElementById('switchUserBtn');
    el.guestBanner = document.getElementById('guestBanner');
    el.guestLoginBtn = document.getElementById('guestLoginBtn');

    el.subtitle = document.getElementById('subtitle');
    el.gridTitle = document.getElementById('gridTitle');
    el.solvedCount = document.getElementById('solvedCount');
    el.totalCount = document.getElementById('totalCount');
    el.progressFill = document.getElementById('progressFill');

    el.entryInput = document.getElementById('entryInput');
    el.clearBtn = document.getElementById('clearBtn');
    el.feedback = document.getElementById('feedback');

    el.numberGrid = document.getElementById('numberGrid');
  }

  function bindEvents() {
    el.switchUserBtn.addEventListener('click', function () {
      logout();
    });

    el.guestLoginBtn.addEventListener('click', function () {
      authUI.show();
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

  // Keeps --header-height in sync with the actual rendered topbar height,
  // so the sticky entry panel sits flush below it instead of overlapping
  // or leaving a gap -- needed since the topbar's height isn't fixed (it
  // wraps to multiple lines on narrow screens, grows when "Playing as..."
  // appears, etc).
  function syncHeaderHeight() {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;
    document.documentElement.style.setProperty('--header-height', topbar.offsetHeight + 'px');
  }

  async function init() {
    cacheEls();
    bindEvents();

    syncHeaderHeight();
    window.addEventListener('resize', syncHeaderHeight);

    authUI = CXPAuthUI.init({
      onLoggedIn: function (username, solved, claimedLegacy) {
        applySession(username, solved);
        if (claimedLegacy) {
          el.feedback.className = 'feedback';
          el.feedback.textContent = 'This username didn’t have a password yet — it’s now set to what you just entered.';
        }
      },
      onGuest: applyGuestSession,
    });

    var wordsRes = await fetch('/api/words');
    var wordsData = await wordsRes.json();
    state.words = wordsData.words;
    el.totalCount.textContent = state.words.length;
    el.subtitle.textContent = 'Top ' + state.words.length + ' NYT crossword entries — Modern Era';
    el.gridTitle.textContent = 'All ' + state.words.length + ' entries';

    buildGrid();

    var resumed = await CXPAuth.tryResume();
    if (resumed) {
      applySession(resumed.username, resumed.solved);
    } else {
      authUI.show();
    }
  }

  function applyGuestSession() {
    state.username = null;
    state.isGuest = true;
    state.solvedAnswers = new Map(); // ephemeral -- nothing to load, nothing persists

    el.app.classList.remove('hidden');
    el.whoami.classList.add('hidden');
    el.guestBanner.classList.remove('hidden');
    syncHeaderHeight();

    renderAllCells();
    updateStats();
    el.entryInput.value = '';
    el.entryInput.focus();
  }

  function applySession(username, solved) {
    state.isGuest = false;
    state.username = username;
    state.solvedAnswers = new Map();
    (solved || []).forEach(function (entry) {
      state.solvedAnswers.set(entry.num, entry.answer);
    });

    el.whoamiName.textContent = state.username;
    el.whoami.classList.remove('hidden');
    el.guestBanner.classList.add('hidden');
    el.app.classList.remove('hidden');
    if (authUI) authUI.hide(); // no-op if already hidden -- needed for the silent-resume path, which bypasses the form-submit flow that normally hides it
    syncHeaderHeight();

    renderAllCells();
    updateStats();
    el.entryInput.value = '';
    el.entryInput.focus();
  }

  function logout() {
    CXPAuth.logout();
    window.location.reload();
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
      cell.title = 'Used in ' + w.count + ' NYT puzzles';

      var topRow = document.createElement('div');
      topRow.className = 'cell-top-row';

      var num = document.createElement('span');
      num.className = 'cell-num';
      num.textContent = w.num;

      var count = document.createElement('span');
      count.className = 'cell-count';
      count.textContent = '×' + w.count;

      topRow.appendChild(num);
      topRow.appendChild(count);

      var word = document.createElement('span');
      word.className = 'cell-word';
      word.textContent = blanksFor(w.length);

      cell.appendChild(topRow);
      cell.appendChild(word);
      frag.appendChild(cell);
    });
    el.numberGrid.appendChild(frag);
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
    var token = CXPAuth.getToken();
    if (!token && !state.isGuest) return;
    if (guess !== el.entryInput.value.toUpperCase().replace(/[^A-Z]/g, '')) return; // stale
    if (guess === state.lastChecked) return;
    state.lastChecked = guess;

    try {
      var res = await fetch('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, guess: guess }),
      });
      var data = await res.json();
      if (!res.ok) {
        el.feedback.className = 'feedback error';
        el.feedback.textContent = data.error || 'Something went wrong.';
        if (res.status === 401) {
          CXPAuth.logout();
          setTimeout(function () { window.location.reload(); }, 1200);
        }
        return;
      }
      if (data.correct && data.alreadySolved) {
        // Silent no-op: this guess is a word you already have. Don't touch
        // the input -- it may just be a prefix of a longer word you're
        // still typing toward (e.g. "ARE" on the way to "AREA").
        return;
      }
      if (data.correct) {
        var word = state.words.find(function (w) { return w.num === data.num; });
        state.solvedAnswers.set(data.num, data.answer);
        markCellSolved(data.num, data.answer);
        updateStats();
        el.feedback.className = 'feedback correct';
        el.feedback.textContent = 'Got it — #' + data.num + ' ' + data.answer +
          (word ? ' (used ' + word.count + '×) ' : ' ') + '✓';
        el.entryInput.value = '';
        state.lastChecked = '';

        if (state.solvedAnswers.size === state.words.length) {
          el.feedback.textContent = 'All ' + state.words.length + ' solved! ☆';
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
