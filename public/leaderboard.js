(function () {
  'use strict';

  var el = {
    status: document.getElementById('boardStatus'),
    table: document.getElementById('boardTable'),
    body: document.getElementById('boardBody'),
    refreshBtn: document.getElementById('refreshBtn'),
    fbStatus: document.getElementById('fbBoardStatus'),
    fbBoards: document.getElementById('fbPuzzleBoards'),
    chartStatus: document.getElementById('chartStatus'),
    chartSection: document.getElementById('chartSection'),
    chartEmpty: document.getElementById('chartEmpty'),
    chartLegend: document.getElementById('chartLegend'),
    chartSvg: document.getElementById('chartSvg'),
    chartWrap: document.getElementById('chartWrap'),
    chartTooltip: document.getElementById('chartTooltip'),
    chartTop10Btn: document.getElementById('chartTop10Btn'),
    chartAllBtn: document.getElementById('chartAllBtn'),
    chartNoneBtn: document.getElementById('chartNoneBtn'),
    chartSearchInput: document.getElementById('chartSearchInput'),
    chartSearchResults: document.getElementById('chartSearchResults'),
    chartModeCalendarBtn: document.getElementById('chartModeCalendarBtn'),
    chartModeElapsedBtn: document.getElementById('chartModeElapsedBtn'),
    chartModeNote: document.getElementById('chartModeNote'),
  };

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var DEFAULT_TOP_N = 10;
  var DIRECT_LABEL_MAX = 4; // only label lines directly when few enough not to collide
  // Categorical palette: fixed order, assigned to players by account-creation
  // order (not by rank) so a color never gets reassigned as standings change.
  // Past 8 simultaneous players the color repeats with a dashed stroke so
  // pairs stay distinguishable via a second channel, not hue alone.
  var CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

  // Chart state, rebuilt each time the leaderboard reloads.
  var chart = {
    rows: [],           // players with count > 0, server order (most-solved first)
    colorOf: {},        // username -> { stroke, dashed }
    selected: {},       // username -> bool (which lines are drawn)
    hoverX: null,        // current crosshair position (chart-space ms, meaning depends on mode), or null
    mode: 'calendar',    // 'calendar' | 'elapsed' (elapsed = hours since each player's own first solve)
    searchActive: -1,    // index highlighted in the search dropdown, or -1
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
      setupChart(data.leaderboard || []);
    } catch (err) {
      el.status.textContent = 'Network error — try refresh.';
      el.chartStatus.textContent = 'Network error — try refresh.';
    }
  }

  async function loadFlashback() {
    el.fbStatus.textContent = 'Loading…';
    el.fbStatus.classList.remove('hidden');
    el.fbBoards.innerHTML = '';

    try {
      var res = await fetch('/api/flashback?action=leaderboard');
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
        ['#', 'Player', 'Score'].forEach(function (label, idx) {
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

          var tdScore = document.createElement('td');
          tdScore.textContent = String(entry.score);

          tr.appendChild(tdRank);
          tr.appendChild(tdName);
          tr.appendChild(tdScore);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        section.appendChild(table);
      }

      el.fbBoards.appendChild(section);
    });

    el.fbStatus.classList.add('hidden');
  }

  // ---------- Progress-over-time chart ----------
  //
  // Hand-rolled SVG step chart (no library, no build step, matching the
  // rest of the site). Each player's line is a cumulative step function:
  // flat between solves, a vertical jump at each one, extended flat out to
  // "now" (or, in elapsed mode, out to how long THAT player has been
  // playing). Data comes pre-bucketed to the hour from the server (see
  // api/leaderboard.js) -- one point per hour in which a player's count
  // actually changed.
  //
  // The legend only ever lists the players currently shown, as removable
  // chips -- not a checkbox per player -- so this stays usable regardless
  // of how many people end up playing. New players are added by name via
  // the search box; "reset to top 10" / "add everyone" / "clear" cover the
  // common bulk cases.

  function setupChart(rows) {
    chart.rows = rows.filter(function (r) { return r.count > 0 && r.history && r.history.length > 0; });

    if (!chart.rows.length) {
      el.chartStatus.textContent = 'No progress yet — be the first to solve an entry!';
      el.chartStatus.classList.remove('hidden');
      el.chartSection.classList.add('hidden');
      return;
    }

    chart.colorOf = assignChartColors(chart.rows);

    // Default to the top 10 only the first time; a later refresh keeps
    // whatever the viewer already had selected, and just leaves any new
    // player unselected rather than resetting the whole picker.
    var hadSelection = Object.keys(chart.selected).length > 0;
    var known = {};
    chart.rows.forEach(function (r, i) {
      known[r.username] = true;
      if (!hadSelection) chart.selected[r.username] = i < DEFAULT_TOP_N;
      else if (!(r.username in chart.selected)) chart.selected[r.username] = false;
    });
    Object.keys(chart.selected).forEach(function (u) { if (!known[u]) delete chart.selected[u]; });

    buildLegend();
    drawChart();

    el.chartStatus.classList.add('hidden');
    el.chartSection.classList.remove('hidden');
  }

  // Colors are assigned by account-creation order, not by current rank --
  // rank changes as people solve words, and a line's color shouldn't.
  function assignChartColors(rows) {
    var byId = rows.slice().sort(function (a, b) { return a.id - b.id; });
    var map = {};
    byId.forEach(function (row, i) {
      map[row.username] = {
        stroke: CHART_COLORS[i % CHART_COLORS.length],
        dashed: Math.floor(i / CHART_COLORS.length) % 2 === 1,
      };
    });
    return map;
  }

  function selectedRows() {
    return chart.rows.filter(function (r) { return chart.selected[r.username]; });
  }

  function setSelected(username, on) {
    chart.selected[username] = on;
    buildLegend();
    drawChart();
  }

  // ---- Legend: chips for the players currently shown, not a checkbox list ----

  function buildLegend() {
    el.chartLegend.innerHTML = '';
    selectedRows().forEach(function (row) {
      var color = chart.colorOf[row.username];

      var chip = document.createElement('span');
      chip.className = 'chart-chip';

      var swatch = document.createElement('span');
      swatch.className = 'chart-chip-swatch' + (color.dashed ? ' dashed' : '');
      swatch.style.borderTopColor = color.stroke;

      var name = document.createElement('span');
      name.textContent = row.username;

      var count = document.createElement('span');
      count.className = 'chart-chip-count';
      count.textContent = String(row.count);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chart-chip-remove';
      remove.setAttribute('aria-label', 'Remove ' + row.username + ' from the chart');
      remove.textContent = '×';
      remove.addEventListener('click', function () { setSelected(row.username, false); });

      chip.appendChild(swatch);
      chip.appendChild(name);
      chip.appendChild(count);
      chip.appendChild(remove);
      el.chartLegend.appendChild(chip);
    });
  }

  // ---- Search: add any player by name, however many total there are ----

  function searchMatches(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    return chart.rows
      .filter(function (r) { return !chart.selected[r.username] && r.username.toLowerCase().indexOf(q) !== -1; })
      .slice(0, 8);
  }

  function renderSearchResults(matches) {
    el.chartSearchResults.innerHTML = '';
    chart.searchActive = -1;

    if (!matches.length) {
      var empty = document.createElement('div');
      empty.className = 'chart-search-empty';
      empty.textContent = el.chartSearchInput.value.trim() ? 'No matching player.' : '';
      el.chartSearchResults.appendChild(empty);
      el.chartSearchResults.classList.toggle('hidden', !el.chartSearchInput.value.trim());
      return;
    }

    matches.forEach(function (row) {
      var item = document.createElement('div');
      item.className = 'chart-search-result';

      var name = document.createElement('span');
      name.textContent = row.username;
      var count = document.createElement('span');
      count.className = 'muted';
      count.textContent = row.count + ' words';

      item.appendChild(name);
      item.appendChild(count);
      item.addEventListener('mousedown', function (evt) {
        // mousedown (not click) so this fires before the input's blur hides the list
        evt.preventDefault();
        addPlayer(row.username);
      });
      el.chartSearchResults.appendChild(item);
    });
    el.chartSearchResults.classList.remove('hidden');
  }

  function addPlayer(username) {
    setSelected(username, true);
    el.chartSearchInput.value = '';
    el.chartSearchResults.classList.add('hidden');
    el.chartSearchResults.innerHTML = '';
  }

  function highlightSearchResult(idx) {
    var items = el.chartSearchResults.querySelectorAll('.chart-search-result');
    for (var i = 0; i < items.length; i++) items[i].classList.toggle('active', i === idx);
    chart.searchActive = idx;
  }

  el.chartSearchInput.addEventListener('input', function () {
    renderSearchResults(searchMatches(el.chartSearchInput.value));
  });
  el.chartSearchInput.addEventListener('focus', function () {
    if (el.chartSearchInput.value.trim()) renderSearchResults(searchMatches(el.chartSearchInput.value));
  });
  el.chartSearchInput.addEventListener('blur', function () {
    el.chartSearchResults.classList.add('hidden');
  });
  el.chartSearchInput.addEventListener('keydown', function (evt) {
    var items = el.chartSearchResults.querySelectorAll('.chart-search-result');
    if (!items.length) return;
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      highlightSearchResult(Math.min(items.length - 1, chart.searchActive + 1));
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      highlightSearchResult(Math.max(0, chart.searchActive - 1));
    } else if (evt.key === 'Enter') {
      evt.preventDefault();
      var idx = chart.searchActive === -1 ? 0 : chart.searchActive;
      var matches = searchMatches(el.chartSearchInput.value);
      if (matches[idx]) addPlayer(matches[idx].username);
    } else if (evt.key === 'Escape') {
      el.chartSearchResults.classList.add('hidden');
    }
  });

  // ---- Mode toggle: real calendar time, or elapsed time since each player's own start ----

  function setMode(mode) {
    chart.mode = mode;
    el.chartModeCalendarBtn.classList.toggle('active', mode === 'calendar');
    el.chartModeElapsedBtn.classList.toggle('active', mode === 'elapsed');
    el.chartModeNote.textContent = mode === 'elapsed'
      ? 'Everyone lines up at "hours since their own first guess," so a player who started later isn’t behind on the chart just for starting later.'
      : 'Everyone’s x-axis is their own actual calendar time.';
    drawChart();
  }
  el.chartModeCalendarBtn.addEventListener('click', function () { setMode('calendar'); });
  el.chartModeElapsedBtn.addEventListener('click', function () { setMode('elapsed'); });

  // ---- Drawing ----

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  // Step-after path: holds at the previous value until the next change,
  // then jumps, and finally extends flat out to `endT` (now, or -- in
  // elapsed mode -- however long this player has personally been playing).
  function stepPath(points, xFn, yFn, endT) {
    if (!points.length) return '';
    var d = 'M ' + xFn(points[0].t) + ',' + yFn(points[0].n);
    for (var i = 1; i < points.length; i++) {
      var tx = xFn(points[i].t);
      d += ' L ' + tx + ',' + yFn(points[i - 1].n);
      d += ' L ' + tx + ',' + yFn(points[i].n);
    }
    d += ' L ' + xFn(endT) + ',' + yFn(points[points.length - 1].n);
    return d;
  }

  function niceMax(value) {
    if (value <= 0) return 4;
    var magnitude = Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
    var norm = value / magnitude;
    var niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return niceNorm * magnitude;
  }

  function formatAxisDate(t, rangeMs) {
    var d = new Date(t);
    if (rangeMs < 36 * 3600 * 1000) {
      return d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric' });
    }
    return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  }

  function formatTooltipDate(t) {
    return new Date(t).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function formatElapsed(ms) {
    var totalHours = Math.round(ms / 3600000);
    var days = Math.floor(totalHours / 24), hours = totalHours % 24;
    if (days === 0) return hours + 'h in';
    if (hours === 0) return 'day ' + days;
    return 'day ' + days + ', ' + hours + 'h';
  }

  function formatElapsedTick(ms) {
    var totalHours = Math.round(ms / 3600000);
    var days = Math.floor(totalHours / 24), hours = totalHours % 24;
    if (days === 0) return hours + 'h';
    if (hours === 0) return 'd' + days;
    return 'd' + days + ' ' + hours + 'h';
  }

  // Builds per-series { username, points, endT } in whichever unit the
  // current mode uses for the x-axis -- calendar ms since epoch, or ms
  // elapsed since that player's own first solve. Keeping the rest of the
  // drawing/hover code mode-agnostic (it only ever sees `points`/`endT`)
  // avoids two parallel implementations.
  function buildSeriesForMode(rows, mode) {
    var now = Date.now();
    return rows.map(function (r) {
      var originT = Date.parse(r.history[0].t);
      if (mode === 'elapsed') {
        return {
          username: r.username,
          points: r.history.map(function (p) { return { t: Date.parse(p.t) - originT, n: p.n }; }),
          endT: now - originT,
        };
      }
      return {
        username: r.username,
        points: r.history.map(function (p) { return { t: Date.parse(p.t), n: p.n }; }),
        endT: now,
      };
    });
  }

  // null once `t` is past this series' own endT -- in elapsed mode that
  // means "this player hasn't been playing that long yet," which is
  // different from "had solved 0 at that point" and shouldn't be drawn.
  function valueAt(series, t) {
    if (t > series.endT) return null;
    var val = 0;
    for (var i = 0; i < series.points.length; i++) {
      if (series.points[i].t <= t) val = series.points[i].n; else break;
    }
    return val;
  }

  function drawChart() {
    var rows = selectedRows();

    el.chartTooltip.classList.add('hidden');
    el.chartSvg.innerHTML = '';

    if (!rows.length) {
      el.chartEmpty.classList.remove('hidden');
      el.chartSvg.classList.add('hidden');
      el.chartSvg.onpointermove = null;
      el.chartSvg.onpointerleave = null;
      el.chartSvg.onkeydown = null;
      return;
    }
    el.chartEmpty.classList.add('hidden');
    el.chartSvg.classList.remove('hidden');

    var series = buildSeriesForMode(rows, chart.mode);

    var VBW = 900, VBH = 380;
    var showDirectLabels = rows.length <= DIRECT_LABEL_MAX;
    var plotLeft = 46, plotRight = VBW - (showDirectLabels ? 74 : 14);
    var plotTop = 12, plotBottom = VBH - 30;
    var plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;

    var minT = chart.mode === 'elapsed' ? 0 : Math.min.apply(null, series.map(function (s) { return s.points[0].t; }));
    var maxT = Math.max.apply(null, series.map(function (s) { return s.endT; }));
    if (maxT <= minT) maxT = minT + 3600000; // guard a zero-width domain
    var maxN = 0;
    series.forEach(function (s) { s.points.forEach(function (p) { if (p.n > maxN) maxN = p.n; }); });
    var yMax = niceMax(maxN);

    function xFn(t) { return plotLeft + (t - minT) / (maxT - minT) * plotW; }
    function yFn(n) { return plotTop + plotH - (n / yMax) * plotH; }
    function invX(px) { return minT + (px - plotLeft) / plotW * (maxT - minT); }

    el.chartSvg.setAttribute('viewBox', '0 0 ' + VBW + ' ' + VBH);

    // Y gridlines + labels (+ axis title, so "what am I looking at" doesn't
    // depend on already having read the page heading).
    var yTicks = 4;
    for (var i = 0; i <= yTicks; i++) {
      var val = Math.round(yMax * i / yTicks);
      var gy = yFn(val);
      el.chartSvg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: gy, y2: gy, class: 'chart-grid-line' }));
      var ylabel = svgEl('text', { x: plotLeft - 8, y: gy + 4, class: 'chart-tick-label', 'text-anchor': 'end' });
      ylabel.textContent = String(val);
      el.chartSvg.appendChild(ylabel);
    }
    var yAxisTitle = svgEl('text', {
      x: plotLeft, y: plotTop - 2, class: 'chart-axis-title', 'text-anchor': 'start',
    });
    yAxisTitle.textContent = 'WORDS SOLVED';
    el.chartSvg.appendChild(yAxisTitle);

    // X axis baseline + tick labels.
    el.chartSvg.appendChild(svgEl('line', { x1: plotLeft, x2: plotRight, y1: plotBottom, y2: plotBottom, class: 'chart-axis-line' }));
    var xTicks = 5;
    for (var j = 0; j <= xTicks; j++) {
      var t = minT + (maxT - minT) * (j / xTicks);
      var tx = xFn(t);
      el.chartSvg.appendChild(svgEl('line', { x1: tx, x2: tx, y1: plotBottom, y2: plotBottom + 5, class: 'chart-axis-line' }));
      var anchor = j === 0 ? 'start' : (j === xTicks ? 'end' : 'middle');
      var xlabel = svgEl('text', { x: tx, y: plotBottom + 18, class: 'chart-tick-label', 'text-anchor': anchor });
      xlabel.textContent = chart.mode === 'elapsed' ? formatElapsedTick(t) : formatAxisDate(t, maxT - minT);
      el.chartSvg.appendChild(xlabel);
    }

    // One step-line per selected player, each keyed to its own color.
    series.forEach(function (s) {
      var color = chart.colorOf[s.username];
      var d = stepPath(s.points, xFn, yFn, s.endT);
      var attrs = { d: d, fill: 'none', stroke: color.stroke, 'stroke-width': 2, 'stroke-linejoin': 'round' };
      if (color.dashed) attrs['stroke-dasharray'] = '6 4';
      el.chartSvg.appendChild(svgEl('path', attrs));
    });

    // Direct end-of-line labels, only while few enough lines are shown that
    // they won't collide -- otherwise identity lives in the legend chips
    // and the hover tooltip instead.
    if (showDirectLabels) {
      var labelPositions = series.map(function (s) {
        var last = s.points[s.points.length - 1];
        return { username: s.username, y: yFn(last.n) };
      }).sort(function (a, b) { return a.y - b.y; });
      for (var li = 1; li < labelPositions.length; li++) {
        if (labelPositions[li].y - labelPositions[li - 1].y < 13) {
          labelPositions[li].y = labelPositions[li - 1].y + 13;
        }
      }
      labelPositions.forEach(function (lp) {
        var color = chart.colorOf[lp.username];
        var label = svgEl('text', {
          x: xFn(maxT) + 6, y: lp.y + 4, class: 'chart-direct-label', fill: color.stroke,
        });
        label.textContent = lp.username;
        el.chartSvg.appendChild(label);
      });
    }

    // Crosshair + hover dots, hidden until the pointer (or keyboard) moves.
    var crosshair = svgEl('line', { x1: plotLeft, x2: plotLeft, y1: plotTop, y2: plotBottom, class: 'chart-crosshair', visibility: 'hidden' });
    el.chartSvg.appendChild(crosshair);
    var dotsGroup = svgEl('g', { class: 'chart-hover-dot' });
    el.chartSvg.appendChild(dotsGroup);

    attachHover(series, xFn, yFn, invX, maxT, plotLeft, plotRight, crosshair, dotsGroup);
  }

  function attachHover(series, xFn, yFn, invX, maxT, plotLeft, plotRight, crosshair, dotsGroup) {
    // The crosshair snaps to the nearest moment anything actually changed
    // (or "now"/the series' own end), never to an arbitrary pixel --
    // readers aim at a date, not a 2px line.
    var times = [maxT];
    series.forEach(function (s) {
      times.push(s.endT);
      s.points.forEach(function (p) { times.push(p.t); });
    });
    times = times.filter(function (t, i, arr) { return arr.indexOf(t) === i; }).sort(function (a, b) { return a - b; });

    function nearest(t) {
      var best = times[0], bestDiff = Math.abs(times[0] - t);
      for (var i = 1; i < times.length; i++) {
        var diff = Math.abs(times[i] - t);
        if (diff < bestDiff) { best = times[i]; bestDiff = diff; }
      }
      return best;
    }

    function showAt(t) {
      chart.hoverX = t;
      var cx = xFn(t);
      crosshair.setAttribute('x1', cx);
      crosshair.setAttribute('x2', cx);
      crosshair.setAttribute('visibility', 'visible');

      var items = series
        .map(function (s) { return { s: s, n: valueAt(s, t) }; })
        .filter(function (item) { return item.n !== null; }) // hasn't reached this point yet (elapsed mode)
        .sort(function (a, b) { return b.n - a.n; });

      dotsGroup.innerHTML = '';
      items.forEach(function (item) {
        var color = chart.colorOf[item.s.username];
        dotsGroup.appendChild(svgEl('circle', {
          cx: cx, cy: yFn(item.n), r: 3.5, fill: color.stroke, stroke: '#ffffff', 'stroke-width': 1,
        }));
      });

      renderTooltip(t, items);
      return cx;
    }

    function hide() {
      chart.hoverX = null;
      crosshair.setAttribute('visibility', 'hidden');
      dotsGroup.innerHTML = '';
      el.chartTooltip.classList.add('hidden');
    }

    el.chartSvg.onpointermove = function (evt) {
      var rect = el.chartSvg.getBoundingClientRect();
      var px = (evt.clientX - rect.left) * (900 / rect.width);
      if (px < plotLeft || px > plotRight) { hide(); return; }
      showAt(nearest(invX(px)));
      positionTooltip(evt.clientX, evt.clientY);
    };
    el.chartSvg.onpointerleave = function () { hide(); };
    el.chartSvg.onkeydown = function (evt) {
      if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;
      evt.preventDefault();
      var idx = chart.hoverX === null ? times.length - 1 : times.indexOf(chart.hoverX);
      if (idx === -1) idx = times.length - 1;
      idx = evt.key === 'ArrowLeft' ? Math.max(0, idx - 1) : Math.min(times.length - 1, idx + 1);
      var cx = showAt(times[idx]);
      var rect = el.chartSvg.getBoundingClientRect();
      var scale = rect.width / 900;
      positionTooltip(rect.left + cx * scale, rect.top + rect.height / 2);
    };
  }

  function renderTooltip(t, items) {
    el.chartTooltip.innerHTML = '';

    var dateDiv = document.createElement('div');
    dateDiv.className = 'chart-tooltip-date';
    dateDiv.textContent = chart.mode === 'elapsed' ? formatElapsed(t) : formatTooltipDate(t);
    el.chartTooltip.appendChild(dateDiv);

    items.forEach(function (item) {
      var color = chart.colorOf[item.s.username];
      var row = document.createElement('div');
      row.className = 'chart-tooltip-row';

      var key = document.createElement('span');
      key.className = 'chart-tooltip-key' + (color.dashed ? ' dashed' : '');
      key.style.borderTopColor = color.stroke;

      var name = document.createElement('span');
      name.className = 'chart-tooltip-name';
      name.textContent = item.s.username; // untrusted -- textContent, never innerHTML

      var val = document.createElement('span');
      val.className = 'chart-tooltip-value';
      val.textContent = String(item.n);

      row.appendChild(key);
      row.appendChild(name);
      row.appendChild(val);
      el.chartTooltip.appendChild(row);
    });

    el.chartTooltip.classList.remove('hidden');
  }

  function positionTooltip(clientX, clientY) {
    var wrapRect = el.chartWrap.getBoundingClientRect();
    var left = clientX - wrapRect.left + 14;
    var top = clientY - wrapRect.top + 14;
    el.chartTooltip.style.left = left + 'px';
    el.chartTooltip.style.top = top + 'px';
    var tw = el.chartTooltip.offsetWidth, th = el.chartTooltip.offsetHeight;
    if (left + tw > wrapRect.width) el.chartTooltip.style.left = Math.max(0, clientX - wrapRect.left - tw - 14) + 'px';
    if (top + th > wrapRect.height) el.chartTooltip.style.top = Math.max(0, clientY - wrapRect.top - th - 14) + 'px';
  }

  el.chartTop10Btn.addEventListener('click', function () {
    chart.rows.forEach(function (r, i) { chart.selected[r.username] = i < DEFAULT_TOP_N; });
    buildLegend();
    drawChart();
  });
  el.chartAllBtn.addEventListener('click', function () {
    chart.rows.forEach(function (r) { chart.selected[r.username] = true; });
    buildLegend();
    drawChart();
  });
  el.chartNoneBtn.addEventListener('click', function () {
    chart.rows.forEach(function (r) { chart.selected[r.username] = false; });
    buildLegend();
    drawChart();
  });

  load();
  loadFlashback();
})();
