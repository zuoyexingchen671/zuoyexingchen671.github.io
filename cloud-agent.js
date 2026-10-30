/* 小组共用模型入口。此文件只有公开接口地址，不包含密钥。 */
'use strict';
(() => {
  const ENDPOINT = 'https://yimai-phone-trial.safecabin130.chatgpt.site';
  const fields = new Set([
    '过敏相关记载',
    '药物相关记载',
    '慢病相关记载',
    '手术相关记载',
    '疫苗相关记载',
    '病历诊断记载',
  ]);
  const grants = new Map();
  let cached,
    checkedAt = 0;
  async function status() {
    if (cached && Date.now() - checkedAt < 60000) return cached;
    try {
      const response = await fetch(ENDPOINT + '/api/agent/health', {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw Error('unavailable');
      const data = await response.json();
      cached = {
        available: data.available === true,
        provider: 'DeepSeek',
        model: data.model || 'deepseek-flash',
        message: data.message,
      };
    } catch {
      cached = {
        available: false,
        provider: 'DeepSeek',
        message: '暂时连不上智能整理服务，本地整理仍可使用。',
      };
    }
    checkedAt = Date.now();
    return cached;
  }
  function preview(turn, person, revision) {
    if (turn.archive_version !== revision) throw Error('档案已变化，请先重新整理。');
    const report = turn.report;
    const clean = (text) =>
      String(text)
        .replaceAll(person.name, '[姓名已遮蔽]')
        .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[身份证号已遮蔽]')
        .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号已遮蔽]')
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[邮箱已遮蔽]');
    const sources = (report.analysis?.history_sections || [])
      .flatMap((s) => [...s.checked, ...s.uncertain])
      .filter((f) => f.status === '已核验' && fields.has(f.field));
    if (sources.length > 150)
      throw Error('资料较多，暂超出本次智能整理上限；完整病史仍可查看。');
    const payload = {
      current_description: clean(report.current_description),
      facts: sources.map((f, i) => ({
        id: 'F' + String(i + 1).padStart(3, '0'),
        field: f.field,
        text: clean(f.value),
        uncertain:
          f.certainty?.bucket === 'uncertain' ||
          !!f.certainty?.reasons?.length ||
          f.manual_uncertain === true,
      })),
    };
    if (JSON.stringify(payload).length > 24000)
      throw Error('本次发送文字较多，请先使用本地结果。');
    const token = crypto.randomUUID();
    grants.clear();
    grants.set(token, {
      turnId: turn.id,
      personId: person.id,
      revision,
      sources,
      payload,
      until: Date.now() + 300000,
    });
    return {
      token,
      model: 'deepseek-flash',
      notice:
        '仅用于虚构资料试验。确认后，预览文字将经云端发送到DeepSeek，小组共用每日20次限额。',
      manifest: {
        payload,
        notice: '常见标识符遮蔽不能保证完全匿名。原件、其他人物和未核对文字不发送。',
        disclosure: {
          recipient: 'DeepSeek官方API（通过医脉云端服务）',
          purpose: '筛选本次就诊相关病史，保留来源和存疑',
          retention:
            '云端不保存病历正文；DeepSeek留存以账户条款为准，当前未取得零留存承诺。',
        },
      },
    };
  }
  async function execute(data, turn, personId, revision) {
    const grant = grants.get(data.token);
    if (
      data.confirmed !== true ||
      !grant ||
      grant.turnId !== turn.id ||
      grant.personId !== personId ||
      grant.revision !== revision ||
      grant.until < Date.now()
    )
      throw Error('本次发送预览已失效，请重新预览。');
    grants.delete(data.token);
    const response = await fetch(ENDPOINT + '/api/agent/organize', {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grant.payload),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '智能整理失败，本地结果保留。');
    const ids = result.selected_fact_ids,
      allowed = new Set(grant.payload.facts.map((f) => f.id));
    if (!Array.isArray(ids) || !ids.every((id) => allowed.has(id)))
      throw Error('模型返回无效来源，本地结果保留。');
    const selected = new Set(ids);
    grant.payload.facts.forEach((f) => {
      if (['过敏相关记载', '药物相关记载'].includes(f.field) || f.uncertain)
        selected.add(f.id);
    });
    const sources = grant.sources.filter((_, i) =>
      selected.has('F' + String(i + 1).padStart(3, '0'))
    );
    const lines = ['医生您好，这次主要想咨询：' + turn.report.current_description];
    for (const f of sources)
      lines.push(
        (f.certainty?.reasons?.length ? '【仍需确认】' : '【历史记载】') + f.value
      );
    if (!sources.length) lines.push('本次未选出既往记录，不能据此认为没有相关病史。');
    lines.push(
      '以上是历史资料，不代表目前仍在用药。请结合原件核对，并告诉我还需补充哪些情况。'
    );
    return {
      status: 'success',
      message: 'DeepSeek已完成来源筛选，原件和完整病史仍保留。',
      brief: {
        speech: lines.join('\n'),
        sources,
        notice: 'DeepSeek辅助筛选，本地按原记录组成文字，不是诊断。',
      },
      provider: 'DeepSeek',
      model: result.model,
      created_at: result.created_at,
      usage: result.usage,
    };
  }
  window.YimaiCloud = { status, preview, execute };
})();
