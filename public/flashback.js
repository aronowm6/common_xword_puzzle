(function () {
  'use strict';

  var el = {};

  var state = {
    puzzles: [],           // [{id, theme, wordCount}]
    puzzleId: null,
    theme: null,
    totalWords: 0,
    revealQueue: [],        // words not yet revealed, in reveal order
    placed: [],              // [{word, count}] placed so far, correct order
    currentWord: null,        // word awaiting a guess
    mistakes: 0,
    flashTimer: null,
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
    el.resultFlash = document.getElementById('resultFlash');
    el.resultFlashMain = document.getElementById('resultFlashMain');
    el.resultFlashSub = document.getElementById('resultFlashSub');
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
    // Clear any leftover cards from a previous attempt (and switch
    // sections) immediately, *before* the fetch below -- otherwise the old
    // puzzle's word list stays on screen during the loading gap and then
    // jump-replaces all at once when the new data arrives.
    el.placedList.innerHTML = '';
    el.currentWordCard.classList.add('hidden');
    el.pickerSection.classList.add('hidden');
    el.resultSection.classList.add('hidden');
    el.gameSection.classList.remove('hidden');
    el.gameTheme.textContent = '';
    el.mistakeCount.textContent = '0';
    el.feedback.className = 'feedback';
    el.feedback.textContent = 'Loading puzzle…';

    var res = await fetch('/api/flashback-puzzle?id=' + encodeURIComponent(id));
    if (!res.ok) return;
    var data = await res.json();

    state.puzzleId = data.id;
    state.theme = data.theme;
    state.totalWords = data.revealOrder.length;
    state.revealQueue = data.revealOrder.slice();
    state.placed = [];
    state.currentWord = null;
    state.mistakes = 0;

    var idx = state.puzzles.findIndex(function (p) { return p.id === id; });
    var puzzleLabel = idx >= 0 ? ('Puzzle ' + (idx + 1)) : '';
    el.gameTheme.textContent = state.theme || puzzleLabel;
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
      // First word has nowhere else it could go -- confirm via the API
      // (just to learn its count), no guess needed from the player.
      placeWord(word, 0, true);
      return;
    }

    state.currentWord = word;
    el.currentWord.textContent = word;
    el.currentWordCard.classList.remove('hidden');
    el.feedback.className = 'feedback';
    el.feedback.textContent = 'Click a slot below.';
    renderPlaced();
  }

  // Slots are always rendered (one more than the number of placed words),
  // just active/clickable only while a word is awaiting a guess. That way
  // the list only ever grows by exactly one slot per round instead of all
  // slots disappearing after a guess and reappearing for the next word --
  // which is what caused the layout to visibly collapse and re-expand.
  function renderPlaced() {
    el.placedList.innerHTML = '';
    var n = state.placed.length;
    var active = !!state.currentWord;

    for (var i = 0; i <= n; i++) {
      el.placedList.appendChild(makeSlot(i, active));
      if (i < n) {
        var item = state.placed[i];
        var card = document.createElement('div');
        card.className = 'fb-word-card';

        var wordSpan = document.createElement('span');
        wordSpan.textContent = item.word;
        var countSpan = document.createElement('span');
        countSpan.className = 'fb-word-count';
        countSpan.textContent = '(' + item.count + ')';

        card.appendChild(wordSpan);
        card.appendChild(countSpan);
        el.placedList.appendChild(card);
      }
    }
  }

  function makeSlot(index, active) {
    var slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'fb-slot';
    slot.textContent = '+';
    slot.disabled = !active;
    if (active) {
      slot.addEventListener('click', function () { placeWord(state.currentWord, index, false); });
    }
    return slot;
  }

  var FLASH_DURATION_MS = 1600;
  var REVEAL_DELAY_MS = 1800; // slightly longer than the flash so it fully fades first
  var WRONG_HOLD_MS = 1300;    // how long it sits red at the wrong spot before sliding
  var MIGRATE_MS = 500;         // slide animation duration
  var SETTLE_MS = 700;           // pause after it lands before revealing the next word

  // Flashes the just-placed card green/red (red stays solid -- see
  // migrateCard for when it clears), and flashes a bigger CORRECT/
  // INCORRECT banner (with a detail subheader) at the top of the game
  // area. `detail` carries what used to be a separate message at the
  // bottom of the page -- now shown as part of the same banner instead.
  function flashResult(placedIndex, correct, detail) {
    var cardEl = el.placedList.children[placedIndex * 2 + 1];
    if (cardEl) cardEl.classList.add(correct ? 'flash-correct' : 'wrong-hold');

    el.resultFlashMain.textContent = correct ? 'Correct' : 'Incorrect';
    el.resultFlashSub.textContent = detail || '';
    el.resultFlash.className = 'fb-result-flash show ' + (correct ? 'correct' : 'wrong');
    clearTimeout(state.flashTimer);
    state.flashTimer = setTimeout(function () {
      el.resultFlash.classList.remove('show');
    }, FLASH_DURATION_MS);
  }

  // Moves the card currently at `fromIndex` in state.placed to `toIndex`,
  // sliding it there visually (FLIP-style: measure before, update the DOM,
  // measure after, animate the delta) instead of just teleporting. Stays
  // red for the whole slide and only fades back to normal once it lands.
  function migrateCard(fromIndex, toIndex) {
    var cardEl = el.placedList.children[fromIndex * 2 + 1];
    var oldRect = cardEl ? cardEl.getBoundingClientRect() : null;

    var item = state.placed.splice(fromIndex, 1)[0];
    state.placed.splice(toIndex, 0, item);
    renderPlaced();

    var newCardEl = el.placedList.children[toIndex * 2 + 1];
    if (newCardEl && oldRect) {
      newCardEl.classList.add('wrong-hold'); // renderPlaced() built a fresh node -- stay red on it too
      var newRect = newCardEl.getBoundingClientRect();
      var delta = oldRect.top - newRect.top;
      newCardEl.style.transition = 'none';
      newCardEl.style.transform = 'translateY(' + delta + 'px)';
      // eslint-disable-next-line no-unused-expressions
      newCardEl.offsetHeight; // force reflow so the jump above applies before animating
      newCardEl.style.transition = 'transform ' + MIGRATE_MS + 'ms ease';
      newCardEl.style.transform = 'translateY(0)';

      setTimeout(function () {
        newCardEl.style.transition = 'background 250ms ease, border-color 250ms ease';
        newCardEl.classList.remove('wrong-hold');
      }, MIGRATE_MS);
    }
  }

  // One guess per word. A wrong guess flashes red at the spot the player
  // guessed, then slides to its real spot -- rather than silently
  // teleporting there, which made it easy to miss that you were wrong.
  async function placeWord(word, guessedPosition, isFirst) {
    if (!word) return;
    if (!isFirst) state.currentWord = null; // lock out further clicks immediately

    try {
      var res = await fetch('/api/flashback-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puzzleId: state.puzzleId,
          placed: state.placed.map(function (p) { return p.word; }),
          newWord: word,
          position: guessedPosition,
        }),
      });
      var data = await res.json();
      if (!res.ok) {
        el.feedback.className = 'feedback error';
        el.feedback.textContent = data.error || 'Something went wrong.';
        return;
      }

      if (isFirst || data.correct) {
        var finalPosition = data.correct ? guessedPosition : data.correctIndex;
        state.placed.splice(finalPosition, 0, { word: word, count: data.count });
        el.currentWordCard.classList.add('hidden');
        renderPlaced();

        if (isFirst) {
          // Auto-placed, no real guess involved -- nothing to flash, skip
          // straight to revealing the next word.
          revealNext();
          return;
        }

        flashResult(finalPosition, true, 'Used ' + data.count + ' times.');
        el.feedback.className = 'feedback';
        el.feedback.textContent = '';
        setTimeout(revealNext, REVEAL_DELAY_MS);
        return;
      }

      // Wrong: place it at the spot the player actually guessed first, so
      // the red flash happens where they clicked, not somewhere else.
      state.placed.splice(guessedPosition, 0, { word: word, count: data.count });
      el.currentWordCard.classList.add('hidden');
      renderPlaced();
      flashResult(guessedPosition, false, word + ' actually goes here — used ' + data.count + ' times.');

      state.mistakes += 1;
      el.mistakeCount.textContent = String(state.mistakes);
      el.feedback.className = 'feedback';
      el.feedback.textContent = '';

      setTimeout(function () {
        migrateCard(guessedPosition, data.correctIndex);
        setTimeout(revealNext, MIGRATE_MS + SETTLE_MS);
      }, WRONG_HOLD_MS);
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

    var maxMistakes = Math.max(state.totalWords - 1, 0);
    var msg = state.mistakes === 0
      ? 'Perfect! Zero mistakes.'
      : 'You solved it with ' + state.mistakes + ' out of ' + maxMistakes + ' possible mistakes.';
    if (best !== null && best < state.mistakes) {
      msg += ' Your best on this puzzle is still ' + best + '.';
    } else if (best !== null && best === state.mistakes && state.mistakes > 0) {
      msg += ' That matches your best so far.';
    }
    el.resultSummary.textContent = msg;
  }

  init();
})();
