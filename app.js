'use strict';
const $ = (id) => document.getElementById(id);
const state = {
  csrf: '',
  batches: [],
  batchPeople: {},
  historyRequest: 0,
  personDrafts: {},
  data: null,
  person: null,
  conversation: null,
  document: null,
  active: 'input',
  recognition: null,
  turns: [],
};
const say = (text, error = false) => {
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
};
const node = (tag, text = '', cls = '') => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const button = (text, action, cls = '') => {
  const e = node('button', text, cls);
  e.type = 'button';
  e.addEventListener('click', async (event) => {
    if (e.disabled) return;
    e.disabled = true;
    e.setAttribute('aria-busy', 'true');
    try {
      await guard(action)(event);
    } finally {
      e.disabled = false;
      e.setAttribute('aria-busy', 'false');
    }
  });
  return e;
};
function endSpeech() {
  if (state.recognition) {
    state.recognition.onresult = null;
    state.recognition.abort();
    state.recognition = null;
  }
  $('voice-button').textContent = '语音输入';
}
const date = (value) => (value || '').slice(0, 16).replace('T', ' ');
const personName = (p) => `${p.name} · ${p.alias || '无备注'} · ${p.id.slice(0, 8)}`;
function guard(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (e) {
      say(e.message || '操作未完成，请重试', true);
    }
  };
}
async function api(path, data, raw = false) {
  if (window.YimaiBrowser) return window.YimaiBrowser.api(path, data);
  const options = { credentials: 'same-origin', cache: 'no-store', headers: {} };
  if (data !== undefined) {
    options.method = 'POST';
    options.headers['X-Yimai-CSRF'] = state.csrf;
    if (raw) {
      options.body = data;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw Error('暂时无法连接。请检查网络，稍后重试；试用服务首次唤醒可能需要稍等。');
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.endsWith('/pair')) lock();
    throw Error(result.error || '操作未完成');
  }
  return result;
}
function lock() {
  endSpeech();
  state.csrf = '';
  state.batches = [];
  state.batchPeople = {};
  state.historyRequest++;
  state.personDrafts = {};
  $('person-context').hidden = true;
  state.data = null;
  state.person = null;
  state.conversation = null;
  state.document = null;
  state.turns = [];
  for (const id of [
    'result',
    'person-list',
    'person-detail',
    'document-list',
    'document-detail',
    'jobs',
  ])
    $(id).replaceChildren();
  $('symptoms').value = '';
  $('pair-code').value = '';
  $('input-person').replaceChildren(node('option', '请选择人物'));
  $('person-form').reset();
  $('person-form').hidden = true;
  $('document-detail').hidden = true;
  document.querySelectorAll('.view').forEach((e) => (e.hidden = e.id !== 'pair-view'));
  $('navigation').hidden = true;
}
function selectPerson(id) {
  const old = state.person;
  if (old && old !== id) state.personDrafts[old] = $('symptoms').value;
  if (state.person !== id) {
    endSpeech();
    state.historyRequest++;
    state.turns = [];
    state.document = null;
    for (const key of [
      'history-content',
      'document-list',
      'document-detail',
      'upload-status',
      'jobs',
      'result',
      'conversation-records',
      'person-detail',
    ])
      $(key).replaceChildren();
    $('document-detail').hidden = true;
    $('person-detail').hidden = true;
    $('review-upload-status').textContent = '识别后自动保存到当前人物档案。';
    state.conversation = null;
    $('result').hidden = true;
    $('symptoms').value = state.personDrafts[id] || '';
  }
  state.person = id || null;
  try {
    if (window.YimaiBrowser) {
      if (id) window.localStorage?.setItem('yimai-selected-person', id);
      else window.localStorage?.removeItem('yimai-selected-person');
    }
  } catch {}
  $('input-form').hidden = !state.person;
  $('input-start').hidden = !!state.person;
  $('input-person').value = id || '';
  $('input-person').hidden = true;
  const p = state.data?.people.find((item) => item.id === id);
  document.querySelector('#input-view h1').textContent = p
    ? `${p.name}的本次就诊`
    : '先选择人物';
  document.querySelector('#history-view h1').textContent = p
    ? `${p.name}的既往病史`
    : '既往病史';
  document.querySelector('#review-view h1').textContent = p
    ? `${p.name}的历史记录`
    : '历史记录';
  document.querySelector('#upload-view h1').textContent = p
    ? `上传${p.name}的本次就诊结果`
    : '拍照上传并自动建档';
  $('person-context').replaceChildren();
  $('person-context').hidden = !p;
  if (p) $('person-context').append(node('strong', `${p.name}的健康空间`));
}
async function showHistory() {
  const host = $('history-content');
  const request = ++state.historyRequest;
  host.replaceChildren(node('p', '正在读取病史…', 'muted'));
  if (!state.person) {
    host.replaceChildren();
    host.append(
      node('p', '先在个人中心选择或添加人物。'),
      button('选择人物', () => go('center'))
    );
    return;
  }
  const personId = state.person;
  const data = await api(`/api/person?id=${encodeURIComponent(personId)}`);
  if (
    state.person !== personId ||
    request !== state.historyRequest ||
    state.active !== 'history'
  )
    return;
  host.replaceChildren();
  host.append(node('p', `${data.person.name}的病史档案 · 按病史类别整理`, 'banner'));
  renderHistory(host, data.history_sections);
  const timeline = node('details', '', 'history-group');
  timeline.append(
    node('summary', '医疗记录时间线'),
    node('p', '按已核对的文档记载日期排列；上传日期不当作就诊日期。', 'muted')
  );
  for (const event of data.timeline || [])
    timeline.append(
      row(
        event.value,
        event.document_kind,
        () => openDocument(event.document_id),
        '查看来源'
      )
    );
  if (!data.timeline?.length)
    timeline.append(node('p', '暂无已核对日期的医疗记录。', 'muted'));
  host.append(timeline);
}
function navigate(view) {
  if (!state.csrf) return;
  if (!state.person && view !== 'center' && view !== 'help') {
    view = 'center';
    say('请先选择或添加一位人物，再开始就诊或上传资料。');
  }
  if (view === 'result' && !state.conversation) view = 'input';
  if (view === 'document' && !state.document) view = 'review';
  if (location.hash !== `#${view}`) location.hash = `#${view}`;
  const changed = state.active !== view;
  if (changed) say('');
  state.active = view;
  $('input-form').hidden = !state.person;
  $('input-start').hidden = !!state.person;
  document.body?.classList.toggle('review-mode', view === 'document');
  document
    .querySelectorAll('.view')
    .forEach((e) => (e.hidden = e.id !== `${view}-view`));
  const navView = view === 'document' ? 'review' : view === 'result' ? 'input' : view;
  document.querySelectorAll('nav a').forEach((e) => {
    const current = e.dataset.view === navView;
    e.classList.toggle('active', current);
    e.setAttribute('aria-current', current ? 'page' : 'false');
    e.setAttribute(
      'aria-disabled',
      String(!state.person && e.dataset.view !== 'center')
    );
    e.title =
      !state.person && e.dataset.view !== 'center'
        ? '请先在个人中心选择人物'
        : e.getAttribute?.('aria-label') || e.textContent;
  });
  if (changed) window.scrollTo({ top: 0, behavior: 'instant' });
  if (view === 'center') {
    renderPeople();
    if (state.person) guard(() => openPerson(state.person, false))();
  }
  if (view === 'review') renderConversations();
  if (view === 'history') guard(showHistory)();
  if (view !== 'input') endSpeech();
  if (view === 'help')
    $('connection-info').textContent = window.isSecureContext
      ? '当前为安全上下文。能否安装及语音识别仍取决于浏览器支持。'
      : '当前为普通 HTTP 局域网试用，只使用合成资料。完整安装与部分语音能力需要可信 HTTPS。';
}
async function refresh() {
  state.data = await api('/api/state');
  const selected = state.person;
  $('input-person').replaceChildren(
    Object.assign(node('option', '请选择人物'), { value: '' })
  );
  for (const p of state.data.people)
    $('input-person').append(
      Object.assign(node('option', personName(p)), { value: p.id })
    );
  $('input-person').value = selected;
  $('review-upload-status').textContent =
    $('upload-status').textContent || '识别后自动归档，原件和识别文字一起保存。';
  if (state.active === 'center') renderPeople();
  if (state.active === 'review') renderConversations();
  if (state.active === 'history') guard(showHistory)();
  if (state.batches.length) {
    const jobs = state.data.jobs.filter(
      (j) =>
        state.batches.includes(j.id) &&
        (!state.person || (state.batchPeople[j.id] || j.selected) === state.person)
    );
    const docs = jobs
      .map((j) => state.data.documents.find((d) => d.id === j.document_id))
      .filter(Boolean);
    if (!jobs.length) {
      $('upload-status').replaceChildren();
      return;
    }
    const ids = [...new Set(docs.map((d) => d.person?.id).filter(Boolean))];
    if (!state.person && ids.length === 1) {
      selectPerson(ids[0]);
      for (const job of jobs) state.batchPeople[job.id] = ids[0];
    }
    const waiting = jobs.some((j) => ['pending', 'running'].includes(j.status));
    $('upload-status').replaceChildren(
      node('strong', waiting ? '正在识别并整理，请稍候…' : '本次上传处理结果')
    );
    for (const d of docs) {
      $('upload-status').append(
        row(
          d.person ? `已保存到${d.person.name}的档案` : '原件已保存，还需要确定属于谁',
          d.processing_error
            ? d.processing_error
            : d.person
              ? '文字已自动提取；有疑问的内容保留标记，无需逐条确认。'
              : '姓名不清、重名或页面不完整时才需要处理。',
          () => openDocument(d.id),
          d.person ? '查看 / 纠错' : '选择人物'
        )
      );
    }
    if (!waiting && !docs.length)
      $('upload-status').append(node('p', '未完成识别，请到上传记录重试。'));
  }
}
async function connected(data) {
  state.csrf = data.csrf;
  await refresh();
  let saved;
  try {
    if (window.YimaiBrowser)
      saved = window.localStorage?.getItem('yimai-selected-person');
  } catch {}
  selectPerson(state.data.people.some((p) => p.id === saved) ? saved : null);
  $('pair-view').hidden = true;
  $('navigation').hidden = false;
  navigate(location.hash.slice(1) || 'input');
  if (
    ![
      'input',
      'upload',
      'document',
      'result',
      'center',
      'review',
      'history',
      'help',
    ].includes(state.active)
  )
    navigate('input');
  say(
    window.YimaiBrowser
      ? '手机版已就绪。资料保存在此浏览器，请定期备份。'
      : '已连接独立试用资料库。请先使用合成资料。'
  );
}
$('pair-form').addEventListener(
  'submit',
  guard(async (event) => {
    event.preventDefault();
    const b = event.submitter;
    b.disabled = true;
    try {
      await connected(await api('/api/pair', { code: $('pair-code').value }));
      $('pair-code').value = '';
    } finally {
      b.disabled = false;
    }
  })
);
window.addEventListener('hashchange', () => {
  if (location.hash.slice(1) === state.active) return;
  navigate(
    [
      'input',
      'upload',
      'document',
      'result',
      'center',
      'review',
      'history',
      'help',
    ].includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : 'input'
  );
});
const go = (view) => {
  // 重复点击当前入口时保留正在阅读的位置和展开状态。
  if (view === state.active) return;
  location.hash = view;
  navigate(view);
};
document.querySelectorAll('nav a').forEach((link) =>
  link.addEventListener('click', (event) => {
    event.preventDefault();
    go(link.dataset.view);
  })
);
$('help-button').onclick = () =>
  state.csrf ? go('help') : say('先输入电脑显示的配对码；手机和电脑连接同一网络。');
$('go-review').onclick = () => go('center');
$('new-input').onclick = () => {
  endSpeech();
  state.conversation = null;
  $('conversation-note').textContent = '当前为新会话。每个人的历史分别保存。';
  $('symptoms').value = '';
  $('result').hidden = true;
  say('已新建会话，原结果保存在个人中心。');
};
$('input-person').addEventListener('change', () =>
  selectPerson($('input-person').value)
);
async function upload(files) {
  if (!state.person) {
    go('center');
    throw Error('请先选择人物，再上传资料。');
  }
  if (!files.length) return;
  if (files.length > 20) throw Error('每次最多添加20份资料');
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) throw Error('单份资料不能超过25MB');
    if (
      !/\.(jpe?g|png|bmp|pdf)$/i.test(file.name) &&
      !(
        !/\.[^.]+$/.test(file.name) &&
        /^(image\/(jpeg|png|bmp)|application\/pdf)$/.test(file.type)
      )
    )
      throw Error('暂不支持此格式；HEIC 请转为 JPG 后添加。');
  }
  const uploadPerson = state.person;
  $('camera').disabled = true;
  $('files').disabled = true;
  try {
    for (let i = 0; i < files.length; i++) {
      if (state.person === uploadPerson)
        $('upload-status').textContent =
          `正在上传 ${i + 1} / ${files.length} 份资料，请不要关闭页面…`;
      const batch = await api(
        `/api/upload?name=${encodeURIComponent(files[i].name)}&person_id=${encodeURIComponent(uploadPerson || '')}`,
        files[i],
        true
      );
      const snapshot = await api('/api/state');
      for (const j of snapshot.jobs.filter((j) => j.batch_id === batch.batch_id)) {
        state.batches.push(j.id);
        state.batchPeople[j.id] = uploadPerson;
      }
    }
    if (state.person === uploadPerson)
      $('upload-status').textContent = window.YimaiBrowser
        ? '处理已结束，请查看下方保存结果；识别失败的资料仍保留原件。'
        : '已收到，正在识别和自动归档。完成结果会显示在这里。';
    await refresh();
    if (state.person === uploadPerson)
      say(
        window.YimaiBrowser
          ? '处理结果已保存到手机浏览器，请查看下方结果。'
          : '原件已收到，正在自动整理，无需离开当前页面。'
      );
  } finally {
    $('camera').disabled = false;
    $('files').disabled = false;
    $('camera').value = '';
    $('files').value = '';
  }
}
for (const id of ['camera', 'files'])
  $(id).addEventListener(
    'change',
    guard((event) => upload(Array.from(event.target.files)))
  );
$('retry-button').onclick = guard(async () => {
  await api('/api/retry', { person_id: state.person });
  await refresh();
  say('已安排重试未完成任务。');
});
const jobLabels = {
  pending: '等待识别',
  running: '正在识别',
  partial: '部分页未完成',
  failed: '识别失败',
  completed: '识别完成',
  rejected: '格式或大小不支持',
};
function renderConversations() {
  const host = $('conversation-records');
  host.replaceChildren(node('h2', '问话与整理记录'));
  const records = state.data.conversations.filter(
    (c) => state.person && c.person_id === state.person
  );
  for (const c of records)
    host.append(row(c.title, date(c.created_at), () => openConversation(c.id), '查看'));
  if (!records.length)
    host.append(
      node(
        'p',
        state.person ? '此人尚无问话记录。' : '请先在个人中心选择人物。',
        'muted'
      )
    );
}
function renderDocuments() {
  if (!state.data) return;
  const owned = state.data.documents.filter(
    (d) =>
      state.person &&
      (d.person?.id === state.person ||
        (d.upload_person_id === state.person && !d.person))
  );
  const ownedIds = new Set(owned.map((d) => d.id));
  const jobs = state.data.jobs.filter(
    (j) =>
      j.status !== 'completed' &&
      (ownedIds.has(j.document_id) ||
        (state.person && (state.batchPeople[j.id] || j.selected) === state.person))
  );
  $('jobs').textContent = jobs.length
    ? jobs.map((j, i) => `任务${i + 1}：${jobLabels[j.status] || '待处理'}`).join(' · ')
    : '没有未完成的导入任务。';
  const list = $('document-list');
  list.replaceChildren();
  for (const d of owned) {
    const c = node('article', '', 'card stack');
    c.append(
      node('h3', d.original_name ? `${d.kind} · ${d.original_name}` : d.kind),
      node('p', `${d.person?.name || '尚未确认属于谁'} · ${date(d.uploaded_at)}`),
      node(
        'p',
        `${d.status} · 已核对 ${d.checked_count ?? 0} / ${d.candidate_count ?? 0} 条`,
        'muted'
      ),
      button('查看原件与识别文字', () => openDocument(d.id))
    );
    list.append(c);
  }
  if (!owned.length)
    list.append(
      node(
        'p',
        state.person ? '此人尚无上传记录。' : '请先在个人中心选择人物。',
        'empty'
      )
    );
}
function renderPeople() {
  if (!state.data) return;
  const missing = state.data.documents.filter((d) => !d.person).length;
  $('unassigned-note').textContent =
    `${state.data.people.length} 位人物 · ${missing} 份资料尚未确认属于谁。`;
  $('unassigned-note').replaceChildren(
    node(
      'span',
      `${state.data.people.length} 位人物 · ${missing} 份资料尚未确认属于谁。 `
    )
  );
  if (missing) {
    const waiting = node('details');
    waiting.append(node('summary', '待确定人物的资料'));
    for (const d of state.data.documents.filter((d) => !d.person))
      waiting.append(
        row(d.kind, date(d.uploaded_at), () => openDocument(d.id), '选择归属')
      );
    $('unassigned-note').append(waiting);
  }
  const list = $('person-list');
  list.replaceChildren();
  for (const p of state.data.people) {
    const b = button('', () => openPerson(p.id), 'person-card');
    b.classList.toggle('selected-person', p.id === state.person);
    if (p.id === state.person) b.append(node('small', '正在使用此人档案', 'chip'));
    b.append(
      node('span', p.name.slice(0, 1), 'avatar'),
      node('strong', p.name),
      node('small', `${p.alias || '无备注'} · ${p.id.slice(0, 8)}`),
      node(
        'small',
        `${state.data.documents.filter((d) => d.person?.id === p.id).length} 份资料 · ${state.data.conversations.filter((c) => c.person_id === p.id).length} 次会话`
      )
    );
    list.append(b);
  }
  if (!state.data.people.length)
    list.append(
      node('p', '还没有人物档案。点击“添加人物”，填写姓名后即可开始。', 'empty')
    );
}
function row(title, subtitle, action, label) {
  const e = node('div', '', 'list-row');
  const info = node('div');
  info.append(node('h3', title), node('p', subtitle, 'muted'));
  e.append(info, button(label, action));
  return e;
}
async function downloadExport(path) {
  const data = await api(path);
  const blob = new Blob(['\ufeff', data.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = data.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  say(
    '已请求保存病史文本。若浏览器打开文件，请用分享或保存到文件；内容含个人资料，请自行选择接收者。'
  );
}
function renderHistory(host, sections) {
  if (!sections) {
    host.append(node('p', '此历史快照没有病史分区，请先按最新档案更新。', 'warning'));
    return;
  }
  host.append(
    node('h3', '病史分区'),
    node(
      'p',
      '“文字已核对”不等于医学真实性得到证明。存疑、否定和计划均保留原文。',
      'muted'
    )
  );
  for (const section of sections) {
    const details = document.createElement('details');
    details.className = 'history-group';
    details.append(
      node(
        'summary',
        `${section.title} · ${section.checked.length + section.uncertain.length} 项 · ${section.uncertain.length} 项仍需确认`
      )
    );
    if (!section.checked.length && !section.uncertain.length)
      details.append(node('p', '尚未收录这类信息，不表示没有相关病史。', 'muted'));
    for (const [key, title] of [
      ['checked', '文字已核对且表述明确'],
      ['uncertain', '仍需确认'],
    ]) {
      if (!section[key].length) continue;
      details.append(node('h4', title));
      for (const item of section[key]) {
        const entry = node('div', '', 'history-entry');
        entry.append(
          node('p', item.value),
          node(
            'p',
            `${item.certainty.assertion}${item.certainty.reasons.length ? ' · ' + item.certainty.reasons.join('；') : ''}`,
            'muted'
          ),
          node(
            'p',
            `来源：${item.document_id.slice(0, 8)} · 第${item.evidence?.page || 1}页 · 识别行${item.line + 1}`,
            'muted'
          )
        );
        if (item.evidence?.origin === '用户更正')
          entry.append(
            node('p', `更正前原文：${item.evidence.original_text}`, 'muted')
          );
        entry.append(
          button('查看来源并检查', () => openDocument(item.document_id), 'text-button')
        );
        details.append(entry);
      }
    }
    host.append(details);
  }
}
async function openPerson(id, scroll = true) {
  const firstChoice = !state.person && scroll;
  selectPerson(id);
  renderPeople();
  if (firstChoice) {
    go('input');
    say('人物已选好，可以描述本次症状，或到结果上传添加资料。');
    return;
  }
  $('person-detail').hidden = false;
  $('person-detail').replaceChildren(node('p', '正在读取此人的资料…', 'muted'));
  const data = await api(`/api/person?id=${encodeURIComponent(id)}`);
  if (state.person !== id || state.active !== 'center') return;
  const panel = $('person-detail');
  panel.replaceChildren(
    node('h2', data.person.name),
    node(
      'p',
      `备注：${data.person.alias || '未填写'} · 档案编号：${data.person.id.slice(0, 8)} · 出生日期：${data.person.birthday || '未填写'}`,
      'muted'
    )
  );
  panel.append(
    button(
      '为此人开始本次输入',
      () => {
        $('new-input').click();
        selectPerson(id);
        go('input');
      },
      'primary'
    )
  );
  panel.append(
    button('一键导出此人病史资料', () =>
      downloadExport(`/api/export?person_id=${encodeURIComponent(id)}`)
    )
  );
  panel.append(button('查看此人的全部既往病史', () => go('history')));
  const uploads = node('details');
  uploads.append(node('summary', `原件资料库 · ${data.documents.length} 份照片 / PDF`));
  panel.append(uploads);
  for (const d of data.documents)
    uploads.append(
      row(
        d.kind,
        `${date(d.uploaded_at)} · ${d.status}`,
        () => openDocument(d.id),
        '查看原件 / 核对'
      )
    );
  if (!data.documents.length)
    panel.append(node('p', '还没有确认属于此人的资料。', 'muted'));
  const questions = node('details');
  questions.append(node('summary', `问话与整理记录 · ${data.conversations.length} 次`));
  panel.append(questions);
  for (const c of data.conversations)
    questions.append(
      row(c.title, date(c.created_at), () => openConversation(c.id), '查看')
    );
  if (!data.conversations.length)
    panel.append(node('p', '此人还没有历史会话。', 'muted'));
  panel.hidden = false;
  $('person-form').hidden = true;
  if (scroll && window.dispatchEvent)
    window.dispatchEvent(new CustomEvent('yimai:person-selected'));
  if (scroll) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('add-person-button').onclick = () => {
  $('person-form').hidden = false;
  $('person-detail').hidden = true;
  $('person-name').focus();
};
$('cancel-person').onclick = () => {
  $('person-form').hidden = true;
  $('person-form').reset();
};
$('person-form').addEventListener(
  'submit',
  guard(async (event) => {
    event.preventDefault();
    event.submitter.disabled = true;
    try {
      const p = await api('/api/people', {
        name: $('person-name').value,
        alias: $('person-alias').value,
        birthday: $('person-birthday').value,
      });
      $('person-form').reset();
      $('person-form').hidden = true;
      await refresh();
      await openPerson(p.id);
      say('档案已建立，已进入此人的健康空间。');
    } finally {
      event.submitter.disabled = false;
    }
  })
);
function suggestPerson(name, birthday = '') {
  go('center');
  $('person-form').hidden = false;
  $('person-detail').hidden = true;
  $('person-name').value = name;
  $('person-birthday').value = birthday;
  $('person-name').focus();
}
async function openDocument(id) {
  const owner = state.person;
  const origin =
    state.active === 'document' ? state.documentReturn || 'center' : state.active;
  const request = (state.documentRequest || 0) + 1;
  state.documentRequest = request;
  let d = await api(`/api/document?id=${encodeURIComponent(id)}`);
  if (state.person !== owner || request !== state.documentRequest) return;
  if (d.person && d.person.id !== owner)
    throw Error('请在个人中心切换到此资料所属的人物。');
  state.document = id;
  state.documentReturn = origin;
  let index = 0;
  let pane = 'edit';
  let saving = false;
  const drafts = {};
  const ordered = () => {
    const all = d.processing ? [] : d.candidates.map((c, i) => ({ c, i }));
    const key = all.filter(({ c }) => /药物|诊断/.test(c.field));
    return key.length ? key : all;
  };
  const host = $('document-detail');
  const feedback = $('document-feedback');
  feedback.hidden = true;
  go('document');
  const back = $('document-back');
  back.onclick = () => {
    go(origin);
  };
  function visible() {
    return (
      state.person === owner && state.document === id && state.active === 'document'
    );
  }
  function message(text) {
    feedback.textContent = text;
    feedback.hidden = false;
  }
  async function reload() {
    await refresh();
    const updated = await api(`/api/document?id=${encodeURIComponent(id)}`);
    if (!visible()) return false;
    d = updated;
    paint();
    return true;
  }
  async function persist(action) {
    if (saving) return;
    saving = true;
    paint();
    message('正在保存，请稍候…');
    try {
      await action();
    } catch (error) {
      message(error.message || '未保存成功，请重试。修改的文字仍保留。');
    } finally {
      saving = false;
      if (visible()) paint();
    }
  }
  function assignment() {
    const dialog = $('review-dialog');
    const body = $('review-dialog-body');
    body.replaceChildren(node('h2', '资料姓名与归属'));
    const hints = d.suggestion.hints.filter((h) => h.field === '患者姓名');
    body.append(
      node(
        'p',
        '原件姓名：' + (hints.map((h) => h.value).join('、') || '没有识别到明确姓名')
      )
    );
    const select = node('select');
    select.setAttribute('aria-label', '资料属于哪位人物');
    select.append(Object.assign(node('option', '选择人物'), { value: '' }));
    for (const p of state.data.people)
      select.append(Object.assign(node('option', personName(p)), { value: p.id }));
    select.value = d.person?.id || owner || '';
    body.append(
      select,
      button(
        '保存姓名归属',
        async () => {
          if (!select.value) throw Error('请选择人物');
          await api('/api/assign', {
            document_id: id,
            person_id: select.value,
            reason: '使用者核对患者姓名后保存',
            confirmed: true,
          });
          dialog.close();
          if (!visible()) return;
          if (select.value !== owner) {
            go(origin);
            say('已保存到所选人物，请在个人中心切换后查看。');
            return;
          }
          if (await reload()) message('姓名归属已保存。');
        },
        'primary'
      )
    );
    dialog.showModal();
  }
  function paint() {
    host.hidden = false;
    host.replaceChildren();
    host.dataset.pane = pane;
    const entries = ordered();
    const count = entries.length;
    index = Math.max(0, Math.min(index, count - 1));
    const progress = node('div', '', 'verify-progress');
    progress.append(
      node(
        'strong',
        `${d.person?.name || '姓名待核对'} · 已核对 ${entries.filter(({ c }) => c.status === '已核验').length}/${count} 条`
      ),
      button('姓名', assignment, 'text-button')
    );
    host.append(progress);
    if (d.processing)
      host.append(
        node(
          'p',
          '原件已保存，正在识别。可先查看原件，识别完成后重新打开此记录。',
          'banner'
        )
      );
    const tabs = node('div', '', 'verify-tabs');
    const switchPane = (next) => {
      pane = next;
      host.dataset.pane = pane;
      for (const [control, value] of [
        [editTab, 'edit'],
        [sourceTab, 'source'],
      ]) {
        control.classList.toggle('primary', pane === value);
        control.setAttribute('aria-pressed', String(pane === value));
      }
    };
    const editTab = button(
      '核对文字',
      () => switchPane('edit'),
      pane === 'edit' ? 'primary' : ''
    );
    const sourceTab = button(
      '看原件',
      () => switchPane('source'),
      pane === 'source' ? 'primary' : ''
    );
    editTab.setAttribute('aria-pressed', String(pane === 'edit'));
    sourceTab.setAttribute('aria-pressed', String(pane === 'source'));
    tabs.append(editTab, sourceTab);
    /* 保留原件和输入框节点，切换视图不重新加载图片。 */
    host.append(tabs);
    const layout = node('div', '', 'verify-layout');
    const source = node('article', '', 'card verify-source');
    const edit = node('article', '', 'card verify-edit');
    layout.append(source, edit);
    host.append(layout);
    const c = entries[index]?.c;
    const candidateIndex = entries[index]?.i;
    const line = c ? d.lines[c.line] : null;
    const page = node('select');
    page.setAttribute('aria-label', '原件页码');
    for (const n of d.pages)
      page.append(Object.assign(node('option', `原件第 ${n} 页`), { value: n }));
    const image = node('img');
    image.alt = '保留的原件，可放大查看';
    image.className = 'verify-image';
    function show(n) {
      page.value = String(n);
      const path = `/api/page?id=${encodeURIComponent(id)}&page=${n}`;
      image.src = window.YimaiBrowser ? window.YimaiBrowser.resource(path) : path;
    }
    page.onchange = () => show(page.value);
    if (d.pages.length) show(line?.page || d.pages[0]);
    source.append(page, image);
    const original = node('a', '保存原始照片 / PDF', 'text-button');
    const originalPath = `/api/original?id=${encodeURIComponent(id)}`;
    original.href = window.YimaiBrowser
      ? window.YimaiBrowser.resource(originalPath)
      : originalPath;
    original.download = window.YimaiBrowser ? d.original_name || '医脉原件' : '';
    source.append(original);
    if (c) {
      edit.append(
        node('h2', c.field),
        node(
          'p',
          c.status === '已核验' ? '已保存 · 文字已核对' : '请对照原件，需要时修改',
          c.status === '已核验' ? 'saved-label' : 'muted'
        )
      );
      const value = node('textarea');
      value.value = drafts[index] ?? c.value;
      value.maxLength = 4000;
      value.setAttribute('aria-label', '本条识别文字');
      value.oninput = () => {
        drafts[index] = value.value;
        save.textContent = value.value === c.value ? '文字正确，保存' : '保存修改';
      };
      edit.append(value);
      const notice =
        c.certainty?.reasons?.filter((reason) => reason !== '识别文字尚未核对') || [];
      edit.append(
        node(
          'p',
          notice.length
            ? '内容提示：' + notice.join('；')
            : '仅核对原文，不判断诊断是否成立。',
          'verify-note'
        )
      );
      const actions = node('div', '', 'verify-actions');
      const save = button(
        c.status === '已核验' ? '再次保存' : '文字正确，保存',
        () =>
          persist(async () => {
            await api('/api/review', {
              document_id: id,
              index: candidateIndex,
              action: value.value === c.value ? 'confirm' : 'modify',
              value: value.value,
            });
            delete drafts[index];
            if (await reload()) message('保存成功：本条文字已核对。');
          }),
        'primary'
      );
      actions.append(
        save,
        button(c.manual_uncertain ? '取消存疑' : '有疑问', () =>
          persist(async () => {
            await api('/api/uncertain', {
              document_id: id,
              index: candidateIndex,
              uncertain: !c.manual_uncertain,
            });
            if (await reload()) message('已保存疑问标记，原文仍保留。');
          })
        )
      );
      if (c.status === '已核验')
        actions.append(
          button(
            '撤销核对',
            () =>
              persist(async () => {
                await api('/api/review', {
                  document_id: id,
                  index: candidateIndex,
                  action: 'revoke',
                });
                if (await reload()) message('已撤销，本条恢复为待核对。');
              }),
            'text-button'
          )
        );
      edit.append(actions);
    } else
      edit.append(
        node('h2', '原件已保存'),
        node('p', '没有提取到可核对条目。可切换到“看原件”查看照片或 PDF 页面。')
      );
    const pager = node('div', '', 'verify-pager');
    const prev = button('上一条', () => {
      index--;
      feedback.hidden = true;
      paint();
    });
    prev.disabled = index === 0;
    const next = button('下一条', () => {
      index++;
      feedback.hidden = true;
      paint();
    });
    next.disabled = index >= count - 1;
    pager.append(
      prev,
      node('span', count ? `${index + 1} / ${count}` : '没有待核对条目'),
      next
    );
    host.append(pager);
    if (saving) {
      const disable = (element) => {
        if (['BUTTON', 'SELECT', 'TEXTAREA'].includes(element.tagName))
          element.disabled = true;
        for (const child of element.children) disable(child);
      };
      disable(host);
    }
  }
  paint();
}
$('input-form').addEventListener(
  'submit',
  guard(async (event) => {
    event.preventDefault();
    endSpeech();
    if (!state.person)
      throw Error('请先在个人中心选择人物；也可以在就诊结果上传页拍照建档。');
    const submitPerson = state.person;
    $('submit-button').disabled = true;
    try {
      const value = await api('/api/submit', {
        symptoms: $('symptoms').value,
        person_id: state.person,
        conversation_id: state.conversation || '',
      });
      if (state.person !== submitPerson) return;
      state.conversation = value.id;
      $('symptoms').value = '';
      await refresh();
      await openConversation(value.id);
    } finally {
      $('submit-button').disabled = false;
    }
  })
);
// 提示仅插入空标签，不替使用者编写症状或病史。
document.querySelectorAll('[data-prompt]').forEach((control) => {
  control.addEventListener('click', () => {
    const target = $('symptoms');
    const label = control.dataset.prompt + '：';
    const existing = target.value.indexOf(label);
    if (existing >= 0) {
      target.focus();
      target.setSelectionRange(existing + label.length, existing + label.length);
      return;
    }
    const addition = (target.value ? '\n' : '') + label;
    if (target.value.length + addition.length > target.maxLength) {
      say('文字已接近上限，请精简后再补充。', true);
      return;
    }
    target.value += addition;
    target.focus();
    target.setSelectionRange(target.value.length, target.value.length);
  });
});
async function openConversation(id) {
  const conversation = state.data.conversations.find((c) => c.id === id);
  const personId = state.person;
  if (!personId || conversation?.person_id !== personId)
    throw Error('请先在个人中心切换到这份记录所属的人物。');
  const turns = await api(`/api/turns?id=${encodeURIComponent(id)}`);
  if (state.person !== personId) return;
  state.turns = turns;
  state.conversation = id;
  const resultOrigin = state.active;
  $('result-back').onclick = () =>
    go(resultOrigin === 'result' ? 'review' : resultOrigin);
  go('result');
  $('conversation-note').textContent = '继续此人的会话；新补充会作为独立记录保存。';
  const panel = $('result');
  panel.replaceChildren(node('h2', '给医生看的话'));
  panel.hidden = false;
  const select = document.createElement('select');
  select.setAttribute('aria-label', '选择历史输入结果');
  state.turns.forEach((t, i) =>
    select.append(
      Object.assign(
        node(
          'option',
          `记录 ${i + 1} · ${date(t.created_at)}${t.report.refresh_of ? ' · 档案更新' : ''}`
        ),
        { value: i }
      )
    )
  );
  select.hidden = state.turns.length < 2;
  panel.append(select);
  select.value = String(state.turns.length - 1);
  let detail = node('div');
  const rootDetail = detail;
  panel.append(detail);
  function render() {
    detail = rootDetail;
    const t = state.turns[Number(select.value)];
    detail.replaceChildren();
    if (!t) return;
    const report = t.report;
    if (t.stale) {
      detail.append(
        node('p', '档案已变化：这是历史快照，不可作为当前结果。', 'warning'),
        button(
          '按最新档案重新整理',
          async () => {
            await api('/api/refresh', { conversation_id: id, turn_id: t.id });
            await refresh();
            await openConversation(id);
          },
          'primary'
        )
      );
    }
    function section(title, text) {
      const e = node('section', '', 'result-section');
      e.append(node('h3', title), node('p', text));
      detail.append(e);
      return e;
    }
    if (!t.stale)
      detail.append(
        button('一键导出本次整理资料', () =>
          downloadExport(
            `/api/export?conversation_id=${encodeURIComponent(id)}&turn_id=${encodeURIComponent(t.id)}`
          )
        )
      );
    section(
      '可以对医生这样说',
      report.doctor_brief?.speech || report.current_description
    );
    section(
      '摘要说明',
      report.doctor_brief?.notice || '历史版本，请更新后查看新摘要。'
    );
    if (report.model_assist) {
      section(
        '模型整理记录',
        `${report.model_assist.model} · ${report.model_assist.message}`
      );
    }
    if (report.local_doctor_brief) {
      const original = node('details');
      original.append(
        node('summary', '查看原来的本地整理结果'),
        node('p', report.local_doctor_brief.speech)
      );
      detail.append(original);
    }
    if (window.YimaiBrowser && !state.data?.model_assist?.available) {
      section(
        '智能整理状态',
        state.data?.model_assist?.message || '当前使用本地整理，云端智能整理尚未启用。'
      );
    }
    if (!t.stale && state.data?.model_assist?.available) {
      const cloud = node('section', '', 'result-section');
      const current = () =>
        state.person === personId &&
        state.conversation === id &&
        state.active === 'result' &&
        state.turns[Number(select.value)]?.id === t.id;
      cloud.append(node('h3', '可选：DeepSeek 辅助整理'));
      const feedback = node(
        'p',
        '仅用于小组虚构资料试验。先查看发送内容，再决定是否使用。',
        'muted'
      );
      feedback.setAttribute('role', 'status');
      const preview = node('div');
      cloud.append(
        feedback,
        button('查看将发送的文字', async () => {
          if (!current()) return;
          feedback.textContent = '正在准备发送预览…';
          preview.replaceChildren();
          try {
            const value = await api('/api/model/preview', {
              conversation_id: id,
              turn_id: t.id,
              person_id: personId,
            });
            if (!current()) return;
            const manifest = value.manifest;
            feedback.textContent = `${manifest.disclosure.recipient} · ${value.model} · 五分钟内有效`;
            const text = node('pre', JSON.stringify(manifest.payload, null, 2));
            text.setAttribute(
              'style',
              'white-space:pre-wrap;overflow-wrap:anywhere;max-height:16rem;overflow:auto'
            );
            preview.append(
              node('p', manifest.disclosure.purpose),
              text,
              node('p', manifest.disclosure.retention),
              node('p', manifest.notice),
              node('p', value.notice)
            );
            const send = button(
              '这是虚构资料，发送给 DeepSeek',
              async () => {
                if (!current()) return;
                feedback.textContent = '正在整理，通常需要几秒；原来的结果仍然保留。';
                preview.replaceChildren();
                try {
                  const response = await api('/api/model/execute', {
                    turn_id: t.id,
                    token: value.token,
                    confirmed: true,
                  });
                  if (!current()) return;
                  say(response.message, response.status !== 'success');
                  await openConversation(id);
                } catch (error) {
                  if (current())
                    feedback.textContent = `${error.message}。本地结果仍保留，请重新预览后再试。`;
                }
              },
              'primary'
            );
            preview.append(
              send,
              button(
                '取消，不发送',
                () => {
                  preview.replaceChildren();
                  feedback.textContent = '已取消，本次没有发送。';
                },
                'text-button'
              )
            );
          } catch (error) {
            if (current()) feedback.textContent = error.message;
          }
        })
      );
      cloud.append(preview);
      detail.append(cloud);
    }
    const full = node('details');
    full.append(node('summary', '展开完整病史、来源与待核对事项'));
    detail.append(full);
    detail = full;
    section('本次情况 · 用户自述', report.current_description);
    renderHistory(detail, report.analysis?.history_sections);
    const previous = state.turns
      .slice(0, Number(select.value))
      .filter((p) => !p.report.refresh_of);
    section(
      '本会话此前的补充',
      previous.map((p) => p.symptoms).join('\n') || '暂无之前的输入。'
    );
    const facts = section(
      '已检查的历史资料',
      report.facts.length ? '' : '暂无已核验候选。未确认的文字不会作为事实列入。'
    );
    for (const fact of report.facts) {
      const e = node('div', '', 'result-section');
      e.append(
        node('h3', fact.field),
        node('p', fact.certainty?.label || '文字已核对，内容状态请查看分区', 'muted'),
        node('p', fact.value),
        node(
          'p',
          `${fact.document_kind} · 第${fact.evidence?.page || 1}页 · 识别行${fact.line + 1}`,
          'muted'
        ),
        button(
          '查看这条内容的来源',
          () => openDocument(fact.document_id),
          'text-button'
        )
      );
      if (fact.evidence?.origin === '用户更正')
        e.append(
          node('p', `经用户更正；原文：${fact.evidence.original_text}`, 'muted')
        );
      facts.append(e);
    }
    section(
      '覆盖与待检查事项',
      `已确认属于此人的 ${report.document_count} 份资料，另有 ${report.pending_count} 条候选未核验。尚未确认人物的资料不纳入。`
    );
    const temporal = report.analysis?.temporal;
    section(
      '时间与相反记载',
      temporal?.states
        ?.map(
          (s) => `${s.entity}：${s.state}（${s.note || '保留原文，不推断当前服用'}）`
        )
        .join('\n') || '暂不能建立可靠事件链，不能据此判断没有冲突。'
    );
    section(
      '整理范围',
      `${report.method}\n历史处方不等于当前服用。缺少记录不代表没有病史；本结果不提供诊断、病因或治疗建议。`
    );
  }
  select.onchange = render;
  render();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
$('voice-button').onclick = () => {
  if (state.recognition) {
    state.recognition.stop();
    return;
  }
  if (!Recognition || !window.isSecureContext) {
    $('symptoms').focus();
    $('voice-status').textContent =
      '当前浏览器或连接不支持内置语音识别。请点手机键盘的麦克风进行听写，识别后检查文字；是否联网由系统输入法决定。';
    return;
  }
  $('voice-dialog').showModal();
};
$('voice-dialog').addEventListener('close', () => {
  if ($('voice-dialog').returnValue !== 'start') return;
  const recognition = new Recognition();
  state.recognition = recognition;
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;
  $('voice-button').textContent = '停止语音';
  $('voice-status').textContent = '正在听，请描述本次情况。识别结果不会自动提交。';
  recognition.onresult = (event) => {
    if (state.recognition !== recognition || !state.csrf) return;
    const text = Array.from(event.results)
      .filter((r) => r.isFinal)
      .map((r) => r[0].transcript)
      .join('');
    if (text) {
      const target = $('symptoms');
      const next = target.value + (target.value ? '\n' : '') + text;
      if (next.length <= 10000) target.value = next;
      else say('文字过长，请先精简后再输入。', true);
      $('voice-status').textContent = '语音已转成文字，请检查后再生成结果。';
    }
  };
  recognition.onerror = () => {
    $('voice-status').textContent =
      '语音识别未完成，可检查浏览器支持情况，或改用键盘麦克风 / 打字。';
  };
  recognition.onend = () => {
    state.recognition = null;
    $('voice-button').textContent = '语音输入';
    if ($('voice-status').textContent.startsWith('正在听'))
      $('voice-status').textContent =
        '本次语音已结束，未收到清晰文字。可以重试或使用键盘输入。';
  };
  try {
    recognition.start();
  } catch {
    state.recognition = null;
    $('voice-button').textContent = '语音输入';
    $('voice-status').textContent = '无法启动语音，请使用键盘麦克风或打字。';
  }
});
$('logout-button').onclick = guard(async () => {
  if (window.YimaiBrowser) {
    location.reload();
    return;
  }
  await api('/api/logout', {});
  lock();
  say('已断开本设备，页面中的资料已清空；服务端试用资料未删除。');
});
window.addEventListener('offline', () =>
  say(
    window.YimaiBrowser
      ? '当前离线，已保存资料仍可查看；首次加载识别组件需要联网。'
      : '当前离线，无法读取或处理资料；已显示内容可能不是最新状态。',
    true
  )
);
window.addEventListener('online', () => {
  if (state.csrf) guard(refresh)();
});
setInterval(() => {
  if (state.csrf && state.data?.busy && !document.hidden) guard(refresh)();
}, 3000);
if ('serviceWorker' in navigator && window.isSecureContext)
  navigator.serviceWorker.register('/sw.js').catch(() => {});
api('/api/session')
  .then(connected)
  .catch(() => lock());
