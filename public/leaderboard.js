(function () {
  'use strict';

  var el = {
    status: document.getElementById('boardStatus'),
    table: document.getElementById('boardTable'),
    body: document.getElementById('boardBody'),
    refreshBtn: document.getElementById('refreshBtn'),
  };

  el.refreshBtn.addEventListener('click', load);

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

  load();
})();
