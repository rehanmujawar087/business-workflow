/* =========================================================
   Daybook | Team Task Manager
   - Two roles: manager and employee
   - Manager assigns daily tasks to employees
   - Unfinished tasks automatically move to the next day
   - Completion percentage per employee and for the whole team
   Data is stored in the browser (localStorage).
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- Constants ---------------- */
  var DATA_KEY = 'daybook.data.v1';
  var SESSION_KEY = 'daybook.session.v1';
  var PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
  var PRIORITY_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

  /* ---------------- Safe storage ----------------
     Falls back to memory if the browser blocks storage,
     so the app never crashes. */
  function makeStore(areaName) {
    var memory = {};
    return {
      get: function (key) {
        try {
          var value = window[areaName].getItem(key);
          if (value !== null) return value;
        } catch (e) { /* storage blocked */ }
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      set: function (key, value) {
        memory[key] = value;
        try { window[areaName].setItem(key, value); } catch (e) { /* storage blocked */ }
      },
      remove: function (key) {
        delete memory[key];
        try { window[areaName].removeItem(key); } catch (e) { /* storage blocked */ }
      }
    };
  }

  var local = makeStore('localStorage');     // shared data (tasks, users)
  var session = makeStore('sessionStorage'); // login per browser tab

  /* ---------------- Helpers ---------------- */
  function $(selector) { return document.querySelector(selector); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0].charAt(0);
    var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function percent(done, total) { return total > 0 ? Math.round((done / total) * 100) : 0; }

  /* ---------------- Dates (local time, YYYY-MM-DD) ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }

  function toKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function fromKey(key) {
    var p = String(key).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function todayKey() { return toKey(new Date()); }

  function addDays(key, n) {
    var d = fromKey(key);
    d.setDate(d.getDate() + n);
    return toKey(d);
  }

  function daysBetween(fromK, toK) {
    return Math.round((fromKey(toK) - fromKey(fromK)) / 86400000);
  }

  function formatLong(key) {
    return fromKey(key).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function formatShort(key) {
    return fromKey(key).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function relativeDay(key) {
    var t = todayKey();
    if (key === t) return 'Today';
    if (key === addDays(t, 1)) return 'Tomorrow';
    if (key === addDays(t, -1)) return 'Yesterday';
    return formatShort(key);
  }

  /* "today", "tomorrow", "yesterday" or "on 3 Oct" */
  function dayPhrase(key, past) {
    var t = todayKey();
    if (key === t) return 'today';
    if (key === addDays(t, 1)) return 'tomorrow';
    if (key === addDays(t, -1)) return 'yesterday';
    return (past ? 'on ' : '') + formatShort(key);
  }

  function isCarried(task) {
    return Boolean(task.originalDate) && task.originalDate < task.date;
  }

  function carriedLabel(task) {
    var days = daysBetween(task.originalDate, task.date);
    if (days === 1) return 'Carried over from yesterday';
    return 'Carried over from ' + formatShort(task.originalDate) + ' (' + days + ' days)';
  }

  /* ---------------- Data ---------------- */
  var data = null;

  function makeTask(employeeId, title, description, priority, date, completed) {
    return {
      id: uid(),
      employeeId: employeeId,
      title: title,
      description: description || '',
      priority: priority,
      date: date,            // the day the task currently belongs to
      originalDate: date,    // the day it was first assigned for
      completed: Boolean(completed),
      completedAt: completed ? date : null,
      createdAt: Date.now()
    };
  }

  function seedData() {
    var t = todayKey();
    var y = addDays(t, -1);
    var tm = addDays(t, 1);
    return {
      users: [
        { id: 'u_manager', name: 'Anita Deshmukh', username: 'manager', password: 'manager123', role: 'manager' },
        { id: 'u_rahul', name: 'Rahul Jadhav', username: 'rahul', password: 'rahul123', role: 'employee' },
        { id: 'u_priya', name: 'Priya Kulkarni', username: 'priya', password: 'priya123', role: 'employee' }
      ],
      tasks: [
        // Unfinished from yesterday: will be carried over to today automatically
        makeTask('u_rahul', 'Call back pending customers', 'Five customers from last week are waiting for a quote.', 'high', y, false),
        makeTask('u_rahul', 'Prepare the daily sales summary', 'Share it on the team group before 6 pm.', 'medium', t, false),
        makeTask('u_rahul', 'Restock the front shelf', '', 'low', t, true),
        makeTask('u_rahul', 'Visit the supplier for the new order', 'Carry the signed purchase order.', 'medium', tm, false),
        makeTask('u_priya', 'Design the weekend offer poster', '', 'medium', y, true),
        makeTask('u_priya', 'Update the inventory spreadsheet', 'Add the items received on Monday.', 'high', t, true),
        makeTask('u_priya', 'Reply to customer emails', '', 'medium', t, false)
      ]
    };
  }

  function isValidData(d) {
    return d && Array.isArray(d.users) && Array.isArray(d.tasks) &&
      d.users.some(function (u) { return u.role === 'manager'; });
  }

  function loadData() {
    var raw = local.get(DATA_KEY);
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (isValidData(parsed)) return parsed;
      } catch (e) { /* corrupted data: reseed below */ }
    }
    var fresh = seedData();
    local.set(DATA_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function saveData() {
    local.set(DATA_KEY, JSON.stringify(data));
  }

  /* Move every unfinished task from a past day to today.
     Runs on load, at midnight and when the tab becomes active. */
  function rollOver() {
    var t = todayKey();
    var moved = 0;
    data.tasks.forEach(function (task) {
      if (!task.completed && task.date < t) {
        if (!task.originalDate) task.originalDate = task.date;
        task.date = t;
        moved++;
      }
    });
    if (moved) saveData();
    return moved;
  }

  function employees() {
    return data.users
      .filter(function (u) { return u.role === 'employee'; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function findUser(id) {
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].id === id) return data.users[i];
    }
    return null;
  }

  function currentUser() {
    var id = session.get(SESSION_KEY);
    return id ? findUser(id) : null;
  }

  function tasksFor(employeeId, dateKey) {
    return data.tasks.filter(function (t) {
      return t.employeeId === employeeId && (!dateKey || t.date === dateKey);
    });
  }

  function progressOf(taskList) {
    var done = taskList.filter(function (t) { return t.completed; }).length;
    return { total: taskList.length, done: done, left: taskList.length - done, pct: percent(done, taskList.length) };
  }

  function sortTasks(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      var ca = isCarried(a) ? 0 : 1;
      var cb = isCarried(b) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      var pa = PRIORITY_ORDER[a.priority] !== undefined ? PRIORITY_ORDER[a.priority] : 1;
      var pb = PRIORITY_ORDER[b.priority] !== undefined ? PRIORITY_ORDER[b.priority] : 1;
      if (pa !== pb) return pa - pb;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  /* ---------------- Toasts ---------------- */
  function toast(message, type) {
    var stack = $('#toastStack');
    if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.textContent = message;
    stack.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 3200);
  }

  /* ---------------- Shared rendering ---------------- */
  function setMeter(wrapId, barId, pct) {
    var wrap = document.getElementById(wrapId);
    var bar = document.getElementById(barId);
    if (!wrap || !bar) return;
    bar.style.width = pct + '%';
    wrap.setAttribute('aria-valuenow', String(pct));
    wrap.classList.toggle('is-full', pct >= 100);
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function tagsHtml(task, options) {
    var html = '';
    if (options.showEmployee) {
      var emp = findUser(task.employeeId);
      html += '<span class="tag">' + esc(emp ? emp.name : 'Unknown') + '</span>';
    }
    if (task.completed) {
      html += '<span class="tag tag-done">Done ' + esc(dayPhrase(task.completedAt || task.date, true)) + '</span>';
    } else if (options.showDate) {
      html += '<span class="tag">' + esc(relativeDay(task.date)) + '</span>';
    }
    var prio = PRIORITY_LABEL[task.priority] ? task.priority : 'medium';
    html += '<span class="tag tag-' + prio + '">' + esc(PRIORITY_LABEL[prio]) + '</span>';
    if (isCarried(task)) {
      html += '<span class="tag tag-carried">' + esc(carriedLabel(task)) + '</span>';
    }
    return html;
  }

  function taskClasses(task) {
    var prio = PRIORITY_LABEL[task.priority] ? task.priority : 'medium';
    return 'task prio-' + prio + (task.completed ? ' is-done' : '') + (isCarried(task) ? ' is-carried' : '');
  }

  function emptyHtml(title, text) {
    return '<li class="empty"><strong>' + esc(title) + '</strong>' + esc(text) + '</li>';
  }

  /* =========================================================
     LOGIN
     ========================================================= */
  var selectedRole = 'manager';

  function setRole(role) {
    selectedRole = role === 'employee' ? 'employee' : 'manager';
    document.querySelectorAll('.role-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-role') === selectedRole;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    setText('loginSubmit', 'Sign in as ' + selectedRole);
    setText('loginError', '');
  }

  function handleLogin(event) {
    event.preventDefault();
    var username = $('#loginUser').value.trim().toLowerCase();
    var password = $('#loginPass').value;
    var errorEl = $('#loginError');

    if (!username || !password) {
      errorEl.textContent = 'Enter both your username and password.';
      return;
    }

    var user = null;
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].username.toLowerCase() === username) { user = data.users[i]; break; }
    }

    if (!user || user.password !== password) {
      errorEl.textContent = "That username and password don't match an account. Check them and try again.";
      return;
    }

    if (user.role !== selectedRole) {
      var correct = user.role === 'manager' ? 'Manager' : 'Employee';
      errorEl.textContent = 'This is ' + (user.role === 'manager' ? 'a manager' : 'an employee') +
        ' account. Switch to the ' + correct + ' tab to sign in.';
      return;
    }

    errorEl.textContent = '';
    session.set(SESSION_KEY, user.id);
    $('#loginForm').reset();
    render();
    toast('Signed in as ' + user.name + '.', 'success');
  }

  function logout() {
    session.remove(SESSION_KEY);
    setRole('manager');
    render();
  }

  /* =========================================================
     MANAGER VIEW
     ========================================================= */
  var boardEmployee = 'all';
  var boardScope = 'today';

  function renderManager() {
    var t = todayKey();
    var team = employees();
    var teamIds = team.map(function (e) { return e.id; });

    var todays = data.tasks.filter(function (task) {
      return task.date === t && teamIds.indexOf(task.employeeId) !== -1;
    });
    var prog = progressOf(todays);
    var carriedToday = todays.filter(function (task) { return isCarried(task) && !task.completed; }).length;

    setText('mgrDayTitle', formatLong(t));
    setText('teamPercent', prog.pct + '%');
    setText('teamCount', prog.done + ' of ' + plural(prog.total, 'task') + ' done');
    setMeter('teamMeterWrap', 'teamMeter', prog.pct);

    setText('statEmployees', team.length);
    setText('statToday', prog.total);
    setText('statDone', prog.done);
    setText('statCarried', carriedToday);

    renderTeamList(team, t);
    fillEmployeeSelects(team);
    prepareTaskDate();
    renderBoard();
  }

  function renderTeamList(team, t) {
    var list = $('#teamList');
    setText('teamSummary', plural(team.length, 'employee'));

    if (!team.length) {
      list.innerHTML = emptyHtml('No employees yet.', ' Add one with the form on the right, then assign their first task.');
      return;
    }

    list.innerHTML = team.map(function (emp) {
      var todays = tasksFor(emp.id, t);
      var p = progressOf(todays);
      var carried = todays.filter(function (x) { return isCarried(x) && !x.completed; }).length;
      var meta = p.total
        ? p.done + ' of ' + plural(p.total, 'task') + ' done today'
        : 'No tasks for today';
      if (carried) meta += ', <span class="carried-text">' + carried + ' carried over</span>';

      return '' +
        '<li class="member">' +
          '<span class="avatar avatar-sm" aria-hidden="true">' + esc(initials(emp.name)) + '</span>' +
          '<div class="member-main">' +
            '<div class="member-top"><strong>' + esc(emp.name) + '</strong><span class="muted">@' + esc(emp.username) + '</span></div>' +
            '<div class="meter meter-sm" role="progressbar" aria-label="' + esc(emp.name) + ' completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p.pct + '"><span style="width:' + p.pct + '%"></span></div>' +
            '<p class="member-meta">' + meta + '</p>' +
          '</div>' +
          '<span class="member-pct">' + p.pct + '%</span>' +
          '<div class="member-actions">' +
            '<button type="button" class="btn btn-small btn-quiet" data-action="assign" data-id="' + esc(emp.id) + '">Assign task</button>' +
            '<button type="button" class="btn btn-small btn-quiet" data-action="view" data-id="' + esc(emp.id) + '">View tasks</button>' +
            '<button type="button" class="btn btn-small btn-danger-quiet" data-action="remove" data-id="' + esc(emp.id) + '">Remove</button>' +
          '</div>' +
        '</li>';
    }).join('');
  }

  function fillEmployeeSelects(team) {
    var taskSel = $('#taskEmployee');
    var prev = taskSel.value;
    taskSel.innerHTML = '<option value="">Choose an employee</option>' + team.map(function (e) {
      return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>';
    }).join('');
    if (team.some(function (e) { return e.id === prev; })) taskSel.value = prev;

    var filterSel = $('#filterEmployee');
    filterSel.innerHTML = '<option value="all">All employees</option>' + team.map(function (e) {
      return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>';
    }).join('');
    if (boardEmployee !== 'all' && !team.some(function (e) { return e.id === boardEmployee; })) {
      boardEmployee = 'all';
    }
    filterSel.value = boardEmployee;
    $('#filterScope').value = boardScope;
  }

  function prepareTaskDate() {
    var input = $('#taskDate');
    var t = todayKey();
    input.min = t;
    if (!input.value || input.value < t) input.value = t;
  }

  function renderBoard() {
    var t = todayKey();
    var teamIds = employees().map(function (e) { return e.id; });

    var list = data.tasks.filter(function (task) {
      if (teamIds.indexOf(task.employeeId) === -1) return false;
      if (boardEmployee !== 'all' && task.employeeId !== boardEmployee) return false;
      switch (boardScope) {
        case 'today': return task.date === t;
        case 'upcoming': return task.date > t && !task.completed;
        case 'pending': return !task.completed;
        case 'completed': return task.completed;
        default: return true;
      }
    });

    if (boardScope === 'completed') {
      list.sort(function (a, b) {
        var ak = a.completedAt || a.date;
        var bk = b.completedAt || b.date;
        if (ak !== bk) return ak < bk ? 1 : -1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    } else {
      list = sortTasks(list);
    }

    setText('boardCount', plural(list.length, 'task'));

    var board = $('#taskBoard');
    if (!list.length) {
      var messages = {
        today: ['Nothing assigned for today.', ' Use "Assign a task" to add one.'],
        upcoming: ['No upcoming tasks.', ' Pick a future date when you assign a task to plan ahead.'],
        pending: ['Everything is finished.', ' There are no unfinished tasks.'],
        completed: ['No completed tasks yet.', ' Tasks show up here once employees tick them off.'],
        all: ['No tasks yet.', ' Use "Assign a task" to add the first one.']
      };
      var m = messages[boardScope] || messages.all;
      board.innerHTML = emptyHtml(m[0], m[1]);
      return;
    }

    var showDate = boardScope !== 'today';
    board.innerHTML = list.map(function (task) {
      return '' +
        '<li class="' + taskClasses(task) + '">' +
          '<span class="task-status" role="img" aria-label="' + (task.completed ? 'Completed' : 'Not completed') + '"></span>' +
          '<div class="task-body">' +
            '<div class="task-title">' + esc(task.title) + '</div>' +
            (task.description ? '<p class="task-desc">' + esc(task.description) + '</p>' : '') +
            '<div class="task-tags">' + tagsHtml(task, { showEmployee: true, showDate: showDate }) + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-small btn-danger-quiet" data-action="delete-task" data-id="' + esc(task.id) + '" aria-label="Delete task: ' + esc(task.title) + '">Delete</button>' +
        '</li>';
    }).join('');
  }

  function handleAssignTask(event) {
    event.preventDefault();
    var errorEl = $('#taskError');
    var employeeId = $('#taskEmployee').value;
    var title = $('#taskTitle').value.trim();
    var description = $('#taskDesc').value.trim();
    var priority = $('#taskPriority').value;
    var date = $('#taskDate').value;
    var t = todayKey();

    if (!employees().length) { errorEl.textContent = 'Add an employee first, then assign them a task.'; return; }
    if (!employeeId || !findUser(employeeId)) { errorEl.textContent = 'Choose which employee this task is for.'; return; }
    if (!title) { errorEl.textContent = 'Write what the task is.'; $('#taskTitle').focus(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errorEl.textContent = 'Pick a date for this task.'; return; }
    if (date < t) { errorEl.textContent = 'Pick today or a future date. Past dates are closed.'; return; }
    if (!PRIORITY_LABEL[priority]) priority = 'medium';

    errorEl.textContent = '';
    data.tasks.push(makeTask(employeeId, title, description, priority, date, false));
    saveData();

    var emp = findUser(employeeId);
    $('#taskTitle').value = '';
    $('#taskDesc').value = '';
    $('#taskPriority').value = 'medium';
    renderManager();
    toast('Task assigned to ' + emp.name + ' for ' + dayPhrase(date, false) + '.', 'success');
    $('#taskTitle').focus();
  }

  function handleAddEmployee(event) {
    event.preventDefault();
    var errorEl = $('#empError');
    var name = $('#empName').value.trim().replace(/\s+/g, ' ');
    var username = $('#empUser').value.trim().toLowerCase();
    var password = $('#empPass').value;

    if (name.length < 2) { errorEl.textContent = 'Enter the employee\'s full name.'; $('#empName').focus(); return; }
    if (!/^[a-z0-9._]{3,20}$/.test(username)) {
      errorEl.textContent = 'Username needs 3 to 20 characters: letters, numbers, dots or underscores.';
      $('#empUser').focus();
      return;
    }
    if (data.users.some(function (u) { return u.username.toLowerCase() === username; })) {
      errorEl.textContent = 'The username "' + username + '" is taken. Choose another one.';
      $('#empUser').focus();
      return;
    }
    if (password.length < 4) { errorEl.textContent = 'Password needs at least 4 characters.'; $('#empPass').focus(); return; }

    errorEl.textContent = '';
    var newUser = { id: 'u' + uid(), name: name, username: username, password: password, role: 'employee' };
    data.users.push(newUser);
    saveData();
    $('#empForm').reset();
    renderManager();
    $('#taskEmployee').value = newUser.id;
    toast(name + ' added. They can sign in as @' + username + '.', 'success');
  }

  function handleTeamClick(event) {
    var btn = event.target.closest('button[data-action]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var emp = findUser(id);
    if (!emp) return;
    var action = btn.getAttribute('data-action');

    if (action === 'assign') {
      $('#taskEmployee').value = id;
      $('#taskTitle').focus();
      $('#taskForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (action === 'view') {
      boardEmployee = id;
      boardScope = 'today';
      $('#filterEmployee').value = id;
      $('#filterScope').value = 'today';
      renderBoard();
      $('#boardPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'remove') {
      var count = tasksFor(id).length;
      var ok = window.confirm('Remove ' + emp.name + '? Their account and ' + plural(count, 'task') + ' will be deleted.');
      if (!ok) return;
      data.users = data.users.filter(function (u) { return u.id !== id; });
      data.tasks = data.tasks.filter(function (t) { return t.employeeId !== id; });
      saveData();
      renderManager();
      toast(emp.name + ' removed.');
    }
  }

  function handleBoardClick(event) {
    var btn = event.target.closest('button[data-action="delete-task"]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var task = null;
    for (var i = 0; i < data.tasks.length; i++) {
      if (data.tasks[i].id === id) { task = data.tasks[i]; break; }
    }
    if (!task) return;
    if (!window.confirm('Delete the task "' + task.title + '"?')) return;
    data.tasks = data.tasks.filter(function (t) { return t.id !== id; });
    saveData();
    renderManager();
    toast('Task deleted.');
  }

  function handleReset() {
    if (!window.confirm('Reset all data to the demo accounts and tasks? Everything you added will be deleted.')) return;
    data = seedData();
    saveData();
    rollOver();
    session.set(SESSION_KEY, 'u_manager');
    boardEmployee = 'all';
    boardScope = 'today';
    render();
    toast('Demo data restored.');
  }

  /* =========================================================
     EMPLOYEE VIEW
     ========================================================= */
  function renderEmployee(user) {
    var t = todayKey();
    var mine = tasksFor(user.id);

    var today = mine.filter(function (x) { return x.date === t; });
    var sortedToday = sortTasks(today);
    var p = progressOf(today);
    var carried = today.filter(function (x) { return isCarried(x); }).length;

    var firstName = user.name.split(' ')[0];
    var hour = new Date().getHours();
    var greet = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');

    setText('empDayTitle', formatLong(t));
    setText('empGreeting', greet + ', ' + firstName + '. Here is your list for today.');
    setText('empPercent', p.pct + '%');
    setText('empCount', p.done + ' of ' + plural(p.total, 'task') + ' done');
    setMeter('empMeterWrap', 'empMeter', p.pct);

    setText('empStatTotal', p.total);
    setText('empStatDone', p.done);
    setText('empStatLeft', p.left);
    setText('empStatCarried', carried);

    $('#empAllDone').hidden = !(p.total > 0 && p.left === 0);

    var list = $('#empTodayList');
    if (!sortedToday.length) {
      list.innerHTML = emptyHtml('No tasks for today.', ' New tasks from your manager will appear here.');
    } else {
      list.innerHTML = sortedToday.map(function (task) {
        var inputId = 'chk-' + task.id;
        return '' +
          '<li class="' + taskClasses(task) + '">' +
            '<label class="check" for="' + esc(inputId) + '">' +
              '<input type="checkbox" id="' + esc(inputId) + '" data-id="' + esc(task.id) + '"' + (task.completed ? ' checked' : '') +
                ' aria-label="Mark ' + esc(task.title) + ' as ' + (task.completed ? 'not done' : 'done') + '">' +
              '<span class="check-box" aria-hidden="true"></span>' +
            '</label>' +
            '<div class="task-body">' +
              '<label class="task-title" for="' + esc(inputId) + '">' + esc(task.title) + '</label>' +
              (task.description ? '<p class="task-desc">' + esc(task.description) + '</p>' : '') +
              '<div class="task-tags">' + tagsHtml(task, { showEmployee: false, showDate: false }) + '</div>' +
            '</div>' +
          '</li>';
      }).join('');
    }

    var upcoming = sortTasks(mine.filter(function (x) { return x.date > t && !x.completed; }));
    setText('empUpcomingCount', upcoming.length ? plural(upcoming.length, 'task') : '');
    var upList = $('#empUpcomingList');
    if (!upcoming.length) {
      upList.innerHTML = emptyHtml('Nothing scheduled ahead.', ' Tasks planned for later days will show here.');
    } else {
      upList.innerHTML = upcoming.map(function (task) {
        return '' +
          '<li class="' + taskClasses(task) + '">' +
            '<div class="task-body">' +
              '<div class="task-title">' + esc(task.title) + '</div>' +
              (task.description ? '<p class="task-desc">' + esc(task.description) + '</p>' : '') +
              '<div class="task-tags">' + tagsHtml(task, { showEmployee: false, showDate: true }) + '</div>' +
            '</div>' +
          '</li>';
      }).join('');
    }
  }

  function handleToggleTask(event) {
    var input = event.target;
    if (!input || input.type !== 'checkbox') return;
    var user = currentUser();
    if (!user || user.role !== 'employee') return;

    var id = input.getAttribute('data-id');
    var task = null;
    for (var i = 0; i < data.tasks.length; i++) {
      if (data.tasks[i].id === id && data.tasks[i].employeeId === user.id) { task = data.tasks[i]; break; }
    }
    if (!task) return;

    task.completed = input.checked;
    task.completedAt = input.checked ? todayKey() : null;
    saveData();
    renderEmployee(user);

    // keep keyboard focus on the same checkbox after re-render
    var again = document.getElementById('chk-' + id);
    if (again) again.focus();

    var today = tasksFor(user.id, todayKey());
    var p = progressOf(today);
    if (input.checked && p.total > 0 && p.left === 0) {
      toast("All of today's tasks are done.", 'success');
    }
  }

  /* =========================================================
     MAIN RENDER
     ========================================================= */
  function render() {
    var user = currentUser();
    var loginView = $('#loginView');
    var appView = $('#appView');

    if (!user) {
      if (session.get(SESSION_KEY)) session.remove(SESSION_KEY); // account no longer exists
      appView.hidden = true;
      loginView.hidden = false;
      document.title = 'Sign in | Daybook';
      return;
    }

    loginView.hidden = true;
    appView.hidden = false;

    setText('userAvatar', initials(user.name));
    setText('userName', user.name);
    setText('userRole', user.role === 'manager' ? 'Manager' : 'Employee');

    var isManager = user.role === 'manager';
    $('#managerView').hidden = !isManager;
    $('#employeeView').hidden = isManager;

    if (isManager) {
      document.title = 'Team tasks | Daybook';
      renderManager();
    } else {
      document.title = 'My tasks | Daybook';
      renderEmployee(user);
    }
  }

  /* ---------------- Day change check ---------------- */
  var currentDay = todayKey();

  function checkNewDay() {
    var t = todayKey();
    if (t === currentDay) return;
    currentDay = t;
    var moved = rollOver();
    render();
    if (moved) toast(plural(moved, 'unfinished task') + ' moved to today.');
  }

  /* ---------------- Init ---------------- */
  function init() {
    data = loadData();
    rollOver();

    // Login
    document.querySelectorAll('.role-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setRole(btn.getAttribute('data-role')); });
    });
    document.querySelectorAll('.demo-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        setRole(chip.getAttribute('data-role'));
        $('#loginUser').value = chip.getAttribute('data-user');
        $('#loginPass').value = chip.getAttribute('data-pass');
        $('#loginSubmit').focus();
      });
    });
    $('#togglePw').addEventListener('click', function () {
      var input = $('#loginPass');
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      this.textContent = show ? 'Hide' : 'Show';
      this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    $('#loginForm').addEventListener('submit', handleLogin);
    $('#logoutBtn').addEventListener('click', logout);

    // Manager
    $('#taskForm').addEventListener('submit', handleAssignTask);
    $('#empForm').addEventListener('submit', handleAddEmployee);
    $('#teamList').addEventListener('click', handleTeamClick);
    $('#taskBoard').addEventListener('click', handleBoardClick);
    $('#filterEmployee').addEventListener('change', function () { boardEmployee = this.value; renderBoard(); });
    $('#filterScope').addEventListener('change', function () { boardScope = this.value; renderBoard(); });
    $('#resetBtn').addEventListener('click', handleReset);
    ['#taskTitle', '#taskEmployee', '#taskDate'].forEach(function (sel) {
      $(sel).addEventListener('input', function () { setText('taskError', ''); });
    });
    ['#empName', '#empUser', '#empPass'].forEach(function (sel) {
      $(sel).addEventListener('input', function () { setText('empError', ''); });
    });

    // Employee
    $('#empTodayList').addEventListener('change', handleToggleTask);

    // Keep in sync when another tab changes the data (e.g. manager and employee in two tabs)
    window.addEventListener('storage', function (e) {
      if (e.key !== DATA_KEY) return;
      data = loadData();
      rollOver();
      render();
    });

    // Carry unfinished tasks over when the date changes
    setInterval(checkNewDay, 30000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkNewDay();
    });

    setRole('manager');
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
