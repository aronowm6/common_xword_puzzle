(function () {
  'use strict';

  var state = {
    username: null,
    isGuest: false,
    words: [],                 // [{num, length, count}] ordered 1..N
    solvedAnswers: new Map(),  // num -> answer text
    // What kind of message is currently in the feedback line: 'neutral',
    // 'info' (already-found / out-of-range -- describes one specific typed
    // guess, not a lasting event), 'correct' (a new find -- sticks around
    // until the next real event), or 'error'.
    feedbackKind: 'neutral',
  };

  var el = {};
  var authUI = null;

  // Every distinct value typed gets checked, in order, one at a time --
  // not debounced. Debouncing was silently dropping intermediate states:
  // if you typed fast enough that e.g. "REN" only existed for a moment on
  // the way to "RENO", the debounce timer would get reset before it ever
  // fired for "REN", so that match was never checked at all. Queuing
  // every value (and awaiting each check before starting the next, so
  // slow/out-of-order network responses can't reorder results) fixes
  // that without needing to guess a "safe" debounce delay.
  var checkQueue = [];
  var queueRunning = false;
  var lastQueued = '';

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

    // Run independently of each other so a slow session check doesn't
    // delay the word list too, and vice versa -- keeps the window where
    // the (hidden-by-default) overlay might flash into view as short as
    // possible for the common case of resuming an existing session.
    var results = await Promise.all([
      fetch('/api/words').then(function (r) { return r.json(); }),
      CXPAuth.tryResume(),
    ]);
    var wordsData = results[0];
    var resumed = results[1];

    state.words = wordsData.words;
    el.totalCount.textContent = state.words.length;
    el.subtitle.textContent = 'Top ' + state.words.length + ' NYT crossword entries — Modern Era';
    el.gridTitle.textContent = 'All ' + state.words.length + ' entries';

    buildGrid();

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
    checkQueue.length = 0; // drop anything not yet started; an in-flight check still finishes
    lastQueued = '';
    el.feedback.className = 'feedback';
    el.feedback.textContent = 'Guesses are checked live as you type.';
    state.feedbackKind = 'neutral';
    el.entryInput.focus();
  }

  function handleEntryInput() {
    var v = el.entryInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (v !== el.entryInput.value) el.entryInput.value = v;

    if (!v || v === lastQueued) return;
    lastQueued = v;
    checkQueue.push(v);
    drainQueue();
  }

  // Processes the queue strictly one at a time -- awaiting each check
  // before starting the next -- so a slow response for an earlier value
  // can't land after (and clobber) a later one.
  async function drainQueue() {
    if (queueRunning) return;
    queueRunning = true;
    while (checkQueue.length > 0) {
      var guess = checkQueue.shift();
      await attemptMatch(guess);
    }
    queueRunning = false;
  }

  async function attemptMatch(guess) {
    var token = CXPAuth.getToken();
    if (!token && !state.isGuest) return;

    try {
      var res = await fetch('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, guess: guess }),
      });
      var data = await res.json();

      // Has the player already moved on to typing something else while
      // this check was in flight? If so, a genuine new find still counts
      // (below) but we leave their in-progress typing alone rather than
      // clearing it out from under them.
      var isCurrentValue = guess === el.entryInput.value.toUpperCase().replace(/[^A-Z]/g, '');

      if (!res.ok) {
        el.feedback.className = 'feedback error';
        el.feedback.textContent = data.error || 'Something went wrong.';
        state.feedbackKind = 'error';
        if (res.status === 401) {
          CXPAuth.logout();
          setTimeout(function () { window.location.reload(); }, 1200);
        }
        return;
      }
      if (data.correct && data.alreadySolved) {
        // Informational only -- describes this exact guess, not a lasting
        // state change. Only worth showing while the box still reads this
        // guess: if the player has since typed past it (e.g. WIN -> WINE)
        // it would be describing text that's no longer on screen. Doesn't
        // touch the input either way -- it may just be a prefix of a
        // longer word you're still typing toward.
        if (isCurrentValue) {
          var already = state.words.find(function (w) { return w.num === data.num; });
          el.feedback.className = 'feedback';
          el.feedback.textContent = 'Already found — #' + data.num + ' ' + data.answer +
            (already ? ' (used ' + already.count + '×)' : '') + '.';
          state.feedbackKind = 'info';
        }
        return;
      }
      if (data.outOfRange) {
        // Same reasoning: a real, known common answer, just not in the
        // top 501 -- worth saying, but only while still describing the
        // current box contents.
        if (isCurrentValue) {
          el.feedback.className = 'feedback';
          el.feedback.textContent = 'Nope, that’s #' + data.rank + ' — just outside the top ' + state.words.length + '.';
          state.feedbackKind = 'info';
        }
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
        // A real find -- earns its keep. Unlike 'info' messages this
        // sticks around through later keystrokes, not just until the box
        // changes; it only goes away on the next actual event (another
        // find, or Clear/Escape).
        state.feedbackKind = 'correct';

        if (isCurrentValue) {
          el.entryInput.value = '';
          lastQueued = '';
        }

        if (state.solvedAnswers.size === state.words.length) {
          el.feedback.textContent = 'All ' + state.words.length + ' solved! ☆';
        }
        return;
      }

      // No match. If we're still showing an 'info' message (already-found
      // / out-of-range) from an earlier, shorter guess -- e.g. WIN -- and
      // the player has since typed past it into something that's also not
      // a match (e.g. WINE), that message is now stale: it's describing
      // text no longer in the box. Clear it back to neutral. A 'correct'
      // message is left alone here -- it should persist until the next
      // real find, not just the next keystroke.
      if (isCurrentValue && state.feedbackKind === 'info') {
        el.feedback.className = 'feedback';
        el.feedback.textContent = 'Guesses are checked live as you type.';
        state.feedbackKind = 'neutral';
      }
    } catch (err) {
      el.feedback.className = 'feedback error';
      el.feedback.textContent = 'Network error — try again.';
      state.feedbackKind = 'error';
    }
  }

  init();
})();
