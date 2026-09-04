(function () {
  'use strict';

  var el = {};

  var state = {
    puzzles: [],           // [{id, theme, wordCount}]
    puzzleId: null,
    theme: null,
    revealQueue: [],        // words not yet revealed, in reveal order
    placed: [],              // words placed so far, correct order
    currentWord: null,        // word awaiting placement
    eliminated: null,          // Set of wrong slot indexes for currentWord
    mistakes: 0,
  };

  function cacheEls() {
    el.app = document.getElementById('app');
    el.overlay = document.getElementById('usernameOverlay');
    el.usernameForm = document.getElementById('usernameForm');
    el.usernameInput = document.getElementById('usernameInput');
    el.passwordInput = document.getElementById('passwordInput');
    el.usernameError = document.getElementById('usernameError');
    el.whoami = document.getElementById('whoami');
    el.whoamiName = document.getElementById('whoamiName');
    el.switchUserBtn = document.getElementById('switchUserBtn');

    el.pickerSection = document.getElementById('pickerSection');
    el.puzzleList = document.getElementById('puzzleList');

    el.gameSection = document.getElementById('gameSection');
    el.backToPickerBtn = document.getElementById('backToPickerBtn');
    el.gameTheme = document.getElementById('gameTheme');
    el.mistakeCount = document.getElementById('mistakeCount');
    el.placedList = document.getElementById('placedList');
    el.currentWordCard = document.getElementById('currentWordCard');
    el.currentWord = document.getElementById('currentWord');
    el.feedback = document.getElementById('feedback');

    el.resultSection = document.getElementById('resultSection');
    el.resultSummary = document.getElementById('resultSummary');
    el.playAgainBtn = document.getElementById('playAgainBtn');
    el.otherPuzzleBtn = document.getElementById('otherPuzzleBtn');
  }

  function bindEvents() {
    el.usernameForm.addEventListener('submit', function (e) {
      e.preventDefault();
      loginUser(el.usernameInput.value, el.passwordInput.value);
    });
    el.switchUserBtn.addEventListener('click', function () {
      CXPAuth.logout();
      window.location.reload();
    });
    el.backToPickerBtn.addEventListener('click', showPicker);
    el.playAgainBtn.addEventListener('click', function () { startPuzzle(state.puzzleId); });
    el.otherPuzzleBtn.addEventListener('click', showPicker);
  }

  async function init() {
    cacheEls();
    bindEvents();

    var resumed = await CXPAuth.tryResume();
    if (resumed) {
      onLoggedIn(resumed.username);
    } else {
      showOverlay();
    }
  }

  function showOverlay() {
    el.overlay.classList.remove('hidden');
    el.app.classList.add('hidden');
    el.usernameInput.focus();
  }

  async function onLoggedIn(username) {
    el.whoamiName.textContent = username;
    el.whoami.classList.remove('hidden');
    el.overlay.classList.add('hidden');
    el.app.classList.remove('hidden');
    await loadPuzzleList();
    showPicker();
  }

  async function loginUser(rawName, rawPassword) {
    var name = (rawName || '').trim();
    var password = rawPassword || '';
    if (!name) { showUsernameError('Enter a username to play.'); return; }
    if (password.length < 4) { showUsernameError('Password must be at least 4 characters.'); return; }

    var result = await CXPAuth.login(name, password);
    if (!result.ok) { showUsernameError(result.error); return; }
    el.passwordInput.value = '';
    onLoggedIn(result.username);
  }

  function showUsernameError(msg) {
    el.usernameError.textContent = msg;
    el.usernameError.classList.remove('hidden');
  }

  async function loadPuzzleList() {
    var res = await fetch('/api/flashback-list');
    var data = await res.json();
    state.puzzles = data.puzzles || [];
  }

  function showPicker() {
    el.pickerSection.classList.remove('hidden');
    el.gameSection.classList.add('hidden');
    el.resultSection.classList.add('hidden');

    el.puzzleList.innerHTML = '';
    state.puzzles.forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'fb-puzzle-card';

      var label = document.createElement('div');
      label.className = 'fb-puzzle-label';
      label.textContent = p.theme || ('Puzzle ' + (i + 1));

      var sub = document.createElement('div');
      sub.className = 'muted fb-puzzle-sub';
      sub.textContent = p.wordCount + ' words to order';

      var btn = document.createElement('button');
      btn.textContent = 'Play';
      btn.addEventListener('click', function () { startPuzzle(p.id); });

      card.appendChild(label);
      card.appendChild(sub);
      card.appendChild(btn);
      el.puzzleList.appendChild(card);
    });
  }

  async function startPuzzle(id) {
    var res = await fetch('/api/flashback-puzzle?id=' + encodeURIComponent(id));
    if (!res.ok) return;
    var data = await res.json();

    state.puzzleId = data.id;
    state.theme = data.theme;
    state.revealQueue = data.revealOrder.slice();
    state.placed = [];
    state.currentWord = null;
    state.eliminated = new Set();
    state.mistakes = 0;

    el.pickerSection.classList.add('hidden');
    el.resultSection.classList.add('hidden');
    el.gameSection.classList.remove('hidden');
    el.gameTheme.textContent = state.theme || '';
    el.mistakeCount.textContent = '0';
    el.feedback.className = 'feedback';
    el.feedback.textContent = '';

    revealNext();
  }

  function revealNext() {
    if (state.revealQueue.length === 0) {
      finishPuzzle();
      return;
    }
    var word = state.revealQueue.shift();

    if (state.placed.length === 0) {
      // First word has nowhere else it could go -- auto-place, no guess needed.
      state.placed.push(word);
      renderPlaced();
      revealNext();
      return;
    }

    state.currentWord = word;
    state.eliminated = new Set();
    el.currentWord.textContent = word;
    el.currentWordCard.classList.remove('hidden');
    el.feedback.className = 'feedback';
    el.feedback.textContent = 'Click a slot below.';
    renderPlaced();
  }

  function renderPlaced() {
    el.placedList.innerHTML = '';
    var n = state.placed.length;
    var showSlots = !!state.currentWord;

    for (var i = 0; i <= n; i++) {
      if (showSlots) {
        el.placedList.appendChild(makeSlot(i));
      }
      if (i < n) {
        var card = document.createElement('div');
        card.className = 'fb-word-card';
        card.textContent = state.placed[i];
        el.placedList.appendChild(card);
      }
    }
  }

  function makeSlot(index) {
    var slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'fb-slot';
    if (state.eliminated.has(index)) {
      slot.classList.add('eliminated');
      slot.disabled = true;
      slot.textContent = '✕';
    } else {
      slot.textContent = '+';
      slot.addEventListener('click', function () { attemptPlacement(index); });
    }
    return slot;
  }

  async function attemptPlacement(position) {
    var word = state.currentWord;
    if (!word) return;

    try {
      var res = await fetch('/api/flashback-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puzzleId: state.puzzleId,
          placed: state.placed,
          newWord: word,
          position: position,
        }),
      });
      var data = await res.json();
      if (!res.ok) {
        el.feedback.className = 'feedback error';
        el.feedback.textContent = data.error || 'Something went wrong.';
        return;
      }

      if (data.correct) {
        state.placed.splice(position, 0, word);
        state.currentWord = null;
        el.currentWordCard.classList.add('hidden');
        el.feedback.className = 'feedback correct';
        el.feedback.textContent = 'Correct! ✓';
        renderPlaced();
        setTimeout(revealNext, 450);
      } else {
        state.mistakes += 1;
        state.eliminated.add(position);
        el.mistakeCount.textContent = String(state.mistakes);
        el.feedback.className = 'feedback wrong';
        el.feedback.textContent = 'Not quite — try another slot.';
        renderPlaced();
      }
    } catch (err) {
      el.feedback.className = 'feedback error';
      el.feedback.textContent = 'Network error — try again.';
    }
  }

  async function finishPuzzle() {
    el.currentWordCard.classList.add('hidden');

    var token = CXPAuth.getToken();
    var best = null;
    try {
      var res = await fetch('/api/flashback-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, puzzleId: state.puzzleId, mistakes: state.mistakes }),
      });
      var data = await res.json();
      if (res.ok) best = data.best;
    } catch (err) {
      // Non-fatal -- still show the result locally even if saving failed.
    }

    el.gameSection.classList.add('hidden');
    el.resultSection.classList.remove('hidden');

    var msg = state.mistakes === 0
      ? 'Perfect! Zero mistakes.'
      : 'You solved it with ' + state.mistakes + (state.mistakes === 1 ? ' mistake.' : ' mistakes.');
    if (best !== null && best < state.mistakes) {
      msg += ' Your best on this puzzle is still ' + best + '.';
    } else if (best !== null && best === state.mistakes && state.mistakes > 0) {
      msg += ' That matches your best so far.';
    }
    el.resultSummary.textContent = msg;
  }

  init();
})();
