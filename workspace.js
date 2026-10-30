/* 手机按任务分区；不复制表单、不改变人物归属与业务数据。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const compact = matchMedia('(max-width: 800px)');
  const center = $('center-view');
  const tabs = document.createElement('div');
  tabs.className = 'workspace-tabs';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', '个人中心分区');
  const empty = document.createElement('p');
  empty.className = 'center-empty';
  empty.textContent = '请先在“人物”中选择一人，再查看此人的资料。';
  center.querySelector('.page-heading').after(tabs);
  center.append(empty);
  let area = 'people';
  const controls = [];
  function select(value) {
    area = value;
    update();
  }
  for (const [value, label] of [
    ['people', '人物'],
    ['archive', '此人资料'],
    ['backup', '备份'],
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => select(value);
    tabs.append(b);
    controls.push([b, value]);
  }
  function toggle(el, show) {
    if (el && el.classList.contains('workspace-hidden') === show)
      el.classList.toggle('workspace-hidden', !show);
  }
  function update() {
    const active = compact.matches;
    center.dataset.area = active ? area : 'desktop';
    const title = center.querySelector('.page-heading h1');
    const person = $('person-detail').querySelector('h2')?.textContent;
    const heading =
      active && area === 'archive'
        ? person
          ? person + '的资料'
          : '此人资料'
        : active && area === 'backup'
          ? '资料备份'
          : '每个人，一份清楚的档案';
    if (title.textContent !== heading) title.textContent = heading;
    for (const [b, value] of controls) {
      b.setAttribute('aria-pressed', String(area === value));
      if (value === 'backup') {
        const hide = !center.querySelector('.backup-panel');
        if (b.hidden !== hide) b.hidden = hide;
      }
    }
    toggle($('person-list'), !active || area === 'people');
    toggle($('unassigned-note'), !active || area === 'people');
    toggle($('person-detail'), !active || area === 'archive');
    toggle(center.querySelector('.backup-panel'), !active || area === 'backup');
    toggle($('person-form'), !active || area === 'people');
    const hideEmpty = !active || area !== 'archive' || !$('person-detail').hidden;
    if (empty.hidden !== hideEmpty) empty.hidden = hideEmpty;
    const groups = [...$('history-content').querySelectorAll(':scope > details')];
    let picker = $('history-category');
    if (!active) {
      if (picker) picker.hidden = true;
      for (const group of groups) toggle(group, true);
      return;
    }
    if (!groups.length) {
      if (picker) picker.hidden = true;
      return;
    }
    if (!picker) {
      picker = document.createElement('select');
      picker.id = 'history-category';
      picker.setAttribute('aria-label', '选择病史类别');
      $('history-content').before(picker);
      picker.onchange = update;
    }
    picker.hidden = false;
    const signature = groups
      .map((g) => g.querySelector('summary')?.textContent || '病史资料')
      .join('|');
    if (picker.dataset.signature !== signature) {
      const previous = picker.value;
      picker.replaceChildren();
      groups.forEach((g, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = g.querySelector('summary')?.textContent || '医疗时间线';
        picker.append(o);
      });
      picker.dataset.signature = signature;
      if (Number(previous) < groups.length) picker.value = previous || '0';
    }
    groups.forEach((g, i) => {
      const show = i === Number(picker.value);
      toggle(g, show);
      if (show && !g.open) g.open = true;
    });
  }
  window.addEventListener('yimai:person-selected', () => select('archive'));
  $('add-person-button').addEventListener('click', () => select('people'));
  let pending = false;
  const schedule = () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        update();
      });
    }
  };
  new MutationObserver(schedule).observe(center, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  new MutationObserver(schedule).observe($('history-content'), { childList: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  update();
})();
