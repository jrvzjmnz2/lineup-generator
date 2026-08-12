(function () {
  const user = Auth.requireRole('marshal');
  if (!user) return;

  document.getElementById('welcomeText').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());

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
        eventsGrid.innerHTML = '<p style="color:#888;">No events are open for sign-up right now. Check back soon.</p>';
      } else {
        events.forEach((ev) => {
          const label = `${ev.name} — ${formatDate(ev.date)}`;
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
        currentSubmissionBox.innerHTML = `<div class="alert alert-success">
          You're currently signed up for <strong>${eventNames.join(', ') || 'no active events'}</strong>
          as <strong>${(submission.roles || []).join(', ')}</strong>. Submitting below will overwrite this.
        </div>`;

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

    if (events.length === 0) return setAlert('Please select at least one event.');
    if (roles.length === 0) return setAlert('Please select at least one role.');

    try {
      await apiRequest('/marshal/submit', { method: 'POST', body: { events, roles } });
      setAlert('Your submission has been saved. Thank you!', 'success');
      showToast('Submission saved', 'success');
      load();
    } catch (err) {
      setAlert(err.message);
    }
  });

  load();
})();
