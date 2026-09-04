(function () {
  'use strict';

  var el = {
    status: document.getElementById('boardStatus'),
    table: document.getElementById('boardTable'),
    body: document.getElementById('boardBody'),
    refreshBtn: document.getElementById('refreshBtn'),
    fbStatus: document.getElementById('fbBoardStatus'),
    fbBoards: document.getElementById('fbPuzzleBoards'),
  };

  el.refreshBtn.addEventListener('click', function () {
    load();
    loadFlashback();
  });

  async function load() {
    el.status.textContent = 'Loading…';
    el.status.classList.remove('hidden');
    el.table.classList.add('hidden');

    try {
      var res = await fetch('/api/leaderboard');
      var data = await res.json();
      if (!res.ok) {
        el.status.textContent = data.error || 'Could not load leaderboard.';
        return;
      }
      render(data.leaderboard || []);
    } catch (err) {
      el.status.textContent = 'Network error — try refresh.';
    }
  }

  async function loadFlashback() {
    el.fbStatus.textContent = 'Loading…';
    el.fbStatus.classList.remove('hidden');
    el.fbBoards.innerHTML = '';

    try {
      var res = await fetch('/api/flashback-leaderboard');
      var data = await res.json();
      if (!res.ok) {
        el.fbStatus.textContent = data.error || 'Could not load leaderboard.';
        return;
      }
      renderFlashback(data.puzzles || []);
    } catch (err) {
      el.fbStatus.textContent = 'Network error — try refresh.';
    }
  }

  function render(rows) {
    el.body.innerHTML = '';

    if (rows.length === 0) {
      el.status.textContent = 'No players yet — be the first to solve an entry!';
      return;
    }

    rows.forEach(function (row, i) {
      var tr = document.createElement('tr');

      var tdRank = document.createElement('td');
      tdRank.textContent = String(i + 1);

      var tdName = document.createElement('td');
      tdName.textContent = row.username;

      var tdCount = document.createElement('td');
      tdCount.textContent = row.count + ' / 501';

      // Deliberately shows which entry NUMBERS a player has solved, never
      // the answer text itself -- otherwise anyone could read other
      // players' solved words straight off the leaderboard instead of
      // solving them.
      var tdWords = document.createElement('td');
      if (row.nums && row.nums.length > 0) {
        var toggle = document.createElement('button');
        toggle.className = 'link-btn words-toggle';
        toggle.textContent = 'Show ' + row.nums.length + ' entr' + (row.nums.length === 1 ? 'y' : 'ies');
        var list = document.createElement('div');
        list.className = 'word-chip-list hidden';
        row.nums.forEach(function (num) {
          var chip = document.createElement('span');
          chip.className = 'word-chip';
          chip.textContent = '#' + num;
          list.appendChild(chip);
        });
        toggle.addEventListener('click', function () {
          var showing = !list.classList.contains('hidden');
          list.classList.toggle('hidden', showing);
          toggle.textContent = showing
            ? 'Show ' + row.nums.length + ' entr' + (row.nums.length === 1 ? 'y' : 'ies')
            : 'Hide';
        });
        tdWords.appendChild(toggle);
        tdWords.appendChild(list);
      } else {
        tdWords.textContent = '—';
      }

      tr.appendChild(tdRank);
      tr.appendChild(tdName);
      tr.appendChild(tdCount);
      tr.appendChild(tdWords);
      el.body.appendChild(tr);
    });

    el.status.classList.add('hidden');
    el.table.classList.remove('hidden');
  }

  // One simple table per puzzle: Player, Mistakes. No aggregate columns,
  // no expandable breakdown -- just each puzzle's own board.
  function renderFlashback(puzzles) {
    el.fbBoards.innerHTML = '';

    if (puzzles.length === 0) {
      el.fbStatus.textContent = 'No puzzles yet.';
      return;
    }

    puzzles.forEach(function (p, i) {
      var section = document.createElement('div');
      section.className = 'fb-puzzle-board';

      var heading = document.createElement('h3');
      heading.textContent = 'Puzzle ' + (i + 1);
      section.appendChild(heading);

      if (p.entries.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'muted fb-puzzle-board-empty';
        empty.textContent = 'No attempts yet.';
        section.appendChild(empty);
      } else {
        var table = document.createElement('table');
        table.className = 'board-table';

        var thead = document.createElement('thead');
        var headRow = document.createElement('tr');
        ['#', 'Player', 'Mistakes'].forEach(function (label, idx) {
          var th = document.createElement('th');
          th.className = idx === 0 ? 'col-rank' : (idx === 2 ? 'col-count' : 'col-name');
          th.textContent = label;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        p.entries.forEach(function (entry, j) {
          var tr = document.createElement('tr');

          var tdRank = document.createElement('td');
          tdRank.textContent = String(j + 1);

          var tdName = document.createElement('td');
          tdName.textContent = entry.username;

          var tdMistakes = document.createElement('td');
          tdMistakes.textContent = String(entry.mistakes);

          tr.appendChild(tdRank);
          tr.appendChild(tdName);
          tr.appendChild(tdMistakes);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        section.appendChild(table);
      }

      el.fbBoards.appendChild(section);
    });

    el.fbStatus.classList.add('hidden');
  }

  load();
  loadFlashback();
})();
