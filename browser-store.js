/* 独立手机版适配器。仅 standalone 构建加载；Python 版本不受影响。 */
'use strict';
(() => {
  const id = () => crypto.randomUUID().replaceAll('-', '');
  const now = () => new Date().toISOString();
  const groups = [
    '过敏史',
    '手术史',
    '慢病相关记录',
    '疫苗记录',
    '用药相关记录',
    '其他记录与文档日期',
  ];
  const fresh = () => ({
    version: 1,
    revision: 0,
    people: [],
    documents: [],
    conversations: [],
    jobs: [],
  });
  let db,
    value,
    ready,
    worker,
    tail = Promise.resolve();
  const urls = new Map();
  const progress = (text) => {
    const el = document.getElementById('upload-status');
    if (el) el.textContent = text;
  };
  const copy = (x) => structuredClone(x);
  const request = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  async function init() {
    const r = indexedDB.open('yimai-phone-private-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('archive');
    db = await request(r);
    value =
      (await request(
        db.transaction('archive').objectStore('archive').get('current')
      )) || fresh();
  }
  async function save(force = false) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('archive', 'readwrite');
      const store = tx.objectStore('archive');
      const previous = value.storage_revision || 0;
      let next;
      const current = store.get('current');
      current.onsuccess = () => {
        const stored = current.result?.storage_revision || 0;
        if (!force && stored !== previous) {
          reject(Error('另一个窗口已更新资料，请重新打开此页面后再试，避免覆盖记录。'));
          tx.abort();
          return;
        }
        next = stored + 1;
        store.put({ ...value, storage_revision: next }, 'current');
      };
      tx.oncomplete = () => {
        value.storage_revision = next;
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }).catch((error) => {
      if (/另一个窗口/.test(error?.message)) throw error;
      throw Error('手机存储未能写入，请释放空间或退出无痕模式后重试。');
    });
  }
  function person(pid) {
    const p = value.people.find((p) => p.id === pid);
    if (!p) throw Error('人物不存在，请重新选择。');
    return p;
  }
  function doc(did) {
    const d = value.documents.find((d) => d.id === did);
    if (!d) throw Error('资料不存在。');
    return d;
  }
  function certainty(c) {
    const compactValue = c.value.replace(/\s/g, '');
    const reasons = [];
    if (c.status !== '已核验') reasons.push('识别文字尚未核对');
    if (c.manual_uncertain) reasons.push('使用者标记存疑');
    if (
      /不详|不清|待查|疑似|可能|拟|计划|否认|未见|无过敏|过敏史[:：]?无/.test(
        compactValue
      )
    )
      reasons.push('保留否定、计划或不确定表述');
    return {
      assertion: reasons.length ? '仍需确认' : '原文表述明确',
      reasons,
      label: reasons.length ? '仍需确认' : '文字已核对',
    };
  }
  function summary(d) {
    const checked = d.candidates.filter((c) => c.status === '已核验').length;
    return {
      id: d.id,
      original_name: d.name,
      processing: !!d.processing,
      kind: d.kind,
      uploaded_at: d.uploaded_at,
      upload_person_id: d.upload_person_id || null,
      candidate_count: d.candidates.length,
      checked_count: checked,
      person: value.people.find((p) => p.id === d.person_id) || null,
      status: d.processing
        ? '原件已保存，正在识别'
        : d.assignment_pending
          ? '原件已保存，姓名需要核对'
          : d.error
            ? '识别未完成，原件已保存'
            : !d.candidates.length
              ? '原件已保存，未提取文字'
              : checked === d.candidates.length
                ? '文字核对完成'
                : `已核对 ${checked}/${d.candidates.length} 条`,
      processing_error: d.error || '',
    };
  }
  function sections(pid) {
    const out = groups.map((title) => ({ title, checked: [], uncertain: [] }));
    for (const d of value.documents.filter((d) => d.person_id === pid))
      for (const c of d.candidates) {
        const item = {
          ...copy(c),
          certainty: certainty(c),
          document_id: d.id,
          document_kind: d.kind,
          evidence: {
            page: d.lines[c.line]?.page || 1,
            origin: c.original ? '用户更正' : '识别文字',
            original_text: c.original || c.value,
          },
        };
        out[c.group || 0][item.certainty.reasons.length ? 'uncertain' : 'checked'].push(
          item
        );
      }
    return out;
  }
  function report(pid, symptoms) {
    person(pid);
    const hs = sections(pid),
      checked = hs.flatMap((s) => s.checked),
      uncertain = hs.flatMap((s) => s.uncertain);
    const sources = hs
      .flatMap((section) => [...section.checked, ...section.uncertain])
      .filter((c) => c.field !== '文档日期');
    const blocks = hs
      .map((section) => {
        const records = [...section.checked, ...section.uncertain].filter(
          (c) => c.field !== '文档日期'
        );
        if (!records.length) return '';
        return (
          `${section.title}：\n` +
          records
            .map(
              (c) =>
                `${c.certainty.reasons.length ? '【待核对】' : '【历史记载】'}${c.value}`
            )
            .join('\n')
        );
      })
      .filter(Boolean);
    const speech =
      `医生您好，这次主要想咨询：${symptoms}\n\n` +
      (blocks.length
        ? blocks.join('\n\n')
        : '目前没有可整理的既往资料，不能据此认为没有病史。') +
      '\n\n以上是历史资料，历史处方不代表目前仍在服用。标为待核对的文字可能存在识别错误或不确定表述，请结合原件核对，并告诉我还需补充哪些情况。';
    return {
      current_description: symptoms,
      doctor_brief: {
        speech,
        notice:
          '按本次自述与各类历史记录整理，待核对内容单独标出；没有推断当前用药或生成诊断。',
        sources,
      },
      facts: checked,
      document_count: value.documents.filter((d) => d.person_id === pid).length,
      pending_count: uncertain.length,
      method: '此结果由本地规则整理；可在结果页另行选择 DeepSeek 辅助筛选。',
      analysis: { history_sections: hs, temporal: { states: [] } },
    };
  }
  function createTurn(conv, symptoms, refresh_of = '') {
    let source = refresh_of ? conv.turns.find((t) => t.id === refresh_of) : null;
    // 更新历史快照沿用当时的会话范围，不能把后来的补充混入旧记录。
    const visited = new Set();
    while (source?.report.refresh_of && !visited.has(source.id)) {
      visited.add(source.id);
      source = conv.turns.find((t) => t.id === source.report.refresh_of);
    }
    const end = source ? conv.turns.indexOf(source) : conv.turns.length;
    const previous = conv.turns.slice(0, end).filter((t) => !t.report.refresh_of);
    const description = previous.length
      ? '本次就诊此前自述：\n' +
        previous.map((t, i) => `${i + 1}. ${t.symptoms}`).join('\n') +
        '\n\n本次补充：' +
        symptoms
      : symptoms;
    const t = {
      id: id(),
      created_at: now(),
      symptoms,
      archive_version: value.revision,
      report: report(conv.person_id, description),
    };
    if (refresh_of) t.report.refresh_of = refresh_of;
    conv.turns.push(t);
    return t;
  }
  function extract(d, text, page) {
    for (const raw of text.split(/\r?\n/)) {
      const lineText = raw.trim();
      if (!lineText) continue;
      const line = d.lines.length;
      d.lines.push({ text: lineText, page });
      const compact = lineText.replace(/[ \t]/g, '');
      if (/^(?:资料类型|患者姓名|姓名|性别|医院|门诊号|住院号)[:：]/.test(compact))
        continue;
      const displayText = lineText.replace(
        /([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g,
        '$1'
      );
      const patterns = [
        [/过敏|变态反应/, 0, '过敏相关记载'],
        [/手术|切除|术后/, 1, '手术相关记载'],
        [/慢性|高血压|糖尿病|冠心病|哮喘/, 2, '慢病相关记载'],
        [/疫苗|接种/, 3, '疫苗相关记载'],
        [/药|片剂|胶囊|口服|注射|mg\b|毫克|用法|用量|处方|滴眼/i, 4, '药物相关记载'],
        [/诊断\s*[:：]/, 5, '诊断相关记载'],
        [/\d{4}[年\-/]\d{1,2}[月\-/]\d{1,2}/, 5, '文档日期'],
      ];
      let found = false;
      for (const [re, group, field] of patterns)
        if (re.test(compact)) {
          d.candidates.push({
            field,
            value: displayText,
            line,
            group,
            status: '待核验',
            manual_uncertain: false,
          });
          found = true;
          break;
        }
      if (!found && !/姓名|性别|医院|门诊号|住院号/.test(compact))
        d.candidates.push({
          field: '其他原文记载',
          value: displayText,
          line,
          group: 5,
          status: '待核验',
          manual_uncertain: false,
        });
    }
  }
  function assignName(d, selected) {
    const names = new Set();
    for (const l of d.lines) {
      const m = l.text
        .replace(/\s/g, '')
        .match(
          /(?:患者姓名|病人姓名|姓名)[:：]?([\u4e00-\u9fff·]{2,8}?)(?=性别|年龄|出生|科室|就诊|$)/
        );
      if (m) names.add(m[1]);
    }
    d.names = [...names];
    if (names.size === 1) {
      const name = [...names][0],
        matches = value.people.filter((p) => p.name === name);
      if (selected) {
        if (person(selected).name === name) d.person_id = selected;
        else {
          d.person_id = null;
          d.assignment_pending = true;
        }
      } else if (matches.length === 1) d.person_id = matches[0].id;
      else if (!matches.length) {
        const p = { id: id(), name, alias: '照片识别建档，姓名可核对', birthday: '' };
        value.people.push(p);
        d.person_id = p.id;
      }
      // 同名歧义保留待选择，不能用当前人物覆盖。
    } else if (!names.size && selected) d.person_id = person(selected).id;
    else if (names.size > 1) {
      d.person_id = null;
      d.assignment_pending = true;
    }
  }
  function blobURL(key, blob) {
    if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
    return urls.get(key);
  }
  async function imageCanvas(blob) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(blob);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(Error('照片无法读取，请改用 JPG 或 PNG'));
        };
        image.src = url;
      });
    }
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * scale);
    c.height = Math.round(bitmap.height * scale);
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    bitmap.close?.();
    return c;
  }
  const canvasBlob = (canvas) =>
    new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(Error('照片预览生成失败'))),
        'image/jpeg',
        0.85
      )
    );
  let ocrScript;
  async function loadOCR() {
    if (window.Tesseract) return;
    if (!ocrScript)
      ocrScript = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timer = setTimeout(() => fail(), 30000);
        function fail() {
          clearTimeout(timer);
          script.remove();
          reject(Error('识别组件下载失败，请检查网络后重试上传。原件仍保留。'));
        }
        script.src =
          'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        script.onload = () => {
          clearTimeout(timer);
          if (window.Tesseract) resolve();
          else fail();
        };
        script.onerror = fail;
        document.head.append(script);
      }).catch((error) => {
        ocrScript = null;
        throw error;
      });
    await ocrScript;
  }
  async function bounded(task, milliseconds, message) {
    let timer;
    try {
      return await Promise.race([
        task,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error(message)), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function recognize(canvas) {
    progress('正在准备识别组件…');
    await loadOCR();
    if (!worker) {
      progress('首次使用正在下载识别组件，请保持联网和页面打开…');
      worker = await bounded(
        Tesseract.createWorker(['chi_sim', 'eng'], 1, {
          workerPath:
            'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
          langPath: location.origin + '/ocr',
          logger: (m) =>
            progress(
              m.status === 'recognizing text'
                ? `正在手机上识别 ${Math.round((m.progress || 0) * 100)}%，请保持页面打开…`
                : '正在准备手机识别组件…'
            ),
        }),
        90000,
        '识别组件下载超时'
      ).catch((e) => {
        worker = null;
        throw e;
      });
    }
    try {
      const result = await bounded(worker.recognize(canvas), 90000, '文字识别超时');
      if (!result.data.text.trim()) throw Error('未识别出文字');
      return result.data.text;
    } catch (e) {
      worker?.terminate?.();
      worker = null;
      throw e;
    }
  }
  async function process(d, selected) {
    for (const [key, url] of urls)
      if (key.startsWith(d.id + ':page:')) {
        URL.revokeObjectURL(url);
        urls.delete(key);
      }
    const previousCandidates = copy(d.candidates);
    const previousLines = copy(d.lines);
    d.lines = [];
    d.candidates = [];
    d.pageBlobs = [];
    d.error = '';
    d.processing = true;
    d.assignment_pending = false;
    d.person_id = selected || d.person_id;
    try {
      if (d.name.toLowerCase().endsWith('.pdf')) {
        const pdfjs = await import(
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs'
        );
        pdfjs.GlobalWorkerOptions.workerSrc =
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
        const pdf = await pdfjs.getDocument({
          data: new Uint8Array(await d.original.arrayBuffer()),
          isEvalSupported: false,
          cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
          cMapPacked: true,
          standardFontDataUrl:
            'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/',
        }).promise;
        try {
          if (pdf.numPages > 20)
            throw Error('手机试用版每份PDF最多20页，请拆分后添加。');
          for (let n = 1; n <= pdf.numPages; n++) {
            progress(`正在处理 PDF 第 ${n}/${pdf.numPages} 页…`);
            const page = await pdf.getPage(n),
              view = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({
              scale: Math.min(2, 1800 / Math.max(view.width, view.height)),
            });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport })
              .promise;
            d.pageBlobs.push(await canvasBlob(canvas));
            const text = await page.getTextContent();
            let content = '';
            for (const item of text.items)
              content += item.str + (item.hasEOL ? '\n' : ' ');
            if (content.trim().length < 8) content = await recognize(canvas);
            extract(d, content, n);
            canvas.width = canvas.height = 1;
            page.cleanup();
          }
        } finally {
          await pdf.destroy();
        }
      } else {
        const canvas = await imageCanvas(d.original);
        d.pageBlobs.push(await canvasBlob(canvas));
        extract(d, await recognize(canvas), 1);
        canvas.width = canvas.height = 1;
      }
      assignName(d, selected);
      d.kind = /处方|药品|药物|用法/.test(
        d.lines
          .map((l) => l.text)
          .join('')
          .replace(/\s/g, '')
      )
        ? '处方或用药资料'
        : '医疗资料';
    } catch (e) {
      d.error = /超时/.test(e.message)
        ? '识别等待超时，原件已保存。请联网后重试。'
        : /未识别出文字/.test(e.message)
          ? '没有识别出文字，原件已保存。请重新拍摄清晰照片。'
          : '识别未完成，原件已保存。请检查网络和照片格式，再点“重试未完成任务”。';
      console.warn('Local recognition failed:', e.name);
    }
    // 失败后的重试保留已核对或手动更正的原文对应条目。
    for (const c of d.candidates) {
      const previous = previousCandidates.find(
        (old) =>
          old.field === c.field &&
          (old.original || old.value) === c.value &&
          previousLines[old.line]?.page === d.lines[c.line]?.page
      );
      if (previous)
        Object.assign(c, {
          value: previous.value,
          original: previous.original,
          status: previous.status,
          manual_uncertain: previous.manual_uncertain,
        });
    }
    d.processing = false;
    value.revision++;
    await save();
  }
  function detail(d) {
    return {
      ...summary(d),
      original_name: d.name,
      lines: copy(d.lines),
      candidates: d.candidates.map((c) => ({ ...copy(c), certainty: certainty(c) })),
      pages: d.pageBlobs.map((_, i) => i + 1),
      suggestion: {
        hints: (d.names || []).map((value) => ({ field: '患者姓名', value })),
      },
      reviews: copy(d.reviews || []),
      assignments: copy(d.assignments || []),
    };
  }
  async function route(path, data) {
    const url = new URL(path, location.origin),
      q = url.searchParams,
      p = url.pathname;
    if (p === '/api/session' || p === '/api/pair') return { csrf: 'phone-local' };
    if (p === '/api/state')
      return {
        model_assist: window.YimaiCloud ? await window.YimaiCloud.status() : undefined,
        people: copy(value.people),
        documents: value.documents.map(summary),
        conversations: value.conversations.map(({ turns, ...c }) => copy(c)),
        jobs: copy(value.jobs),
        busy: value.jobs.some((j) => ['pending', 'running'].includes(j.status)),
      };
    if (p === '/api/people') {
      const name = (data.name || '').trim();
      if (name.length < 2 || name.length > 40) throw Error('请填写2至40字姓名。');
      const p = {
        id: id(),
        name,
        alias: (data.alias || '').slice(0, 40),
        birthday: data.birthday || '',
      };
      value.people.push(p);
      await save();
      return copy(p);
    }
    if (p === '/api/person') {
      const pid = q.get('id'),
        hs = sections(pid);
      return {
        person: copy(person(pid)),
        history_sections: hs,
        documents: value.documents
          .filter(
            (d) => d.person_id === pid || (!d.person_id && d.upload_person_id === pid)
          )
          .map(summary),
        conversations: value.conversations
          .filter((c) => c.person_id === pid)
          .map(({ turns, ...c }) => copy(c)),
        timeline: hs.flatMap((s) => s.checked).filter((c) => c.field === '文档日期'),
      };
    }
    if (p === '/api/upload') {
      if (!data || !data.size || data.size > 25 * 1024 * 1024)
        throw Error('请选择25MB以内的照片或PDF。');
      let name = q.get('name') || data.name || '';
      if (!/\.[^.]+$/.test(name)) {
        const ext = {
          'image/jpeg': '.jpg',
          'image/png': '.png',
          'image/bmp': '.bmp',
          'application/pdf': '.pdf',
        }[data.type];
        if (ext) name = (name || '拍照资料') + ext;
      }
      if (!/\.(png|jpe?g|bmp|pdf)$/i.test(name)) throw Error('仅支持照片或PDF。');
      const selected = q.get('person_id');
      if (selected) person(selected);
      const d = {
        id: id(),
        name,
        original: new Blob([data], { type: data.type || 'application/octet-stream' }),
        person_id: selected || null,
        upload_person_id: selected || null,
        processing: true,
        kind: '医疗资料',
        uploaded_at: now(),
        lines: [],
        candidates: [],
        pageBlobs: [],
        names: [],
        reviews: [],
        assignments: [],
      };
      value.documents.push(d);
      const batch = id(),
        job = {
          id: id(),
          batch_id: batch,
          document_id: d.id,
          status: 'running',
          selected,
        };
      value.jobs.push(job);
      await save();
      await process(d, selected);
      job.status = d.error ? 'failed' : 'completed';
      await save();
      return { batch_id: batch };
    }
    if (p === '/api/document') return detail(doc(q.get('id')));
    if (p === '/api/assign') {
      const d = doc(data.document_id);
      person(data.person_id);
      if (!data.confirmed) throw Error('请先核对姓名。');
      d.assignments.push({
        at: now(),
        previous: d.person_id,
        person_id: data.person_id,
        reason: data.reason,
      });
      d.person_id = data.person_id;
      d.upload_person_id = data.person_id;
      d.assignment_pending = false;
      value.revision++;
      await save();
      return { ok: true };
    }
    if (p === '/api/review' || p === '/api/uncertain') {
      const d = doc(data.document_id),
        c = d.candidates[data.index];
      if (!Number.isInteger(data.index) || !c) throw Error('条目不存在。');
      if (p === '/api/uncertain') c.manual_uncertain = !!data.uncertain;
      else {
        if (!['confirm', 'modify', 'revoke'].includes(data.action))
          throw Error('无效操作');
        if (data.action === 'modify') {
          if (!data.value?.trim() || data.value.length > 4000)
            throw Error('请填写有效文字。');
          c.original ||= c.value;
          c.value = data.value.trim();
        }
        c.status = data.action === 'revoke' ? '待核验' : '已核验';
      }
      d.reviews.push({
        at: now(),
        index: data.index,
        action: data.action || 'uncertain',
        value: c.value,
        uncertain: c.manual_uncertain,
      });
      value.revision++;
      await save();
      return { ok: true };
    }
    if (p === '/api/model/preview') {
      const c = value.conversations.find((c) => c.id === data.conversation_id);
      const t = c?.turns.find((t) => t.id === data.turn_id);
      if (!t || c.person_id !== data.person_id || !window.YimaiCloud)
        throw Error('本次整理对象或云端服务无效。');
      return window.YimaiCloud.preview(t, person(c.person_id), value.revision);
    }
    if (p === '/api/model/execute') {
      if (!window.YimaiCloud) throw Error('智能整理未启用。');
      for (const c of value.conversations)
        for (const t of c.turns) {
          if (t.id !== data.turn_id) continue;
          const result = await window.YimaiCloud.execute(
            data,
            t,
            c.person_id,
            value.revision
          );
          if (t.archive_version !== value.revision)
            throw Error('资料已变化，请重新整理。');
          t.report.local_doctor_brief ||= copy(t.report.doctor_brief);
          t.report.doctor_brief = result.brief;
          t.report.model_assist = Object.fromEntries(
            Object.entries(result).filter(([k]) => k !== 'brief')
          );
          await save();
          return result;
        }
      throw Error('本次记录不存在。');
    }
    if (p === '/api/submit') {
      person(data.person_id);
      if (!data.symptoms?.trim() || data.symptoms.length > 10000)
        throw Error('请填写本次症状。');
      let c = data.conversation_id
        ? value.conversations.find((c) => c.id === data.conversation_id)
        : null;
      if (data.conversation_id && !c) throw Error('会话不存在。');
      if (c && c.person_id !== data.person_id) throw Error('不能把不同人物合并。');
      if (!c) {
        c = {
          id: id(),
          person_id: data.person_id,
          title: `${person(data.person_id).name} · ${data.symptoms.slice(0, 30)}`,
          created_at: now(),
          turns: [],
        };
        value.conversations.push(c);
      }
      createTurn(c, data.symptoms.trim());
      await save();
      return { id: c.id };
    }
    if (p === '/api/turns') {
      const c = value.conversations.find((c) => c.id === q.get('id'));
      if (!c) throw Error('会话不存在。');
      return c.turns.map((t) => ({
        ...copy(t),
        stale: t.archive_version !== value.revision,
      }));
    }
    if (p === '/api/refresh') {
      const c = value.conversations.find((c) => c.id === data.conversation_id),
        t = c?.turns.find((t) => t.id === data.turn_id);
      if (!t) throw Error('记录不存在。');
      createTurn(c, t.symptoms, t.id);
      await save();
      return { id: c.id };
    }
    if (p === '/api/export') {
      let content, filename;
      if (q.has('person_id')) {
        const pid = q.get('person_id');
        filename = person(pid).name + '的病史资料.txt';
        content = sections(pid)
          .map(
            (s) =>
              s.title +
              '\n' +
              [...s.checked, ...s.uncertain]
                .map(
                  (c) =>
                    `[${c.status}${c.manual_uncertain ? ' / 存疑' : ''}] ${c.value}（来源${c.document_id.slice(0, 8)} 第${c.evidence.page}页）`
                )
                .join('\n')
          )
          .join('\n\n');
      } else {
        const c = value.conversations.find((c) => c.id === q.get('conversation_id')),
          t = c?.turns.find((t) => t.id === q.get('turn_id'));
        if (!t) throw Error('记录不存在');
        if (t.archive_version !== value.revision)
          throw Error('档案已变化，请先重新整理。');
        filename = '本次就诊准备.txt';
        content = t.report.doctor_brief.speech + '\n\n' + t.report.doctor_brief.notice;
      }
      return { content, filename };
    }
    if (p === '/api/retry') {
      for (const job of value.jobs.filter(
        (j) =>
          ['failed', 'running', 'pending'].includes(j.status) &&
          (!data?.person_id ||
            doc(j.document_id).person_id === data.person_id ||
            (!doc(j.document_id).person_id && j.selected === data.person_id))
      )) {
        await process(doc(job.document_id), job.selected);
        job.status = doc(job.document_id).error ? 'failed' : 'completed';
      }
      await save();
      return { ok: true };
    }
    if (p === '/api/logout') return { ok: true };
    throw Error('当前手机版不支持这个操作。');
  }
  window.YimaiBrowser = {
    api(path, data) {
      // 查询不排在长时间 OCR 后面；上传原件已先提交到 IndexedDB。
      if (data === undefined)
        return (async () => {
          await (ready ||= init());
          return route(path, data);
        })();
      const run = tail.then(async () => {
        await (ready ||= init());
        try {
          return await route(path, data);
        } catch (e) {
          value =
            (await request(
              db.transaction('archive').objectStore('archive').get('current')
            )) || fresh();
          throw e;
        }
      });
      tail = run.catch(() => {});
      return run;
    },
    resource(path) {
      const u = new URL(path, location.origin),
        d = doc(u.searchParams.get('id'));
      const n = Number(u.searchParams.get('page'));
      return u.pathname === '/api/original'
        ? blobURL(d.id + ':original', d.original)
        : blobURL(`${d.id}:page:${n}`, d.pageBlobs[n - 1]);
    },
    async backup() {
      await (ready ||= init());
      await tail;
      const data = copy(value);
      for (const d of data.documents) {
        d.original = await toData(d.original);
        d.pageBlobs = await Promise.all(d.pageBlobs.map(toData));
      }
      return new Blob(
        [JSON.stringify({ format: 'yimai-phone-backup-v1', archive: data })],
        { type: 'application/json' }
      );
    },
    async restore(file) {
      await (ready ||= init());
      await tail;
      if (file.size > 150 * 1024 * 1024)
        throw Error('备份超过150MB，请使用原设备分批导出资料。');
      const b = JSON.parse(await file.text());
      const v = b.archive;
      if (
        b.format !== 'yimai-phone-backup-v1' ||
        v?.version !== 1 ||
        !['people', 'documents', 'conversations', 'jobs'].every((k) =>
          Array.isArray(v[k])
        )
      )
        throw Error('不是医脉备份文件。');
      if (
        !v.people.every(
          (p) => typeof p.name === 'string' && typeof p.id === 'string'
        ) ||
        !v.documents.every(
          (d) =>
            typeof d.original === 'string' &&
            d.original.startsWith('data:') &&
            Array.isArray(d.candidates) &&
            Array.isArray(d.pageBlobs)
        )
      )
        throw Error('备份内容不完整。');
      for (const d of v.documents) {
        d.original = fromData(d.original);
        d.pageBlobs = d.pageBlobs.map(fromData);
      }
      const previous = value;
      value = v;
      try {
        await save(true);
      } catch (e) {
        value = previous;
        throw e;
      }
      location.reload();
    },
  };
  function toData(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  function fromData(s) {
    if (
      !/^data:(image\/(png|jpeg|bmp)|application\/(pdf|octet-stream));base64,/.test(s)
    )
      throw Error('备份包含不支持的文件类型。');
    const [head, body] = s.split(','),
      bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: head.slice(5, head.indexOf(';')) });
  }
})();
