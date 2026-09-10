(function () {
  const user = Auth.requireRole('marshal');
  if (!user) return;

  document.getElementById('welcomeText').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());

  // Re-check against the server in case localStorage is stale (e.g. this tab
  // was open from before the profile was completed) -- Auth.requireRole only
  // trusted the cached copy.
  (async () => {
    try {
      const { user: fresh } = await apiRequest('/auth/me');
      if (!fresh.profileComplete) {
        Auth.setSession(Auth.getToken(), fresh);
        window.location.href = 'complete-profile.html';
        return;
      }
      Auth.setSession(Auth.getToken(), fresh);
    } catch (err) {
      // apiRequest already redirects to index.html on an expired session.
    }
  })();

  // Advisory only -- these pages work in a webview, but if the marshal got
  // here from a Messenger link, warn them before something else surprises them.
  if (window.InApp && window.InApp.active) {
    window.InApp.renderNotice(document.getElementById('inappNotice'), 'advisory');
  }

  const alertBox = document.getElementById('alertBox');
  const currentSubmissionBox = document.getElementById('currentSubmissionBox');
  const signupGroups = document.getElementById('signupGroups');
  const form = document.getElementById('marshalForm');

  function clearAlert() { alertBox.innerHTML = ''; }
  function setAlert(message, type = 'error') {
    alertBox.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  }

  function checkItem(id, name, value, label) {
    const wrapper = document.createElement('label');
    wrapper.className = 'check-item';
    wrapper.innerHTML = `<input type="checkbox" name="${name}" value="${escapeAttr(value)}" id="${id}" /> <span>${escapeHtml(label)}</span>`;
    const input = wrapper.querySelector('input');
    input.addEventListener('change', () => wrapper.classList.toggle('checked', input.checked));
    return wrapper;
  }

  let eventsById = {};
  let typeGroups = [];      // [{ name, roles, untyped? }]
  let untypedGroup = 'Other';

  // Ids have to survive spaces and dots ("Bib Production", "Ma. Angelica"),
  // and are used to find a checkbox again when prefilling.
  function slug(str) { return String(str).replace(/[^A-Za-z0-9]+/g, '_'); }
  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const escapeAttr = escapeHtml;

  /** "a" / "an" for a type name -- "an Entractiv event", not "a Entractiv event". */
  function article(word) {
    return /^[aeiou]/i.test(String(word || '')) ? 'an' : 'a';
  }

  /** Which group an event belongs to. Untyped legacy events fall into "Other". */
  function groupNameFor(ev) { return ev.eventType || untypedGroup; }

  /**
   * One block per event type, each with that type's open events and only that
   * type's roles.
   *
   * The types have disjoint role sets -- a Spotter is a Timing thing, Walk-ins
   * belongs to Kit Claiming and Entractiv -- so a single flat role list (what
   * this form used to show) offered marshals roles that didn't exist on the
   * events they were ticking. Groups with no open events are left out entirely
   * rather than rendered empty.
   */
  function renderGroups(events, submission) {
    signupGroups.innerHTML = '';

    if (events.length === 0) {
      signupGroups.innerHTML = '<p class="pool-empty">No events are open for sign-up right now. Check back soon.</p>';
      return;
    }

    const byGroup = {};
    events.forEach((ev) => {
      const key = groupNameFor(ev);
      (byGroup[key] = byGroup[key] || []).push(ev);
    });

    // Follow the server's group order, so the form reads the same way every time.
    typeGroups.forEach((group) => {
      const groupEvents = byGroup[group.name] || [];
      if (groupEvents.length === 0) return;

      const box = document.createElement('div');
      box.className = 'signup-type-group';
      box.dataset.type = group.name;

      const head = document.createElement('div');
      head.className = 'signup-type-head';
      const h = document.createElement('h3');
      h.textContent = group.untyped ? 'Other events' : `${group.name} events`;
      head.appendChild(h);
      const count = document.createElement('span');
      count.className = 'signup-type-count';
      count.textContent = `${groupEvents.length} open`;
      head.appendChild(count);
      box.appendChild(head);

      const evHead = document.createElement('p');
      evHead.className = 'signup-subhead';
      evHead.textContent = 'Events';
      box.appendChild(evHead);

      const evGrid = document.createElement('div');
      evGrid.className = 'checkbox-grid';
      groupEvents.forEach((ev) => {
        const label = `${ev.name} — ${formatDate(ev.date)} — ${ev.location}`;
        evGrid.appendChild(checkItem(`ev_${ev._id}`, 'events', ev._id, label));
      });
      box.appendChild(evGrid);

      const roleHead = document.createElement('p');
      roleHead.className = 'signup-subhead';
      roleHead.textContent = group.untyped
        ? 'Roles for these events'
        : `Roles at ${article(group.name)} ${group.name} event`;
      box.appendChild(roleHead);

      const roleGrid = document.createElement('div');
      roleGrid.className = 'checkbox-grid';
      // The role input name carries the group, so the submit handler can post
      // roles per type without having to map back from the DOM.
      const inputName = `roles__${group.name}`;
      group.roles.forEach((role) => {
        roleGrid.appendChild(checkItem(`role_${slug(group.name)}__${slug(role)}`, inputName, role, role));
      });
      box.appendChild(roleGrid);

      signupGroups.appendChild(box);
    });

    if (submission) prefill(submission);
  }

  /**
   * Re-tick what the marshal submitted last time.
   *
   * Submissions made before roles were per-type only carry the flat `roles`
   * array. Those are re-ticked in every group that actually has the role, so
   * an older submission still shows up as something rather than as blank.
   */
  function prefill(submission) {
    (submission.events || []).forEach((id) => {
      const box = document.getElementById(`ev_${id}`);
      if (box) { box.checked = true; box.closest('.check-item').classList.add('checked'); }
    });

    const byType = submission.rolesByType || null;
    const hasByType = byType && Object.keys(byType).length > 0;

    typeGroups.forEach((group) => {
      const roles = hasByType
        ? (Array.isArray(byType[group.name]) ? byType[group.name] : [])
        : (submission.roles || []).filter((r) => group.roles.includes(r));
      roles.forEach((role) => {
        const box = document.getElementById(`role_${slug(group.name)}__${slug(role)}`);
        if (box) { box.checked = true; box.closest('.check-item').classList.add('checked'); }
      });
    });
  }

  function renderCurrentSubmission(submission) {
    if (!submission) { currentSubmissionBox.innerHTML = ''; return; }

    const eventNames = (submission.events || [])
      .map((id) => (eventsById[id] ? eventsById[id].name : null))
      .filter(Boolean);

    if (eventNames.length === 0) {
      currentSubmissionBox.innerHTML = `<div class="alert alert-success">
        You are not currently signed up for any events. Select one or more below and submit to join.
      </div>`;
      return;
    }

    // Read back per type, which is how it was chosen.
    const byType = submission.rolesByType || {};
    const parts = Object.keys(byType).length
      ? Object.entries(byType)
          .filter(([, roles]) => (roles || []).length)
          .map(([type, roles]) => `<strong>${escapeHtml(type)}</strong> as ${escapeHtml((roles || []).join(', '))}`)
      : [`as <strong>${escapeHtml((submission.roles || []).join(', '))}</strong>`];

    currentSubmissionBox.innerHTML = `<div class="alert alert-success">
      You're currently signed up for <strong>${escapeHtml(eventNames.join(', '))}</strong> —
      ${parts.join('; ')}. Submitting below will overwrite this.
    </div>`;
  }

  async function load() {
    try {
      const [{ events, typeGroups: groups, untypedGroup: other, roles }, { submission }] = await Promise.all([
        apiRequest('/marshal/events'),
        apiRequest('/marshal/mine'),
      ]);

      eventsById = Object.fromEntries(events.map((e) => [e._id, e]));
      untypedGroup = other || 'Other';
      // Fall back to a single flat group if an older server is answering.
      typeGroups = (groups && groups.length)
        ? groups
        : [{ name: untypedGroup, roles: roles || [], untyped: true }];

      renderGroups(events, submission);
      renderCurrentSubmission(submission);
    } catch (err) {
      setAlert(err.message);
    }
  }

  function formatDate(d) {
    // "2026-09-13" is a bare calendar date -- new Date() would read it as UTC
    // midnight and render the previous day west of UTC. Build from the parts.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();

    const events = Array.from(form.querySelectorAll('input[name="events"]:checked')).map((el) => el.value);

    // Roles are collected per type, from the group each checkbox sits in.
    const rolesByType = {};
    typeGroups.forEach((group) => {
      const picked = Array.from(form.querySelectorAll(`input[name="roles__${cssEscape(group.name)}"]:checked`))
        .map((el) => el.value);
      if (picked.length) rolesByType[group.name] = picked;
    });

    // Ticking nothing at all is allowed -- it means "take me out of
    // consideration for everything", so no roles are required either.
    if (events.length > 0) {
      // Every type you picked an event in needs a role, or the submission says
      // nothing about what you'd do at those events. Named explicitly, because
      // "select a role" is confusing when you've already ticked one elsewhere.
      const missing = [];
      typeGroups.forEach((group) => {
        const anyEvent = Array.from(form.querySelectorAll('input[name="events"]:checked'))
          .some((el) => groupNameFor(eventsById[el.value] || {}) === group.name);
        if (anyEvent && !(rolesByType[group.name] || []).length) missing.push(group.name);
      });
      if (missing.length) {
        return setAlert(
          `Pick at least one role for: ${escapeHtml(missing.join(', '))}. You've selected ${missing.length === 1 ? 'an event' : 'events'} there but no role.`
        );
      }
    }

    try {
      const { removedFrom } = await apiRequest('/marshal/submit', { method: 'POST', body: { events, rolesByType } });
      if (events.length === 0) {
        const extra = removedFrom && removedFrom.length
          ? ` You've also been removed from the lineup for: ${removedFrom.map((r) => r.eventName).join(', ')}.`
          : '';
        setAlert(`You've been removed from all events.${extra}`, 'success');
        showToast('Removed from all events', 'success');
      } else {
        setAlert('Your submission has been saved. Thank you!', 'success');
        showToast('Submission saved', 'success');
      }
      load();
    } catch (err) {
      setAlert(err.message);
    }
  });

  // Type names go into a querySelector attribute value. They are our own
  // strings, but "Bib Production" has a space and CSS.escape isn't everywhere,
  // so quote-escape rather than trusting the name.
  function cssEscape(str) {
    return String(str).replace(/["\\]/g, '\\$&');
  }

  load();
})();
