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

  // ---------------- Drag auto-scroll ----------------
  //
  // The Create List grid can run far taller than the viewport, but native
  // HTML5 drag-and-drop does not reliably auto-scroll a plain window scroll
  // container the way it scrolls a textarea or a single scrollable div --
  // dragging a marshal/employee chip toward the top or bottom edge of the
  // screen just leaves the pointer pinned there with no way to reach a role
  // slot further up or down the page. This makes the page itself scroll
  // while a drag from this app is in progress and the pointer is near an
  // edge, so long lists stay reachable mid-drag.
  (function setupDragAutoScroll() {
    const EDGE = 90; // px from the viewport edge where scrolling kicks in
    const MAX_SPEED = 22; // px scrolled per animation frame right at the edge
    let speed = 0;
    let rafId = null;

    function tick() {
      if (!speed) {
        rafId = null;
        return;
      }
      window.scrollBy(0, speed);
      rafId = requestAnimationFrame(tick);
    }

    function updateSpeed(clientY) {
      const vh = window.innerHeight;
      let next = 0;
      if (clientY < EDGE) {
        next = -Math.max(4, MAX_SPEED * ((EDGE - clientY) / EDGE));
      } else if (clientY > vh - EDGE) {
        next = Math.max(4, MAX_SPEED * ((clientY - (vh - EDGE)) / EDGE));
      }
      speed = next;
      if (speed && rafId === null) rafId = requestAnimationFrame(tick);
    }

    function stop() {
      speed = 0;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    document.addEventListener('dragover', (e) => {
      // Only steer scrolling for this app's own chips (marshal/employee
      // drags) -- dataTransfer.types is readable during dragover even though
      // getData() isn't, so this doesn't need to know which chip it is.
      const types = e.dataTransfer && e.dataTransfer.types;
      const ours = types && Array.from(types).some((t) => t === 'text/marshal-id' || t === 'text/employee-id');
      if (!ours) return;
      updateSpeed(e.clientY);
    });
    document.addEventListener('dragend', stop);
    document.addEventListener('drop', stop);
    // Dragging the pointer off the browser window entirely stops delivering
    // dragover events, so without this the last speed would keep scrolling.
    document.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) stop();
    });
  })();

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

  function buildGenField(field, typeName, initialValue, keep = {}) {
    const def = FIELD_DEFS[field] || { label: field };
    const wrap = document.createElement('div');
    wrap.className = 'field' + (def.span === 2 ? ' span-2' : '');
    wrap.dataset.field = field;

    const id = `gen${field.charAt(0).toUpperCase()}${field.slice(1)}`;
    const label = document.createElement('label');
    label.textContent = def.label;
    wrap.appendChild(label);

    // Timing only: Team Lead / Off Site Support are the same employee
    // checklist as the Create List card (buildGenTeamChecklist), not free
    // text. No `for` on the label here -- there's no single focusable target
    // to point it at, just the <details> disclosure inside.
    if (typeName === TEAM_DROPDOWN_TYPE && TEAM_DROPDOWN_FIELDS.includes(field)) {
      wrap.appendChild(buildGenTeamChecklist(field, id, initialValue));
      return wrap;
    }

    label.setAttribute('for', id);

    // The date is a start/end pair on every type that can run over
    // consecutive weekdays (all but Timing), and a single date otherwise.
    // Either way it carries the weekday/weekend hint, rebuilt with the field.
    if (field === 'date') {
      const t = typeByName(typeName);
      const allowRange = Boolean(t && t.multiDay);
      if (allowRange) label.textContent = 'Date(s)';
      const range = buildDateRangeInputs({
        startId: id,
        endId: 'genEndDate',
        hintId: 'genDateHint',
        startValue: initialValue,
        endValue: keep.endDate,
        allowRange,
        genFields: true,
      });
      wrap.appendChild(range.el);
      return wrap;
    }

    const input = document.createElement('input');
    input.type = def.type || 'text';
    input.id = id;
    input.dataset.genField = field;
    if (def.required) input.required = true;
    if (def.placeholder) input.placeholder = def.placeholder;
    if (initialValue !== undefined) input.value = initialValue;
    wrap.appendChild(input);
    return wrap;
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
      genFieldGrid.appendChild(buildGenField(field, typeName, keep[field], keep));
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
    // A range that crosses a weekend is refused before it reaches the server
    // (the end-date input carries the reason as its validity message).
    const endInput = document.getElementById('genEndDate');
    if (endInput && !endInput.checkValidity()) {
      generateAlertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(endInput.validationMessage)}</div>`;
      return;
    }

    try {
      const created = await apiRequest('/admin/events', { method: 'POST', body: payload });
      // A brand-new event is the one about to be lined up, so it opens
      // already expanded in Create List while the rest stay collapsed.
      if (created && created.event && created.event._id) expandedEvents.add(created.event._id);
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

  // ---- Team filter + collapsible cards -------------------------------------
  //
  // "Team" here is the event type. '' means All Events; UNTYPED_FILTER picks
  // out events saved before types existed (only offered while any exist).
  // The filter only decides which cards are SHOWN -- the weekend one-event
  // rule (buildAssignedMap) still looks at every active event, so hiding a
  // card can never let someone be double-booked.
  const createListTypeFilter = document.getElementById('createListTypeFilter');
  const UNTYPED_FILTER = '__untyped';
  const FILTER_KEY = 'lineup_createlist_team';
  let createListFilter = '';
  try { createListFilter = localStorage.getItem(FILTER_KEY) || ''; } catch (err) { /* storage blocked: default to All Events */ }

  // Cards start collapsed; this holds the ids of the ones opened. It lives
  // outside renderCreateList() because every assign/unassign rebuilds the
  // grid, and an open card must stay open through that.
  const expandedEvents = new Set();

  createListTypeFilter.addEventListener('change', () => {
    createListFilter = createListTypeFilter.value;
    try { localStorage.setItem(FILTER_KEY, createListFilter); } catch (err) { /* not fatal */ }
    renderCreateList();
  });
  document.getElementById('expandAllCreateList').addEventListener('click', () => {
    eventsForFilter().forEach((ev) => expandedEvents.add(ev._id));
    renderCreateList();
  });
  document.getElementById('collapseAllCreateList').addEventListener('click', () => {
    eventsForFilter().forEach((ev) => expandedEvents.delete(ev._id));
    renderCreateList();
  });

  function eventsForFilter() {
    if (!createListFilter) return allActiveEvents;
    if (createListFilter === UNTYPED_FILTER) return allActiveEvents.filter((ev) => !ev.eventType);
    return allActiveEvents.filter((ev) => ev.eventType === createListFilter);
  }

  // Rebuilt on every render so the counts stay current as events are added,
  // completed or deleted.
  function renderTypeFilterOptions() {
    const names = eventTypes.map((t) => t.name);
    // Fall back to whatever types the events carry if the catalogue failed
    // to load, so the filter still works.
    allActiveEvents.forEach((ev) => {
      if (ev.eventType && !names.includes(ev.eventType)) names.push(ev.eventType);
    });
    const untypedCount = allActiveEvents.filter((ev) => !ev.eventType).length;

    // A remembered filter that no longer applies (e.g. the last untyped event
    // was typed) falls back to All Events rather than showing an empty page.
    const valid = createListFilter === '' ||
      names.includes(createListFilter) ||
      (createListFilter === UNTYPED_FILTER && untypedCount > 0);
    if (!valid) createListFilter = '';

    const opts = [{ value: '', label: 'All Events', count: allActiveEvents.length }];
    names.forEach((name) => opts.push({
      value: name,
      label: name,
      count: allActiveEvents.filter((ev) => ev.eventType === name).length,
    }));
    if (untypedCount) opts.push({ value: UNTYPED_FILTER, label: 'Untyped', count: untypedCount });

    createListTypeFilter.innerHTML = '';
    opts.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = `${o.label} (${o.count})`;
      createListTypeFilter.appendChild(opt);
    });
    createListTypeFilter.value = createListFilter;
  }

  // Slots filled vs. slots set, across the roles the card shows. An off-type
  // role has no capacity of its own, so the people in it count as its size.
  function fillSummary(ev) {
    let filled = 0;
    let total = 0;
    [...(ev.typeRoles || []), ...(ev.extraRoles || [])].forEach((role) => {
      const assigned = ((ev.assignments || {})[role] || []).length;
      const cap = (ev.roleCapacities || {})[role] || 0;
      filled += assigned;
      total += Math.max(cap, assigned);
    });
    return { filled, total };
  }

  // Turns the slate card head into the open/close control and adds the
  // at-a-glance line a collapsed card needs: slots filled, and how many
  // signed-up marshals are still waiting in the pool.
  function makeCollapsible(wrapper, card, ev) {
    const head = card.querySelector('.card-head');
    const open = expandedEvents.has(ev._id);
    wrapper.classList.toggle('collapsed', !open);

    head.classList.add('card-head-toggle');
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.setAttribute('aria-expanded', String(open));
    head.title = open ? 'Collapse this event' : 'Expand to line up this event';

    const chevron = document.createElement('span');
    chevron.className = 'collapse-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    head.querySelector('.card-head-top').appendChild(chevron);

    const { filled, total } = fillSummary(ev);
    const waiting = unplacedSignups(ev).length;
    const summary = document.createElement('div');
    summary.className = 'card-head-summary' + (total > 0 && filled >= total ? ' full' : '');
    const slotsText = total > 0 ? `${filled} / ${total} slots filled` : 'No slots set yet';
    summary.textContent = `${slotsText}  ·  ${waiting} in pool`;
    head.appendChild(summary);

    const toggle = () => {
      const nowOpen = wrapper.classList.contains('collapsed');
      wrapper.classList.toggle('collapsed', !nowOpen);
      head.setAttribute('aria-expanded', String(nowOpen));
      head.title = nowOpen ? 'Collapse this event' : 'Expand to line up this event';
      if (nowOpen) expandedEvents.add(ev._id);
      else expandedEvents.delete(ev._id);
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); // Space would otherwise scroll the page
        toggle();
      }
    });
  }

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

    renderTypeFilterOptions();

    createListGrid.innerHTML = '';
    if (allActiveEvents.length === 0) {
      createListGrid.innerHTML = '<div class="empty-state">No active events yet. Add one under "Generate Event".</div>';
      return;
    }
    const visibleEvents = eventsForFilter();
    if (visibleEvents.length === 0) {
      const label = createListFilter === UNTYPED_FILTER ? 'untyped' : escapeHtml(createListFilter);
      createListGrid.innerHTML = `<div class="empty-state">No active ${label} events. Pick another team, or "All Events".</div>`;
      return;
    }
    visibleEvents.forEach((ev) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'event-card-wrapper';
      const card = buildEventCard(ev, { editable: true });
      wrapper.appendChild(card);
      wrapper.appendChild(buildPoolCard(ev));
      makeCollapsible(wrapper, card, ev);
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

  // Team Lead / Off Site Support, on Timing events only, become a checklist
  // against the employee_list roster instead of free text -- picked over
  // every-type because Timing is the type this actually matters for day to
  // day. Kit Claiming's Off Site Support and every type's Team Leader stay
  // plain text, unchanged. Applies both here (Create List) and in Generate
  // Event -- see buildGenTeamChecklist below.
  //
  // The stored value is still the same plain string the field always held,
  // historically several names typed as "Brett / Jordan / Joshua" (see the
  // Generate Event placeholder) -- so nothing about the schema, the PDF or
  // the announcement needed to change. The checklist just reads and writes
  // that string, split/joined on " / ".
  //
  // The checkbox list itself is further filtered to employees whose own
  // `team` field (a column on employee_list, alongside `name`) matches this
  // type -- not the whole roster. A Kit Claiming-team employee never shows up
  // as a pickable Team Lead on a Timing event, even though the widget itself
  // only appears on Timing events.
  const TEAM_DROPDOWN_TYPE = 'Timing';
  const TEAM_DROPDOWN_FIELDS = ['teamLeader', 'offsiteSupport'];

  function employeesForTeam(teamName) {
    const target = String(teamName || '').trim().toLowerCase();
    if (!target) return [];
    return allEmployees.filter((e) => String(e.team || '').trim().toLowerCase() === target);
  }

  function splitTeamNames(value) {
    return String(value || '').split('/').map((s) => s.trim()).filter(Boolean);
  }

  function joinTeamNames(names) {
    return names.join(' / ');
  }

  // Builds the checklist markup shared by the Create List card and Generate
  // Event: a <details> summary plus one checkbox row per employee on
  // `teamEmployees`. `preserved` is shown in the summary alongside whatever
  // is checked but never gets a checkbox of its own (see buildTeamMultiSelect
  // below for what it holds). `onToggle(checkedNames)` fires whenever a box
  // changes, with the full checked-name list in DOM order; the caller
  // decides what to do with it (save immediately, or just keep a hidden
  // field in sync).
  function buildTeamChecklistWidget(teamEmployees, initialChecked, preserved, onToggle) {
    const checked = new Set(initialChecked);

    const wrap = document.createElement('details');
    wrap.className = 'team-multiselect';

    const summary = document.createElement('summary');
    summary.className = 'team-multiselect-summary';
    const renderSummary = () => {
      const all = [...checked, ...preserved];
      summary.textContent = all.length ? all.join(', ') : 'Select…';
      summary.title = all.length ? all.join(', ') : 'No one selected';
    };
    renderSummary();
    wrap.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'team-multiselect-list';

    if (!teamEmployees.length) {
      const empty = document.createElement('p');
      empty.className = 'team-multiselect-empty';
      empty.textContent = allEmployees.length
        ? `No employees are tagged for the ${TEAM_DROPDOWN_TYPE} team`
        : 'No employees on file';
      list.appendChild(empty);
    } else {
      teamEmployees.forEach((emp) => {
        const row = document.createElement('label');
        row.className = 'team-check-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked.has(emp.name);
        cb.addEventListener('change', () => {
          if (cb.checked) checked.add(emp.name);
          else checked.delete(emp.name);
          renderSummary();
          onToggle([...checked]);
        });
        row.appendChild(cb);

        const span = document.createElement('span');
        span.textContent = emp.name;
        row.appendChild(span);

        list.appendChild(row);
      });
    }
    wrap.appendChild(list);

    return wrap;
  }

  // A name already on the field that doesn't match anyone currently on the
  // Timing team (older free text, someone since removed from the roster, or
  // someone on a different team) is never offered as a checkbox, but it is
  // also never silently dropped -- it rides along untouched as `preserved`
  // and is written back on every save, alongside whatever the checkboxes
  // decide.
  function buildTeamMultiSelect(ev, field) {
    const teamEmployees = employeesForTeam(TEAM_DROPDOWN_TYPE);
    const empNameSet = new Set(teamEmployees.map((e) => e.name));
    const current = splitTeamNames(ev[field]);
    const checked = current.filter((n) => empNameSet.has(n));
    const preserved = current.filter((n) => !empNameSet.has(n));

    return buildTeamChecklistWidget(teamEmployees, checked, preserved, (checkedNames) => {
      updateEventField(ev._id, field, joinTeamNames([...checkedNames, ...preserved]));
    });
  }

  // Same checklist for the Generate Event form, where there is nothing to
  // save yet -- it just keeps a hidden field (`data-gen-field`) in sync so
  // the existing generic value-collection code (the submit handler, and the
  // "carry values across a type switch" logic in renderGenerateForm) picks
  // it up exactly like a plain text field, with no changes to either.
  function buildGenTeamChecklist(field, id, initialValue) {
    const teamEmployees = employeesForTeam(TEAM_DROPDOWN_TYPE);
    const empNameSet = new Set(teamEmployees.map((e) => e.name));
    const current = splitTeamNames(initialValue);
    const checked = current.filter((n) => empNameSet.has(n));
    const preserved = current.filter((n) => !empNameSet.has(n));

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = id;
    hidden.dataset.genField = field;
    hidden.value = joinTeamNames([...checked, ...preserved]);

    const widget = buildTeamChecklistWidget(teamEmployees, checked, preserved, (checkedNames) => {
      hidden.value = joinTeamNames([...checkedNames, ...preserved]);
    });
    widget.appendChild(hidden);

    return widget;
  }

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

  // On/Off switch in the card head: ON events are offered on the marshal
  // sign-up form, OFF events are hidden from it. It sits inside the head,
  // which is the collapse control on Create List, so its clicks and keys are
  // kept from reaching the head and toggling the card.
  function buildSignupSwitch(ev) {
    const on = ev.signupOpen !== false;
    const wrap = document.createElement('label');
    wrap.className = 'signup-switch' + (on ? ' on' : '');
    wrap.title = on
      ? 'Shown on the marshal sign-up form. Switch off to hide it.'
      : 'Hidden from the marshal sign-up form. Switch on to show it.';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = on;
    input.setAttribute('aria-label', `Show ${ev.name} on the marshal sign-up form`);

    const track = document.createElement('span');
    track.className = 'signup-switch-track';
    track.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'signup-switch-text';
    text.textContent = on ? 'Sign-up: On' : 'Sign-up: Off';

    wrap.append(input, track, text);
    ['click', 'keydown'].forEach((type) => wrap.addEventListener(type, (e) => e.stopPropagation()));
    input.addEventListener('change', () => setSignupOpen(ev._id, input.checked, input));
    return wrap;
  }

  async function setSignupOpen(eventId, open, input) {
    input.disabled = true;
    try {
      const { event } = await apiRequest(`/admin/events/${eventId}/signup`, { method: 'POST', body: { open } });
      replaceLocalEvent(event);
      showToast(open ? 'Event is now on the sign-up form.' : 'Event is now hidden from the sign-up form.', 'success');
    } catch (err) {
      input.checked = !open;
      input.disabled = false;
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

    // A consecutive-day event reads "Wednesday – Friday, 9/16 – 9/18/2026 (3 days)".
    const dayText = dayRangeName(ev);
    const dayLabel = dayText ? `${escapeHtml(dayText)}, ` : '';
    const dayCountText = ev.dayCount > 1 ? ` (${ev.dayCount} days)` : '';
    head.innerHTML =
      `<div class="card-head-top"><h3>${escapeHtml(ev.name)}</h3>` +
      `<span class="card-head-tags">${typeTag}` +
      `<span class="${tagClass}" title="${tagTitle}">${tagText}</span></span></div>` +
      `<div class="meta">${dayLabel}${formatDateRange(ev.date, ev.endDate)}${dayCountText} &nbsp;•&nbsp; ${escapeHtml(ev.location)}</div>`;
    if (editable) head.appendChild(buildSignupSwitch(ev));
    card.appendChild(head);

    // Edit Event Details (name / dates / location) opens right under the head.
    if (editable && editingEvents.has(ev._id)) card.appendChild(buildEditDetailsPanel(ev));

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

    if (editable) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-secondary edit-details-btn';
      editBtn.textContent = 'Edit Details';
      editBtn.title = 'Change the event name, date(s) or location';
      editBtn.addEventListener('click', () => openEditDetails(ev));
      footer.appendChild(editBtn);
    }

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

    const attendanceBtn = document.createElement('button');
    attendanceBtn.className = 'btn-secondary';
    attendanceBtn.textContent = 'Create Attendance Sheet';
    attendanceBtn.title = 'Download the attendance sheet (Excel) with the event, date, names and roles filled in';
    attendanceBtn.addEventListener('click', () => exportAttendanceSheet(ev, attendanceBtn));
    footer.appendChild(attendanceBtn);

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

  // ---- Edit Event Details --------------------------------------------------
  //
  // Name, date(s) and location live in the card head, where they aren't
  // editable in place, so they get their own small form. Open forms and what
  // has been typed into them are kept in `editingEvents` (eventId -> draft):
  // every assign/unassign rebuilds the grid, and a half-typed edit must not
  // vanish because someone was dragged into a slot meanwhile.
  //
  // Moving an event onto a weekend is where this can go wrong -- people lined
  // up while it was a weekday event were never checked against the weekend
  // rule. The server refuses that save and names who clashes; the message is
  // shown in the form so the admin can fix it and try again.
  const editingEvents = new Map();

  function openEditDetails(ev) {
    if (!editingEvents.has(ev._id)) {
      editingEvents.set(ev._id, { name: ev.name || '', date: ev.date || '', endDate: ev.endDate || '', location: ev.location || '' });
      renderCreateList();
    }
    const nameInput = document.getElementById(`editName_${ev._id}`);
    if (nameInput) {
      nameInput.closest('.edit-details').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      nameInput.focus();
    }
  }

  function closeEditDetails(eventId) {
    editingEvents.delete(eventId);
    renderCreateList();
  }

  function buildEditDetailsPanel(ev) {
    const draft = editingEvents.get(ev._id);
    const form = document.createElement('form');
    form.className = 'edit-details';
    form.setAttribute('aria-label', `Edit details for ${ev.name}`);

    const title = document.createElement('p');
    title.className = 'edit-details-title';
    title.textContent = 'Edit event details';
    form.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'edit-details-grid';
    form.appendChild(grid);

    const field = (labelText, forId, control, extraClass) => {
      const wrap = document.createElement('div');
      wrap.className = 'field' + (extraClass ? ` ${extraClass}` : '');
      const label = document.createElement('label');
      label.textContent = labelText;
      label.setAttribute('for', forId);
      wrap.appendChild(label);
      wrap.appendChild(control);
      grid.appendChild(wrap);
    };

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = `editName_${ev._id}`;
    nameInput.required = true;
    nameInput.value = draft.name;
    nameInput.addEventListener('input', () => { draft.name = nameInput.value; });
    field('Event Name', nameInput.id, nameInput, 'span-2');

    const range = buildDateRangeInputs({
      startId: `editDate_${ev._id}`,
      endId: `editEndDate_${ev._id}`,
      startValue: draft.date,
      endValue: draft.endDate,
      allowRange: Boolean(ev.allowsMultiDay),
    });
    range.start.addEventListener('input', () => { draft.date = range.start.value; draft.endDate = range.end ? range.end.value : ''; });
    if (range.end) range.end.addEventListener('input', () => { draft.endDate = range.end.value; });
    field(ev.allowsMultiDay ? 'Date(s)' : 'Date', range.start.id, range.el);

    const locInput = document.createElement('input');
    locInput.type = 'text';
    locInput.id = `editLocation_${ev._id}`;
    locInput.required = true;
    locInput.value = draft.location;
    locInput.addEventListener('input', () => { draft.location = locInput.value; });
    field('Location', locInput.id, locInput);

    const errorBox = document.createElement('div');
    errorBox.className = 'alert alert-error edit-details-error';
    errorBox.setAttribute('role', 'alert');
    errorBox.hidden = true;
    form.appendChild(errorBox);

    const actions = document.createElement('div');
    actions.className = 'edit-details-actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn-primary btn-small';
    saveBtn.textContent = 'Save Details';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-outline btn-small';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeEditDetails(ev._id));
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeEditDetails(ev._id); }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      if (!form.reportValidity()) return;
      const body = {
        name: nameInput.value.trim(),
        date: range.start.value,
        endDate: range.end ? range.end.value : '',
        location: locInput.value.trim(),
      };
      if (!body.name || !body.location) {
        errorBox.textContent = 'Event name and location can\'t be empty.';
        errorBox.hidden = false;
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const { event } = await apiRequest(`/admin/events/${ev._id}`, { method: 'PUT', body });
        editingEvents.delete(ev._id);
        const idx = allActiveEvents.findIndex((x) => x._id === event._id);
        if (idx >= 0) allActiveEvents[idx] = event;
        // A new date can move the card; keep the list in date order.
        allActiveEvents.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        buildAssignedMap();
        renderCreateList();
        showToast('Event details saved.', 'success');
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Details';
      }
    });

    return form;
  }

  function detailRow(label, field, ev, editable) {
    const row = document.createElement('div');
    row.className = 'detail-row';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'dlabel';
    labelSpan.textContent = `${label.toUpperCase()}:`;
    row.appendChild(labelSpan);

    if (editable && ev.eventType === TEAM_DROPDOWN_TYPE && TEAM_DROPDOWN_FIELDS.includes(field)) {
      row.appendChild(buildTeamMultiSelect(ev, field));
    } else if (editable) {
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
  // Marshals signed up for this event who aren't placed in any of its slots
  // yet -- the ones the pool card lists. Shared with the collapsed card's
  // summary line so the two counts can't disagree.
  function unplacedSignups(ev) {
    const candidates = allMarshals.filter((m) => (m.events || []).some((id) => String(id) === String(ev._id)));
    // Exclude marshals already placed in THIS event's slots (they show in the role slot instead).
    const placedHereIds = new Set(
      ALL_ROLES.flatMap((role) => ((ev.assignments || {})[role] || []).map((a) => String(a.marshalId)))
    );
    return candidates.filter((m) => !placedHereIds.has(String(m._id)));
  }

  function buildPoolCard(ev) {
    const visible = unplacedSignups(ev);

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

  // Each attended event collapses to one line: name, date, role (note), and
  // a status pill. Beyond the first two (already the most recent, since
  // /admin/marshal-list feeds them in date-descending order) the rest sit
  // behind a "+N more" toggle so a long history doesn't blow out row height.
  const ATTENDANCE_VISIBLE = 2;

  function buildAttendanceRow(a) {
    const item = document.createElement('div');
    item.className = 'attendance-item';
    const roleNote = a.note ? `${escapeHtml(a.role)} (${escapeHtml(a.note)})` : escapeHtml(a.role);
    const when = formatDateRange(a.date, a.endDate);
    const lineText = `${a.eventName} — ${when} · ${a.role}${a.note ? ` (${a.note})` : ''}`;
    item.innerHTML = `<span class="ev-line" title="${escapeHtml(lineText)}">` +
        `<span class="ev-name">${escapeHtml(a.eventName)}</span>` +
        `<span class="ev-meta"> · ${when} · ${roleNote}</span>` +
      `</span>` +
      `<span class="status-pill ${a.status}">${a.status}</span>`;
    return item;
  }

  function buildAttendanceList(events) {
    const wrap = document.createElement('div');
    wrap.className = 'attendance-list';

    events.slice(0, ATTENDANCE_VISIBLE).forEach((a) => wrap.appendChild(buildAttendanceRow(a)));

    const hiddenCount = events.length - ATTENDANCE_VISIBLE;
    if (hiddenCount > 0) {
      const extra = document.createElement('div');
      extra.className = 'attendance-extra';
      extra.hidden = true;
      events.slice(ATTENDANCE_VISIBLE).forEach((a) => extra.appendChild(buildAttendanceRow(a)));
      wrap.appendChild(extra);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'attendance-toggle';
      toggle.textContent = `+${hiddenCount} more`;
      toggle.addEventListener('click', () => {
        const willExpand = extra.hidden;
        extra.hidden = !willExpand;
        toggle.textContent = willExpand ? 'Show less' : `+${hiddenCount} more`;
      });
      wrap.appendChild(toggle);
    }

    return wrap;
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
        attendTd.appendChild(buildAttendanceList(m.eventsAttended));
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

  // Rating is shown as a TRAFFIC LIGHT: red at 1, amber in the middle, green
  // at 10. Returns null (no tint) when unrated.
  //
  // DELIBERATE BRAND DEPARTURE, approved 2026-09-15. The ITEMHOUND palette is
  // four colours and contains no green or amber, so this is the second
  // recorded exception after dark mode. It replaces the monochrome maroon
  // intensity ramp that shipped with the 2026-09-03 redesign, which was
  // on-palette but made 4 and 6 hard to tell apart at a glance.
  //
  // TWO sets of stops, not one. Chips sit on white in light mode and on
  // #445259 in dark, and no single ramp clears 3:1 against both surfaces.
  // Every value here was measured rather than eyeballed -- see
  // preview/rating-contrast.js, which walks all 10 ratings in both themes and
  // asserts the chip text stays >= 4.5:1 on the tinted background and the
  // solid edge stays >= 3:1 against the chip surface. Worst observed: 4.61:1
  // text (dark, rating 10) and 3.27:1 edge (light, rating 6).
  //
  // The light-mode middle stop is a dark gold rather than a true yellow:
  // yellow on white tops out near 2.7:1 as a solid bar, under the 3:1 a
  // non-text UI element needs to be seen at all.
  const RATING_STOPS = {
    light: [[198, 40, 40], [192, 138, 0], [46, 125, 50]],     // #C62828 #C08A00 #2E7D32
    dark: [[255, 135, 135], [251, 191, 36], [74, 222, 128]],  // #FF8787 #FBBF24 #4ADE80
  };

  function unratedSwatch() {
    // Neutral, and deliberately outside the ramp: unrated must not read as a
    // low rating, which a pale red would.
    return isDarkTheme() ? 'rgba(255, 255, 255, 0.10)' : 'rgba(217, 217, 217, 0.62)';
  }
  function isDarkTheme() {
    return document.documentElement.dataset.theme === 'dark';
  }
  function ratingRamp(rating) {
    const t = (Math.min(10, Math.max(1, rating)) - 1) / 9; // 0 -> 1
    const stops = isDarkTheme() ? RATING_STOPS.dark : RATING_STOPS.light;
    // Interpolated in two segments so the midpoint lands on amber. A direct
    // red-to-green interpolation passes through mud instead.
    const seg = t < 0.5 ? 0 : 1;
    const k = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    const from = stops[seg];
    const to = stops[seg + 1];
    const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * k)).join(', ');
    // The hue carries the rating, so the background tint barely ramps -- a
    // chip is never so saturated that the name on it gets hard to read. The
    // edge is full strength, which is what the Marshal List swatch shows.
    return { rgb, tint: (isDarkTheme() ? 0.16 : 0.12) + t * 0.10, edge: 1 };
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
  function exportEventPdf(ev, btn) {
    return downloadFromApi(`/api/admin/events/${ev._id}/pdf`, btn, {
      fallbackName: `${ev.name} MARSHALS LIST.pdf`,
      done: 'PDF exported.',
    });
  }

  // The team's attendance sheet template filled with this lineup (Event,
  // Date, full name + role per row; everything else blank for the day), as
  // "<Event Name>-Attendance Sheet.xlsx". One sheet per day for a
  // consecutive-day event.
  function exportAttendanceSheet(ev, btn) {
    return downloadFromApi(`/api/admin/events/${ev._id}/attendance-sheet`, btn, {
      fallbackName: `${ev.name}-Attendance Sheet.xlsx`,
      done: 'Attendance sheet created.',
    });
  }

  // Fetches a file the server builds (PDF, xlsx) and saves it under the name
  // the server sends. Errors arrive as JSON and surface as a toast.
  async function downloadFromApi(path, btn, { fallbackName, done }) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      const res = await fetch(path, {
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
      const name = filenameFromDisposition(res.headers.get('Content-Disposition')) || fallbackName;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on a delay: Safari needs the object URL alive past the click.
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      showToast(done, 'success');
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
    const parse = (raw) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanValue(raw));
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const d = parse(ev.date);
    if (!d) return cleanValue(ev.date);
    const day = ev.dayName || d.toLocaleDateString('en-US', { weekday: 'long' });

    // Consecutive days: "Wednesday, September 16 – Friday, September 18, 2026".
    const end = parse(ev.endDate);
    if (end && end > d) {
      const endDay = ev.endDayName || end.toLocaleDateString('en-US', { weekday: 'long' });
      const sameYear = end.getFullYear() === d.getFullYear();
      const first = d.toLocaleDateString('en-US', sameYear
        ? { month: 'long', day: 'numeric' }
        : { month: 'long', day: 'numeric', year: 'numeric' });
      const last = end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      return `${day}, ${first} – ${endDay}, ${last}`;
    }

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

  // ---------------- Consecutive-day dates ----------------
  //
  // Non-Timing events can run over several consecutive WEEKDAYS: `date` is the
  // first day, `endDate` the last ('' for a one-day event). These mirror
  // server/config/schedule.js so the form can answer instantly -- the server
  // re-checks everything and is the one that decides.
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function parseYMD(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
    return d;
  }
  const ymdOf = (d) => d.toISOString().slice(0, 10);
  const addDaysYMD = (str, n) => ymdOf(new Date(parseYMD(str).getTime() + n * 86400000));

  // { endDate, dayCount } or { error } -- same wording as the server.
  function checkWeekdayRange(startStr, endStr) {
    const start = parseYMD(startStr);
    if (!start) return { error: 'Pick a valid date.' };
    const end = String(endStr || '').trim();
    if (!end || end === startStr) return { endDate: '', dayCount: 1 };
    const last = parseYMD(end);
    if (!last) return { error: 'Pick a valid end date.' };
    if (last < start) return { error: 'The end date is before the start date.' };
    let count = 0;
    for (let t = start.getTime(); t <= last.getTime(); t += 86400000) {
      const dt = new Date(t);
      const day = dt.getUTCDay();
      if (day === 0 || day === 6) {
        return { error: `Consecutive days are for weekday events only — ${WEEKDAY_NAMES[day]} ${dt.getUTCMonth() + 1}/${dt.getUTCDate()}/${dt.getUTCFullYear()} is a weekend. Keep the range within one Monday–Friday week.` };
      }
      count += 1;
    }
    return { endDate: end, dayCount: count };
  }

  // "9/16/2026" or, for a range, "9/16 – 9/18/2026" (year written once unless
  // the range crosses into a new year).
  function formatDateRange(start, end) {
    const a = parseYMD(start);
    const b = parseYMD(end);
    if (!a || !b || b <= a) return formatDate(start);
    if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${formatDate(start)} – ${formatDate(end)}`;
    return `${a.getUTCMonth() + 1}/${a.getUTCDate()} – ${formatDate(end)}`;
  }

  // "Wednesday – Friday" for a range, else the single day name.
  function dayRangeName(ev) {
    if (ev.endDate && ev.endDayName && ev.endDate !== ev.date) return `${ev.dayName} – ${ev.endDayName}`;
    return ev.dayName || '';
  }

  /**
   * The start/end date pair used by BOTH Generate Event and Edit Event
   * Details. With `allowRange` false (Timing, untyped) it is just the one date
   * input, exactly as before. Otherwise an optional end date sits beside it:
   * limited to the rest of that Monday–Friday week, disabled when the start
   * falls on a weekend (weekend events are one day), and checked live with
   * the reason shown in the hint and set as the input's validity message so a
   * bad range can't be submitted.
   *
   * Returns { el, start, end, hint } -- `end` is null without a range.
   */
  function buildDateRangeInputs({ startId, endId, hintId, startValue, endValue, allowRange, genFields }) {
    const el = document.createElement('div');
    el.className = 'date-range';

    const row = document.createElement('div');
    row.className = 'date-range-row';
    el.appendChild(row);

    const start = document.createElement('input');
    start.type = 'date';
    start.id = startId;
    start.required = true;
    if (genFields) start.dataset.genField = 'date';
    if (startValue) start.value = startValue;
    row.appendChild(start);

    let end = null;
    if (allowRange) {
      const to = document.createElement('span');
      to.className = 'date-range-to';
      to.textContent = 'to';
      row.appendChild(to);

      end = document.createElement('input');
      end.type = 'date';
      end.id = endId;
      end.setAttribute('aria-label', 'End date (optional, consecutive weekdays)');
      if (genFields) end.dataset.genField = 'endDate';
      if (endValue) end.value = endValue;
      row.appendChild(end);
    }

    const hint = document.createElement('p');
    hint.className = 'field-hint';
    if (hintId) hint.id = hintId;
    el.appendChild(hint);

    const paint = () => {
      const d = parseYMD(start.value);
      if (end) end.setCustomValidity('');
      if (!d) {
        hint.textContent = allowRange ? 'Add an end date too if it runs over consecutive weekdays.' : '';
        hint.className = 'field-hint';
        if (end) { end.disabled = false; end.removeAttribute('min'); end.removeAttribute('max'); }
        return;
      }
      const day = d.getUTCDay();
      const weekend = day === 0 || day === 6;

      if (end) {
        if (weekend) {
          end.value = '';
          end.disabled = true;
        } else {
          end.disabled = false;
          end.min = start.value;
          end.max = addDaysYMD(start.value, 5 - day); // that week's Friday
        }
      }

      if (weekend) {
        hint.textContent = `${WEEKDAY_NAMES[day]} — weekend event: each marshal can hold only one weekend event.` +
          (allowRange ? ' Weekend events are one day only.' : '');
        hint.className = 'field-hint field-hint-weekend';
        return;
      }

      const range = end ? checkWeekdayRange(start.value, end.value) : { endDate: '', dayCount: 1 };
      if (range.error) {
        hint.textContent = range.error;
        hint.className = 'field-hint field-hint-error';
        end.setCustomValidity(range.error);
        return;
      }
      if (range.dayCount > 1) {
        const last = WEEKDAY_NAMES[parseYMD(range.endDate).getUTCDay()];
        hint.textContent = `${WEEKDAY_NAMES[day]} – ${last}, ${range.dayCount} days — weekday event: marshals can be lined up on several of these.`;
      } else {
        hint.textContent = `${WEEKDAY_NAMES[day]} — weekday event: marshals can be lined up on several of these.`;
      }
      hint.className = 'field-hint';
    };
    start.addEventListener('input', paint);
    start.addEventListener('change', paint);
    if (end) {
      end.addEventListener('input', paint);
      end.addEventListener('change', paint);
    }
    paint();
    return { el, start, end, hint };
  }

  // Re-tint on a theme flip: the rating ramp is baked into inline styles at
  // render time, so whatever is currently on screen has to be redrawn.
  window.addEventListener('lineup:themechange', () => {
    if (allActiveEvents.length) renderCreateList();
    if (marshalListData.length) renderMarshalList();
  });

  // Initial load. The type catalogue comes first: the Generate Event tab is
  // the one showing on arrival and it cannot build its form without it.
  //
  // loadCreateList() is also what fetches `allEmployees` -- needed by the
  // Team Lead / Off Site Support checklist in THIS form, not just the
  // Create List tab. It's normally done well before anyone finishes picking
  // "Timing" from the type select, but on the off chance it wasn't, re-render
  // once it lands so the checklist doesn't get stuck showing an empty roster.
  (async () => {
    await loadEventTypes();
    renderGenerateForm();
    await loadCreateList();
    if (genTypeSelect.value === TEAM_DROPDOWN_TYPE) renderGenerateForm();
  })();
})();
