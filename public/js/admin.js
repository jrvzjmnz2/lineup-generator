(function () {
  const user = Auth.requireRole('admin');
  if (!user) return;

  document.getElementById('welcomeText').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());

  // The master role list, mirrored from server/config/roles.js (append, never
  // insert -- saved events key their capacities/assignments by role name).
  //
  // WHICH of these a given event offers is decided by its event type and comes
  // down per event on `typeRoles` / `extraRoles`, so this list is only used
  // where every role has to be swept regardless of type: scanning assignments
  // to find who is already placed.
  const ALL_ROLES = [
    'Operator',
    'Spotter',
    'Split',
    'SLR',
    'Head Marshal',
    'Tech Support',
    'Kit Claiming Staff',
    'Registration Staff',
    'Fulfillment',
    'Onsite Support',
    'Walk-ins',
    'Bib Production',
  ];

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
  //
  // The form is built from the event type the admin picks, not hardcoded.
  // Each type has its own entries and its own roles (server/config/eventTypes.js),
  // so a Fulfillment event never shows a Gun Start box and a Kit Claiming
  // event never offers a Spotter slot. The catalogue is fetched from
  // /admin/event-types rather than mirrored here -- a second copy of a 5x2
  // table of fields and roles would drift.

  // How each field renders. The keys are the field names the server uses; the
  // ids stay `gen<Field>` so #genDate (and its weekend hint) keep working.
  const FIELD_DEFS = {
    name: { label: 'Event Name', required: true },
    date: { label: 'Date', required: true, type: 'date', span: 1 },
    location: { label: 'Location', required: true, span: 2 },
    teamLeader: { label: 'Team Leader', placeholder: 'e.g. Brett / Jordan / Joshua' },
    offsiteSupport: { label: 'Offsite Support' },
    categories: { label: 'Categories', placeholder: 'e.g. 42KM|21KM|10KM|5KM' },
    lanes: { label: 'Number of Lanes', placeholder: 'e.g. 6' },
    gunstart: { label: 'Gun Start — optional', placeholder: 'e.g. 0100AM|0400AM|0430AM|0500AM' },
    callTime: { label: 'Call Time', placeholder: 'e.g. 8:00 PM (Saturday) 8/08/2026' },
    maxRunners: { label: 'Max Runners', placeholder: 'e.g. 5,640' },
    meals: { label: 'Meals', placeholder: 'e.g. 2 Meals' },
    transpo: { label: 'Transportation' },
    driver: { label: 'Driver' },
    driverNumber: { label: 'Contact Number' },
    rate: { label: 'Rate' },
  };

  const genTypeSelect = document.getElementById('genEventType');
  const genFieldGrid = document.getElementById('genFieldGrid');
  const roleCounterGrid = document.getElementById('roleCounterGrid');
  const generateForm = document.getElementById('generateForm');
  const generateAlertBox = document.getElementById('generateAlertBox');

  let eventTypes = [];            // [{ name, fields, roles, hasLogistics }]
  let logisticsFields = [];       // filled in only from the event card, never here
  let roleCounts = {};            // role -> slots, for the type currently selected

  function typeByName(name) {
    return eventTypes.find((t) => t.name === name) || null;
  }

  // Fields the CREATE form asks for. Logistics (transport / driver / rate) are
  // deliberately excluded even on Timing: they get filled in on the event card
  // once the lineup exists, which is how it worked before types and is still
  // how the team uses it.
  function formFieldsFor(typeName) {
    const t = typeByName(typeName);
    if (!t) return [];
    return t.fields.filter((f) => !logisticsFields.includes(f));
  }

  async function loadEventTypes() {
    try {
      const data = await apiRequest('/admin/event-types');
      eventTypes = data.types || [];
      logisticsFields = data.logisticsFields || [];
      genTypeSelect.innerHTML = '<option value="">Select an event type…</option>';
      eventTypes.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.name;
        opt.textContent = t.name;
        genTypeSelect.appendChild(opt);
      });
    } catch (err) {
      generateAlertBox.innerHTML = `<div class="alert alert-error">Could not load the event types: ${escapeHtml(err.message)}</div>`;
    }
  }

  function buildGenField(field) {
    const def = FIELD_DEFS[field] || { label: field };
    const wrap = document.createElement('div');
    wrap.className = 'field' + (def.span === 2 ? ' span-2' : '');
    wrap.dataset.field = field;

    const id = `gen${field.charAt(0).toUpperCase()}${field.slice(1)}`;
    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = def.label;
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.type = def.type || 'text';
    input.id = id;
    input.dataset.genField = field;
    if (def.required) input.required = true;
    if (def.placeholder) input.placeholder = def.placeholder;
    wrap.appendChild(input);

    // The date field carries the weekday/weekend hint. It is rebuilt with the
    // field, so the hint element and its listeners are wired here rather than
    // once at page load.
    if (field === 'date') {
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.id = 'genDateHint';
      wrap.appendChild(hint);
      wireDateHint(input, hint);
    }
    return wrap;
  }

  // Tell the admin which rule the event they are creating will fall under,
  // as soon as they pick a date.
  function wireDateHint(input, hint) {
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const paint = () => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.value || '');
      if (!m) { hint.textContent = ''; hint.className = 'field-hint'; return; }
      // Built from the parts via Date.UTC for the same reason the server does:
      // parsing the string directly would shift the day in a non-UTC zone.
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      const day = d.getUTCDay();
      const weekend = day === 0 || day === 6;
      hint.textContent = weekend
        ? `${DAY_NAMES[day]} — weekend event: each marshal can hold only one weekend event.`
        : `${DAY_NAMES[day]} — weekday event: marshals can be lined up on several of these.`;
      hint.className = 'field-hint' + (weekend ? ' field-hint-weekend' : '');
    };
    input.addEventListener('change', paint);
    input.addEventListener('input', paint);
    paint();
  }

  /**
   * Rebuild the entries and the role counters for the selected type.
   *
   * Values already typed into fields the new type also has are carried over --
   * switching from Timing to Kit Claiming after typing the name and date
   * shouldn't make you type them again. Slot counts reset, since the roles
   * themselves are different.
   */
  function renderGenerateForm() {
    const typeName = genTypeSelect.value;
    const keep = {};
    genFieldGrid.querySelectorAll('[data-gen-field]').forEach((el) => { keep[el.dataset.genField] = el.value; });

    genFieldGrid.innerHTML = '';
    roleCounterGrid.innerHTML = '';
    roleCounts = {};

    const t = typeByName(typeName);
    if (!t) {
      genFieldGrid.innerHTML = '<p class="pool-empty" data-placeholder>Choose an event type to see its entries.</p>';
      roleCounterGrid.innerHTML = '<p class="pool-empty" data-placeholder>Choose an event type to see its roles.</p>';
      return;
    }

    formFieldsFor(typeName).forEach((field) => {
      const el = buildGenField(field);
      const input = el.querySelector('[data-gen-field]');
      if (keep[field] !== undefined) {
        input.value = keep[field];
        if (field === 'date') input.dispatchEvent(new Event('input'));
      }
      genFieldGrid.appendChild(el);
    });

    t.roles.forEach((role) => {
      roleCounts[role] = 0;
      const div = document.createElement('div');
      div.className = 'role-counter';
      div.innerHTML = `
        <span class="role-name">${escapeHtml(role)}</span>
        <div class="counter-controls">
          <button type="button" data-action="dec" data-role="${escapeHtml(role)}">−</button>
          <span class="counter-value" id="count_${slug(role)}">0</span>
          <button type="button" data-action="inc" data-role="${escapeHtml(role)}">+</button>
        </div>`;
      roleCounterGrid.appendChild(div);
    });
  }

  genTypeSelect.addEventListener('change', renderGenerateForm);

  roleCounterGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const role = btn.dataset.role;
    if (!(role in roleCounts)) return;
    const delta = btn.dataset.action === 'inc' ? 1 : -1;
    roleCounts[role] = Math.max(0, roleCounts[role] + delta);
    document.getElementById(`count_${slug(role)}`).textContent = roleCounts[role];
  });

  generateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    generateAlertBox.innerHTML = '';

    const eventType = genTypeSelect.value;
    if (!eventType) {
      generateAlertBox.innerHTML = '<div class="alert alert-error">Choose an event type first.</div>';
      return;
    }

    // Only the fields this type has are sent -- the server drops anything else
    // anyway, but there is nothing else on screen to send.
    const payload = { eventType, roleCounts };
    genFieldGrid.querySelectorAll('[data-gen-field]').forEach((el) => {
      payload[el.dataset.genField] = el.value.trim();
    });

    try {
      await apiRequest('/admin/events', { method: 'POST', body: payload });
      showToast(`${eventType} event added — it now appears in Create List and the marshal sign-up form.`, 'success');
      generateForm.reset();
      genTypeSelect.value = '';
      renderGenerateForm();
    } catch (err) {
      generateAlertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  // ---------------- Create List ----------------
  const createListGrid = document.getElementById('createListGrid');
  const createListAlertBox = document.getElementById('createListAlertBox');
  document.getElementById('refreshCreateList').addEventListener('click', loadCreateList);

  let allActiveEvents = [];
  let allMarshals = [];
  // marshalId -> { eventId, eventName, role, dayName } for active WEEKEND
  // events only. Weekday events are unrestricted, so being on one never
  // disables a marshal anywhere.
  let assignedMap = {};
  let exemptMarshalIds = new Set(); // marshalIds exempt from the single-active-event rule this cycle
  let allEmployees = []; // the employee_list roster, for the pool-card dropdown
  // eventId -> [employeeId] currently staged as draggable chips on that card.
  // UI-only: staging just reveals a drag source, so it lives for the session
  // and does not need persisting. It has to survive renderCreateList(), which
  // rebuilds the whole grid after every assign.
  const stagedEmployees = new Map();

  async function loadCreateList() {
    try {
      const [{ events }, { marshals }, { marshalIds }, { employees }] = await Promise.all([
        apiRequest('/admin/events?status=active'),
        apiRequest('/admin/marshals'),
        apiRequest('/admin/exemptions'),
        apiRequest('/admin/employees'),
      ]);
      allActiveEvents = events;
      allMarshals = marshals;
      exemptMarshalIds = new Set(marshalIds);
      allEmployees = employees || [];
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
      if (!ev.isWeekend) return; // weekday placements never restrict anything
      ALL_ROLES.forEach((role) => {
        (ev.assignments[role] || []).forEach((a) => {
          assignedMap[a.marshalId] = {
            eventId: ev._id,
            eventName: ev.name,
            role,
            dayName: ev.dayName || '',
          };
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

  // Labels for the event-card detail rows, keyed by the field names the server
  // uses. Which of these a card shows comes from `ev.typeFields`.
  const CARD_FIELD_LABELS = {
    teamLeader: 'Team Lead',
    offsiteSupport: 'Off Site Support',
    categories: 'Categories',
    lanes: 'No. of Lanes',
    gunstart: 'Gun Start',
    callTime: 'Call Time',
    maxRunners: 'Max No. Runners',
    meals: 'Meals',
    transpo: 'Transportation',
    driver: 'Driver',
    driverNumber: 'Contact Number',
    rate: 'Rate',
  };
  // Shown in the card head, not as detail rows.
  const CARD_BASE_FIELDS = ['name', 'date', 'location'];
  // Shown in their own block at the bottom, Timing events only.
  const CARD_LOGISTICS_FIELDS = ['transpo', 'driver', 'driverNumber', 'rate'];

  // One-time type picker for an event saved before event types existed.
  //
  // Setting a type is one-way (the server refuses to re-type a typed event):
  // the type decides which roles an event has, and swapping it under a lineup
  // that is already built is how people get lost.
  function buildTypePicker(ev) {
    const wrap = document.createElement('div');
    wrap.className = 'type-picker';

    const text = document.createElement('p');
    text.className = 'type-picker-note';
    text.textContent = 'This event was created before event types. Set its type to narrow it to the right entries and roles — anyone already lined up stays where they are.';
    wrap.appendChild(text);

    const row = document.createElement('div');
    row.className = 'type-picker-row';

    const select = document.createElement('select');
    select.setAttribute('aria-label', `Set the event type for ${ev.name}`);
    select.innerHTML = '<option value="">Set event type…</option>';
    eventTypes.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name;
      select.appendChild(opt);
    });
    row.appendChild(select);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary btn-small';
    btn.textContent = 'Set type';
    btn.addEventListener('click', () => {
      if (!select.value) return showToast('Pick a type first.', 'error');
      if (!window.confirm(`Set "${ev.name}" to ${select.value}? This cannot be changed afterwards.`)) return;
      setEventType(ev._id, select.value);
    });
    row.appendChild(btn);

    wrap.appendChild(row);
    return wrap;
  }

  async function setEventType(eventId, eventType) {
    try {
      const { event } = await apiRequest(`/admin/events/${eventId}/type`, { method: 'POST', body: { eventType } });
      replaceLocalEvent(event);
      showToast(`Set to ${eventType}.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function buildEventCard(ev, { editable }) {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.dataset.eventId = ev._id;

    const head = document.createElement('div');
    head.className = 'card-head';
    // Two tags, both read at a glance:
    //   type     -- which kind of operation this is, and so which entries and
    //               roles it has at all
    //   schedule -- which lineup rule applies (weekend cards allow one event
    //               per marshal, weekday cards don't restrict)
    const tagClass = ev.isWeekend ? 'schedule-tag weekend' : 'schedule-tag weekday';
    const tagText = ev.isWeekend ? 'Weekend' : 'Weekday';
    const tagTitle = ev.isWeekend
      ? 'Weekend event — a marshal can only hold one weekend event at a time'
      : 'Weekday event — marshals can be lined up on as many as you need';

    const typed = Boolean(ev.eventType);
    const typeTag = typed
      ? `<span class="type-tag" title="${escapeHtml(ev.eventType)} event — its entries and roles come from this type">${escapeHtml(ev.eventType)}</span>`
      : `<span class="type-tag untyped" title="Saved before event types existed, so it still shows every entry and every role. Set a type below to fix that.">Untyped</span>`;

    const dayLabel = ev.dayName ? `${escapeHtml(ev.dayName)}, ` : '';
    head.innerHTML =
      `<div class="card-head-top"><h3>${escapeHtml(ev.name)}</h3>` +
      `<span class="card-head-tags">${typeTag}` +
      `<span class="${tagClass}" title="${tagTitle}">${tagText}</span></span></div>` +
      `<div class="meta">${dayLabel}${formatDate(ev.date)} &nbsp;•&nbsp; ${escapeHtml(ev.location)}</div>`;
    card.appendChild(head);

    // Untyped events get a one-time picker. Setting the type narrows the card
    // to that type's entries and roles; anyone already lined up in a role the
    // new type doesn't have stays put and stays visible (see extraRoles).
    if (!typed && editable) card.appendChild(buildTypePicker(ev));

    const body = document.createElement('div');
    body.className = 'card-body';

    // Editable detail fields -- exactly the ones this event's type carries.
    // `typeFields` is derived server-side from the type, so the card can never
    // show an entry the type doesn't have or hide one it does.
    const detailFields = (ev.typeFields || []).filter(
      (f) => !CARD_BASE_FIELDS.includes(f) && !CARD_LOGISTICS_FIELDS.includes(f)
    );
    if (detailFields.length) {
      const detailGrid = document.createElement('div');
      detailGrid.className = 'detail-grid';
      detailFields.forEach((field) => {
        // Gun Start stays hidden on a completed card when it was never filled.
        if (field === 'gunstart' && !editable && !ev.gunstart) return;
        detailGrid.appendChild(detailRow(CARD_FIELD_LABELS[field] || field, field, ev, editable));
      });
      body.appendChild(detailGrid);
    }

    // Role blocks: this type's roles, then any role still holding people from
    // before the event was typed (marked, and not growable -- see the server).
    (ev.typeRoles || []).forEach((role) => {
      body.appendChild(buildRoleBlock(ev, role, editable));
    });
    (ev.extraRoles || []).forEach((role) => {
      body.appendChild(buildRoleBlock(ev, role, editable, { extra: true }));
    });

    // Logistics -- Timing events only (and untyped ones, which may hold it).
    if (ev.hasLogistics) {
      const logisticsWrap = document.createElement('div');
      logisticsWrap.className = 'logistics-grid';
      CARD_LOGISTICS_FIELDS.forEach((field) => {
        logisticsWrap.appendChild(logisticsField(CARD_FIELD_LABELS[field] || field, field, ev, editable));
      });
      body.appendChild(logisticsWrap);
    }

    card.appendChild(body);

    // Footer actions
    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const announceBtn = document.createElement('button');
    announceBtn.className = 'btn-secondary';
    announceBtn.textContent = 'Generate Announcement';
    announceBtn.addEventListener('click', () => copyAnnouncement(ev));
    footer.appendChild(announceBtn);

    const pdfBtn = document.createElement('button');
    pdfBtn.className = 'btn-secondary';
    pdfBtn.textContent = 'Export PDF';
    pdfBtn.title = 'Download the marshal list as a PDF, laid out like the ITEMHOUND template';
    pdfBtn.addEventListener('click', () => exportEventPdf(ev, pdfBtn));
    footer.appendChild(pdfBtn);

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

  function buildRoleBlock(ev, role, editable, { extra = false } = {}) {
    const capacity = ev.roleCapacities[role] || 0;
    const assigned = ev.assignments[role] || [];

    const block = document.createElement('div');
    block.className = 'role-block' + (extra ? ' role-block-extra' : '');

    const title = document.createElement('div');
    title.className = 'role-title';
    // An `extra` role is one holding people from before this event was typed.
    // It shows so nobody silently disappears from the card, the announcement
    // or the PDF, but it gets no +/- : the server refuses to grow a role the
    // type doesn't have. Removing people from it still works.
    const capacityControls = editable && !extra
      ? `<span class="cap-controls">
           <button type="button" class="cap-btn" data-cap-action="dec" aria-label="Remove a slot">−</button>
           <span class="cap-count">${assigned.length}/${capacity}</span>
           <button type="button" class="cap-btn" data-cap-action="inc" aria-label="Add a slot">+</button>
         </span>`
      : `<span>${assigned.length}/${capacity}</span>`;
    const extraNote = extra
      ? `<span class="role-extra-flag" title="Not a role on ${escapeHtml(ev.eventType || 'this')} events. Left here because people are still assigned to it — you can remove them, but not add more.">off-type</span>`
      : '';
    title.innerHTML = `<span>${escapeHtml(role)}</span>${extraNote}${capacityControls}`;
    block.appendChild(title);

    if (editable && !extra) {
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
      hint.textContent = extra ? 'Empty — this role is not part of this event type' : (editable ? 'Drag a marshal or employee here' : 'Unfilled');
      slot.appendChild(hint);
    } else {
      assigned.forEach((a) => {
        const isEmployee = a.kind === 'employee';
        // Whichever id this entry carries is what note/unassign must key on.
        const ref = isEmployee ? { employeeId: a.employeeId } : { marshalId: a.marshalId };

        const chip = document.createElement('div');
        chip.className = 'assigned-chip' + (isEmployee ? ' employee' : '');

        if (editable) {
          // Employees have no rating, so no tint -- the badge identifies them.
          const rating = isEmployee ? null : getMarshalRating(a.marshalId);
          const bg = ratingColor(rating);
          if (bg) {
            chip.style.background = bg;
            chip.style.borderLeft = `4px solid ${ratingBorderColor(rating)}`;
            chip.style.paddingLeft = '6px';
          }

          const nameSpan = document.createElement('span');
          nameSpan.textContent = a.name;
          const left = document.createElement('span');
          left.style.display = 'flex';
          left.style.alignItems = 'center';
          left.appendChild(nameSpan);
          if (isEmployee) {
            const badge = document.createElement('span');
            badge.className = 'emp-badge';
            badge.textContent = 'EMP';
            badge.title = 'From the employee list — not bound by the weekend one-event rule';
            left.appendChild(badge);
          }
          const noteInput = document.createElement('input');
          noteInput.type = 'text';
          noteInput.value = a.note || '';
          noteInput.placeholder = 'note (e.g. 5KM)';
          noteInput.style.width = '90px';
          noteInput.style.marginLeft = '6px';
          noteInput.style.padding = '2px 6px';
          noteInput.style.fontSize = '11.5px';
          noteInput.addEventListener('change', () => updateNote(ev._id, role, ref, noteInput.value));
          left.appendChild(noteInput);
          chip.appendChild(left);

          const removeBtn = document.createElement('button');
          removeBtn.className = 'remove-btn';
          removeBtn.textContent = '×';
          removeBtn.title = 'Remove';
          removeBtn.addEventListener('click', () => unassignMarshal(ev._id, role, ref));
          chip.appendChild(removeBtn);
        } else {
          chip.innerHTML = `<span>${escapeHtml(a.name)}${isEmployee ? ' <span class="emp-badge">EMP</span>' : ''}${a.note ? ` - ${escapeHtml(a.note)}` : ''}</span>`;
        }
        slot.appendChild(chip);
      });
    }

    // No drop target on an off-type role: the server would refuse the assign,
    // so don't offer the gesture in the first place.
    if (editable && !extra) {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (assigned.length < capacity) slot.classList.add('dragover');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('dragover');
        // Two payload types so a slot can tell a marshal from an employee.
        const employeeId = e.dataTransfer.getData('text/employee-id');
        if (employeeId) return assignEmployee(ev._id, role, employeeId);
        const marshalId = e.dataTransfer.getData('text/marshal-id');
        if (marshalId) assignMarshal(ev._id, role, marshalId);
      });
    }

    block.appendChild(slot);
    return block;
  }

  // What this marshal said they'd do at an event of THIS type.
  //
  // Sign-ups are per type now (the types have disjoint role sets), so the flat
  // `roles` union is the wrong thing to show against a specific event -- it
  // would offer "Spotter" on a Kit Claiming card. Submissions made before
  // rolesByType existed only have the flat list, so that is the fallback.
  function preferredRolesFor(m, ev) {
    const key = ev.eventType || 'Other';
    const byType = m.rolesByType || null;
    if (byType && Array.isArray(byType[key])) return byType[key];
    if (byType && Object.keys(byType).length) return []; // typed submission, nothing for this type
    return m.roles || [];
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
        // The weekend block only applies when THIS card is a weekend event.
        const assignedElsewhere = ev.isWeekend ? assignedMap[m._id] : null;
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
          const when = assignedElsewhere.dayName ? ` (${assignedElsewhere.dayName})` : '';
          chip.title = `Already on ${assignedElsewhere.role} for "${assignedElsewhere.eventName}"${when}. Weekend events allow one event per marshal.`;
        } else {
          // The roles this marshal picked FOR THIS EVENT'S TYPE. The flat
          // `roles` union would list roles that don't exist on this event.
          const prefer = preferredRolesFor(m, ev);
          const preferText = prefer.length ? prefer.join(', ') : 'none picked for this event type';
          chip.title = isExempt
            ? `Exempt this cycle -- can be lined up on multiple events. Preferred roles: ${preferText}`
            : `Preferred roles: ${preferText}`;
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
    poolCard.appendChild(buildEmployeePicker(ev));
    return poolCard;
  }

  // ---- Employees section at the bottom of each pool card ----------------
  //
  // Employees come from the employee_list roster rather than the sign-up form,
  // so they are not in the marshal pool and are not restricted: they can hold
  // several roles in one event, appear on any event, and the weekend
  // one-event rule does not apply to them.
  //
  // Picking a name stages a draggable chip. Dragging it into a slot does NOT
  // consume it -- employees are reusable, so the chip stays for another role.
  // The x on a chip un-stages it.
  function buildEmployeePicker(ev) {
    const wrap = document.createElement('div');
    wrap.className = 'employee-picker';

    const heading = document.createElement('h4');
    heading.textContent = 'Employees';
    wrap.appendChild(heading);

    const staged = stagedEmployees.get(ev._id) || [];

    if (staged.length) {
      const chips = document.createElement('div');
      chips.className = 'marshal-pool employee-pool';
      staged.forEach((employeeId) => {
        const emp = allEmployees.find((e) => String(e._id) === String(employeeId));
        if (!emp) return;

        const chip = document.createElement('div');
        chip.className = 'marshal-chip employee-chip';
        chip.draggable = true;
        chip.title = `${emp.name} — drag into any role. Reusable: stays here after you place them.`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'marshal-chip-name';
        nameSpan.textContent = emp.name;
        chip.appendChild(nameSpan);

        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'unstage-btn';
        drop.textContent = '×';
        drop.title = 'Remove from this list (does not unassign anyone)';
        drop.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          unstageEmployee(ev._id, employeeId);
        });
        chip.appendChild(drop);

        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/employee-id', String(employeeId));
          chip.classList.add('dragging');
        });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));

        chips.appendChild(chip);
      });
      wrap.appendChild(chips);
    }

    const select = document.createElement('select');
    select.className = 'employee-select';
    select.setAttribute('aria-label', 'Add an employee to this event');

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = allEmployees.length
      ? 'Add an employee…'
      : 'No employees on file';
    select.appendChild(placeholder);

    allEmployees.forEach((emp) => {
      const opt = document.createElement('option');
      opt.value = emp._id;
      opt.textContent = emp.name;
      select.appendChild(opt);
    });
    select.disabled = allEmployees.length === 0;

    select.addEventListener('change', () => {
      const id = select.value;
      select.value = ''; // reset so the same name can be picked again
      if (id) stageEmployee(ev._id, id);
    });

    wrap.appendChild(select);
    return wrap;
  }

  function stageEmployee(eventId, employeeId) {
    const list = stagedEmployees.get(eventId) || [];
    if (list.some((id) => String(id) === String(employeeId))) {
      showToast('That employee is already in the list below.', '');
      return;
    }
    stagedEmployees.set(eventId, [...list, employeeId]);
    renderCreateList();
  }

  function unstageEmployee(eventId, employeeId) {
    const list = stagedEmployees.get(eventId) || [];
    stagedEmployees.set(eventId, list.filter((id) => String(id) !== String(employeeId)));
    renderCreateList();
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

  // `ref` is { marshalId } or { employeeId } -- whichever identifies the entry.
  // Employees are never removed from the pool on assignment -- they are
  // reusable, so the staged chip stays put for another role.
  async function assignEmployee(eventId, role, employeeId) {
    try {
      const { event } = await apiRequest(`/admin/events/${eventId}/assign`, { method: 'POST', body: { role, employeeId } });
      replaceLocalEvent(event);
    } catch (err) {
      showToast(err.message, 'error');
      loadCreateList();
    }
  }

  // `ref` is { marshalId } or { employeeId } -- whichever identifies the entry.
  async function updateNote(eventId, role, ref, note) {
    try {
      const { event } = await apiRequest(`/admin/events/${eventId}/note`, { method: 'POST', body: { role, ...ref, note } });
      replaceLocalEvent(event);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function unassignMarshal(eventId, role, ref) {
    try {
      const { event } = await apiRequest(`/admin/events/${eventId}/unassign`, { method: 'POST', body: { role, ...ref } });
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
      swatch.style.background = ratingBorderColor(m.rating) || unratedSwatch();

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
      if (swatchEl) swatchEl.style.background = ratingBorderColor(marshal.rating) || unratedSwatch();
      showToast('Rating updated.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Rating is shown as a monochrome INTENSITY ramp: faint at 1, full strength
  // at 10. The ITEMHOUND palette has no green/amber, so a red-to-green scale
  // would mean inventing unofficial brand colors -- intensity carries the same
  // "higher is stronger" reading using only approved colors.
  //
  // The ramp has to flip with the theme: maroon on dark slate is roughly
  // 1.4:1, i.e. invisible, so in dark mode the ramp runs on white instead.
  // Either way the metaphor holds -- more intense means higher rated.
  // Returns null (no tint) when unrated.
  function unratedSwatch() {
    // Kept below the rating-1 value (0.18) so "unrated" never reads as rated.
    return isDarkTheme() ? 'rgba(255, 255, 255, 0.10)' : 'rgba(217, 217, 217, 0.62)';
  }
  function isDarkTheme() {
    return document.documentElement.dataset.theme === 'dark';
  }
  function ratingRamp(rating) {
    const t = (Math.min(10, Math.max(1, rating)) - 1) / 9; // 0 -> 1
    // The dark edge ramp runs 0.18 -> 1.0: measured against CIE L*, a linear
    // ramp spaces more evenly than any gamma curve tried (evenness 0.87 vs
    // 0.47 at t^1.3), and this range yields ~19% more total lightness travel
    // than starting at 0.30, so 8 vs 9 vs 10 stay tellable apart.
    return isDarkTheme()
      ? { rgb: '255, 255, 255', tint: 0.05 + t * 0.16, edge: 0.18 + t * 0.82 }
      : { rgb: '99, 10, 31', tint: 0.05 + t * 0.15, edge: 0.28 + t * 0.72 };
  }
  function ratingColor(rating) {
    if (!rating) return null;
    const r = ratingRamp(rating);
    return `rgba(${r.rgb}, ${r.tint.toFixed(3)})`;
  }
  function ratingBorderColor(rating) {
    if (!rating) return null;
    const r = ratingRamp(rating);
    return `rgba(${r.rgb}, ${r.edge.toFixed(3)})`;
  }
  function getMarshalRating(marshalId) {
    const m = allMarshals.find((mm) => String(mm._id) === String(marshalId));
    return m ? m.rating : null;
  }

  // ---------------- PDF export ----------------
  async function exportEventPdf(ev, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      const res = await fetch(`/api/admin/events/${ev._id}/pdf`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` },
      });

      if (!res.ok) {
        let message = `Export failed (${res.status})`;
        try {
          const data = await res.json();
          if (data && data.error) message = data.error;
        } catch (err) { /* not JSON -- keep the status message */ }
        throw new Error(message);
      }

      const blob = await res.blob();
      const name = filenameFromDisposition(res.headers.get('Content-Disposition'))
        || `${ev.name} MARSHALS LIST.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on a delay: Safari needs the object URL alive past the click.
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      showToast('PDF exported.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // Prefers the RFC 5987 filename* parameter, which carries non-ASCII names.
  function filenameFromDisposition(header) {
    if (!header) return null;
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (utf8) {
      try { return decodeURIComponent(utf8[1].trim()); } catch (err) { /* fall through */ }
    }
    const plain = /filename="?([^";]+)"?/i.exec(header);
    return plain ? plain[1].trim() : null;
  }

  // ---------------- Announcement ----------------
  //
  // The announcement is plain text pasted into group chats, so the styling has
  // to survive a proportional font and a narrow phone screen. That rules out
  // column alignment (spaces don't line up) and long horizontal rules (they
  // wrap). What is left: icons, short rules, and blank lines between blocks.
  //
  // Every icon lives in this one map -- change the look here rather than
  // hunting through the builder.
  const ANNOUNCE_ICONS = {
    title: '📣',
    date: '🗓',
    venue: '📍',
    teamLead: '👤',
    offsite: '🤝',
    type: '🏷',
    categories: '🏁',
    lanes: '🛣',
    gunstart: '🔔',
    callTime: '⏰',
    maxRunners: '👥',
    meals: '🍽',
    details: '📋',
    lineup: '👷',
    role: '🔹',
    logistics: '🚚',
    transpo: '🚐',
    driver: '🧑',
    contact: '📱',
    rate: '💵',
  };

  const ANNOUNCE_RULE = '────────────────';

  const cleanValue = (v) => String(v === null || v === undefined ? '' : v).trim();

  // "42KM|21KM|10KM" -> "42KM | 21KM | 10KM". The pipes are how the team types
  // these fields; they just need room to breathe once they're in a message.
  const spaceSeparators = (v) => cleanValue(v).replace(/\s*\|\s*/g, ' | ');

  /**
   * Long, human date for the announcement header: "Sunday, September 13, 2026".
   * Built from the date parts rather than `new Date(str)` -- see formatDate for
   * why that would shift the calendar day west of UTC. Prefers the day name the
   * server already derived.
   */
  function announcementDate(ev) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanValue(ev.date));
    if (!m) return cleanValue(ev.date);
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime())) return cleanValue(ev.date);
    const day = ev.dayName || d.toLocaleDateString('en-US', { weekday: 'long' });
    const rest = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return `${day}, ${rest}`;
  }

  /**
   * Builds the announcement text. Any field left blank is omitted entirely --
   * no "TEAM LEAD:" with nothing after it -- and a section whose every field is
   * blank disappears along with its heading.
   */
  function buildAnnouncement(ev) {
    const I = ANNOUNCE_ICONS;
    const blocks = [];

    // ---- Headline ----
    const head = [`${I.title}  ${cleanValue(ev.name).toUpperCase()}`];
    // Which kind of operation this is. Sits under the name so whoever reads
    // the post in a group chat knows what they are being called to.
    if (ev.eventType) head.push(`${I.type}  ${cleanValue(ev.eventType)}`);
    const when = announcementDate(ev);
    if (when) head.push(`${I.date}  ${when}`);
    const venue = cleanValue(ev.location);
    if (venue) head.push(`${I.venue}  ${venue}`);
    blocks.push(head.join('\n'));

    // ---- Event details ----
    //
    // Gated on the event's own field list, not just on "is it blank".
    // Blank-dropping alone is not enough: an event that was retyped can still
    // hold a value in a field its type doesn't have, and the post would then
    // announce a Max Runners count that the event's own card doesn't show.
    // `typeFields` is absent on an older payload or a test fixture, in which
    // case every field is allowed through and blank-dropping decides.
    const owns = (field) => !ev.typeFields || ev.typeFields.includes(field);

    const details = [
      ['teamLeader', I.teamLead, 'Team Lead', ev.teamLeader],
      ['offsiteSupport', I.offsite, 'Off Site Support', ev.offsiteSupport],
      ['categories', I.categories, 'Categories', spaceSeparators(ev.categories)],
      ['lanes', I.lanes, 'No. of Lanes', ev.lanes],
      ['gunstart', I.gunstart, 'Gun Start', spaceSeparators(ev.gunstart)],
      ['callTime', I.callTime, 'Call Time', ev.callTime],
      ['maxRunners', I.maxRunners, 'Max Runners', ev.maxRunners],
      ['meals', I.meals, 'Meals', ev.meals],
    ]
      .filter(([field, , , value]) => owns(field) && cleanValue(value) !== '')
      .map(([, icon, label, value]) => `${icon}  ${label}: ${cleanValue(value)}`);

    if (details.length) {
      blocks.push([`${I.details}  EVENT DETAILS`, ANNOUNCE_RULE, '', ...details].join('\n'));
    }

    // ---- Marshal lineup ----
    // This event's own roles, in the type's order, then any off-type role
    // still holding people (from before the event was typed) so nobody is
    // left off the post. Falls back to the master list for a fixture or an
    // older payload with no type info.
    const lineupRoles = (ev.typeRoles && ev.typeRoles.length) || (ev.extraRoles && ev.extraRoles.length)
      ? [...(ev.typeRoles || []), ...(ev.extraRoles || [])]
      : ALL_ROLES;

    const lineup = [];
    lineupRoles.forEach((role) => {
      const assigned = ev.assignments[role] || [];
      if (assigned.length === 0) return; // unfilled roles stay out of the post
      if (lineup.length) lineup.push('');
      lineup.push(`${I.role}  ${role.toUpperCase()}`);
      assigned.forEach((a, i) => {
        const note = cleanValue(a.note);
        // Staff off the employee_list roster are marked so the posted lineup
        // distinguishes them from marshals who signed up.
        const tag = a.kind === 'employee' ? ' (Employee)' : '';
        lineup.push(`     ${i + 1}.  ${cleanValue(a.name)}${tag}${note ? ` — ${note}` : ''}`);
      });
    });

    if (lineup.length) {
      blocks.push([`${I.lineup}  MARSHAL LINEUP`, ANNOUNCE_RULE, '', ...lineup].join('\n'));
    }

    // ---- Logistics ---- (Timing events only, same gate as the card)
    const logistics = [
      ['transpo', I.transpo, 'Transportation', ev.transpo],
      ['driver', I.driver, 'Driver', ev.driver],
      ['driverNumber', I.contact, 'Contact', ev.driverNumber],
      ['rate', I.rate, 'Rate', ev.rate],
    ]
      .filter(([field, , , value]) => owns(field) && cleanValue(value) !== '')
      .map(([, icon, label, value]) => `${icon}  ${label}: ${cleanValue(value)}`);

    if (logistics.length) {
      blocks.push([`${I.logistics}  LOGISTICS`, ANNOUNCE_RULE, '', ...logistics].join('\n'));
    }

    // One blank line between blocks; nothing trailing.
    return blocks.join('\n\n');
  }

  function copyAnnouncement(ev) {
    copyToClipboard(buildAnnouncement(ev));
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
  // "2026-09-13" is a bare calendar date. Passing it to `new Date()` parses it
  // as UTC midnight, so anywhere west of UTC this rendered the PREVIOUS day --
  // the same trap server/config/schedule.js avoids. Build from the parts so the
  // calendar date is whatever was typed, wherever this runs.
  function formatDate(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  }

  // Re-tint on a theme flip: the rating ramp is baked into inline styles at
  // render time, so whatever is currently on screen has to be redrawn.
  window.addEventListener('lineup:themechange', () => {
    if (allActiveEvents.length) renderCreateList();
    if (marshalListData.length) renderMarshalList();
  });

  // Initial load. The type catalogue comes first: the Generate Event tab is
  // the one showing on arrival and it cannot build its form without it.
  (async () => {
    await loadEventTypes();
    renderGenerateForm();
    loadCreateList();
  })();
})();
