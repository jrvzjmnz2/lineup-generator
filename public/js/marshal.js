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
  const eventsGrid = document.getElementById('eventsCheckboxGrid');
  const rolesGrid = document.getElementById('rolesCheckboxGrid');
  const form = document.getElementById('marshalForm');

  function clearAlert() { alertBox.innerHTML = ''; }
  function setAlert(message, type = 'error') {
    alertBox.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  }

  function checkItem(id, name, value, label) {
    const wrapper = document.createElement('label');
    wrapper.className = 'check-item';
    wrapper.innerHTML = `<input type="checkbox" name="${name}" value="${value}" id="${id}" /> <span>${label}</span>`;
    const input = wrapper.querySelector('input');
    input.addEventListener('change', () => wrapper.classList.toggle('checked', input.checked));
    return wrapper;
  }

  let eventsById = {};

  async function load() {
    try {
      const [{ events, roles }, { submission }] = await Promise.all([
        apiRequest('/marshal/events'),
        apiRequest('/marshal/mine'),
      ]);

      eventsById = Object.fromEntries(events.map((e) => [e._id, e]));

      eventsGrid.innerHTML = '';
      if (events.length === 0) {
        eventsGrid.innerHTML = '<p class="pool-empty">No events are open for sign-up right now. Check back soon.</p>';
      } else {
        events.forEach((ev) => {
          const label = `${ev.name} — ${formatDate(ev.date)} — ${ev.location}`;
          eventsGrid.appendChild(checkItem(`ev_${ev._id}`, 'events', ev._id, label));
        });
      }

      rolesGrid.innerHTML = '';
      roles.forEach((role) => {
        rolesGrid.appendChild(checkItem(`role_${role.replace(/\s+/g, '_')}`, 'roles', role, role));
      });

      if (submission) {
        const eventNames = (submission.events || [])
          .map((id) => (eventsById[id] ? eventsById[id].name : null))
          .filter(Boolean);

        if (eventNames.length === 0) {
          currentSubmissionBox.innerHTML = `<div class="alert alert-success">
            You are not currently signed up for any events. Select one or more below and submit to join.
          </div>`;
        } else {
          currentSubmissionBox.innerHTML = `<div class="alert alert-success">
            You're currently signed up for <strong>${eventNames.join(', ')}</strong>
            as <strong>${(submission.roles || []).join(', ')}</strong>. Submitting below will overwrite this.
          </div>`;
        }

        (submission.events || []).forEach((id) => {
          const box = document.getElementById(`ev_${id}`);
          if (box) { box.checked = true; box.closest('.check-item').classList.add('checked'); }
        });
        (submission.roles || []).forEach((role) => {
          const box = document.getElementById(`role_${role.replace(/\s+/g, '_')}`);
          if (box) { box.checked = true; box.closest('.check-item').classList.add('checked'); }
        });
      }
    } catch (err) {
      setAlert(err.message);
    }
  }

  function formatDate(d) {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    const events = Array.from(form.querySelectorAll('input[name="events"]:checked')).map((el) => el.value);
    const roles = Array.from(form.querySelectorAll('input[name="roles"]:checked')).map((el) => el.value);

    // No event selected is allowed -- it means "take me out of consideration
    // for everything," so roles aren't required in that case either.
    if (events.length > 0 && roles.length === 0) return setAlert('Please select at least one role.');

    try {
      const { removedFrom } = await apiRequest('/marshal/submit', { method: 'POST', body: { events, roles } });
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

  load();
})();
