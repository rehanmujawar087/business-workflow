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

  function makeTask(employeeId, title, description, priority, date, completed, extra) {
    extra = extra || {};
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
      createdAt: Date.now(),
      category: extra.category ? String(extra.category) : '',   // used by the ML model
      estimatedHours: toHours(extra.estimatedHours),             // used by the ML model
      actualHours: toHours(extra.actualHours)                    // logged by the employee
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
        makeTask('u_rahul', 'Call back pending customers', 'Five customers from last week are waiting for a quote.', 'high', y, false, { category: 'Client Onboarding', estimatedHours: 3, actualHours: 1 }),
        makeTask('u_rahul', 'Prepare the daily sales summary', 'Share it on the team group before 6 pm.', 'medium', t, false, { category: 'Market Research', estimatedHours: 2 }),
        makeTask('u_rahul', 'Restock the front shelf', '', 'low', t, true, { category: 'Inventory Update', estimatedHours: 1, actualHours: 1 }),
        makeTask('u_rahul', 'Visit the supplier for the new order', 'Carry the signed purchase order.', 'medium', tm, false, { category: 'Inventory Update', estimatedHours: 4 }),
        makeTask('u_priya', 'Design the weekend offer poster', '', 'medium', y, true, { category: 'UI Design', estimatedHours: 5, actualHours: 6 }),
        makeTask('u_priya', 'Update the inventory spreadsheet', 'Add the items received on Monday.', 'high', t, true, { category: 'Inventory Update', estimatedHours: 2, actualHours: 2 }),
        makeTask('u_priya', 'Reply to customer emails', '', 'medium', t, false, { category: 'Client Onboarding', estimatedHours: 1 })
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
    ensureKeys();                                // gives users their Firebase node name (employee0, manager1, ...)
    local.set(DATA_KEY, JSON.stringify(data));
    Cloud.push();                                // send the change to Firebase
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
    if (task.category) html += '<span class="tag">' + esc(task.category) + '</span>';
    var hrs = hoursText(task, !options.hideSpent);
    if (hrs) html += '<span class="tag">' + esc(hrs) + '</span>';
    if (options.showPrediction && !task.completed) {
      var pred = Model.predictTask(task);
      if (pred) {
        html += '<span class="tag tag-ml' + (pred.label === 'Blocked' ? ' tag-ml-risk' : '') +
          '" title="Status predicted by your trained model">Model: ' + esc(pred.label) + ' ' + Math.round(pred.prob * 100) + '%</span>';
      }
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

    // Wait for the first download from Firebase so accounts made on other devices can sign in
    if (!Cloud.isReady()) {
      var submitBtn = $('#loginSubmit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Connecting to database…';
      Cloud.whenReady(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in as ' + selectedRole;
        handleLogin(event);
      });
      return;
    }

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
    setManagerTab('dashboard');
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
    fillCategorySelect();
    renderAnalytics();
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
            '<div class="task-tags">' + tagsHtml(task, { showEmployee: true, showDate: showDate, showPrediction: true }) + '</div>' +
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
    var category = $('#taskCategory').value;
    var hoursRaw = $('#taskHours').value.trim();
    var estimatedHours = toHours(hoursRaw);
    if (hoursRaw !== '' && estimatedHours === null) { errorEl.textContent = 'Estimated hours must be a number from 0 to 999.'; $('#taskHours').focus(); return; }

    errorEl.textContent = '';
    data.tasks.push(makeTask(employeeId, title, description, priority, date, false, { category: category, estimatedHours: estimatedHours }));
    saveData();

    var emp = findUser(employeeId);
    $('#taskTitle').value = '';
    $('#taskDesc').value = '';
    $('#taskPriority').value = 'medium';
    $('#taskCategory').value = '';
    $('#taskHours').value = '';
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
              '<div class="task-tags">' + tagsHtml(task, { showEmployee: false, showDate: false, hideSpent: true }) + '</div>' +
              '<div class="hours-log">' +
                '<label for="hrs-' + esc(task.id) + '">Hours spent</label>' +
                '<input type="number" id="hrs-' + esc(task.id) + '" data-hours-id="' + esc(task.id) + '" min="0" max="999" step="0.5" inputmode="decimal" placeholder="0" value="' + (task.actualHours != null ? esc(task.actualHours) : '') + '">' +
              '</div>' +
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
     FIREBASE REALTIME DATABASE SYNC
     Database layout:
       /managers/manager1, manager2, ...
            { id, name, username, password, role }
       /employees/employee0, employee1, ...
            { id, name, username, password, role,
              tasks: { <taskId>: { title, description, priority, date, ... } } }
     The browser copy (localStorage) still works on its own; Firebase is the
     shared copy every device reads from and writes to.
     ========================================================= */
  var FIREBASE_URL = 'https://business-273f6-default-rtdb.firebaseio.com';

  /* Give every user a stable node name: employees start at employee0,
     managers start at manager1. Existing names are never changed. */
  function ensureKeys() {
    if (!data || !Array.isArray(data.users)) return;
    var maxEmployee = -1;
    var maxManager = 0;
    data.users.forEach(function (u) {
      var m = /^(employee|manager)(\d+)$/.exec(u.fbKey || '');
      if (!m) return;
      var n = parseInt(m[2], 10);
      if (m[1] === 'employee') maxEmployee = Math.max(maxEmployee, n);
      else maxManager = Math.max(maxManager, n);
    });
    data.users.forEach(function (u) {
      var valid = u.role === 'manager' ? /^manager\d+$/.test(u.fbKey || '') : /^employee\d+$/.test(u.fbKey || '');
      if (valid) return;
      if (u.role === 'manager') { maxManager++; u.fbKey = 'manager' + maxManager; }
      else { maxEmployee++; u.fbKey = 'employee' + maxEmployee; }
    });

    // Tasks inside each employee node: task0, task1, task2, ... (numbered per employee)
    if (!Array.isArray(data.tasks)) return;
    var used = {};
    var next = {};
    data.tasks.forEach(function (t) {
      var m = /^task(\d+)$/.exec(t.fbKey || '');
      if (!m) return;
      var e = t.employeeId;
      used[e] = used[e] || {};
      if (used[e][t.fbKey]) { t.fbKey = null; return; }   // duplicate number: renumber below
      used[e][t.fbKey] = true;
      next[e] = Math.max(next[e] || 0, parseInt(m[1], 10) + 1);
    });
    data.tasks.slice()
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); })
      .forEach(function (t) {
        if (/^task\d+$/.test(t.fbKey || '')) return;
        var n = next[t.employeeId] || 0;
        t.fbKey = 'task' + n;
        next[t.employeeId] = n + 1;
      });
  }

  var Cloud = (function () {
    var lastSynced = null;   // what Firebase holds, as { path: jsonString }; null until first download
    var ready = false;
    var waiters = [];
    var pushing = false;
    var pendingPush = false;
    var pushFailed = false;
    var refreshTimer = null;
    var pill = null;

    /* ---------- Status indicator ---------- */
    function setStatus(state, text) {
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'sync-pill';
        pill.setAttribute('role', 'status');
        document.body.appendChild(pill);
      }
      pill.setAttribute('data-state', state);
      pill.textContent = text;
      pill.title = text;
    }

    function errorText(err) {
      if (err && (err.status === 401 || err.status === 403)) {
        return 'Firebase refused access. Check the database rules.';
      }
      return 'Offline. Changes are saved in this browser.';
    }

    function markReady() {
      if (ready) return;
      ready = true;
      waiters.splice(0).forEach(function (fn) { fn(); });
    }

    /* ---------- REST requests ---------- */
    function request(method, path, body) {
      var options = { method: method };
      if (body !== undefined) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
      }
      if (typeof window.fetch !== 'function') return Promise.reject(new Error('fetch is not supported'));
      return window.fetch(FIREBASE_URL + '/' + path + '.json', options).then(function (res) {
        if (!res.ok) {
          var err = new Error('Firebase request failed (' + res.status + ')');
          err.status = res.status;
          throw err;
        }
        return res.json();
      });
    }

    function pull() {
      return Promise.all([request('GET', 'employees'), request('GET', 'managers')]).then(function (r) {
        return {
          employees: r[0] && typeof r[0] === 'object' ? r[0] : {},
          managers: r[1] && typeof r[1] === 'object' ? r[1] : {}
        };
      });
    }

    /* ---------- Converting between Firebase nodes and app data ---------- */
    function userFromNode(node, key, role) {
      return {
        id: node.id ? String(node.id) : 'u_' + key,
        name: String(node.name || key),
        username: String(node.username || key).toLowerCase(),
        password: String(node.password == null ? '' : node.password),
        role: role,
        fbKey: key
      };
    }

    function taskFromNode(node, key, employeeId, employeeKey) {
      var validDate = function (d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d); };
      var date = validDate(node.date) ? node.date : todayKey();
      return {
        id: node.id ? String(node.id) : employeeKey + '_' + key,
        fbKey: key,
        employeeId: employeeId,
        title: String(node.title || 'Untitled task'),
        description: String(node.description || ''),
        priority: PRIORITY_LABEL[node.priority] ? node.priority : 'medium',
        date: date,
        originalDate: validDate(node.originalDate) ? node.originalDate : date,
        completed: node.completed === true,
        completedAt: validDate(node.completedAt) ? node.completedAt : null,
        createdAt: Number(node.createdAt) || 0,
        category: typeof node.category === 'string' ? node.category : '',
        estimatedHours: toHours(node.estimatedHours),
        actualHours: toHours(node.actualHours)
      };
    }

    function fromTree(tree) {
      var users = [];
      var tasks = [];
      Object.keys(tree.managers).forEach(function (key) {
        var node = tree.managers[key];
        if (node && typeof node === 'object') users.push(userFromNode(node, key, 'manager'));
      });
      Object.keys(tree.employees).forEach(function (key) {
        var node = tree.employees[key];
        if (!node || typeof node !== 'object') return;
        var user = userFromNode(node, key, 'employee');
        users.push(user);
        var taskNodes = node.tasks && typeof node.tasks === 'object' ? node.tasks : {};
        Object.keys(taskNodes).forEach(function (taskKey) {
          var t = taskNodes[taskKey];
          if (t && typeof t === 'object') tasks.push(taskFromNode(t, taskKey, user.id, key));
        });
      });
      return { users: users, tasks: tasks };
    }

    function taskNode(t) {
      var node = {
        id: t.id,
        employeeId: t.employeeId,
        title: t.title,
        description: t.description || '',
        priority: t.priority,
        date: t.date,
        originalDate: t.originalDate || t.date,
        completed: Boolean(t.completed),
        createdAt: t.createdAt || 0
      };
      if (t.completedAt) node.completedAt = t.completedAt;
      if (t.category) node.category = t.category;
      if (t.estimatedHours != null) node.estimatedHours = t.estimatedHours;
      if (t.actualHours != null) node.actualHours = t.actualHours;
      return node;
    }

    /* Flatten app data into Firebase paths, e.g.
       "employees/employee0/name" or "employees/employee0/tasks/<id>" */
    function flatten(d) {
      var out = {};
      var baseOf = {};
      d.users.forEach(function (u) {
        if (!u.fbKey) return;
        var base = (u.role === 'manager' ? 'managers/' : 'employees/') + u.fbKey;
        baseOf[u.id] = base;
        out[base + '/id'] = JSON.stringify(u.id);
        out[base + '/name'] = JSON.stringify(u.name);
        out[base + '/username'] = JSON.stringify(u.username);
        out[base + '/password'] = JSON.stringify(u.password);
        out[base + '/role'] = JSON.stringify(u.role);
      });
      d.tasks.forEach(function (t) {
        var base = baseOf[t.employeeId];
        if (!base || base.indexOf('employees/') !== 0 || !t.fbKey) return;
        out[base + '/tasks/' + t.fbKey] = JSON.stringify(taskNode(t));
      });
      return out;
    }

    function mapsEqual(a, b) {
      var ak = Object.keys(a);
      if (ak.length !== Object.keys(b).length) return false;
      for (var i = 0; i < ak.length; i++) {
        if (a[ak[i]] !== b[ak[i]]) return false;
      }
      return true;
    }

    /* ---------- Upload: only the paths that changed ---------- */
    function push() {
      if (lastSynced === null) return;            // first download not finished yet
      if (pushing) { pendingPush = true; return; }

      ensureKeys();
      var current = flatten(data);
      var body = {};
      var changed = 0;
      Object.keys(current).forEach(function (path) {
        if (lastSynced[path] !== current[path]) { body[path] = JSON.parse(current[path]); changed++; }
      });
      Object.keys(lastSynced).forEach(function (path) {
        if (!Object.prototype.hasOwnProperty.call(current, path)) { body[path] = null; changed++; }
      });
      if (!changed) return;

      pushing = true;
      setStatus('saving', 'Saving to Firebase…');
      request('PATCH', '', body).then(function () {
        lastSynced = current;
        pushFailed = false;
        setStatus('ok', 'Synced with Firebase');
      }).catch(function (err) {
        pushFailed = true;
        setStatus('error', errorText(err));
      }).then(function () {
        pushing = false;
        if (pendingPush) { pendingPush = false; push(); }
      });
    }

    /* ---------- Download: replace the browser copy with Firebase ---------- */
    function applyTree(tree) {
      var wasReady = ready;
      var remote = fromTree(tree);

      if (!remote.users.length) {
        // Empty database: upload what this browser has (demo data the first time)
        lastSynced = {};
        saveData();
        markReady();
        return;
      }

      var serverMap = flatten(remote);

      // Always keep at least one manager so someone can sign in
      if (!remote.users.some(function (u) { return u.role === 'manager'; })) {
        data.users.forEach(function (u) { if (u.role === 'manager') remote.users.push(u); });
      }

      var changed = !mapsEqual(flatten(remote), flatten(data));
      lastSynced = serverMap;
      data = remote;
      local.set(DATA_KEY, JSON.stringify(data));
      rollOver();   // move unfinished past tasks to today (uploads if anything moved)
      push();       // upload anything still missing on the server
      if (changed || !wasReady) render();
      markReady();
    }

    function refresh() {
      refreshTimer = null;
      if (pushFailed && lastSynced !== null) { pushFailed = false; push(); return; }
      if (pushing || pendingPush) { scheduleRefresh(800); return; }
      pull().then(function (tree) {
        if (pushing || pendingPush) { scheduleRefresh(800); return; }
        applyTree(tree);
        if (!pushing && !pushFailed) setStatus('ok', 'Synced with Firebase');
      }).catch(function (err) {
        setStatus('error', errorText(err));
        markReady();   // sign-in still works with the browser copy
      });
    }

    function scheduleRefresh(delay) {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, delay == null ? 300 : delay);
    }

    /* Live updates: Firebase streams changes, then we download the new data */
    function listen() {
      if (typeof window.EventSource !== 'function') return;
      ['employees', 'managers'].forEach(function (node) {
        try {
          var es = new EventSource(FIREBASE_URL + '/' + node + '.json');
          es.addEventListener('put', function () { scheduleRefresh(); });
          es.addEventListener('patch', function () { scheduleRefresh(); });
          es.addEventListener('cancel', function () { es.close(); });
        } catch (e) { /* polling below still keeps data fresh */ }
      });
    }

    function start() {
      setStatus('connecting', 'Connecting to Firebase…');
      scheduleRefresh(0);
      listen();
      setInterval(function () { scheduleRefresh(0); }, 20000);  // safety net if live updates drop
      setTimeout(markReady, 6000);                               // never block sign-in for long
    }

    return {
      start: start,
      push: push,
      request: request,
      isReady: function () { return ready; },
      whenReady: function (fn) { if (ready) fn(); else waiters.push(fn); }
    };
  })();

  /* =========================================================
     EMPLOYEE ANALYTICS + ML MODEL (businessworkflow.ipynb)
     The notebook trains a Logistic Regression that predicts a
     task's Status. Its export cell saves the trained model as
     daybook_model.json; the manager loads that file here and the
     app runs the same pipeline (mean imputer + one-hot encoder +
     logistic regression) on live tasks.
     ========================================================= */
  var ML_KEY = 'daybook.model.v1';
  var DATASET_CATEGORIES = ['Bug Fix', 'UI Design', 'Inventory Update', 'Code Review',
    'Client Onboarding', 'Market Research', 'Content Creation', 'Invoicing'];
  var DATASET_PRIORITY = { high: 'High', medium: 'Medium', low: 'Low' };
  var CHART_COLORS = ['#1F7A6D', '#52709A', '#D9921A', '#B8434B', '#6F8F5A',
    '#8B6FA3', '#44546A', '#C7A63A', '#3F9BB0', '#A0674B'];

  /* ---------------- Small helpers ---------------- */
  function toHours(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    if (!isFinite(n) || n < 0 || n > 999) return null;
    return Math.round(n * 10) / 10;
  }

  function fmtNum(n) { return String(Math.round((Number(n) || 0) * 10) / 10); }

  function hoursText(task, withSpent) {
    var est = task.estimatedHours;
    var spent = withSpent ? task.actualHours : null;
    if (est != null && spent != null) return 'Spent ' + fmtNum(spent) + ' of ' + fmtNum(est) + ' h';
    if (est != null) return 'Est. ' + fmtNum(est) + ' h';
    if (spent != null) return 'Spent ' + fmtNum(spent) + ' h';
    return '';
  }

  function pctText(v) {
    return typeof v === 'number' && isFinite(v) ? (v * 100).toFixed(1) + '%' : '–';
  }

  function sumHours(list, field) {
    return list.reduce(function (s, t) { return s + (t[field] != null ? Number(t[field]) || 0 : 0); }, 0);
  }

  function isOnTime(task) {
    return task.completed && (task.completedAt || task.date) <= (task.originalDate || task.date);
  }

  function pairs(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter(function (p) { return Array.isArray(p) && p.length >= 2; })
      .map(function (p) { return [String(p[0]), Number(p[1]) || 0]; });
  }

  /* ---------------- Charts (plain HTML/CSS, no library) ---------------- */
  function barList(items, colorFor) {
    if (!items.length) return '<p class="small-empty">No data yet.</p>';
    var max = Math.max.apply(null, items.map(function (i) { return i[1]; }).concat([1]));
    return '<ul class="bar-list">' + items.map(function (item, i) {
      var color = colorFor ? colorFor(item[0], i) : CHART_COLORS[i % CHART_COLORS.length];
      return '<li>' +
        '<span class="bar-label" title="' + esc(item[0]) + '">' + esc(item[0]) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + ((item[1] / max) * 100).toFixed(1) + '%;background:' + color + '"></span></span>' +
        '<span class="bar-value">' + esc(fmtNum(item[1])) + '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function columnChart(items, options) {
    options = options || {};
    if (!items.length) return '<p class="small-empty">No data yet.</p>';
    var max = Math.max.apply(null, items.map(function (i) { return i[1]; }).concat([1]));
    return '<div class="cols' + (options.dense ? ' cols-dense' : '') + '">' + items.map(function (item) {
      var h = item[1] > 0 ? Math.max(2, (item[1] / max) * 100) : 0;
      return '<div class="col" title="' + esc(item[2] || item[0]) + ': ' + esc(fmtNum(item[1])) + '">' +
        '<div class="col-plot"><span class="col-bar" style="height:' + h.toFixed(1) + '%">' +
          (options.dense ? '' : '<span class="col-value">' + esc(fmtNum(item[1])) + '</span>') +
        '</span></div>' +
        (options.dense ? '' : '<span class="col-label">' + esc(item[0]) + '</span>') +
      '</div>';
    }).join('') + '</div>';
  }

  function histogram(hist) {
    if (!hist || !Array.isArray(hist.counts) || !Array.isArray(hist.edges) || hist.edges.length !== hist.counts.length + 1) {
      return '<p class="small-empty">No data in the model file.</p>';
    }
    var items = hist.counts.map(function (c, i) {
      return ['', Number(c) || 0, fmtNum(hist.edges[i]) + '–' + fmtNum(hist.edges[i + 1]) + ' h'];
    });
    var first = hist.edges[0];
    var last = hist.edges[hist.edges.length - 1];
    return columnChart(items, { dense: true }) +
      '<div class="axis"><span>' + esc(fmtNum(first)) + ' h</span><span>' + esc(fmtNum((first + last) / 2)) + ' h</span><span>' + esc(fmtNum(last)) + ' h</span></div>';
  }

  function donut(items) {
    var total = items.reduce(function (s, i) { return s + i[1]; }, 0);
    if (!total) return '<p class="small-empty">No data yet.</p>';
    var acc = 0;
    var stops = items.map(function (item, i) {
      var start = (acc / total) * 100;
      acc += item[1];
      var end = (acc / total) * 100;
      return CHART_COLORS[i % CHART_COLORS.length] + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%';
    });
    return '<div class="donut-wrap">' +
      '<div class="donut" style="background:conic-gradient(' + stops.join(',') + ')" role="img" aria-label="Share of tasks by category">' +
        '<span><strong>' + esc(fmtNum(total)) + '</strong>tasks</span>' +
      '</div>' +
      '<ul class="legend">' + items.map(function (item, i) {
        return '<li><i style="background:' + CHART_COLORS[i % CHART_COLORS.length] + '"></i><span>' + esc(item[0]) +
          '</span><span>' + ((item[1] / total) * 100).toFixed(1) + '%</span></li>';
      }).join('') + '</ul>' +
    '</div>';
  }

  function corrColor(v) {
    var x = Math.max(-1, Math.min(1, Number(v) || 0));
    var t = Math.abs(x);
    var end = x >= 0 ? [180, 4, 38] : [59, 76, 192];
    var base = [242, 243, 240];
    return 'rgb(' + base.map(function (b, i) { return Math.round(b + (end[i] - b) * t); }).join(',') + ')';
  }

  function heatmap(corr) {
    if (!corr || !Array.isArray(corr.labels) || !Array.isArray(corr.matrix)) return '<p class="small-empty">No data in the model file.</p>';
    var labels = corr.labels.map(function (l) { return String(l).replace(/_/g, ' '); });
    var n = labels.length;
    var html = '<div class="heatmap" style="grid-template-columns:minmax(120px,auto) repeat(' + n + ',minmax(52px,1fr))">';
    html += '<span></span>' + labels.map(function (l) { return '<span class="hm-col">' + esc(l) + '</span>'; }).join('');
    corr.matrix.forEach(function (row, r) {
      html += '<span class="hm-label">' + esc(labels[r] || '') + '</span>';
      for (var c = 0; c < n; c++) {
        var v = Array.isArray(row) ? Number(row[c]) : NaN;
        var ok = isFinite(v);
        html += '<span class="hm-cell" style="background:' + (ok ? corrColor(v) : 'var(--track)') + ';color:' + (ok && Math.abs(v) > 0.55 ? '#fff' : 'var(--ink)') +
          '" title="' + esc(labels[r] + ' vs ' + labels[c]) + '">' + (ok ? v.toFixed(2) : '–') + '</span>';
      }
    });
    return html + '</div>';
  }

  function statItems(items) {
    return items.map(function (i) { return '<div><dt>' + esc(i[0]) + '</dt><dd>' + esc(i[1]) + '</dd></div>'; }).join('');
  }

  /* ---------------- Model: load, validate, predict ---------------- */
  var Model = (function () {
    var current = null;
    var rawText = null;
    var checkResult = null;

    function sigmoid(z) {
      if (z < -35) return 0;
      if (z > 35) return 1;
      return 1 / (1 + Math.exp(-z));
    }

    function numArray(a, len) {
      return Array.isArray(a) && (len == null || a.length === len) &&
        a.every(function (v) { return typeof v === 'number' && isFinite(v); });
    }

    function validate(m) {
      var notExport = 'This file is not a Daybook model export. Run the export cell at the end of businessworkflow.ipynb and load the daybook_model.json it downloads.';
      if (!m || typeof m !== 'object' || m.format !== 'daybook-ml-v1' || !m.model || typeof m.model !== 'object') throw new Error(notExport);
      var mm = m.model;
      if (!Array.isArray(mm.classes) || mm.classes.length < 2 ||
          !Array.isArray(mm.numericFeatures) || !Array.isArray(mm.categoricalFeatures) ||
          !Array.isArray(mm.categories) || mm.categories.length !== mm.categoricalFeatures.length ||
          !mm.categories.every(Array.isArray)) {
        throw new Error(notExport);
      }
      if (!numArray(mm.numericMeans, mm.numericFeatures.length)) throw new Error('The model file is damaged: the imputer values are missing.');
      var width = mm.numericFeatures.length + mm.categories.reduce(function (s, c) { return s + c.length; }, 0);
      var rowsOk = Array.isArray(mm.coef) &&
        (mm.coef.length === mm.classes.length || (mm.classes.length === 2 && mm.coef.length === 1));
      if (!rowsOk) throw new Error('The model file is damaged: the coefficients do not match the number of statuses.');
      if (!mm.coef.every(function (r) { return numArray(r, width); })) throw new Error('The model file is damaged: the coefficients do not match the features.');
      if (!numArray(mm.intercept, mm.coef.length)) throw new Error('The model file is damaged: the intercepts are missing.');
      mm.classes = mm.classes.map(String);
      mm.categories = mm.categories.map(function (c) { return c.map(String); });
      return m;
    }

    // Same order as the notebook's ColumnTransformer: numeric columns first, then one-hot columns
    function vectorize(m, row) {
      var mm = m.model;
      var x = [];
      mm.numericFeatures.forEach(function (f, i) {
        var v = row[f];
        var n = (v === null || v === undefined || v === '') ? NaN : Number(v);
        x.push(isFinite(n) ? n : mm.numericMeans[i]);              // SimpleImputer(strategy='mean')
      });
      mm.categoricalFeatures.forEach(function (f, j) {
        var v = row[f] == null ? null : String(row[f]);
        mm.categories[j].forEach(function (c) { x.push(v === c ? 1 : 0); });   // OneHotEncoder(handle_unknown='ignore')
      });
      return x;
    }

    function predictRow(m, row) {
      var mm = m.model;
      var x = vectorize(m, row);
      var scores = mm.coef.map(function (w, k) {
        var s = mm.intercept[k];
        for (var i = 0; i < w.length; i++) s += w[i] * x[i];
        return s;
      });
      var probs;
      if (scores.length === 1) {
        var p1 = sigmoid(scores[0]);
        probs = [1 - p1, p1];
      } else if (m.model.probability === 'softmax') {
        var max = Math.max.apply(null, scores);
        var ex = scores.map(function (s) { return Math.exp(s - max); });
        var sumE = ex.reduce(function (a, b) { return a + b; }, 0);
        probs = ex.map(function (e) { return e / sumE; });
      } else {
        var sg = scores.map(sigmoid);                                   // one-vs-rest (liblinear)
        var sumS = sg.reduce(function (a, b) { return a + b; }, 0) || 1;
        probs = sg.map(function (v) { return v / sumS; });
      }
      var best = 0;
      for (var k = 1; k < probs.length; k++) if (probs[k] > probs[best]) best = k;
      return {
        label: mm.classes[best],
        prob: probs[best],
        probs: mm.classes.map(function (c, i) { return [c, probs[i]]; })
      };
    }

    function runCheck(m) {
      if (!Array.isArray(m.check) || !m.check.length) return null;
      var match = 0;
      var total = 0;
      m.check.forEach(function (c) {
        if (!c || typeof c.features !== 'object' || c.predicted == null) return;
        total++;
        if (predictRow(m, c.features).label === String(c.predicted)) match++;
      });
      return total ? { match: match, total: total } : null;
    }

    function apply(text) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) {
        throw new Error('This file is not valid JSON. Load the daybook_model.json file created by the notebook.');
      }
      var m = validate(parsed);
      current = m;
      rawText = text;
      checkResult = runCheck(m);
      return m;
    }

    function clear() { current = null; rawText = null; checkResult = null; }

    function saveCache(uploaded) {
      if (rawText === null) { local.remove(ML_KEY); return; }
      local.set(ML_KEY, JSON.stringify({ text: rawText, uploaded: Boolean(uploaded) }));
    }

    function readCache() {
      try { var c = JSON.parse(local.get(ML_KEY) || 'null'); return c && typeof c.text === 'string' ? c : null; }
      catch (e) { return null; }
    }

    function loadCached() {
      var c = readCache();
      if (!c) return;
      try { apply(c.text); } catch (e) { local.remove(ML_KEY); }
    }

    function uploadCurrent(fileName) {
      return Cloud.request('PUT', 'mlModel', { json: rawText, fileName: fileName || '', uploadedAt: Date.now() })
        .then(function () { saveCache(true); return true; })
        .catch(function () { return false; });
    }

    /* Firebase keeps the shared copy at /mlModel so every manager device gets it */
    function syncFromCloud() {
      return Cloud.request('GET', 'mlModel').then(function (node) {
        var cache = readCache();
        if (node && typeof node.json === 'string') {
          if (node.json === rawText) { saveCache(true); return; }
          try { apply(node.json); saveCache(true); render(); } catch (e) { /* ignore a broken remote copy */ }
        } else if (current) {
          if (cache && cache.uploaded === false) uploadCurrent('');   // loaded while offline: upload now
          else { clear(); local.remove(ML_KEY); render(); }          // removed on another device
        }
      }).catch(function () { /* offline: keep the cached model */ });
    }

    function load(text, fileName) {
      apply(text);          // throws a readable error if the file is wrong
      saveCache(false);
      return uploadCurrent(fileName);
    }

    function remove() {
      clear();
      local.remove(ML_KEY);
      return Cloud.request('DELETE', 'mlModel').then(function () { return true; }).catch(function () { return false; });
    }

    function taskToRow(task) {
      var emp = findUser(task.employeeId);
      var createdKey = task.createdAt ? toKey(new Date(task.createdAt)) : (task.originalDate || task.date);
      var due = task.originalDate || task.date;
      return {
        Category: task.category || null,
        Assignee: emp ? emp.name : null,
        Priority: DATASET_PRIORITY[task.priority] || 'Medium',
        Estimated_Hours: task.estimatedHours,
        Actual_Hours: task.actualHours,
        Planned_Duration_Days: Math.max(0, daysBetween(createdKey, due)),
        Actual_Duration_Days: task.completed && task.completedAt ? Math.max(0, daysBetween(createdKey, task.completedAt)) : null
      };
    }

    return {
      current: function () { return current; },
      checkResult: function () { return checkResult; },
      predictTask: function (task) { return current ? predictRow(current, taskToRow(task)) : null; },
      categoriesFor: function (feature) {
        if (!current) return null;
        var i = current.model.categoricalFeatures.indexOf(feature);
        return i === -1 ? null : current.model.categories[i].slice();
      },
      loadCached: loadCached,
      syncFromCloud: syncFromCloud,
      load: load,
      remove: remove
    };
  })();

  /* ---------------- Manager tabs ---------------- */
  var managerTab = 'dashboard';

  function setManagerTab(tab) {
    managerTab = tab === 'analytics' ? 'analytics' : 'dashboard';
    document.querySelectorAll('.view-tab').forEach(function (btn) {
      var active = btn.getAttribute('data-tab') === managerTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    var dash = $('#mgrDashboard');
    var an = $('#mgrAnalytics');
    if (dash) dash.hidden = managerTab !== 'dashboard';
    if (an) an.hidden = managerTab !== 'analytics';
    if (managerTab === 'analytics') {
      renderAnalytics();
      Model.syncFromCloud();
    }
  }

  function fillCategorySelect() {
    var sel = $('#taskCategory');
    if (!sel) return;
    var prev = sel.value;
    var cats = Model.categoriesFor('Category') || DATASET_CATEGORIES;
    sel.innerHTML = '<option value="">Not set</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
    if (cats.indexOf(prev) !== -1) sel.value = prev;
  }

  /* ---------------- Analytics rendering ---------------- */
  function renderAnalytics() {
    var panel = $('#mgrAnalytics');
    if (!panel || panel.hidden) return;

    var t = todayKey();
    var team = employees();
    var teamIds = team.map(function (e) { return e.id; });
    var all = data.tasks.filter(function (x) { return teamIds.indexOf(x.employeeId) !== -1; });
    var done = all.filter(function (x) { return x.completed; });
    var onTime = done.filter(isOnTime);

    $('#anStats').innerHTML = statItems([
      ['Tasks assigned', String(all.length)],
      ['Completion rate', percent(done.length, all.length) + '%'],
      ['On-time completion', done.length ? percent(onTime.length, done.length) + '%' : '–'],
      ['Hours spent / estimated', fmtNum(sumHours(all, 'actualHours')) + ' / ' + fmtNum(sumHours(all, 'estimatedHours'))]
    ]);

    // Per-employee performance table
    var rows = team.map(function (emp) {
      var mine = all.filter(function (x) { return x.employeeId === emp.id; });
      var d = mine.filter(function (x) { return x.completed; });
      return {
        emp: emp,
        total: mine.length,
        done: d.length,
        pct: percent(d.length, mine.length),
        onTime: d.length ? percent(d.filter(isOnTime).length, d.length) + '%' : '–',
        carried: mine.filter(function (x) { return !x.completed && isCarried(x); }).length,
        est: sumHours(mine, 'estimatedHours'),
        spent: sumHours(mine, 'actualHours')
      };
    }).sort(function (a, b) { return (b.pct - a.pct) || (b.done - a.done) || a.emp.name.localeCompare(b.emp.name); });

    var head = '<thead><tr><th>Employee</th><th class="num">Assigned</th><th class="num">Done</th><th>Completion</th>' +
      '<th class="num">On time</th><th class="num">Carried over</th><th class="num">Hours spent / est.</th></tr></thead>';
    var body = rows.length ? rows.map(function (r) {
      return '<tr>' +
        '<td><strong>' + esc(r.emp.name) + '</strong><br><span class="muted">@' + esc(r.emp.username) + '</span></td>' +
        '<td class="num">' + r.total + '</td>' +
        '<td class="num">' + r.done + '</td>' +
        '<td><div class="cell-bar"><span class="meter meter-sm"><span style="width:' + r.pct + '%"></span></span><strong>' + r.pct + '%</strong></div></td>' +
        '<td class="num">' + r.onTime + '</td>' +
        '<td class="num">' + r.carried + '</td>' +
        '<td class="num">' + esc(fmtNum(r.spent)) + ' / ' + esc(fmtNum(r.est)) + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="7" class="muted">No employees yet. Add one on the Dashboard tab.</td></tr>';
    $('#anEmployeeTable').innerHTML = head + '<tbody>' + body + '</tbody>';

    // Completions in the last 7 days
    var week = [];
    for (var i = 6; i >= 0; i--) {
      var key = addDays(t, -i);
      var count = done.filter(function (x) { return x.completedAt === key; }).length;
      var label = i === 0 ? 'Today' : fromKey(key).toLocaleDateString('en-IN', { weekday: 'short' });
      week.push([label, count, formatShort(key)]);
    }
    $('#anWeek').innerHTML = columnChart(week);

    // Tasks by category and by priority
    var catCounts = {};
    all.forEach(function (x) { var c = x.category || 'Not set'; catCounts[c] = (catCounts[c] || 0) + 1; });
    var catItems = Object.keys(catCounts).map(function (k) { return [k, catCounts[k]]; })
      .sort(function (a, b) { return (a[0] === 'Not set') - (b[0] === 'Not set') || b[1] - a[1]; });
    $('#anCategory').innerHTML = barList(catItems);

    var prioColors = { High: '#B8434B', Medium: '#52709A', Low: '#A9B3A6' };
    $('#anPriority').innerHTML = barList(['high', 'medium', 'low'].map(function (p) {
      return [DATASET_PRIORITY[p], all.filter(function (x) { return x.priority === p; }).length];
    }), function (label) { return prioColors[label]; });

    renderModelPanel(all);
  }

  function renderModelPanel(all) {
    var m = Model.current();
    $('#mlEmpty').hidden = Boolean(m);
    $('#mlLoaded').hidden = !m;
    $('#mlRemove').hidden = !m;
    $('#edaPanel').hidden = !(m && m.eda);
    setText('mlFileLabel', m ? 'Replace model file' : 'Load model file');

    if (!m) {
      setText('mlSub', 'No model loaded');
      return;
    }

    var metrics = m.metrics || {};
    var trained = m.trainedAt ? new Date(m.trainedAt) : null;
    setText('mlSub', (m.model.type || 'Logistic Regression') + ' predicting ' + (m.target || 'Status') +
      (trained && !isNaN(trained) ? ', trained ' + trained.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '') +
      (metrics.trainSize ? ' on ' + metrics.trainSize + ' tasks' : ''));

    var check = Model.checkResult();
    $('#mlMetrics').innerHTML = statItems([
      ['Test accuracy', pctText(metrics.accuracy)],
      ['Precision (weighted)', pctText(metrics.precisionWeighted)],
      ['F1 score (weighted)', pctText(metrics.f1Weighted)],
      ['Matches notebook', check ? check.match + ' of ' + check.total : '–']
    ]);

    var note = $('#mlCheckNote');
    if (check && check.match < check.total) {
      note.textContent = 'Some predictions here differ from the notebook. Run the notebook again from the top, then re-export and load the new file.';
      note.classList.add('is-warn');
    } else {
      note.textContent = check
        ? 'The app reproduced the notebook\'s predictions on ' + check.total + ' test tasks, so it is using the same trained model.'
        : '';
      note.classList.remove('is-warn');
    }

    var per = Array.isArray(metrics.perClass) ? metrics.perClass : [];
    $('#mlReport').innerHTML = '<thead><tr><th>Status</th><th class="num">Precision</th><th class="num">Recall</th><th class="num">F1</th><th class="num">Test tasks</th></tr></thead><tbody>' +
      (per.length ? per.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + pctText(r[1]) + '</td><td class="num">' + pctText(r[2]) +
          '</td><td class="num">' + pctText(r[3]) + '</td><td class="num">' + esc(r[4]) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">The model file has no per-status results.</td></tr>') + '</tbody>';

    // Predictions for unfinished tasks, highest Blocked risk first
    var hasBlocked = m.model.classes.indexOf('Blocked') !== -1;
    var preds = all.filter(function (x) { return !x.completed; }).map(function (task) {
      var p = Model.predictTask(task);
      var blocked = 0;
      if (hasBlocked) p.probs.forEach(function (pc) { if (pc[0] === 'Blocked') blocked = pc[1]; });
      return { task: task, p: p, blocked: blocked };
    }).sort(function (a, b) { return hasBlocked ? b.blocked - a.blocked : b.p.prob - a.p.prob; }).slice(0, 10);

    $('#mlPredictions').innerHTML = preds.length ? preds.map(function (o) {
      var emp = findUser(o.task.employeeId);
      return '<li class="pred">' +
        '<div class="pred-main"><strong>' + esc(o.task.title) + '</strong><span class="muted">' + esc(emp ? emp.name : '') + ', ' + esc(relativeDay(o.task.date)) + '</span></div>' +
        '<div class="pred-out"><span class="tag tag-ml' + (o.p.label === 'Blocked' ? ' tag-ml-risk' : '') + '">' + esc(o.p.label) + '</span><span class="pred-prob">' + Math.round(o.p.prob * 100) + '%</span></div>' +
        (hasBlocked ? '<span class="pred-risk">Chance of being blocked: ' + Math.round(o.blocked * 100) + '%</span>' : '') +
      '</li>';
    }).join('') : '<li class="small-empty">No unfinished tasks to predict.</li>';

    // Training data insights (EDA from the notebook)
    var eda = m.eda;
    if (!eda) return;
    var missing = pairs(eda.missing).filter(function (p) { return p[1] > 0; });
    setText('edaSub', fmtNum(eda.rows || 0) + ' tasks in the training data' +
      (missing.length ? '. Missing values: ' + missing.map(function (p) { return p[0] + ' (' + p[1] + ')'; }).join(', ') : ''));
    $('#edaCategory').innerHTML = donut(pairs(eda.category));
    $('#edaPriority').innerHTML = barList(pairs(eda.priority));
    $('#edaStatus').innerHTML = barList(pairs(eda.status));
    $('#edaAssignee').innerHTML = barList(pairs(eda.assignee));
    $('#edaHours').innerHTML = histogram(eda.estimatedHours);
    $('#edaCorr').innerHTML = heatmap(eda.correlation);
  }

  /* ---------------- Model file actions ---------------- */
  function handleModelFile(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    setText('mlError', '');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setText('mlError', 'That file is larger than 5 MB. Load the daybook_model.json file created by the notebook.');
      input.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      input.value = '';
      var promise;
      try {
        promise = Model.load(String(reader.result || ''), file.name);
      } catch (err) {
        setText('mlError', err.message);
        return;
      }
      render();
      var check = Model.checkResult();
      promise.then(function (uploaded) {
        var msg = 'Model loaded' + (check ? ': ' + check.match + ' of ' + check.total + ' notebook predictions match' : '') + '.';
        if (uploaded) toast(msg + ' Saved to Firebase.', 'success');
        else toast(msg + ' Saved in this browser; the Firebase upload failed and will retry.', 'error');
      });
    };
    reader.onerror = function () {
      input.value = '';
      setText('mlError', 'The file could not be read. Try choosing it again.');
    };
    reader.readAsText(file);
  }

  function handleModelRemove() {
    if (!window.confirm('Remove the status prediction model from this app and from Firebase?')) return;
    Model.remove().then(function (ok) {
      toast(ok ? 'Model removed.' : 'Model removed from this browser. Firebase could not be reached.');
    });
    render();
  }

  function handleHoursChange(event) {
    var input = event.target;
    if (!input || input.type !== 'number' || !input.hasAttribute('data-hours-id')) return;
    var user = currentUser();
    if (!user || user.role !== 'employee') return;
    var id = input.getAttribute('data-hours-id');
    var task = null;
    for (var i = 0; i < data.tasks.length; i++) {
      if (data.tasks[i].id === id && data.tasks[i].employeeId === user.id) { task = data.tasks[i]; break; }
    }
    if (!task) return;
    var raw = input.value.trim();
    var hours = toHours(raw);
    if (raw !== '' && hours === null) {
      input.value = task.actualHours != null ? task.actualHours : '';
      toast('Enter hours as a number from 0 to 999.', 'error');
      return;
    }
    if (hours === task.actualHours) return;
    task.actualHours = hours;
    saveData();
    toast('Hours saved.');
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
    Model.loadCached();

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
    $('#empTodayList').addEventListener('change', handleHoursChange);

    // Analytics + ML model
    document.querySelectorAll('.view-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { setManagerTab(btn.getAttribute('data-tab')); });
    });
    $('#mlFile').addEventListener('change', handleModelFile);
    $('#mlRemove').addEventListener('click', handleModelRemove);

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

    // Connect to Firebase Realtime Database
    Cloud.start();
    Model.syncFromCloud();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
