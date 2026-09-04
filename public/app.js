(function () {
  'use strict';

  var STORAGE_KEY = 'cxp_username';

  var state = {
    username: null,
    words: [],             // [{num, length}] ordered 1..500
    numToIndex: new Map(), // num -> index in words[]
    solvedAnswers: new Map(), // num -> answer text (only known once solved)
    currentIndex: 0,
    lastChecked: new Map(), // num -> last guess string checked (avoid dup calls)
    gridCells: new Map(),   // num -> DOM element
  };

  var el = {};

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

    el.clueNum = document.getElementById('clueNum');
    el.tiles = document.getElementById('tiles');
    el.guessInput = document.getElementById('guessInput');
    el.feedback = document.getElementById('feedback');

    el.prevBtn = document.getElementById('prevBtn');
    el.nextBtn = document.getElementById('nextBtn');
    el.randomBtn = document.getElementById('randomBtn');

    el.numberGrid = document.getElementById('numberGrid');
    el.jumpForm = document.getElementById('jumpForm');
    el.jumpInput = document.getElementById('jumpInput');
  }

  function bindEvents() {
    el.usernameForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = el.usernameInput.value;
      loginUser(name);
    });

    el.switchUserBtn.addEventListener('click', function () {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    });

    el.guessInput.addEventListener('input', handleGuessInput);

    el.prevBtn.addEventListener('click', function () { step(-1); });
    el.nextBtn.addEventListener('click', function () { step(1); });
    el.randomBtn.addEventListener('click', goToRandomUnsolved);

    el.jumpForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = parseInt(el.jumpInput.value, 10);
      if (n && state.numToIndex.has(n)) {
        state.currentIndex = state.numToIndex.get(n);
        renderClue();
      }
      el.jumpInput.value = '';
    });

    // Let the player just start typing anywhere on the page -- no need to
    // click into the guess box first, and no need to press Enter either.
    document.addEventListener('keydown', function (e) {
      if (!el.app || el.app.classList.contains('hidden')) return;
      if (document.activeElement === el.guessInput) return;
      if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement !== el.guessInput) return;
      if (el.guessInput.disabled) return;

      if (/^[a-zA-Z]$/.test(e.key)) {
        el.guessInput.focus();
        el.guessInput.value = (el.guessInput.value + e.key).toUpperCase();
        handleGuessInput();
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        el.guessInput.focus();
        el.guessInput.value = el.guessInput.value.slice(0, -1);
        handleGuessInput();
        e.preventDefault();
      }
    });
  }

  async function init() {
    cacheEls();
    bindEvents();

    var wordsRes = await fetch('/api/words');
    var wordsData = await wordsRes.json();
    state.words = wordsData.words;
    state.words.forEach(function (w, i) { state.numToIndex.set(w.num, i); });
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

      state.currentIndex = findFirstUnsolvedIndex();
      markAllGridCells();
      updateStats();
      renderClue();
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

  function getCurrentWord() {
    return state.words[state.currentIndex];
  }

  function findFirstUnsolvedIndex() {
    for (var i = 0; i < state.words.length; i++) {
      if (!state.solvedAnswers.has(state.words[i].num)) return i;
    }
    return 0;
  }

  function buildGrid() {
    var frag = document.createDocumentFragment();
    state.words.forEach(function (w, i) {
      var cell = document.createElement('div');
      cell.className = 'num-cell';
      cell.textContent = w.num;
      cell.title = w.length + ' letters';
      cell.addEventListener('click', function () {
        state.currentIndex = i;
        renderClue();
      });
      state.gridCells.set(w.num, cell);
      frag.appendChild(cell);
    });
    el.numberGrid.appendChild(frag);
  }

  function markAllGridCells() {
    state.gridCells.forEach(function (cell, num) {
      cell.classList.toggle('solved', state.solvedAnswers.has(num));
    });
    markCurrentGridCell();
  }

  function markCurrentGridCell() {
    state.gridCells.forEach(function (cell) { cell.classList.remove('current'); });
    var word = getCurrentWord();
    if (word) {
      var cell = state.gridCells.get(word.num);
      if (cell) cell.classList.add('current');
    }
  }

  function renderClue() {
    var word = getCurrentWord();
    if (!word) return;
    el.clueNum.textContent = word.num;
    el.feedback.className = 'feedback';

    var solvedAnswer = state.solvedAnswers.get(word.num);
    el.guessInput.value = solvedAnswer || '';
    el.guessInput.disabled = !!solvedAnswer;
    el.feedback.textContent = solvedAnswer
      ? 'Solved ✓'
      : 'Just start typing — no need to press Enter.';
    if (solvedAnswer) el.feedback.classList.add('correct');

    renderTiles(word.length, solvedAnswer || '', !!solvedAnswer);
    markCurrentGridCell();

    if (!solvedAnswer) {
      el.guessInput.focus();
    }
  }

  function renderTiles(length, value, solved) {
    el.tiles.innerHTML = '';
    el.tiles.classList.toggle('solved', !!solved);
    for (var i = 0; i < length; i++) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.textContent = value[i] || '';
      el.tiles.appendChild(tile);
    }
  }

  function shakeTiles() {
    el.tiles.classList.remove('shake');
    // force reflow so the animation can restart
    void el.tiles.offsetWidth;
    el.tiles.classList.add('shake');
  }

  function handleGuessInput() {
    var word = getCurrentWord();
    if (!word) return;
    var v = el.guessInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (v.length > word.length) v = v.slice(0, word.length);
    el.guessInput.value = v;
    renderTiles(word.length, v, false);

    if (v.length === word.length && v.length > 0) {
      if (state.lastChecked.get(word.num) !== v) {
        checkGuess(word, v);
      }
    } else {
      el.feedback.className = 'feedback';
      el.feedback.textContent = 'Just start typing — no need to press Enter.';
    }
  }

  async function checkGuess(word, guess) {
    state.lastChecked.set(word.num, guess);
    el.feedback.className = 'feedback';
    el.feedback.textContent = 'Checking…';
    try {
      var res = await fetch('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: state.username, num: word.num, guess: guess }),
      });
      var data = await res.json();
      if (!res.ok) {
        el.feedback.className = 'feedback error';
        el.feedback.textContent = data.error || 'Something went wrong.';
        return;
      }
      if (data.correct) {
        state.solvedAnswers.set(word.num, data.answer || guess);
        el.feedback.className = 'feedback correct';
        el.feedback.textContent = data.alreadySolved ? 'Already solved!' : 'Correct! ✓';
        el.tiles.classList.add('solved');
        el.guessInput.disabled = true;
        markAllGridCells();
        updateStats();
        setTimeout(function () {
          if (getCurrentWord() && getCurrentWord().num === word.num) {
            goToRandomUnsolved(true);
          }
        }, 500);
      } else {
        el.feedback.className = 'feedback wrong';
        el.feedback.textContent = 'Not quite — keep trying.';
        shakeTiles();
      }
    } catch (err) {
      el.feedback.className = 'feedback error';
      el.feedback.textContent = 'Network error — try again.';
    }
  }

  function updateStats() {
    el.solvedCount.textContent = state.solvedAnswers.size;
    var pct = (state.solvedAnswers.size / state.words.length) * 100;
    el.progressFill.style.width = pct + '%';
  }

  function step(delta) {
    var n = state.words.length;
    state.currentIndex = (state.currentIndex + delta + n) % n;
    renderClue();
  }

  function goToRandomUnsolved(preferSequential) {
    var unsolved = [];
    for (var i = 0; i < state.words.length; i++) {
      if (!state.solvedAnswers.has(state.words[i].num)) unsolved.push(i);
    }
    if (unsolved.length === 0) {
      el.feedback.className = 'feedback correct';
      el.feedback.textContent = 'All 500 solved! ☆';
      return;
    }
    if (preferSequential) {
      var next = unsolved.find(function (i) { return i > state.currentIndex; });
      state.currentIndex = next !== undefined ? next : unsolved[0];
    } else {
      state.currentIndex = unsolved[Math.floor(Math.random() * unsolved.length)];
    }
    renderClue();
  }

  init();
})();
