(function () {
  const user = Auth.requireRole('admin');
  if (!user) return;

  document.getElementById('welcomeText').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());

  // Keep in sync with server/config/roles.js
  const ROLES_WITH_CAPACITY = [
    'Operator',
    'Spotter',
    'Split',
    'SLR',
    'Head Marshal',
    'Tech Support',
    'Kit Claiming Staff',
    'Registration Staff',
  ];
  const ALL_ROLES = [...ROLES_WITH_CAPACITY];

  const roleCounts = Object.fromEntries(ROLES_WITH_CAPACITY.map((r) => [r, 0]));

  // ---------------- Tabs ----------------
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'createlist') loadCreateList();
      if (btn.dataset.tab === 'allevents') loadAllEvents();
      if (btn.dataset.tab === 'marshallist') loadMarshalList();
    });
  });

  // ---------------- Generate Event ----------------
  const roleCounterGrid = document.getElementById('roleCounterGrid');
  ROLES_WITH_CAPACITY.forEach((role) => {
    const div = document.createElement('div');
    div.className = 'role-counter';
    div.innerHTML = `
      <span class="role-name">${role}</span>
      <div class="counter-controls">
        <button type="button" data-action="dec" data-role="${role}">−</button>
        <span class="counter-value" id="count_${slug(role)}">0</span>
        <button type="button" data-action="inc" data-role="${role}">+</button>
      </div>`;
    roleCounterGrid.appendChild(div);
  });

  roleCounterGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const role = btn.dataset.role;
    const delta = btn.dataset.action === 'inc' ? 1 : -1;
    roleCounts[role] = Math.max(0, roleCounts[role] + delta);
    document.getElementById(`count_${slug(role)}`).textContent = roleCounts[role];
  });

  const generateForm = document.getElementById('generateForm');
  const generateAlertBox = document.getElementById('generateAlertBox');

  generateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    generateAlertBox.innerHTML = '';
    const payload = {
      name: val('genName'),
      date: val('genDate'),
      location: val('genLocation'),
      teamLeader: val('genTeamLeader'),
      offsiteSupport: val('genOffsiteSupport'),
      categories: val('genCategories'),
      gunstart: val('genGunstart'),
      callTime: val('genCallTime'),
      maxRunners: val('genMaxRunners'),
      meals: val('genMeals'),
      roleCounts,
    };
    try {
      await apiRequest('/admin/events', { method: 'POST', body: payload });
      showToast('Event added — it now appears in Create List and the marshal sign-up form.', 'success');
      generateForm.reset();
      ROLES_WITH_CAPACITY.forEach((role) => {
        roleCounts[role] = 0;
        document.getElementById(`count_${slug(role)}`).textContent = 0;
      });
    } catch (err) {
      generateAlertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  // ---------------- Create List ----------------
  const createListGrid = document.getElementById('createListGrid');
  const createListAlertBox = document.getElementById('createListAlertBox');
  document.getElementById('refreshCreateList').addEventListener('click', loadCreateList);

  let allActiveEvents = [];
  let allMarshals = [];
  let assignedMap = {}; // marshalId -> { eventId, eventName, role }
  let exemptMarshalIds = new Set(); // marshalIds exempt from the single-active-event rule this cycle

  async function loadCreateList() {
    try {
      const [{ events }, { marshals }, { marshalIds }] = await Promise.all([
        apiRequest('/admin/events?status=active'),
        apiRequest('/admin/marshals'),
        apiRequest('/admin/exemptions'),
      ]);
      allActiveEvents = events;
      allMarshals = marshals;
      exemptMarshalIds = new Set(marshalIds);
      buildAssignedMap();
      renderCreateList();
    } catch (err) {
      createListAlertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  }

  async function toggleExemption(marshalId, currentlyExempt) {
    // Optimistic local update so the chip responds immediately.
    if (currentlyExempt) exemptMarshalIds.delete(marshalId);
    else exemptMarshalIds.add(marshalId);
    renderCreateList();

    try {
      if (currentlyExempt) {
        await apiRequest(`/admin/exemptions/${marshalId}`, { method: 'DELETE' });
        showToast('Exemption removed for this cycle.', 'success');
      } else {
        await apiRequest('/admin/exemptions', { method: 'POST', body: { marshalId } });
        showToast('Marshal exempted -- can now be lined up on multiple events this cycle.', 'success');
      }
    } catch (err) {
      // Revert on failure and let the user know.
      if (currentlyExempt) exemptMarshalIds.add(marshalId);
      else exemptMarshalIds.delete(marshalId);
      renderCreateList();
      showToast(err.message, 'error');
    }
  }

  function buildAssignedMap() {
    assignedMap = {};
    allActiveEvents.forEach((ev) => {
      ALL_ROLES.forEach((role) => {
        (ev.assignments[role] || []).forEach((a) => {
          assignedMap[a.marshalId] = { eventId: ev._id, eventName: ev.name, role };
        });
      });
    });
  }

  function renderCreateList() {
    // Rebuilding the grid replaces every pool card's DOM, which would
    // otherwise snap each one's scroll position back to the top on every
    // assign/unassign -- capture scrollTop per event first and restore it
    // after the rebuild below.
    const poolScrollByEventId = {};
    createListGrid.querySelectorAll('.pool-card[data-event-id]').forEach((el) => {
      poolScrollByEventId[el.dataset.eventId] = el.scrollTop;
    });

    createListGrid.innerHTML = '';
    if (allActiveEvents.length === 0) {
      createListGrid.innerHTML = '<div class="empty-state">No active events yet. Add one under "Generate Event".</div>';
      return;
    }
    allActiveEvents.forEach((ev) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'event-card-wrapper';
      wrapper.appendChild(buildEventCard(ev, { editable: true }));
      wrapper.appendChild(buildPoolCard(ev));
      createListGrid.appendChild(wrapper);
    });

    createListGrid.querySelectorAll('.pool-card[data-event-id]').forEach((el) => {
      const prev = poolScrollByEventId[el.dataset.eventId];
      if (prev) el.scrollTop = prev;
    });
  }

  function buildEventCard(ev, { editable }) {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.dataset.eventId = ev._id;

    const head = document.createElement('div');
    head.className = 'card-head';
    head.innerHTML = `<h3>${escapeHtml(ev.name)}</h3><div class="meta">${formatDate(ev.date)} &nbsp;•&nbsp; ${escapeHtml(ev.location)}</div>`;
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'card-body';

    // Editable detail fields
    const detailGrid = document.createElement('div');
    detailGrid.className = 'detail-grid';
    detailGrid.appendChild(detailRow('Team Lead', 'teamLeader', ev, editable));
    detailGrid.appendChild(detailRow('Off Site Support', 'offsiteSupport', ev, editable));
    detailGrid.appendChild(detailRow('Categories', 'categories', ev, editable));
    if (editable || ev.gunstart) detailGrid.appendChild(detailRow('Gun Start', 'gunstart', ev, editable));
    detailGrid.appendChild(detailRow('Call Time', 'callTime', ev, editable));
    detailGrid.appendChild(detailRow('Max No. Runners', 'maxRunners', ev, editable));
    detailGrid.appendChild(detailRow('Meals', 'meals', ev, editable));
    body.appendChild(detailGrid);

    // Role blocks
    ALL_ROLES.forEach((role) => {
      body.appendChild(buildRoleBlock(ev, role, editable));
    });

    // Logistics
    const logisticsWrap = document.createElement('div');
    logisticsWrap.className = 'logistics-grid';
    logisticsWrap.appendChild(logisticsField('Transportation', 'transpo', ev, editable));
    logisticsWrap.appendChild(logisticsField('Driver', 'driver', ev, editable));
    logisticsWrap.appendChild(logisticsField('Contact Number', 'driverNumber', ev, editable));
    logisticsWrap.appendChild(logisticsField('Rate', 'rate', ev, editable));
    body.appendChild(logisticsWrap);

    card.appendChild(body);

    // Footer actions
    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const announceBtn = document.createElement('button');
    announceBtn.className = 'btn-secondary';
    announceBtn.textContent = 'Generate Announcement';
    announceBtn.addEventListener('click', () => copyAnnouncement(ev));
    footer.appendChild(announceBtn);

    if (editable) {
      const completeBtn = document.createElement('button');
      completeBtn.className = 'btn-success';
      completeBtn.textContent = 'Complete Event';
      completeBtn.addEventListener('click', () => completeEvent(ev._id));
      footer.appendChild(completeBtn);
    } else {
      const reopenBtn = document.createElement('button');
      reopenBtn.className = 'btn-outline';
      reopenBtn.textContent = 'Reopen';
      reopenBtn.addEventListener('click', () => reopenEvent(ev._id));
      footer.appendChild(reopenBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger';
    deleteBtn.textContent = 'Delete Event';
    deleteBtn.addEventListener('click', () => deleteEvent(ev._id, { fromCompleted: !editable }));
    footer.appendChild(deleteBtn);

    card.appendChild(footer);
    return card;
  }

  function detailRow(label, field, ev, editable) {
    const row = document.createElement('div');
    row.className = 'detail-row';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'dlabel';
    labelSpan.textContent = `${label.toUpperCase()}:`;
    row.appendChild(labelSpan);

    if (editable) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = ev[field] || '';
      input.addEventListener('change', () => updateEventField(ev._id, field, input.value));
      row.appendChild(input);
    } else {
      const span = document.createElement('span');
      span.textContent = ev[field] || '';
      row.appendChild(span);
    }
    return row;
  }

  function logisticsField(label, field, ev, editable) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    wrap.appendChild(lbl);
    if (editable) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = ev[field] || '';
      input.addEventListener('change', () => updateEventField(ev._id, field, input.value));
      wrap.appendChild(input);
    } else {
      const span = document.createElement('div');
      span.textContent = ev[field] || '—';
      wrap.appendChild(span);
    }
    return wrap;
  }

  function buildRoleBlock(ev, role, editable) {
    const capacity = ev.roleCapacities[role] || 0;
    const assigned = ev.assignments[role] || [];

    const block = document.createElement('div');
    block.className = 'role-block';

    const title = document.createElement('div');
    title.className = 'role-title';
    const capacityControls = editable
      ? `<span class="cap-controls">
           <button type="button" class="cap-btn" data-cap-action="dec" aria-label="Remove a slot">−</button>
           <span class="cap-count">${assigned.length}/${capacity}</span>
           <button type="button" class="cap-btn" data-cap-action="inc" aria-label="Add a slot">+</button>
         </span>`
      : `<span>${assigned.length}/${capacity}</span>`;
    title.innerHTML = `<span>${role}</span>${capacityControls}`;
    block.appendChild(title);

    if (editable) {
      title.querySelector('[data-cap-action="inc"]').addEventListener('click', () => adjustCapacity(ev._id, role, capacity + 1));
      title.querySelector('[data-cap-action="dec"]').addEventListener('click', () => adjustCapacity(ev._id, role, capacity - 1));
    }

    const slot = document.createElement('div');
    slot.className = 'role-slot' + (assigned.length >= capacity ? ' full' : '');
    slot.dataset.eventId = ev._id;
    slot.dataset.role = role;

    if (assigned.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'slot-empty-hint';
      hint.textContent = editable ? 'Drag a marshal here' : 'Unfilled';
      slot.appendChild(hint);
    } else {
      assigned.forEach((a) => {
        const chip = document.createElement('div');
        chip.className = 'assigned-chip';

        if (editable) {
          const rating = getMarshalRating(a.marshalId);
          const bg = ratingColor(rating);
          if (bg) {
            chip.style.background = bg;
            chip.style.borderLeft = `4px solid ${ratingBorderColor(rating)}`;
            chip.style.paddingLeft = '6px';
          }

          const nameSpan = document.createElement('span');
          nameSpan.textContent = a.name;
          const noteInput = document.createElement('input');
          noteInput.type = 'text';
          noteInput.value = a.note || '';
          noteInput.placeholder = 'note (e.g. 5KM)';
          noteInput.style.width = '90px';
          noteInput.style.marginLeft = '6px';
          noteInput.style.padding = '2px 6px';
          noteInput.style.fontSize = '11.5px';
          noteInput.addEventListener('change', () => updateNote(ev._id, role, a.marshalId, noteInput.value));
          const left = document.createElement('span');
          left.style.display = 'flex';
          left.style.alignItems = 'center';
          left.appendChild(nameSpan);
          left.appendChild(noteInput);
          chip.appendChild(left);

          const removeBtn = document.createElement('button');
          removeBtn.className = 'remove-btn';
          removeBtn.textContent = '×';
          removeBtn.title = 'Remove';
          removeBtn.addEventListener('click', () => unassignMarshal(ev._id, role, a.marshalId));
          chip.appendChild(removeBtn);
        } else {
          chip.innerHTML = `<span>${escapeHtml(a.name)}${a.note ? ` - ${escapeHtml(a.note)}` : ''}</span>`;
        }
        slot.appendChild(chip);
      });
    }

    if (editable) {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (assigned.length < capacity) slot.classList.add('dragover');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('dragover');
        const marshalId = e.dataTransfer.getData('text/marshal-id');
        if (marshalId) assignMarshal(ev._id, role, marshalId);
      });
    }

    block.appendChild(slot);
    return block;
  }

  // Builds the small, always-visible card that sits beside the main event
  // card listing marshals signed up for this event.
  function buildPoolCard(ev) {
    const candidates = allMarshals.filter((m) => (m.events || []).some((id) => String(id) === String(ev._id)));

    // Exclude marshals already placed in THIS event's slots (they show in the role slot instead).
    const placedHereIds = new Set(
      ALL_ROLES.flatMap((role) => (ev.assignments[role] || []).map((a) => String(a.marshalId)))
    );
    const visible = candidates.filter((m) => !placedHereIds.has(String(m._id)));

    const poolCard = document.createElement('div');
    poolCard.className = 'pool-card';
    // .pool-card itself is the scrollable element (overflow-y: auto) -- tag
    // it with the event id so its scroll position can be preserved across
    // the full-grid re-renders that assign/unassign trigger.
    poolCard.dataset.eventId = ev._id;
    poolCard.innerHTML = `<h4>Signed-up Marshals <span class="pool-count-badge">${visible.length}</span></h4>`;

    const pool = document.createElement('div');
    pool.className = 'marshal-pool';

    if (visible.length === 0) {
      pool.innerHTML = '<span class="pool-empty">No one signed up for this event yet (or everyone is already placed).</span>';
    } else {
      visible.forEach((m) => {
        const assignedElsewhere = assignedMap[m._id];
        const isExempt = exemptMarshalIds.has(String(m._id));
        // Exempt marshals skip the "already assigned elsewhere" block entirely.
        const disabled = assignedElsewhere && !isExempt;

        const chip = document.createElement('div');
        chip.className = 'marshal-chip' + (disabled ? ' disabled' : '') + (isExempt ? ' exempt' : '');

        const nameSpan = document.createElement('span');
        nameSpan.className = 'marshal-chip-name';
        nameSpan.textContent = `${m.firstName} ${m.lastName}`;
        chip.appendChild(nameSpan);

        const exemptBtn = document.createElement('button');
        exemptBtn.type = 'button';
        exemptBtn.className = 'exempt-toggle';
        exemptBtn.textContent = '★';
        exemptBtn.title = isExempt
          ? 'Exempt this cycle -- click to revoke (they will be locked to one event again)'
          : 'Exempt from the one-event rule for this cycle -- lets them be lined up on multiple events';
        exemptBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          toggleExemption(m._id, isExempt);
        });
        chip.appendChild(exemptBtn);

        if (disabled) {
          chip.title = `Already assigned to ${assignedElsewhere.role} on "${assignedElsewhere.eventName}"`;
        } else {
          chip.title = isExempt
            ? `Exempt this cycle -- can be lined up on multiple events. Preferred roles: ${(m.roles || []).join(', ')}`
            : `Preferred roles: ${(m.roles || []).join(', ')}`;
          const bg = ratingColor(m.rating);
          if (bg) {
            chip.style.background = bg;
            chip.style.borderColor = ratingBorderColor(m.rating);
          }
          chip.draggable = true;
          chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/marshal-id', m._id);
            chip.classList.add('dragging');
          });
          chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
        }
        pool.appendChild(chip);
      });
    }

    poolCard.appendChild(pool);
    return poolCard;
  }

  async function updateEventField(eventId, field, value) {
    try {
      await apiRequest(`/admin/events/${eventId}`, { method: 'PUT', body: { [field]: value } });
      patchLocalEvent(eventId, { [field]: value });
    } catch (err) {
      showToast(err.message, 'error');
      loadCreateList();
    }
  }

  async function adjustCapacity(eventId, role, newCapacity) {
    if (newCapacity < 0) return;
    try {
      const { event } = await apiRequest(`/admin/events/${eventId}/capacity`, { method: 'POST', body: { role, capacity: newCapacity } });
      replaceLocalEvent(event);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function assignMarshal(eventId, role, marshalId) {
    try {
      const { event } = await apiRequest(`/admin/events/${eventId}/assign`, { method: 'POST', body: { role, marshalId } });
      replaceLocalEvent(event);
    } catch (err) {
      showToast(err.message, 'error');
      loadCreateList();
    }
  }

  async function updateNote(eventId, role, marshalId, note) {
    try {
      const { event } = await apiRequest(`/admin/events/${eventId}/note`, { method: 'POST', body: { role, marshalId, note } });
      replaceLocalEvent(event);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function unassignMarshal(eventId, role, marshalId) {
    try {
      const { event } = await apiRequest(`/admin/events/${eventId}/unassign`, { method: 'POST', body: { role, marshalId } });
      replaceLocalEvent(event);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function completeEvent(eventId) {
    if (!confirm('Mark this event as complete? It will move to All Events.')) return;
    try {
      await apiRequest(`/admin/events/${eventId}/complete`, { method: 'POST' });
      showToast('Event completed and moved to All Events.', 'success');
      allActiveEvents = allActiveEvents.filter((e) => e._id !== eventId);
      renderCreateList();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function reopenEvent(eventId) {
    try {
      await apiRequest(`/admin/events/${eventId}/reopen`, { method: 'POST' });
      showToast('Event reopened — check Create List.', 'success');
      loadAllEvents();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteEvent(eventId, { fromCompleted } = {}) {
    if (!confirm('Delete this event permanently? This cannot be undone, and any marshals placed on it will become available for other events again.')) return;
    try {
      await apiRequest(`/admin/events/${eventId}`, { method: 'DELETE' });
      showToast('Event deleted.', 'success');
      if (fromCompleted) {
        loadAllEvents();
      } else {
        allActiveEvents = allActiveEvents.filter((e) => e._id !== eventId);
        buildAssignedMap();
        renderCreateList();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function patchLocalEvent(eventId, patch) {
    const ev = allActiveEvents.find((e) => e._id === eventId);
    if (ev) Object.assign(ev, patch);
  }

  function replaceLocalEvent(newEvent) {
    const idx = allActiveEvents.findIndex((e) => e._id === newEvent._id);
    if (idx >= 0) allActiveEvents[idx] = newEvent;
    buildAssignedMap();
    renderCreateList();
  }

  // ---------------- All Events ----------------
  const allEventsGrid = document.getElementById('allEventsGrid');
  document.getElementById('refreshAllEvents').addEventListener('click', loadAllEvents);

  const allEventsMonthPicker = document.getElementById('allEventsMonthPicker');
  // Default to the current calendar month on first load.
  allEventsMonthPicker.value = currentMonthValue();
  allEventsMonthPicker.addEventListener('change', () => {
    // Falling back to the current month if the user clears the picker keeps
    // the tab from silently showing every completed event ever.
    if (!allEventsMonthPicker.value) allEventsMonthPicker.value = currentMonthValue();
    loadAllEvents();
  });

  function currentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async function loadAllEvents() {
    try {
      const [year, month] = allEventsMonthPicker.value.split('-').map((n) => parseInt(n, 10));
      const { events } = await apiRequest(`/admin/events?status=completed&year=${year}&month=${month}`);
      allEventsGrid.innerHTML = '';
      if (events.length === 0) {
        allEventsGrid.innerHTML = '<div class="empty-state">No completed events in this month.</div>';
        return;
      }
      events.forEach((ev) => allEventsGrid.appendChild(buildEventCard(ev, { editable: false })));
    } catch (err) {
      allEventsGrid.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  }

  // ---------------- Marshal List ----------------
  const marshalListWrap = document.getElementById('marshalListWrap');
  const marshalListAlertBox = document.getElementById('marshalListAlertBox');
  document.getElementById('refreshMarshalList').addEventListener('click', loadMarshalList);

  let marshalListData = [];

  async function loadMarshalList() {
    try {
      const { marshals } = await apiRequest('/admin/marshal-list');
      marshalListData = marshals;
      marshalListAlertBox.innerHTML = '';
      renderMarshalList();
    } catch (err) {
      marshalListAlertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  }

  function renderMarshalList() {
    marshalListWrap.innerHTML = '';
    if (marshalListData.length === 0) {
      marshalListWrap.innerHTML = '<div class="empty-state">No marshals have submitted the sign-up form yet.</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'marshal-table';
    table.innerHTML = `<thead><tr>
      <th>Name</th>
      <th>Contact</th>
      <th>Roles Interested</th>
      <th>Events Attended</th>
      <th>Rating</th>
    </tr></thead>`;

    const tbody = document.createElement('tbody');

    marshalListData.forEach((m) => {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.className = 'marshal-name-cell';
      // Google-authenticated marshals have no username -- show the sign-in
      // method instead of an "@undefined" line.
      const nameSub = m.username ? `@${escapeHtml(m.username)}` : 'Google sign-in';
      nameTd.innerHTML = `<div class="full-name">${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}</div><div class="sub">${nameSub}</div>`;
      tr.appendChild(nameTd);

      const contactTd = document.createElement('td');
      contactTd.innerHTML = `${escapeHtml(m.email)}<br/><span class="sub">${escapeHtml(m.contactNumber)}</span>`;
      tr.appendChild(contactTd);

      const rolesTd = document.createElement('td');
      const roleTagList = document.createElement('div');
      roleTagList.className = 'role-tag-list';
      (m.roles || []).forEach((r) => {
        const tag = document.createElement('span');
        tag.className = 'role-tag';
        tag.textContent = r;
        roleTagList.appendChild(tag);
      });
      rolesTd.appendChild(roleTagList);
      tr.appendChild(rolesTd);

      const attendTd = document.createElement('td');
      if (!m.eventsAttended || m.eventsAttended.length === 0) {
        attendTd.innerHTML = '<span class="no-attendance">No events yet</span>';
      } else {
        const list = document.createElement('div');
        list.className = 'attendance-list';
        m.eventsAttended.forEach((a) => {
          const item = document.createElement('div');
          item.className = 'attendance-item';
          item.innerHTML = `<span class="ev-name">${escapeHtml(a.eventName)}</span><span class="status-pill ${a.status}">${a.status}</span><br/>
            <span class="ev-meta">${formatDate(a.date)} — ${escapeHtml(a.role)}${a.note ? ` (${escapeHtml(a.note)})` : ''}</span>`;
          list.appendChild(item);
        });
        attendTd.appendChild(list);
      }
      tr.appendChild(attendTd);

      const ratingTd = document.createElement('td');
      const ratingControl = document.createElement('div');
      ratingControl.className = 'rating-control';

      const swatch = document.createElement('span');
      swatch.className = 'rating-swatch';
      swatch.style.background = ratingBorderColor(m.rating) || 'rgba(217, 217, 217, 0.62)';

      const select = document.createElement('select');
      select.innerHTML =
        '<option value="">No rating</option>' +
        Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<option value="${n}">${n}</option>`).join('');
      select.value = m.rating ? String(m.rating) : '';
      select.addEventListener('change', () => updateMarshalRating(m._id, select.value, swatch));

      ratingControl.appendChild(swatch);
      ratingControl.appendChild(select);
      ratingTd.appendChild(ratingControl);
      tr.appendChild(ratingTd);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    marshalListWrap.appendChild(table);
  }

  async function updateMarshalRating(marshalId, value, swatchEl) {
    try {
      const { marshal } = await apiRequest(`/admin/marshals/${marshalId}/rating`, {
        method: 'PUT',
        body: { rating: value === '' ? null : parseInt(value, 10) },
      });
      const idx = marshalListData.findIndex((m) => m._id === marshalId);
      if (idx >= 0) marshalListData[idx].rating = marshal.rating;
      if (swatchEl) swatchEl.style.background = ratingBorderColor(marshal.rating) || 'rgba(217, 217, 217, 0.62)';
      showToast('Rating updated.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Rating is shown as a monochrome MAROON INTENSITY ramp: 1 = barely tinted,
  // 10 = deep maroon. The ITEMHOUND palette has no green/amber, so a red-to-green
  // scale would mean inventing unofficial brand colors -- intensity carries the
  // same "higher is stronger" reading using only the approved primary.
  // Returns null (no tint) when unrated.
  function ratingColor(rating) {
    if (!rating) return null;
    const t = (Math.min(10, Math.max(1, rating)) - 1) / 9; // 0 -> 1
    return `rgba(99, 10, 31, ${(0.05 + t * 0.15).toFixed(3)})`;
  }
  function ratingBorderColor(rating) {
    if (!rating) return null;
    const t = (Math.min(10, Math.max(1, rating)) - 1) / 9;
    return `rgba(99, 10, 31, ${(0.28 + t * 0.72).toFixed(3)})`;
  }
  function getMarshalRating(marshalId) {
    const m = allMarshals.find((mm) => String(mm._id) === String(marshalId));
    return m ? m.rating : null;
  }

  // ---------------- Announcement ----------------
  function copyAnnouncement(ev) {
    const lines = [];
    lines.push(ev.name.toUpperCase());
    lines.push(formatDate(ev.date));
    lines.push(ev.location.toUpperCase());
    lines.push(`TEAM LEAD: ${ev.teamLeader || ''}`);
    lines.push(`OFF SITE SUPPORT: ${ev.offsiteSupport || ''}`);
    lines.push(`CATEGORIES: ${ev.categories || ''}`);
    if (ev.gunstart) lines.push(`GUNSTART: ${ev.gunstart}`);
    lines.push(`CALL TIME: ${ev.callTime || ''}`);
    lines.push(`MAX NO.RUNNERS: ${ev.maxRunners || ''}`);
    lines.push(`MEALS: ${ev.meals || ''}`);

    ALL_ROLES.forEach((role) => {
      const assigned = ev.assignments[role] || [];
      if (assigned.length === 0) return;
      lines.push(`${role.toUpperCase()}:`);
      assigned.forEach((a, i) => {
        lines.push(`${i + 1} ${a.name}${a.note ? ` - ${a.note}` : ''}`);
      });
    });

    if (ev.transpo) lines.push(`TRANSPO: ${ev.transpo}`);
    if (ev.driver) lines.push(`DRIVER: ${ev.driver}`);
    if (ev.driverNumber) lines.push(ev.driverNumber);
    if (ev.rate) lines.push(`RATE: ${ev.rate}`);

    const text = lines.join('\n');
    copyToClipboard(text);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast('Announcement copied to clipboard.', 'success'),
        () => fallbackCopy(text)
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Announcement copied to clipboard.', 'success');
    } catch {
      showToast('Could not copy automatically. Please copy manually.', 'error');
    }
    ta.remove();
  }

  // ---------------- Utilities ----------------
  function val(id) { return document.getElementById(id).value.trim(); }
  function slug(role) { return role.replace(/\s+/g, '_'); }
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatDate(d) {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  }

  // Initial load
  loadCreateList();
})();
