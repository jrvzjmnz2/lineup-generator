(function () {
  // Shared login for the employee sign-up form. Several people use the same
  // account, so the form always asks for the name and clears itself after a
  // successful submit, ready for the next person.
  const user = Auth.requireRole('signup');
  if (!user) return;

  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());

  const alertBox = document.getElementById('alertBox');
  const form = document.getElementById('employeeSignupForm');
  const employeeSelect = document.getElementById('employeeSelect');
  const eventList = document.getElementById('eventList');

  let events = [];

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function setAlert(message, type = 'error') {
    alertBox.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  }
  function clearAlert() { alertBox.innerHTML = ''; }

  function formatDate(d) {
    // Built from the parts: new Date("2026-09-13") reads as UTC midnight and
    // shows the previous day west of UTC.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  }

  function renderEvents() {
    eventList.innerHTML = '';
    if (events.length === 0) {
      eventList.innerHTML = '<p class="pool-empty">No exclusive events are open right now. Check back soon.</p>';
      return;
    }
    events.forEach((ev) => {
      const when = ev.endDate ? `${formatDate(ev.date)} – ${formatDate(ev.endDate)}` : formatDate(ev.date);
      const label = document.createElement('label');
      label.className = 'check-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'events';
      input.value = ev._id;
      const text = document.createElement('span');
      text.textContent = `${ev.name} — ${when} — ${ev.location}`;
      label.append(input, ' ', text);
      input.addEventListener('change', () => label.classList.toggle('checked', input.checked));
      eventList.appendChild(label);
    });
  }

  function setChecked(ids) {
    const set = new Set(ids.map(String));
    eventList.querySelectorAll('input[name="events"]').forEach((input) => {
      input.checked = set.has(input.value);
      input.closest('.check-item').classList.toggle('checked', input.checked);
    });
  }

  async function load() {
    try {
      const data = await apiRequest('/signup/options');
      events = data.events || [];
      employeeSelect.innerHTML = '<option value="">Select your name…</option>';
      (data.employees || []).forEach((emp) => {
        const opt = document.createElement('option');
        opt.value = emp._id;
        opt.textContent = emp.team ? `${emp.name} (${emp.team})` : emp.name;
        employeeSelect.appendChild(opt);
      });
      renderEvents();
    } catch (err) {
      setAlert(err.message);
    }
  }

  // Picking a name re-ticks what that person chose last time.
  employeeSelect.addEventListener('change', async () => {
    clearAlert();
    setChecked([]);
    if (!employeeSelect.value) return;
    try {
      const { events: picked } = await apiRequest(`/signup/employees/${employeeSelect.value}`);
      setChecked(picked || []);
      if (picked && picked.length) setAlert('Your previous picks are ticked below. Submitting replaces them.', 'success');
    } catch (err) {
      setAlert(err.message);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();
    const employeeId = employeeSelect.value;
    if (!employeeId) return setAlert('Pick your name first.');
    const picked = Array.from(eventList.querySelectorAll('input[name="events"]:checked')).map((el) => el.value);
    const name = employeeSelect.options[employeeSelect.selectedIndex].textContent;

    try {
      await apiRequest('/signup/submit', { method: 'POST', body: { employeeId, events: picked } });
      setAlert(
        picked.length
          ? `Thanks, ${name}. You're signed up for ${picked.length} event${picked.length === 1 ? '' : 's'}.`
          : `Thanks, ${name}. You've been withdrawn from all exclusive events.`,
        'success'
      );
      showToast('Sign-up saved', 'success');
      // Ready for the next person on the shared login.
      employeeSelect.value = '';
      setChecked([]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setAlert(err.message);
    }
  });

  load();
})();
