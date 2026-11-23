/* 蓦初·衡 — 页面渲染与交互 */
(function () {
  'use strict';

  const M = window.Mochu;
  const U = M.utils;
  const { esc, fmt, dateStr, addDays, nextWeekday, dayName, clamp } = U;

  let route = (location.hash || '#overview').replace('#', '');
  const ui = {
    profileEditing: false,
    lastCheckinId: null,
    lastFeedback: null,
    movementCsv: '',
    movementFile: '',
    movementResult: null,
    guardResult: null,
    opinionForm: false,
    confirmCallback: null
  };

  const VIEW_META = {
    overview: { title: '总览 · 全周期', crumb: '总览' },
    profile: { title: '会员档案', crumb: '01 会员档案' },
    checkin: { title: '到店核对与风险提示', crumb: '02 到店核对' },
    plan: { title: '个性化计划', crumb: '03 个性化计划' },
    feedback: { title: '离店反馈与调整', crumb: '04 离店反馈' },
    movement: { title: '动作评估', crumb: '05 动作评估' },
    game: { title: '趣味训练', crumb: '06 趣味训练' },
    rehab: { title: '康复训练与慢病支持', crumb: '07 康复与慢病' },
    booking: { title: '预约与场馆服务协同', crumb: '08 预约与服务' },
    records: { title: '记录、导出与说明', crumb: '记录与说明' }
  };

  /* ---------------- shared helpers ---------------- */
  const member = () => M.getMember();
  const riskClass = (d) => d === 'continue' ? 'ok' : d === 'supplement' ? 'warn' : d === 'professional_review' ? 'info' : d === 'suspend' ? 'danger' : 'muted';
  const badge = (text, kind) => '<span class="badge ' + (kind || 'muted') + '">' + esc(text) + '</span>';
  const riskBadge = (risk) => risk ? badge(risk.label, riskClass(risk.decision)) : badge('未核对', 'muted');
  const CHANGE_LABEL = { progress: '小幅进阶', deload: '训练减量', safety_stop: '安全暂停', reduce_frequency: '降低频次', maintain: '维持' };
  const changeLabel = (t) => CHANGE_LABEL[t] || t || '—';
  const BOOKING_LABEL = { requested: '待确认', confirmed: '已确认', rescheduled: '已改约', cancelled: '已取消', completed: '已完成', waitlist: '候补' };
  const bookingLabel = (s) => BOOKING_LABEL[s] || s || '—';
  function planStatusBadge(plan, risk) {
    if (!plan) return badge('未生成', 'muted');
    if (plan.adjustment_type === 'progress') return badge('反馈后进阶', 'ok');
    if (plan.adjustment_type === 'safety_stop') return badge('安全暂停', 'danger');
    if (plan.adjustment_type === 'deload') return badge('减量恢复', 'warn');
    if (plan.adjustment_type === 'reduce_frequency') return badge('降低频次', 'warn');
    return riskBadge(risk);
  }
  const tag = (text, kind) => '<span class="tag ' + (kind || '') + '">' + esc(text) + '</span>';

  function pageHead(eyebrow, title, desc, actions) {
    return '<div class="page-head"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(title) + '</h1>' +
      (desc ? '<div class="desc">' + desc + '</div>' : '') + '</div>' +
      (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>';
  }
  function cardHead(title, sub, right) {
    return '<div class="card-head"><div><h3>' + esc(title) + '</h3>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' +
      (right ? '<div class="right">' + right + '</div>' : '') + '</div>';
  }
  function empty(icon, title, desc, action) {
    return '<div class="empty"><div class="icon">' + esc(icon) + '</div><div style="font-weight:600;color:var(--ink)">' + esc(title) + '</div>' +
      '<div class="small" style="margin-top:4px">' + esc(desc) + '</div>' + (action ? '<div style="margin-top:14px">' + action + '</div>' : '') + '</div>';
  }
  function kpi(label, value, foot, accent) {
    return '<div class="kpi ' + (accent ? 'accent' : '') + '"><div class="k-label">' + esc(label) + '</div><div class="k-value">' + value + '</div><div class="k-foot">' + foot + '</div></div>';
  }
  function riskCard(risk, opts) {
    if (!risk) {
      return '<div class="callout warn">暂无到店核对记录。请先完成「02 到店核对」，系统才能给出本次训练注意事项。</div>';
    }
    const reasons = risk.reasons.map((r) =>
      '<li><span class="rule-code">' + esc(r.rule) + '</span><div>' + esc(r.text) + '<span class="rule-src">来源：' + esc(r.source) + '</span></div></li>'
    ).join('');
    return '<div class="risk-card ' + risk.decision + '">' +
      '<div class="risk-top">' + badge(risk.decision === 'suspend' ? '暂停活动' : risk.decision === 'professional_review' ? '专业复核' : risk.decision === 'supplement' ? '补充资料' : '继续训练', riskClass(risk.decision)) +
      '<div class="risk-title">' + esc(risk.label) + '</div></div>' +
      '<ul class="rule-list">' + reasons + '</ul>' +
      '<div class="divider"></div>' +
      '<div class="grid grid-2" style="gap:10px"><div><div class="tiny muted">本次允许强度</div><div class="small" style="font-weight:600">' + esc(risk.allowed_intensity) + '</div></div>' +
      '<div><div class="tiny muted">下一步动作</div><div class="small">' + esc(risk.next_action) + '</div></div></div>' +
      '<div class="hint" style="margin-top:10px">' + esc(risk.disclaimer) + '</div></div>';
  }
  function planSession(s) {
    const pause = (s.intensity || '').includes('暂停');
    return '<div class="plan-session ' + (pause ? 'pause' : '') + '">' +
      '<div class="top"><span class="day">' + esc(s.day || '待定') + '</span><div style="min-width:0"><div class="title">' + esc(s.title) + '</div>' +
      '<div class="meta">' + esc(s.time || '') + ' · ' + esc(String(s.duration_min)) + ' 分钟 · ' + esc(s.intensity || '') + (s.focus ? ' · ' + s.focus.map((f) => esc(f)).join(' / ') : '') + '</div></div></div>' +
      '<ul>' + (s.items || []).map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul></div>';
  }
  function timelineItems(items) {
    if (!items.length) return '<div class="muted small">暂无记录。</div>';
    return '<div class="timeline">' + items.map((it) =>
      '<div class="t-item ' + (it.kind || '') + '"><div class="t-dot">' + esc(it.icon || '·') + '</div><div><div class="t-title">' + esc(it.title) + '</div>' +
      '<div class="t-meta">' + esc(it.meta || '') + '</div>' + (it.body ? '<div class="t-body">' + it.body + '</div>' : '') + '</div></div>'
    ).join('') + '</div>';
  }

  /* ---------------- overview ---------------- */
  function renderOverview() {
    const m = member();
    const ck = M.latestCheckin();
    const risk = ck ? ck.risk : null;
    const plan = M.activePlan();
    const game = M.db.game[m.id] || M.syncGame(m.id);
    const bookings = M.bookingsFor();
    const nextBooking = bookings.find((b) => ['confirmed', 'requested', 'rescheduled'].includes(b.status));
    const completeness = M.memberCompleteness(m);
    const schedule = (m.available_time || []).map((s) => s.day + ' ' + s.start).join(' · ') || '未设置';
    const recent = [];
    M.db.checkins.filter((c) => c.member_id === m.id).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 2).forEach((c) => {
      recent.push({ kind: c.risk.decision === 'continue' ? 'done' : c.risk.decision === 'supplement' ? 'warn' : 'danger', icon: '核', title: '到店核对 · ' + c.risk.label, meta: fmt(c.at) + ' · 睡眠 ' + c.sleep_hours + 'h · 疲劳 ' + c.fatigue + '/10', body: '<span class="small muted">' + esc(c.risk.reasons[0].text) + '</span>' });
    });
    M.db.feedbacks.filter((f) => f.member_id === m.id).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 2).forEach((f) => {
      recent.push({ kind: 'done', icon: '馈', title: '离店反馈 · 计划调整', meta: fmt(f.at) + ' · 完成 ' + f.completed_sessions + ' 次 · 疲劳 ' + (f.fatigue == null ? '—' : f.fatigue), body: f.summary ? '<span class="small muted">完成率 ' + (f.summary.adherence == null ? '—' : Math.round(f.summary.adherence * 100) + '%') + ' · ' + esc(changeLabel(f.change_type)) + '</span>' : '' });
    });
    M.db.assessments.filter((a) => a.member_id === m.id).slice().sort((a, b) => String(b.analyzed_at).localeCompare(String(a.analyzed_at))).slice(0, 1).forEach((a) => {
      recent.push({ kind: 'done', icon: '评', title: '动作评估 · ' + a.exercise, meta: fmt(a.analyzed_at) + ' · 评分 ' + a.metrics.score + '/100', body: '<span class="small muted">' + esc(a.summary) + '</span>' });
    });
    recent.sort((a, b) => String(b.meta).localeCompare(String(a.meta)));

    return pageHead('FULL-CYCLE HEALTH MANAGEMENT', m.display_name + '的全周期健康档案',
      '一份统一会员档案，贯通「到店前 — 训练中 — 离店后」。当前演示对象为 M001，全部数据为合成演示数据。',
      '<button class="btn" data-action="goto" data-view="profile">查看档案</button><button class="btn primary" data-action="goto" data-view="checkin">开始今日核对</button>') +
      '<div class="hero"><div class="eyebrow">MOCHU · BALANCE</div><h2>' + esc(m.display_name) + '，今天从一次核对开始。</h2>' +
      '<p>' + esc(m.goal_detail || '') + '</p>' +
      '<div class="hero-chips"><span>目标：' + esc((m.goal || []).join(' · ')) + '</span><span>训练经验：' + esc(m.training_experience || '—') + '</span><span>可用时间：' + esc(schedule) + '</span><span>' + esc(m.membership || '') + '</span></div>' +
      '<div class="cycle-rail">' +
      '<div class="cycle-step"><div class="line"></div><div class="node"><div class="n">01</div><div class="t">到店前</div></div><div class="d">状态核对 · 风险提示 · 器械准备</div></div>' +
      '<div class="cycle-step"><div class="line"></div><div class="node"><div class="n">02</div><div class="t">训练中</div></div><div class="d">个性化计划 · 动作评估 · 趣味联动</div></div>' +
      '<div class="cycle-step"><div class="node"><div class="n">03</div><div class="t">离店后</div></div><div class="d">反馈记录 · 计划调整 · 随访与预约</div></div>' +
      '</div>' +
      '<div class="hero-actions"><button class="btn copper" data-action="demo">一键连续演示</button><button class="btn" data-action="goto" data-view="plan">查看当前计划</button><button class="btn" data-action="goto" data-view="game">查看趣味训练</button></div></div>' +

      '<div class="grid grid-4">' +
      kpi('档案完整度', completeness + '<small>%</small>', '目标、训练、近期、饮食、睡眠、专业意见', false) +
      kpi('最近核对', risk ? riskBadge(risk) : badge('未核对', 'muted'), ck ? '最近核对：' + fmt(ck.at) : '完成到店核对后生成', false) +
      kpi('当前计划', plan ? 'v' + plan.version : '—', plan ? plan.training.length + ' 次 / 周 · ' + plan.change_reason : '尚未生成', true) +
      kpi('山径进度', game.progress_pct + '<small>%</small>', game.stage_name + ' · XP ' + game.xp + ' · ' + game.status_label, false) +
      '</div>' +

      '<div class="grid grid-main" style="margin-top:16px">' +
      '<div class="card"><div class="card-head"><div><h3>今日状态与训练注意事项</h3><div class="sub">统一会员身份 · 最近一次核对</div></div><div class="right">' + (risk ? riskBadge(risk) : '') + '</div></div>' +
      (risk ? riskCard(risk) : empty('核', '还没有今日核对', '到店前 2 分钟填写身体感受、疲劳、睡眠与疼痛，系统会给出可解释的决策。', '<button class="btn primary" data-action="goto" data-view="checkin">去核对</button>')) +
      '</div>' +
      '<div class="card"><div class="card-head"><div><h3>下一次到店</h3><div class="sub">预约 · 器械 · 教练</div></div><div class="right"><button class="btn sm ghost" data-action="goto" data-view="booking">全部预约</button></div></div>' +
      (nextBooking ? '<div class="plan-session"><div class="top"><span class="day">' + esc(dayName(nextBooking.date)) + '</span><div><div class="title">' + esc(nextBooking.date) + ' ' + esc(nextBooking.time) + ' · ' + esc(nextBooking.equipment) + '</div><div class="meta">' + esc(nextBooking.coach) + ' · 计划 v' + esc(nextBooking.plan_version) + ' · ' + riskBadge({ label: nextBooking.status === 'confirmed' ? '已确认' : nextBooking.status, decision: 'continue' }) + '</div></div></div><div class="hint" style="margin-top:8px">器械准备：' + esc(nextBooking.prep.join('、')) + '</div></div>' : empty('约', '暂无待到店预约', '预约会与当前计划的训练日、器械与教练自动衔接。', '<button class="btn sm" data-action="goto" data-view="booking">去预约</button>')) +
      '<div class="divider"></div><div class="card-head" style="margin-bottom:6px"><div><h3>趣味训练</h3><div class="sub">与现实表现一致，不脱离风险状态</div></div><div class="right"><button class="btn sm ghost" data-action="goto" data-view="game">查看</button></div></div>' +
      '<div class="progress" style="margin:8px 0 6px"><i style="width:' + game.progress_pct + '%"></i></div>' +
      '<div class="small muted">' + esc(game.trail) + ' · ' + esc(game.stage_name) + ' · ' + esc(game.status_label) + '</div>' +
      '<div class="small" style="margin-top:6px">当前任务：' + esc(game.task) + '</div>' +
      '</div></div>' +

      '<div class="grid grid-main" style="margin-top:16px">' +
      '<div class="card"><div class="card-head"><div><h3>当前计划</h3><div class="sub">' + (plan ? 'v' + plan.version + ' · 依据 ' + esc(plan.basis.risk_decision) + ' · 复核 ' + esc(plan.review_date) : '尚未生成') + '</div></div><div class="right"><button class="btn sm" data-action="goto" data-view="plan">完整计划</button></div></div>' +
      (plan ? plan.training.map(planSession).join('') + '<div class="hint" style="margin-top:10px">适用限制：' + esc(plan.limitations.slice(0, 2).join('；')) + '</div>' : empty('计', '还没有训练计划', '完成到店核对后，系统会按目标、可用时间、近期记录与专业限制生成训练、饮食、睡眠建议。', '<button class="btn primary" data-action="goto" data-view="plan">生成计划</button>')) +
      '</div>' +
      '<div class="card"><div class="card-head"><div><h3>最近闭环</h3><div class="sub">核对 → 计划 → 反馈 → 评估 → 预约</div></div><div class="right"><button class="btn sm ghost" data-action="goto" data-view="records">全部记录</button></div></div>' +
      timelineItems(recent.slice(0, 4)) + '</div></div>' +

      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>八项任务覆盖</h3><div class="sub">按第二赛道四层八项逐项对应</div></div><div class="right"><button class="btn sm ghost" data-action="goto" data-view="records">查看证据</button></div></div>' +
      taskMatrix(true) + '</div>' +
      '<div class="callout" style="margin-top:16px">演示数据均为合成数据，不含真实会员个人健康信息；健康建议不构成医疗建议，康复与慢病内容遵循专业意见，医疗诊断与治疗决策由具备资质的专业人员做出。</div>';
  }

  function taskMatrix(compact) {
    const m = member();
    const cks = M.db.checkins.filter((c) => c.member_id === m.id);
    const plan = M.activePlan();
    const fbs = M.db.feedbacks.filter((f) => f.member_id === m.id);
    const ass = M.db.assessments.filter((a) => a.member_id === m.id);
    const bks = M.db.bookings.filter((b) => b.member_id === m.id);
    const rehab = M.db.rehab[m.id] || { opinions: [], followups: [] };
    const opinionCount = (rehab.opinions || []).length + (m.voluntary?.medical_advice || []).length;
    const tasks = [
      { n: '01', layer: '基础', name: '会员档案', ok: !!m && M.memberCompleteness(m) >= 60, ev: 'v' + m.version + ' · 目标/训练/近期/自愿信息' },
      { n: '02', layer: '基础', name: '状态核对与风险提示', ok: cks.length > 0, ev: cks.length + ' 次核对 · 最近 ' + (M.latestRisk() ? M.latestRisk().label : '未核对') },
      { n: '03', layer: '线上', name: '个性化计划', ok: !!plan, ev: plan ? 'v' + plan.version + ' · 训练/饮食/睡眠' : '待生成' },
      { n: '04', layer: '线上', name: '反馈与调整', ok: fbs.length > 0, ev: fbs.length + ' 次反馈 · ' + (plan ? '当前 v' + plan.version : '—') },
      { n: '05', layer: '线下', name: '动作检测/模式评估', ok: ass.length > 0, ev: ass.length ? ass[ass.length - 1].metrics.score + '/100 · ' + ass[ass.length - 1].exercise : '待评估' },
      { n: '06', layer: '线下', name: '趣味训练与虚拟联动', ok: !!M.db.game[m.id], ev: M.db.game[m.id] ? M.db.game[m.id].stage_name + ' · ' + M.db.game[m.id].status_label : '待同步' },
      { n: '07', layer: '协同', name: '康复辅助与慢病支持', ok: opinionCount > 0, ev: opinionCount ? opinionCount + ' 条专业意见 · ' + rehab.followups.length + ' 次随访' : '待录入' },
      { n: '08', layer: '协同', name: '预约与场馆服务', ok: bks.length > 0, ev: bks.length ? bks.length + ' 条预约 · 状态可回写' : '待预约' }
    ];
    if (compact) {
      return '<div class="grid grid-4" style="gap:10px">' + tasks.map((t) =>
        '<div class="metric" style="padding:12px 13px"><div class="m-label">' + t.n + ' · ' + esc(t.layer) + '</div><div style="font-size:12.5px;font-weight:600;margin-top:2px">' + esc(t.name) + '</div>' +
        '<div style="margin-top:5px">' + (t.ok ? tag('已完成', 'green') : tag('待完成', 'amber')) + '</div><div class="tiny muted" style="margin-top:4px">' + esc(t.ev) + '</div></div>'
      ).join('') + '</div>';
    }
    return '<table class="table"><thead><tr><th>层级</th><th>任务</th><th>状态</th><th>证据</th></tr></thead><tbody>' + tasks.map((t) =>
      '<tr><td><span class="tag">' + t.n + ' · ' + esc(t.layer) + '</span></td><td>' + esc(t.name) + '</td><td>' + (t.ok ? '<span class="status-pass">已完成</span>' : '<span class="status-warn">待完成</span>') + '</td><td class="muted">' + esc(t.ev) + '</td></tr>'
    ).join('') + '</tbody></table>';
  }

  /* ---------------- profile ---------------- */
  function renderProfile() {
    const m = member();
    const v = m.voluntary || {};
    const completeness = M.memberCompleteness(m);
    const missing = [];
    if (!m.goal?.length) missing.push('健身目标');
    if (!m.training_experience) missing.push('训练经验');
    if (!m.recent_activity?.weekly_sessions) missing.push('近期运动');
    if (!m.available_time?.length) missing.push('可用时间');
    if (!v.diet?.pattern) missing.push('饮食偏好');
    if (!v.sleep?.target_hours) missing.push('睡眠目标');
    if (!v.medical_advice?.length) missing.push('专业意见');
    const history = (m.history || []).slice().reverse().map((h) =>
      '<div class="t-item done"><div class="t-dot">v</div><div><div class="t-title">v' + esc(h.version) + ' · ' + esc(h.change) + '</div><div class="t-meta">' + esc(fmt(h.at)) + '</div><div class="t-body tiny muted">字段：' + esc((h.fields || []).join('、')) + '</div></div></div>'
    ).join('');

    const editForm = ui.profileEditing ? '<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>编辑会员档案</h3><div class="sub">保存后版本号递增，历史版本保留</div></div></div>' +
      '<form data-form="profile">' +
      '<div class="field-row three"><div class="field"><label>姓名</label><input class="input" name="display_name" value="' + esc(m.display_name) + '" required></div>' +
      '<div class="field"><label>年龄</label><input class="input" name="age" type="number" value="' + esc(m.age || '') + '"></div>' +
      '<div class="field"><label>会员类型</label><input class="input" name="membership" value="' + esc(m.membership || '') + '"></div></div>' +
      '<div class="field-row"><div class="field"><label>健身目标（逗号分隔）</label><input class="input" name="goal" value="' + esc((m.goal || []).join('、')) + '"></div>' +
      '<div class="field"><label>可用时间（最多 3 段）</label><div class="field-row three">' +
      [0, 1, 2].map((i) => { const s = (m.available_time || [])[i] || {}; return '<input class="input" name="slot_day_' + i + '" placeholder="周二" value="' + esc(s.day || '') + '"><input class="input" name="slot_time_' + i + '" placeholder="19:00" value="' + esc(s.start || '') + '"><input class="input" name="slot_min_' + i + '" placeholder="分钟" type="number" value="' + esc(s.minutes || '') + '">'; }).join('') +
      '</div></div></div>' +
      '<div class="field"><label>目标说明</label><textarea class="textarea" name="goal_detail">' + esc(m.goal_detail || '') + '</textarea></div>' +
      '<div class="field"><label>训练经验与近期运动</label><input class="input" name="training_experience" value="' + esc(m.training_experience || '') + '"></div>' +
      '<div class="field-row"><div class="field"><label>饮食模式</label><input class="input" name="diet_pattern" value="' + esc(v.diet?.pattern || '') + '"></div>' +
      '<div class="field"><label>过敏/忌口（逗号分隔）</label><input class="input" name="allergies" value="' + esc((v.diet?.allergies || []).join('、')) + '"></div></div>' +
      '<div class="field-row"><div class="field"><label>睡眠目标（小时）</label><input class="input" name="sleep_target" type="number" step="0.1" value="' + esc(v.sleep?.target_hours || '') + '"></div>' +
      '<div class="field"><label>活动限制（每行一条，来自专业意见）</label><textarea class="textarea" name="restrictions">' + esc((v.activity_restrictions || []).join('\n')) + '</textarea></div></div>' +
      '<div class="btn-row" style="margin-top:14px"><button class="btn primary" type="submit">保存并生成新版本</button><button class="btn" type="button" data-action="profile-cancel">取消</button></div></form></div>' : '';

    return pageHead('TASK 01 · UNIFIED MEMBER PROFILE', '会员档案',
      '可持续更新的统一会员记录：健身目标、训练经验、近期运动，以及会员自愿提供的饮食、睡眠、既往诊断与医嘱信息。',
      '<button class="btn" data-action="profile-edit">编辑档案</button><button class="btn primary" data-action="goto" data-view="checkin">去核对</button>') +
      editForm +
      '<div class="grid grid-main">' +
      '<div>' +
      '<div class="card"><div class="card-head"><div><h3>基本信息</h3><div class="sub">身份与会员权益</div></div><div class="right">' + tag('v' + m.version + ' 档案', 'green') + '</div></div>' +
      '<table class="table"><tbody>' +
      '<tr><th style="width:110px">会员编号</th><td class="mono">' + esc(m.id) + '</td><th style="width:90px">姓名</th><td>' + esc(m.display_name) + '</td></tr>' +
      '<tr><th>年龄/性别</th><td>' + esc(m.age || '—') + ' / ' + esc(m.sex || '—') + '</td><th>会员类型</th><td>' + esc(m.membership || '—') + '</td></tr>' +
      '<tr><th>健身目标</th><td colspan="3">' + (m.goal || []).map((g) => tag(g, 'green')).join(' ') + '</td></tr>' +
      '<tr><th>目标说明</th><td colspan="3">' + esc(m.goal_detail || '—') + '</td></tr>' +
      '<tr><th>训练经验</th><td colspan="3">' + esc(m.training_experience || '—') + '</td></tr>' +
      '<tr><th>近期运动</th><td colspan="3">' + esc((m.recent_activity?.last_7d || []).join('；') || '—') + '<div class="tiny muted">' + esc(m.recent_activity?.notes || '') + '</div></td></tr>' +
      '</tbody></table></div>' +

      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>可用时间与偏好</h3><div class="sub">计划生成会优先匹配这些时段</div></div></div>' +
      '<div class="chip-row">' + ((m.available_time || []).length ? m.available_time.map((s) => '<span class="chip active">' + esc(s.day) + ' ' + esc(s.start) + ' · ' + esc(s.minutes) + ' 分钟</span>').join('') : '<span class="muted small">未设置</span>') + '</div>' +
      '<div class="hint" style="margin-top:10px">器械偏好：' + esc((m.preferences?.equipment || []).join('、') || '—') + '；教练：' + esc(m.preferences?.coach || '—') + '</div></div>' +

      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>会员自愿提供的健康信息</h3><div class="sub">仅用于健康管理与训练支持，可随时补充或修改</div></div></div>' +
      '<div class="grid grid-2" style="gap:14px"><div><h4>饮食</h4><div class="small">' + esc(v.diet?.pattern || '未填写') + '</div><div class="tiny muted">过敏/忌口：' + esc((v.diet?.allergies || []).join('、') || '无') + '</div></div>' +
      '<div><h4>睡眠</h4><div class="small">目标 ' + esc(v.sleep?.target_hours || '—') + ' 小时</div><div class="tiny muted">' + esc(v.sleep?.habit || '') + '</div></div></div>' +
      '<div class="divider"></div><h4>既往诊断</h4>' +
      ((v.diagnoses || []).length ? '<table class="table"><thead><tr><th>编码</th><th>名称</th><th>来源/日期</th></tr></thead><tbody>' + v.diagnoses.map((d) => '<tr><td class="mono">' + esc(d.code) + '</td><td>' + esc(d.label) + '</td><td class="muted">' + esc(d.source) + ' · ' + esc(d.date) + '</td></tr>').join('') + '</tbody></table>' : '<div class="muted small">未填写。</div>') +
      '<div class="divider"></div><h4>专业意见与活动限制</h4>' +
      ((v.medical_advice || []).length ? v.medical_advice.map((a) => '<div class="callout info" style="margin-bottom:8px"><strong>' + esc(a.source) + '</strong> · ' + esc(a.date) + '<div style="margin-top:4px">' + esc(a.text) + '</div><div class="tiny muted" style="margin-top:4px">限制：' + esc((a.restrictions || []).join('；')) + '</div></div>').join('') : '<div class="muted small">未填写。</div>') +
      '</div></div>' +

      '<div>' +
      '<div class="card"><div class="card-head"><div><h3>档案完整度</h3><div class="sub">用于计划质量与风险判断</div></div><div class="right"><strong style="font-family:Georgia,serif;font-size:22px;color:var(--moss)">' + completeness + '%</strong></div></div>' +
      '<div class="progress" style="margin-bottom:12px"><i style="width:' + completeness + '%"></i></div>' +
      (missing.length ? '<div class="hint">待补充：' + esc(missing.join('、')) + '</div>' : '<div class="hint">关键字段已齐全，可支撑计划与风险判断。</div>') +
      '<div class="divider"></div><div class="grid grid-2" style="gap:8px">' +
      '<div class="metric"><div class="m-label">核对次数</div><div class="m-value">' + M.db.checkins.filter((c) => c.member_id === m.id).length + '</div></div>' +
      '<div class="metric"><div class="m-label">计划版本</div><div class="m-value">v' + (M.activePlan()?.version || '—') + '</div></div>' +
      '<div class="metric"><div class="m-label">反馈次数</div><div class="m-value">' + M.feedbacksFor().length + '</div></div>' +
      '<div class="metric"><div class="m-label">评估次数</div><div class="m-value">' + M.assessmentsFor().length + '</div></div></div></div>' +

      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>数据来源与授权</h3><div class="sub">合规底线</div></div></div>' +
      '<div class="small"><div class="checkline">' + (m.consent?.health_data ? '✓' : '○') + ' 会员同意健康数据用于健康管理</div>' +
      '<div class="checkline" style="margin-top:6px">' + (m.consent?.professional_contact ? '✓' : '○') + ' 同意必要时联系专业人员</div>' +
      '<div class="checkline" style="margin-top:6px">' + (m.consent?.demo_authorized ? '✓' : '○') + ' 演示授权（合成数据）</div></div>' +
      '<div class="callout warn" style="margin-top:12px">当前会员为合成演示对象，不包含真实个人健康信息。真实上线时需完成授权、脱敏与访问控制。</div></div>' +

      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>档案版本历史</h3><div class="sub">补充、查询、修改均可追溯</div></div></div>' +
      '<div class="timeline">' + (history || '<div class="muted small">暂无</div>') + '</div></div>' +
      '</div></div>';
  }

  /* ---------------- check-in ---------------- */
  function renderCheckin() {
    const m = member();
    const last = M.latestCheckin();
    const result = ui.lastCheckinId ? M.db.checkins.find((c) => c.id === ui.lastCheckinId) : last;
    const ck = last || { body_feel: 4, fatigue: 4, sleep_hours: 7, sleep_quality: 4, pain: 1, pain_location: '', training_intent: '核心稳定训练', notes: '' };
    const recent = M.db.checkins.filter((c) => c.member_id === m.id).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 5);
    const recentHtml = recent.length ? recent.map((c) => '<div class="plan-session"><div class="top"><span class="day">' + esc(fmt(c.at).slice(5, 10)) + '</span><div><div class="title">' + esc(c.risk.label) + '</div><div class="meta">睡眠 ' + esc(c.sleep_hours) + 'h · 疲劳 ' + esc(c.fatigue) + '/10 · 疼痛 ' + esc(c.pain) + '/10' + (c.pain_location ? '（' + esc(c.pain_location) + '）' : '') + '</div></div><div style="margin-left:auto">' + riskBadge(c.risk) + '</div></div></div>').join('') : '<div class="muted small">暂无核对记录。</div>';

    return pageHead('TASK 02 · PRE-TRAINING CHECK', '到店核对与风险提示',
      '根据会员当次填报的身体感受、疲劳与睡眠情况，以及档案中的活动限制，给出「继续训练 / 补充资料 / 提交专业复核 / 暂停活动」的可解释决策。',
      '<button class="btn" data-action="goto" data-view="plan">查看计划</button>') +
      (result ? '<div style="margin-bottom:16px">' + riskCard(result.risk) + '</div>' : '') +
      '<div class="grid grid-main">' +
      '<div class="card"><div class="card-head"><div><h3>今日到店核对</h3><div class="sub">演示对象：' + esc(m.display_name) + '（' + esc(m.id) + '）· 合成数据</div></div><div class="right"><span class="tag">约 2 分钟</span></div></div>' +
      '<div class="chip-row" style="margin-bottom:14px"><span class="tiny muted" style="align-self:center">快速填入：</span>' +
      '<button class="chip" data-action="preset" data-preset="normal">状态正常</button><button class="chip" data-action="preset" data-preset="sleep">睡眠不足</button><button class="chip" data-action="preset" data-preset="pain">疼痛 5/10</button><button class="chip risk-suspend" data-action="preset" data-preset="red">红旗症状</button></div>' +
      '<form data-form="checkin"><div class="field-row four">' +
      '<div class="field"><label>身体感受（1 差 – 5 好）</label><input class="input" type="number" name="body_feel" min="1" max="5" value="' + esc(ck.body_feel ?? '') + '" required></div>' +
      '<div class="field"><label>主观疲劳（1–10）</label><input class="input" type="number" name="fatigue" min="1" max="10" value="' + esc(ck.fatigue ?? '') + '" required></div>' +
      '<div class="field"><label>昨晚睡眠（小时）</label><input class="input" type="number" step="0.1" name="sleep_hours" min="0" max="16" value="' + esc(ck.sleep_hours ?? '') + '" required></div>' +
      '<div class="field"><label>睡眠质量（1–5）</label><input class="input" type="number" name="sleep_quality" min="1" max="5" value="' + esc(ck.sleep_quality ?? '') + '"></div></div>' +
      '<div class="field-row three" style="margin-top:10px"><div class="field"><label>疼痛评分（0–10）</label><input class="input" type="number" name="pain" min="0" max="10" value="' + esc(ck.pain ?? 0) + '" required></div>' +
      '<div class="field"><label>疼痛位置</label><input class="input" name="pain_location" placeholder="如：腰部 / 膝" value="' + esc(ck.pain_location || '') + '"></div>' +
      '<div class="field"><label>本次训练意图</label><input class="input" name="training_intent" placeholder="如：核心稳定训练" value="' + esc(ck.training_intent || '') + '"></div></div>' +
      '<div class="divider"></div><div class="field"><label>红旗症状（可多选）</label><div class="check-grid">' +
      ['胸痛', '眩晕', '晕厥', '发热', '呼吸困难', '新发麻木'].map((f) => '<label class="checkline"><input type="checkbox" name="red_flags" value="' + f + '"> ' + f + '</label>').join('') +
      '</div></div>' +
      '<div class="field" style="margin-top:10px"><label>新发症状（没有可留空）</label><input class="input" name="new_symptom" placeholder="如：右膝新发肿胀"></div>' +
      '<div class="field" style="margin-top:10px"><label>备注</label><textarea class="textarea" name="notes" placeholder="训练前想补充的信息">' + esc(ck.notes || '') + '</textarea></div>' +
      '<div class="btn-row" style="margin-top:14px"><button class="btn primary lg" type="submit">提交核对并生成决策</button><span class="hint">提交后记录进入统一档案，可在计划、游戏与预约中复用。</span></div></form></div>' +

      '<div><div class="card"><div class="card-head"><div><h3>判断顺序</h3><div class="sub">决策优先级：暂停 > 专业复核 > 补充资料 > 继续</div></div></div>' +
      '<div class="small" style="display:flex;flex-direction:column;gap:8px">' +
      '<div><span class="tag red">R01–R02</span> 红旗症状或疼痛 ≥7 → 暂停</div><div><span class="tag blue">R03–R05</span> 疼痛 4–6、新发症状、意图冲突 → 专业复核</div><div><span class="tag amber">R04/R06</span> 睡眠/疲劳不足、关键信息缺失 → 补充资料</div><div><span class="tag green">R09</span> 无异常 → 继续训练</div></div>' +
      '<div class="hint" style="margin-top:12px">依据：运动前健康筛查（PAR-Q+ / ACSM）红旗症状清单、场馆疼痛分级与转介流程、睡眠与疲劳管理指引。</div></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>最近核对</h3><div class="sub">同一会员身份关联</div></div></div>' + recentHtml + '</div></div></div>';
  }

  /* ---------------- plan ---------------- */
  function renderPlan() {
    const m = member();
    const plan = M.activePlan();
    const ck = M.latestCheckin();
    const risk = ck ? ck.risk : null;
    const versions = M.plansFor().slice().sort((a, b) => b.version - a.version);
    const history = versions.map((p) =>
      '<div class="t-item ' + (p.status === 'active' ? 'done' : '') + '"><div class="t-dot">v' + p.version + '</div><div><div class="t-title">' + esc(p.change_reason || '计划版本') + ' ' + (p.status === 'active' ? tag('生效', 'green') : tag('已被替代', '')) + '</div>' +
      '<div class="t-meta">' + esc(fmt(p.created_at)) + ' · 依据风险：' + esc(p.basis?.risk_decision || '—') + ' · ' + esc((p.training || []).length) + ' 次/周</div>' +
      (p.diff && p.diff.length ? '<div class="t-body"><div class="diff">' + p.diff.map((d) => '<div class="diff-box"><div class="h">调整前</div>' + esc(d.before) + '</div><div class="diff-box after"><div class="h">调整后</div>' + esc(d.after) + '<div class="tiny muted" style="margin-top:4px">' + esc(d.reason) + '</div></div>').join('') + '</div></div>' : '') +
      '</div></div>').join('');

    if (!plan) {
      return pageHead('TASK 03 · PERSONALIZED PLAN', '个性化计划',
        '根据会员目标、可用时间与近期记录，生成相互协调的训练、饮食与睡眠建议，并说明主要依据与适用限制。',
        '<button class="btn primary" data-action="plan-generate">生成计划</button>') +
        empty('计', '还没有生效计划', ck ? '已有到店核对记录，可以生成计划。' : '建议先完成「02 到店核对」，让计划与本次状态一致。', '<button class="btn primary" data-action="plan-generate">生成计划</button><button class="btn" data-action="goto" data-view="checkin" style="margin-left:8px">先去核对</button>') +
        '<div class="callout info" style="margin-top:16px">计划会复用会员档案中的目标、可用时间、训练经验、饮食睡眠偏好与专业限制；同一会员的所有计划共享 member_id。</div>';
    }

    const nutrition = plan.nutrition || {};
    const sleep = plan.sleep || {};
    return pageHead('TASK 03 · PERSONALIZED PLAN', '个性化计划 v' + plan.version,
      '训练、饮食与睡眠三位一体；每条建议都带依据与适用限制，可按反馈持续调整。',
      '<button class="btn" data-action="plan-generate">重新生成</button><button class="btn" data-action="goto" data-view="feedback">记录离店反馈</button>') +
      '<div class="grid grid-main">' +
      '<div><div class="card"><div class="card-head"><div><h3>训练安排</h3><div class="sub">' + esc((plan.basis?.goal || []).join(' · ')) + ' · 复核日期 ' + esc(plan.review_date) + '</div></div><div class="right">' + planStatusBadge(plan, risk) + '</div></div>' +
      plan.training.map(planSession).join('') +
      '<div class="callout info" style="margin-top:12px"><strong>主要依据：</strong>目标 ' + esc((plan.basis?.goal || []).join('、')) + '；可用时间 ' + esc((plan.basis?.available_time || []).map((s) => s.day + ' ' + s.start).join('、')) + '；训练经验 ' + esc(plan.basis?.training_experience || '—') + '；最近核对 ' + esc(plan.basis?.risk_decision || '未核对') + '。</div>' +
      '<div class="callout warn" style="margin-top:10px"><strong>适用限制：</strong>' + esc(plan.limitations.join('；')) + '</div></div>' +
      '<div class="grid grid-2" style="margin-top:16px"><div class="card"><div class="card-head"><div><h3>饮食建议</h3><div class="sub">' + esc(nutrition.pattern || '') + '</div></div></div>' +
      '<ul class="small" style="padding-left:17px;margin:0;color:#4f5a53">' + (nutrition.principles || []).map((p) => '<li style="margin:3px 0">' + esc(p) + '</li>').join('') + '</ul>' +
      '<div class="divider"></div><table class="table"><tbody>' + (nutrition.meals || []).map((x) => '<tr><th style="width:52px">' + esc(x.meal) + '</th><td>' + esc(x.example) + '</td></tr>').join('') + '</tbody></table>' +
      '<div class="hint" style="margin-top:8px">' + esc(nutrition.hydration || '') + (nutrition.avoid?.length ? ' 避免：' + esc(nutrition.avoid.join('、')) : '') + '</div>' +
      '<div class="tiny muted" style="margin-top:6px">' + esc(nutrition.note || '') + '</div></div>' +
      '<div class="card"><div class="card-head"><div><h3>睡眠建议</h3><div class="sub">目标 ' + esc(sleep.target_hours) + ' 小时</div></div></div>' +
      '<ul class="small" style="padding-left:17px;margin:0;color:#4f5a53">' + (sleep.principles || []).map((p) => '<li style="margin:3px 0">' + esc(p) + '</li>').join('') + '</ul>' +
      '<div class="divider"></div><h4>睡前流程</h4><div class="chip-row">' + (sleep.routine || []).map((r) => '<span class="chip">' + esc(r) + '</span>').join('') + '</div>' +
      '<div class="hint" style="margin-top:10px">咖啡因截止：' + esc(sleep.caffeine_cutoff || '') + '</div><div class="tiny muted" style="margin-top:6px">' + esc(sleep.note || '') + '</div></div></div></div>' +

      '<div><div class="card"><div class="card-head"><div><h3>计划联动</h3><div class="sub">统一档案复用的证据</div></div></div>' +
      '<div class="small" style="display:flex;flex-direction:column;gap:9px">' +
      '<div>' + tag('会员', 'green') + ' member_id=' + esc(plan.basis?.member_id || m.id) + ' · 档案 v' + esc(m.version) + '</div>' +
      '<div>' + tag('核对', 'green') + ' ' + esc(plan.basis?.latest_checkin || '未关联') + ' · ' + esc(plan.basis?.risk_decision || '') + '</div>' +
      '<div>' + tag('限制', 'amber') + ' ' + esc((plan.basis?.restrictions || []).join('；') || '无') + '</div>' +
      '<div>' + tag('反馈', 'blue') + ' ' + esc(plan.basis?.last_feedback_id || '尚未关联反馈') + '</div>' +
      '<div>' + tag('预约', 'blue') + ' ' + (M.bookingsFor().length ? M.bookingsFor().length + ' 条预约引用计划 v' + plan.version : '尚未预约') + '</div>' +
      '<div>' + tag('游戏', 'blue') + ' 状态与风险/计划一致</div></div>' +
      '<div class="divider"></div><h4>当前状态</h4><div class="small">' + (plan.adjustment_type ? '最近调整：' + esc(changeLabel(plan.adjustment_type)) : '首次生成') + '</div>' +
      '<div class="hint" style="margin-top:6px">' + esc(plan.change_reason || '') + '</div></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>版本历史与调整原因</h3><div class="sub">调整前后内容均可查询</div></div></div><div class="timeline">' + (history || '<div class="muted small">暂无</div>') + '</div></div></div></div>';
  }

  /* ---------------- feedback ---------------- */
  function renderFeedback() {
    const m = member();
    const plan = M.activePlan();
    const lastResult = ui.lastFeedback;
    const fbs = M.feedbacksFor().slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const latestFb = fbs[0];
    const resultView = lastResult || (latestFb && latestFb.summary ? {
      feedback: latestFb, plan: plan, summary: latestFb.summary,
      changeType: latestFb.change_type, reasons: [plan ? plan.change_reason : '']
    } : null);
    const history = fbs.length ? fbs.slice(0, 8).map((f) => '<div class="plan-session"><div class="top"><span class="day">' + esc(fmt(f.at).slice(5, 10)) + '</span><div><div class="title">完成 ' + esc(f.completed_sessions) + ' 次 · RPE ' + esc(f.rpe ?? '—') + ' · 疲劳 ' + esc(f.fatigue ?? '—') + '/10</div><div class="meta">睡眠 ' + esc(f.sleep_hours ?? '—') + 'h · 疼痛 ' + esc(f.pain ?? 0) + '/10 · ' + esc(changeLabel(f.change_type)) + '</div>' +
      (f.summary ? '<div class="hint" style="margin-top:4px">完成率 ' + (f.summary.adherence == null ? '—' : Math.round(f.summary.adherence * 100) + '%') + ' · 计划 ' + esc(f.plan_after_id || '') + '</div>' : '') +
      '<div class="tiny muted" style="margin-top:4px">' + esc(f.notes || '') + '</div></div><div style="margin-left:auto">' + tag(f.change_type === 'safety_stop' ? '暂停' : f.change_type === 'progress' ? '进阶' : f.change_type === 'deload' ? '减量' : '维持', f.change_type === 'safety_stop' ? 'red' : f.change_type === 'progress' ? 'green' : 'amber') + '</div></div></div>').join('') : '<div class="muted small">暂无反馈。</div>';

    if (!plan) {
      return pageHead('TASK 04 · POST-SESSION FEEDBACK', '离店反馈与调整', '会员离店后记录运动、饮食、睡眠与疲劳感受，智能体生成变化摘要并更新后续计划。', '') +
        empty('馈', '还没有可调整的计划', '先生成计划，或完成一次到店核对。', '<button class="btn primary" data-action="goto" data-view="plan">去生成计划</button>');
    }

    const resultHtml = resultView ? '<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>本次调整结果</h3><div class="sub">' + esc(fmt(resultView.feedback.at)) + '</div></div><div class="right">' + badge(resultView.changeType === 'safety_stop' ? '安全暂停' : resultView.changeType === 'progress' ? '小幅进阶' : resultView.changeType === 'deload' ? '训练减量' : '维持', resultView.changeType === 'safety_stop' ? 'danger' : resultView.changeType === 'progress' ? 'ok' : 'warn') + '</div></div>' +
      '<div class="grid grid-4" style="gap:10px">' +
      '<div class="metric"><div class="m-label">完成率</div><div class="m-value">' + (resultView.summary.adherence == null ? '—' : Math.round(resultView.summary.adherence * 100) + '<small>%</small>') + '</div><div class="m-foot">' + resultView.summary.completed_sessions + '/' + resultView.summary.planned_sessions + ' 次</div></div>' +
      '<div class="metric"><div class="m-label">疲劳</div><div class="m-value">' + esc(resultView.summary.fatigue ?? '—') + '<small>/10</small></div></div>' +
      '<div class="metric"><div class="m-label">睡眠</div><div class="m-value">' + esc(resultView.summary.sleep_hours ?? '—') + '<small>h</small></div></div>' +
      '<div class="metric"><div class="m-label">疼痛</div><div class="m-value">' + esc(resultView.summary.pain ?? 0) + '<small>/10</small></div></div></div>' +
      '<div class="divider"></div><div class="diff">' + ((resultView.plan && resultView.plan.diff) || []).map((d) => '<div class="diff-box"><div class="h">调整前</div>' + esc(d.before) + '</div><div class="diff-box after"><div class="h">调整后（v' + esc(resultView.plan.version) + '）</div>' + esc(d.after) + '<div class="tiny muted" style="margin-top:4px">' + esc(d.reason) + '</div></div>').join('') + '</div>' +
      '<div class="callout info" style="margin-top:12px"><strong>调整依据：</strong>' + esc(resultView.reasons.join('；')) + '</div></div>' : '';

    return pageHead('TASK 04 · POST-SESSION FEEDBACK', '离店反馈与调整',
      '记录运动、饮食、睡眠与疲劳感受；系统生成变化摘要，并给出计划调整前后与原因。',
      '<button class="btn" data-action="goto" data-view="plan">查看当前计划 v' + plan.version + '</button>') +
      resultHtml +
      '<div class="grid grid-main"><div class="card"><div class="card-head"><div><h3>本次离店反馈</h3><div class="sub">计划 v' + plan.version + ' · ' + plan.training.length + ' 次/周</div></div><div class="right">' + tag('合成数据', '') + '</div></div>' +
      '<form data-form="feedback"><div class="field-row four">' +
      '<div class="field"><label>完成次数</label><input class="input" type="number" name="completed_sessions" min="0" max="6" value="' + plan.training.length + '"></div>' +
      '<div class="field"><label>整体 RPE（1–10）</label><input class="input" type="number" name="rpe" min="1" max="10" value="5"></div>' +
      '<div class="field"><label>当前疲劳（1–10）</label><input class="input" type="number" name="fatigue" min="1" max="10" value="5" required></div>' +
      '<div class="field"><label>昨晚睡眠（小时）</label><input class="input" type="number" step="0.1" name="sleep_hours" min="0" max="16" value="7" required></div></div>' +
      '<div class="field-row three" style="margin-top:10px"><div class="field"><label>疼痛（0–10）</label><input class="input" type="number" name="pain" min="0" max="10" value="1"></div>' +
      '<div class="field"><label>疼痛位置</label><input class="input" name="pain_location" placeholder="无则留空"></div>' +
      '<div class="field"><label>红旗症状</label><div class="checkline" style="height:42px"><input type="checkbox" name="red_flag" value="是"> 出现胸痛/眩晕等</div></div></div>' +
      '<div class="field-row"><div class="field"><label>饮食执行情况</label><textarea class="textarea" name="diet_notes" placeholder="如：外食偏咸，蛋白质不足"></textarea></div>' +
      '<div class="field"><label>睡眠执行情况</label><textarea class="textarea" name="sleep_notes" placeholder="如：入睡偏晚，夜间醒一次"></textarea></div></div>' +
      '<div class="field" style="margin-top:10px"><label>其他感受</label><textarea class="textarea" name="notes" placeholder="训练后的身体感受、疼痛变化等"></textarea></div>' +
      '<div class="btn-row" style="margin-top:14px"><button class="btn primary lg" type="submit">提交反馈并调整计划</button><span class="hint">疼痛 ≥4 或红旗症状会触发暂停与专业复核。</span></div></form></div>' +
      '<div class="card"><div class="card-head"><div><h3>反馈历史</h3><div class="sub">每次调整都保留原因</div></div></div>' + history + '</div></div>';
  }

  /* ---------------- movement ---------------- */
  function renderMovement() {
    const list = M.assessmentsFor().slice().sort((a, b) => String(b.analyzed_at).localeCompare(String(a.analyzed_at)));
    const result = ui.movementResult || list[0] || null;
    const checks = result ? '<table class="table"><thead><tr><th>检查项</th><th>结果</th><th>状态</th><th>改进提示</th></tr></thead><tbody>' + result.checks.map((c) =>
      '<tr><td>' + esc(c.name) + '</td><td class="mono">' + esc(c.value) + '</td><td><span class="status-' + c.status + '">' + (c.status === 'pass' ? '通过' : c.status === 'warn' ? '关注' : '需改进') + '</span></td><td class="muted">' + esc(c.cue) + '</td></tr>'
    ).join('') + '</tbody></table>' : '';
    const history = list.length ? list.slice(0, 6).map((a) => '<div class="plan-session"><div class="top"><span class="day">' + esc(a.metrics.score) + '</span><div><div class="title">' + esc(a.exercise) + '</div><div class="meta">' + esc(fmt(a.analyzed_at)) + ' · ' + esc(a.reps) + ' 次 · 对称 ' + esc(a.metrics.symmetry_index ?? '—') + '</div></div><div style="margin-left:auto">' + tag('评分 ' + a.metrics.score, a.metrics.score >= 85 ? 'green' : 'amber') + '</div></div></div>').join('') : '<div class="muted small">暂无评估记录。</div>';

    return pageHead('TASK 05 · MOVEMENT ASSESSMENT', '动作评估',
      '围绕普拉提核心床动作，分析关节角度时间序列，输出可核查的 ROM、节奏、左右对称与躯干稳定指标及改进反馈。',
      '<button class="btn" data-action="goto" data-view="plan">查看训练计划</button>') +
      '<div class="grid grid-main"><div>' +
      '<div class="card"><div class="card-head"><div><h3>上传运动资料</h3><div class="sub">支持 CSV：t, knee_angle, hip_angle, trunk_angle, knee_angle_left, knee_angle_right</div></div></div>' +
      '<div class="field-row three"><div class="field"><label>动作</label><select class="select" id="exercise-select"><option>普拉提核心床·足部序列</option><option>普拉提·侧卧系列</option><option>普拉提·百次拍击</option></select></div>' +
      '<div class="field"><label>运动资料</label><input class="input" type="file" id="csv-file" accept=".csv,text/csv"><div class="hint" id="csv-file-label">未选择文件（可使用内置示例）</div></div>' +
      '<div class="field"><label>&nbsp;</label><div class="btn-row"><button class="btn" data-action="movement-sample">载入示例</button><button class="btn primary" data-action="movement-analyze">开始分析</button></div></div></div>' +
      '<div class="callout info" style="margin-top:12px">资料形式：场馆动作捕捉/核心床传感器导出的关节角度时间序列（10Hz 示例）。分析方法：平滑 → 阈值识别动作周期 → 逐次计算幅度、节奏、对称与躯干偏离。全流程可复核。</div></div>' +
      (result ? '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>' + esc(result.exercise) + '</h3><div class="sub">' + esc(result.method) + '</div></div><div class="right"><button class="btn sm ghost" data-action="goto" data-view="game">同步到趣味训练</button></div></div>' +
      '<div class="grid grid-4" style="gap:10px;margin-bottom:14px">' +
      '<div class="metric" style="border-color:var(--copper-soft);background:#fdf8f1"><div class="m-label">动作质量评分</div><div class="m-value" style="color:var(--copper);font-size:32px">' + esc(result.metrics.score) + '<small>/100</small></div><div class="m-foot">' + esc(result.reps) + ' 次完整动作</div></div>' +
      '<div class="metric"><div class="m-label">平均 ROM</div><div class="m-value">' + esc(result.metrics.rom_mean_deg) + '<small>°</small></div><div class="m-foot">变异 ' + (result.metrics.rom_cv * 100).toFixed(1) + '%</div></div>' +
      '<div class="metric"><div class="m-label">节奏</div><div class="m-value">' + esc(result.metrics.tempo_mean_s) + '<small>s/次</small></div><div class="m-foot">变异 ' + (result.metrics.tempo_cv * 100).toFixed(1) + '%</div></div>' +
      '<div class="metric"><div class="m-label">左右对称</div><div class="m-value">' + esc(result.metrics.symmetry_index ?? '—') + '</div><div class="m-foot">躯干偏离 ' + esc(result.metrics.trunk_rms_deg ?? '—') + '°</div></div></div>' +
      '<canvas id="movement-chart" height="190" style="width:100%;height:190px;border:1px solid var(--line);border-radius:12px;background:#fff"></canvas>' +
      '<div class="hint" style="margin:6px 0 14px">曲线为膝角度时间序列；浅色区间为识别出的动作周期。数据点：' + esc(result.rep_details?.length || 0) + ' 次。</div>' +
      checks +
      '<div class="callout" style="margin-top:12px">' + esc(result.summary) + '<div class="tiny muted" style="margin-top:4px">' + esc(result.disclaimer) + '</div></div>' +
      '<div class="divider"></div><h4>逐次结果</h4><div style="overflow:auto;max-height:220px"><table class="table"><thead><tr><th>次数</th><th>ROM（°）</th><th>用时（s）</th></tr></thead><tbody>' + (result.rep_details || []).map((r) => '<tr><td>' + r.rep + '</td><td class="mono">' + r.rom_deg + '</td><td class="mono">' + r.duration_s + '</td></tr>').join('') + '</tbody></table></div></div>' : empty('评', '还没有动作评估', '上传一段关节角度 CSV，或载入内置示例，即可看到可核查指标与改进反馈。', '<button class="btn primary" data-action="movement-sample">载入示例</button>')) +
      '</div><div><div class="card"><div class="card-head"><div><h3>评估历史</h3><div class="sub">同一会员身份关联</div></div></div>' + history + '</div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>指标说明</h3></div></div><div class="small" style="display:flex;flex-direction:column;gap:7px">' +
      '<div><strong>ROM</strong>：每次动作的膝角度变化幅度，反映控制范围。</div><div><strong>节奏变异</strong>：动作周期时长的离散程度，越低越稳定。</div><div><strong>左右对称</strong>：左右侧 ROM 的比值，低于 0.92 提示关注。</div><div><strong>躯干稳定</strong>：躯干角度偏离均方根，反映代偿程度。</div></div>' +
      '<div class="callout warn" style="margin-top:12px">动作评估用于训练反馈，不构成医学诊断；如出现疼痛或功能障碍，转介专业人员。</div></div></div></div>';
  }

  function drawMovementChart() {
    const canvas = document.getElementById('movement-chart');
    if (!canvas) return;
    const list = M.assessmentsFor().slice().sort((a, b) => String(b.analyzed_at).localeCompare(String(a.analyzed_at)));
    const result = ui.movementResult || list[0];
    if (!result || !result._series) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = 190;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const s = result._series;
    const t = s.t, knee = s.knee;
    const pad = { l: 40, r: 14, t: 14, b: 26 };
    const w = cssW - pad.l - pad.r, h = cssH - pad.t - pad.b;
    const minT = Math.min(...t), maxT = Math.max(...t);
    const minY = Math.min(...knee), maxY = Math.max(...knee);
    const x = (v) => pad.l + (v - minT) / (maxT - minT || 1) * w;
    const y = (v) => pad.t + (1 - (v - minY) / (maxY - minY || 1)) * h;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.strokeStyle = '#eee8dc'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + h * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(cssW - pad.r, yy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(181,118,76,0.12)';
    // 用与 core 相同的阈值逻辑近似标出动作区间
    const vals = knee;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const high = lo + (hi - lo) * 0.7, low = lo + (hi - lo) * 0.3;
    let state = 'high', highIdx = null, trough = null;
    const reps = [];
    vals.forEach((v, idx) => {
      if (state === 'high') {
        if (v >= high) highIdx = idx;
        else if (v < low && highIdx != null) { state = 'low'; trough = idx; }
      } else {
        if (v < vals[trough]) trough = idx;
        if (v > high) { reps.push({ start: highIdx, end: idx }); state = 'high'; highIdx = idx; }
      }
    });
    reps.forEach((r, i) => {
      ctx.fillStyle = i % 2 ? 'rgba(181,118,76,0.04)' : 'rgba(44,78,68,0.035)';
      const x1 = x(t[r.start]), x2 = x(t[r.end]);
      ctx.fillRect(x1, pad.t, x2 - x1, h);
    });
    ctx.strokeStyle = '#2c4e44'; ctx.lineWidth = 2; ctx.beginPath();
    knee.forEach((v, i) => { const px = x(t[i]), py = y(v); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.stroke();
    ctx.fillStyle = '#7d877f'; ctx.font = '10px "Microsoft YaHei"';
    ctx.fillText(maxY.toFixed(0) + '°', 6, pad.t + 4);
    ctx.fillText(minY.toFixed(0) + '°', 6, pad.t + h + 3);
    ctx.fillText('0s', pad.l, cssH - 8);
    ctx.fillText(maxT.toFixed(0) + 's', cssW - pad.r - 20, cssH - 8);
    ctx.fillStyle = '#b5764c';
    ctx.fillText('膝角度', pad.l + 8, pad.t + 12);
  }

  /* ---------------- game ---------------- */
  function renderGame() {
    const m = member();
    const game = M.syncGame(m.id) || M.db.game[m.id];
    M.save();
    const plan = M.activePlan();
    const stops = M.TRAIL_STAGES.map((name, i) => {
      const cls = i < game.stage_index ? 'reached' : (i === game.stage_index ? 'reached current' : '');
      return '<div class="trail-stop ' + cls + '"><div class="bar"></div><div class="dot">' + (i + 1) + '</div><div class="label">' + esc(name) + '</div></div>';
    }).join('');
    return pageHead('TASK 06 · PLAYFUL TRAINING', '趣味训练',
      '把现实训练表现映射为虚拟山径进度、得分与反馈状态；游戏始终服从会员当前计划与风险状态。',
      '<button class="btn" data-action="game-sync">同步状态</button><button class="btn" data-action="goto" data-view="plan">查看计划</button>') +
      '<div class="grid grid-main"><div><div class="trail-wrap"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div><div class="tiny" style="letter-spacing:.2em;color:#d9a47c">VIRTUAL TRAIL</div><div style="font-family:\'Songti SC\',serif;font-size:26px;margin-top:2px">' + esc(game.trail) + '</div></div><div style="margin-left:auto">' + badge(game.status_label, game.status === 'paused' ? 'danger' : 'ok') + '</div></div>' +
      '<div class="trail-scroll"><div class="trail">' + stops + '</div></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:rgba(246,240,228,.7)"><span>阶段 ' + (game.stage_index + 1) + '/' + M.TRAIL_STAGES.length + ' · ' + esc(game.stage_name) + '</span><span>下一阶段还差 ' + Math.round(250 - (game.xp % 250)) + ' XP</span></div>' +
      '<div class="progress" style="margin-top:8px"><i style="width:' + game.progress_pct + '%"></i></div>' +
      '<div class="grid grid-3" style="margin-top:16px;gap:10px"><div><div class="tiny" style="color:rgba(246,240,228,.5)">XP</div><div style="font-family:Georgia,serif;font-size:26px">' + esc(game.xp) + '</div></div><div><div class="tiny" style="color:rgba(246,240,228,.5)">等级</div><div style="font-size:16px;margin-top:3px">' + esc(game.level) + '</div></div><div><div class="tiny" style="color:rgba(246,240,228,.5)">当前任务</div><div style="font-size:12px;margin-top:3px">' + esc(game.task) + '</div></div></div>' +
      '<div class="chip-row" style="margin-top:14px">' + (game.badges.length ? game.badges.map((b) => '<span class="badge" style="background:rgba(217,164,124,.18);border-color:rgba(217,164,124,.4);color:#f0c9a9">' + esc(b) + '</span>').join('') : '<span class="tiny" style="color:rgba(246,240,228,.5)">完成一次闭环后获得徽章</span>') + '</div></div>' +
      (game.status === 'paused' ? '<div class="callout danger" style="margin-top:16px"><strong>守护模式：</strong>' + esc(game.pause_reason || '当前风险状态要求暂停训练。') + '<div style="margin-top:4px">游戏进度冻结，任务切换为呼吸练习与症状记录；专业复核通过后自动恢复。</div></div>' : '<div class="callout info" style="margin-top:16px">当前风险与计划均允许训练，游戏按计划完成度、动作评分与连续反馈计算 XP。</div>') +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>映射规则</h3><div class="sub">现实表现 → 虚拟反馈</div></div></div>' +
      '<table class="table"><thead><tr><th>现实记录</th><th>虚拟反馈</th><th>约束</th></tr></thead><tbody>' +
      '<tr><td>完成一次到店核对</td><td>+40 XP</td><td>必须同会员身份</td></tr><tr><td>完成计划训练（每次）</td><td>+60 XP</td><td>最多计 2 次/反馈</td></tr><tr><td>动作评估评分</td><td>+评分 × 0.5 XP</td><td>评估记录可追溯</td></tr><tr><td>提交离店反馈</td><td>+20 XP</td><td>需关联生效计划</td></tr><tr><td>风险为专业复核/暂停</td><td>进度冻结 + 守护任务</td><td>专业限制优先</td></tr></tbody></table></div></div>' +
      '<div><div class="card"><div class="card-head"><div><h3>与计划一致</h3><div class="sub">不是独立的小游戏</div></div></div><div class="small" style="display:flex;flex-direction:column;gap:8px">' +
      '<div>' + tag('计划', 'green') + ' ' + (plan ? 'v' + plan.version + ' · ' + plan.training.length + ' 次/周' : '暂无计划') + '</div>' +
      '<div>' + tag('风险', game.status === 'paused' ? 'red' : 'green') + ' ' + esc(M.latestRisk()?.label || '未核对') + '</div>' +
      '<div>' + tag('训练', 'blue') + ' ' + (plan ? plan.training.map((s) => s.title).join('；') : '—') + '</div></div>' +
      '<div class="callout warn" style="margin-top:12px">当风险决策为「提交专业复核」或「暂停活动」，或计划已转为暂停训练时，游戏自动进入守护模式，不发放训练 XP。</div></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>当前计划任务</h3></div></div>' + (plan ? plan.training.map((s) => '<div class="checkline" style="margin:6px 0"><input type="checkbox" disabled> ' + esc(s.day + ' ' + s.time + ' · ' + s.title) + '</div>').join('') : '<div class="muted small">暂无</div>') +
      '<div class="hint" style="margin-top:8px">完成训练后请在「04 离店反馈」记录，系统会自动更新游戏进度。</div></div></div></div>';
  }

  /* ---------------- rehab ---------------- */
  function renderRehab() {
    const m = member();
    const r = M.rehabOf(m.id);
    const profileOpinions = (m.voluntary?.medical_advice || []).map((a, i) => ({
      id: 'PA-' + i, source: a.source, role: '专业人员（档案）', date: a.date,
      text: a.text, restrictions: a.restrictions || [], next_review: ''
    }));
    const seenOpinions = new Set();
    const opinions = r.opinions.concat(profileOpinions).filter((o) => {
      const k = o.source + '|' + o.date + '|' + o.text;
      if (seenOpinions.has(k)) return false;
      seenOpinions.add(k);
      return true;
    }).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const followups = r.followups.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const restrictions = m.voluntary?.activity_restrictions || [];
    const guard = ui.guardResult;
    const opinionTimeline = opinions.length ? opinions.map((o) => '<div class="t-item done"><div class="t-dot">意</div><div><div class="t-title">' + esc(o.source) + ' · ' + esc(o.role) + '</div><div class="t-meta">' + esc(o.date) + (o.next_review ? ' · 下次复核 ' + esc(o.next_review) : '') + '</div><div class="t-body">' + esc(o.text) + (o.restrictions?.length ? '<div class="tiny muted" style="margin-top:4px">限制：' + esc(o.restrictions.join('；')) + '</div>' : '') + '</div></div></div>').join('') : '<div class="muted small">暂无专业意见。</div>';
    const followTimeline = followups.length ? followups.map((f) => '<div class="t-item ' + (f.status === '稳定' ? 'done' : 'warn') + '"><div class="t-dot">访</div><div><div class="t-title">随访 · ' + esc(f.status) + '</div><div class="t-meta">' + esc(f.date) + (f.next_date ? ' · 下次 ' + esc(f.next_date) : '') + '</div><div class="t-body">' + esc(f.notes) + '</div></div></div>').join('') : '<div class="muted small">暂无随访记录。</div>';
    const guardResultHtml = guard ? '<div class="risk-card ' + (guard.decision === 'pass' ? 'continue' : guard.decision === 'refuse' ? 'suspend' : 'professional_review') + '" style="margin-top:12px">' +
      '<div class="risk-top"><div class="risk-title">' + (guard.decision === 'pass' ? '未发现冲突' : guard.decision === 'refuse' ? '超出服务边界' : '需专业复核') + '</div>' + badge(guard.decision === 'pass' ? '通过' : guard.decision === 'refuse' ? '拒绝越界' : '专业复核', guard.decision === 'pass' ? 'ok' : guard.decision === 'refuse' ? 'danger' : 'info') + '</div>' +
      '<div class="small" style="margin-top:8px">' + esc(guard.reason) + '</div>' +
      (guard.conflicts?.length ? '<ul class="rule-list">' + guard.conflicts.map((c) => '<li><span class="rule-code">限制</span><div>' + esc(c.restriction) + '<span class="rule-src">命中关键词：' + esc(c.matched.join('、')) + '</span></div></li>').join('') + '</ul>' : '') +
      (guard.suggested_alternative ? '<div class="callout info" style="margin-top:10px"><strong>建议替代：</strong>' + esc(guard.suggested_alternative) + '</div>' : '') +
      '<div class="hint" style="margin-top:8px">专业限制优先于一切计划、互动与预约安排。</div></div>' : '';

    return pageHead('TASK 07 · REHAB & CHRONIC SUPPORT', '康复训练与慢病支持',
      '依据适用专业意见提供训练辅助与生活建议，形成随访记录；专业限制优先于一切计划与互动安排。',
      '<button class="btn" data-action="opinion-toggle">录入专业意见</button><button class="btn" data-action="goto" data-view="profile">查看档案限制</button>') +
      (ui.opinionForm ? '<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>录入专业意见</h3><div class="sub">来源、日期、限制条件会同步到会员档案</div></div></div><form data-form="opinion"><div class="field-row three">' +
        '<div class="field"><label>来源</label><input class="input" name="source" placeholder="如：康复治疗师 李医生" required></div>' +
        '<div class="field"><label>角色</label><input class="input" name="role" value="康复治疗师"></div>' +
        '<div class="field"><label>日期</label><input class="input" name="date" type="date" value="' + dateStr() + '"></div></div>' +
        '<div class="field" style="margin-top:10px"><label>专业意见</label><textarea class="textarea" name="text" placeholder="训练适用条件、禁忌与复诊建议" required></textarea></div>' +
        '<div class="field-row"><div class="field"><label>活动限制（逗号分隔）</label><input class="input" name="restrictions" placeholder="避免脊柱屈曲负重, 避免仰卧起坐"></div>' +
        '<div class="field"><label>下次复核</label><input class="input" name="next_review" type="date"></div></div>' +
        '<div class="btn-row" style="margin-top:12px"><button class="btn primary" type="submit">保存专业意见</button><button class="btn" type="button" data-action="opinion-toggle">取消</button></div></form></div>' : '') +
      '<div class="grid grid-main"><div>' +
      '<div class="card"><div class="card-head"><div><h3>专业意见</h3><div class="sub">只采信有来源、有日期的意见</div></div><div class="right">' + tag(opinions.length + ' 条', 'green') + '</div></div><div class="timeline">' + opinionTimeline + '</div></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>随访记录</h3><div class="sub">康复与慢病管理留痕</div></div></div><div class="timeline">' + followTimeline + '</div>' +
      '<form data-form="followup" style="margin-top:14px"><div class="field-row three"><div class="field"><label>状态</label><select class="select" name="status"><option>稳定</option><option>进行中</option><option>需复诊</option><option>已转介</option></select></div>' +
      '<div class="field"><label>下次随访</label><input class="input" type="date" name="next_date"></div>' +
      '<div class="field"><label>备注</label><input class="input" name="notes" placeholder="症状、训练反应、依从性"></div></div><button class="btn sm" type="submit" style="margin-top:10px">记录本次随访</button></form></div></div>' +
      '<div><div class="card"><div class="card-head"><div><h3>当前活动限制</h3><div class="sub">来自专业意见与会员档案</div></div></div>' +
      (restrictions.length ? '<div class="chip-row">' + restrictions.map((x) => '<span class="chip" style="background:var(--danger-soft);border-color:#e6c2bc;color:var(--danger)">' + esc(x) + '</span>').join('') + '</div>' : '<div class="muted small">暂无活动限制。</div>') +
      '<div class="hint" style="margin-top:10px">限制会进入风险核对（R05）、计划生成与预约器械准备；任何冲突都需要专业复核。</div></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>专业限制校验</h3><div class="sub">检查拟议内容是否越界</div></div></div>' +
      '<form data-form="guard"><div class="field"><label>拟议训练/互动内容</label><textarea class="textarea" name="proposed" placeholder="例如：安排仰卧起坐与负重深蹲，作为核心训练">' + esc('安排仰卧起坐与负重深蹲，作为核心训练') + '</textarea></div>' +
      '<div class="field" style="margin-top:8px"><label>意图类型</label><select class="select" name="intent"><option value="training">训练安排</option><option value="diagnosis">医疗诊断</option><option value="treatment">治疗决策</option><option value="medication_change">药物调整</option></select></div>' +
      '<button class="btn primary" type="submit" style="margin-top:10px">执行校验</button></form>' + guardResultHtml + '</div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>慢病自我管理边界</h3></div></div><div class="small" style="display:flex;flex-direction:column;gap:7px">' +
      '<div>' + tag('可以做', 'green') + ' 监测记录、生活方式建议、训练依从性支持、红旗症状转介</div><div>' + tag('不可以做', 'red') + ' 诊断、处方、调整药物或替代医生决策</div>' +
      '<div class="hint">涉及康复与慢病内容须遵循专业意见；医疗诊断与治疗决策由具备相应资质的专业人员做出。</div></div></div></div></div>';
  }

  /* ---------------- booking ---------------- */
  function renderBooking() {
    const m = member();
    const plan = M.activePlan();
    const list = M.bookingsFor();
    const cards = list.length ? list.map((b) => {
      const statusMap = { confirmed: ['已确认', 'green'], requested: ['待确认', 'amber'], rescheduled: ['已改约', 'blue'], cancelled: ['已取消', 'red'], completed: ['已完成', 'green'], waitlist: ['候补', 'amber'] };
      const st = statusMap[b.status] || [b.status, ''];
      const actions = ['confirmed', 'requested', 'rescheduled', 'waitlist'].includes(b.status) ?
        '<button class="btn sm" data-action="booking-reschedule" data-id="' + esc(b.id) + '">改约</button><button class="btn sm" data-action="booking-complete" data-id="' + esc(b.id) + '">签到完成</button><button class="btn sm ghost" data-action="booking-cancel" data-id="' + esc(b.id) + '">取消</button>' : '';
      return '<div class="plan-session" style="margin-bottom:12px"><div class="top"><span class="day">' + esc(dayName(b.date)) + '</span><div style="min-width:0"><div class="title">' + esc(b.date) + ' ' + esc(b.time) + ' · ' + esc(b.equipment) + '</div><div class="meta">' + esc(b.coach) + ' · 计划 v' + esc(b.plan_version) + ' · 创建 ' + esc(fmt(b.created_at)) + '</div></div><div style="margin-left:auto">' + tag(st[0], st[1]) + '</div></div>' +
        '<div class="hint" style="margin-top:8px">器械准备：' + esc(b.prep.join('、')) + '</div>' +
        '<div class="tiny muted" style="margin-top:4px">风险快照：' + esc(M.RISK_LABEL[b.risk_snapshot] || b.risk_snapshot) + '；状态历史：' + b.history.map((h) => esc((h.from ? bookingLabel(h.from) : '新建') + '→' + bookingLabel(h.to) + (h.note ? '（' + h.note + '）' : ''))).join(' · ') + '</div>' +
        '<div class="btn-row" style="margin-top:8px">' + actions + '</div></div>';
    }).join('') : '<div class="muted small">暂无预约。</div>';
    const sessionOptions = plan ? plan.training.map((s, i) => '<option value="' + i + '">' + esc(s.day + ' ' + s.time + ' · ' + s.title) + '</option>').join('') : '';

    return pageHead('TASK 08 · BOOKING & VENUE SERVICE', '预约与场馆服务协同',
      '训练计划与到店预约、改约、器械准备衔接；处理状态可查询、可回写，并与风险状态保持一致。',
      '<button class="btn" data-action="goto" data-view="plan">查看计划</button>') +
      (plan ? '' : '<div class="callout warn" style="margin-bottom:16px">当前没有生效计划，预约无法与训练计划衔接。请先在「03 个性化计划」生成计划。</div>') +
      '<div class="grid grid-main"><div class="card"><div class="card-head"><div><h3>创建预约</h3><div class="sub">从当前计划选择训练日</div></div></div>' +
      (plan ? '<form data-form="booking"><div class="field-row"><div class="field"><label>训练安排</label><select class="select" name="session_index">' + sessionOptions + '</select></div>' +
        '<div class="field"><label>日期</label><input class="input" type="date" name="date" value="' + dateStr(addDays(1)) + '"></div></div>' +
        '<div class="field-row three" style="margin-top:10px"><div class="field"><label>时间</label><input class="input" type="time" name="time" value="' + esc(plan.training[0]?.time || '19:00') + '"></div>' +
        '<div class="field"><label>教练</label><select class="select" name="coach">' + M.COACHES.map((c) => '<option>' + esc(c) + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>&nbsp;</label><button class="btn primary" type="submit" style="width:100%">创建并分配器械</button></div></div>' +
        '<div class="hint" style="margin-top:8px">系统会检查同一时段的器械占用，自动分配普拉提核心床并生成器械准备清单。</div></form>' : '<div class="muted small">请先生成计划。</div>') +
      '<div class="divider"></div><h4>器械与教练</h4><div class="chip-row">' + M.EQUIPMENT.map((e) => '<span class="chip">' + esc(e) + '</span>').join('') + '</div><div class="hint" style="margin-top:6px">教练：' + esc(M.COACHES.join('、')) + '；同一时段按先到先得分配。</div></div>' +
      '<div class="card"><div class="card-head"><div><h3>预约列表</h3><div class="sub">状态实时可查 · 完成可回写训练记录</div></div><div class="right">' + tag(list.length + ' 条', 'blue') + '</div></div>' + cards +
      '<div class="callout info" style="margin-top:10px">状态机：待确认 → 已确认 → 已完成；支持改约、取消与候补。完成签到会回写一条训练记录并同步趣味训练。</div></div></div>';
  }

  /* ---------------- records ---------------- */
  function renderRecords() {
    const m = member();
    const audits = M.db.audit.filter((a) => a.member_id === m.id).slice().reverse().slice(0, 60);
    const timeline = audits.length ? audits.map((a) => {
      const kind = a.text.includes('暂停') || a.text.includes('复核') ? 'danger' : a.text.includes('调整') || a.text.includes('评分') ? 'warn' : 'done';
      return '<div class="t-item ' + kind + '"><div class="t-dot">·</div><div><div class="t-title">' + esc(a.text) + '</div><div class="t-meta">' + esc(fmt(a.at)) + ' · ' + esc(a.module) + '</div></div></div>';
    }).join('') : '<div class="muted small">暂无记录。</div>';
    const members = M.memberList().map((x) => {
      const counts = [M.db.checkins, M.db.feedbacks, M.db.assessments, M.db.bookings].map((arr) => arr.filter((r) => r.member_id === x.id).length);
      return '<tr><td><strong>' + esc(x.display_name) + '</strong><div class="tiny muted mono">' + esc(x.id) + '</div></td><td>' + esc((x.goal || []).join('、')) + '</td><td class="num">v' + esc(x.version) + '</td><td class="num">' + counts[0] + '</td><td class="num">' + counts[1] + '</td><td class="num">' + counts[2] + '</td><td class="num">' + counts[3] + '</td></tr>';
    }).join('');

    return pageHead('EVIDENCE & COMPLIANCE', '记录、导出与说明',
      '统一会员身份、任务覆盖、审计日志与合规说明。此页可直接用于提交材料的运行证据截图。',
      '<button class="btn" data-action="export-json">导出当前会员数据</button><button class="btn" data-action="print">打印</button>') +
      '<div class="grid grid-main"><div>' +
      '<div class="card"><div class="card-head"><div><h3>八项任务证据</h3><div class="sub">按第二赛道要求逐项核验</div></div></div>' + taskMatrix(false) + '</div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>统一会员身份</h3><div class="sub">所有记录通过 member_id 关联，跨会员隔离</div></div></div>' +
      '<table class="table"><thead><tr><th>会员</th><th>目标</th><th>档案版本</th><th>核对</th><th>反馈</th><th>评估</th><th>预约</th></tr></thead><tbody>' + members + '</tbody></table></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>审计日志</h3><div class="sub">最近 60 条 · 时间、模块、动作</div></div><div class="right"><button class="btn sm ghost" data-action="export-json">导出 JSON</button></div></div><div class="timeline">' + timeline + '</div></div></div>' +
      '<div><div class="card"><div class="card-head"><div><h3>数据与合规</h3></div></div><div class="small" style="display:flex;flex-direction:column;gap:8px">' +
      '<div>' + tag('合成数据', 'green') + ' 演示会员与全部记录均为合成数据，不含真实个人健康信息。</div>' +
      '<div>' + tag('授权', 'green') + ' 真实上线时需取得会员授权，并完成脱敏、访问控制与留存期限管理。</div>' +
      '<div>' + tag('医疗边界', 'amber') + ' 健康建议不构成医疗建议；康复/慢病内容遵循专业意见。</div>' +
      '<div>' + tag('专业优先', 'amber') + ' 专业限制优先于计划、游戏与预约安排；诊断与治疗由具备资质的专业人员做出。</div></div></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>WorkBuddy 使用</h3><div class="sub">比赛要求：至少部分环节实际使用</div></div></div>' +
      '<div class="small" style="display:flex;flex-direction:column;gap:7px"><div>1. 在 WorkBuddy 专家中心打开「蓦初·衡」专家。</div><div>2. 用自然语言让专家完成到店核对、生成计划、记录反馈或创建预约。</div><div>3. 专家会通过 Skill CLI 读写同一套会员数据，并返回可核查结果。</div><div>4. 请保留专家对话与 Skill 调用画面，作为使用记录。</div></div>' +
      '<div class="callout info" style="margin-top:10px">本地面板是离线演示镜像；WorkBuddy 中的专家与 Skill 是同一套规则与数据模型的另一种入口。</div></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>演示数据管理</h3></div></div>' +
      '<div class="btn-row"><button class="btn" data-action="reset-seed">恢复示例闭环</button><button class="btn" data-action="reset-base">清空为本轮起点</button><button class="btn primary" data-action="demo">重新播放完整演示</button></div>' +
      '<div class="hint" style="margin-top:8px">「恢复示例闭环」保留一条历史核对、计划、反馈与评估；「清空为本轮起点」仅保留会员档案，便于从零开始连续演示。</div></div>' +
      '<div class="card" style="margin-top:16px"><div class="card-head"><div><h3>免责声明</h3></div></div><div class="tiny muted">本作品为 2026「AI 赋能·三旋翼驱动」旋创赛第二轮参赛作品。演示数据为合成数据；所有健康相关建议仅用于健康管理与训练支持，不构成医疗建议。康复与慢病相关内容遵循专业意见，医疗诊断与治疗决策由具备相应资质的专业人员做出。</div></div></div></div>';
  }

  /* ---------------- render ---------------- */
  const VIEWS = {
    overview: renderOverview, profile: renderProfile, checkin: renderCheckin, plan: renderPlan,
    feedback: renderFeedback, movement: renderMovement, game: renderGame, rehab: renderRehab,
    booking: renderBooking, records: renderRecords
  };

  function renderChrome() {
    const m = member();
    const sel = document.getElementById('member-select');
    sel.innerHTML = M.memberList().map((x) => '<option value="' + esc(x.id) + '">' + esc(x.display_name) + ' · ' + esc(x.id) + '</option>').join('');
    sel.value = m.id;
    document.getElementById('member-meta').innerHTML = [tag((m.goal || [])[0] || '未设目标'), tag('v' + m.version), tag(m.synthetic ? '合成数据' : '')].join('');
    const risk = M.latestRisk();
    const pill = document.getElementById('top-risk');
    pill.className = 'badge ' + riskClass(risk ? risk.decision : '');
    pill.textContent = risk ? '最近核对：' + risk.label : '最近核对：未核对';
    document.getElementById('crumb-view').textContent = VIEW_META[route]?.crumb || '总览';
    document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.view === route));
  }

  function render() {
    if (!VIEWS[route]) route = 'overview';
    renderChrome();
    document.getElementById('view').innerHTML = VIEWS[route]();
    if (route === 'movement') setTimeout(drawMovementChart, 30);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function nav(view) {
    if (!VIEWS[view]) return;
    route = view;
    try { history.replaceState(null, '', '#' + view); } catch (e) { location.hash = view; }
    render();
  }

  /* ---------------- toast / modal ---------------- */
  function toast(msg, kind) {
    const wrap = document.getElementById('toast-wrap');
    const div = document.createElement('div');
    div.className = 'toast ' + (kind || '');
    div.textContent = msg;
    wrap.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity .3s'; setTimeout(() => div.remove(), 320); }, 3400);
  }

  function openModal(title, body, footer) {
    document.getElementById('modal-root').innerHTML = '<div class="modal-back" data-action="modal-back"><div class="modal">' +
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="x" data-action="close-modal">×</button></div>' +
      '<div class="modal-body">' + body + '</div>' + (footer ? '<div class="modal-foot">' + footer + '</div>' : '') + '</div></div>';
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; ui.confirmCallback = null; }

  function confirmAction(title, body, cb, danger) {
    ui.confirmCallback = cb;
    openModal(title, body, '<button class="btn" data-action="close-modal">取消</button><button class="btn ' + (danger ? 'copper' : 'primary') + '" data-action="confirm-yes">确认</button>');
  }

  /* ---------------- actions ---------------- */
  function collectCheckin(form) {
    const fd = new FormData(form);
    return {
      body_feel: Number(fd.get('body_feel')), fatigue: Number(fd.get('fatigue')),
      sleep_hours: Number(fd.get('sleep_hours')), sleep_quality: Number(fd.get('sleep_quality')),
      pain: Number(fd.get('pain')), pain_location: fd.get('pain_location') || '',
      red_flags: fd.getAll('red_flags'), new_symptom: fd.get('new_symptom') || '',
      training_intent: fd.get('training_intent') || '', notes: fd.get('notes') || ''
    };
  }

  function applyPreset(name) {
    const presets = {
      normal: { body_feel: 4, fatigue: 4, sleep_hours: 7.2, sleep_quality: 4, pain: 1, pain_location: '', training_intent: '核心稳定训练', notes: '状态良好，按计划训练。' },
      sleep: { body_feel: 3, fatigue: 7, sleep_hours: 5.8, sleep_quality: 3, pain: 2, pain_location: '腰部', training_intent: '核心稳定训练', notes: '昨晚入睡偏晚，晨起仍感疲劳。' },
      pain: { body_feel: 3, fatigue: 6, sleep_hours: 6.5, sleep_quality: 3, pain: 5, pain_location: '腰部', training_intent: '核心稳定训练', notes: '久坐后腰部疼痛加重。' },
      red: { body_feel: 2, fatigue: 8, sleep_hours: 5, sleep_quality: 2, pain: 8, pain_location: '胸部', training_intent: '核心稳定训练', notes: '训练前出现胸闷，需要专业评估。' }
    };
    const p = presets[name];
    if (!p) return;
    const form = document.querySelector('form[data-form="checkin"]');
    if (!form) return;
    Object.keys(p).forEach((k) => { const el = form.elements[k]; if (el) el.value = p[k]; });
    form.querySelectorAll('input[name="red_flags"]').forEach((c) => { c.checked = name === 'red' && c.value === '胸痛'; });
    toast('已填入「' + (name === 'normal' ? '状态正常' : name === 'sleep' ? '睡眠不足' : name === 'pain' ? '疼痛 5/10' : '红旗症状') + '」示例，请点击提交核对。');
  }

  function runFullDemo() {
    confirmAction('连续演示', '<div class="small">将重置合成演示数据，并以同一会员 M001 连续执行 8 个步骤：<br><br>① 档案核验 → ② 到店核对 → ③ 生成计划 → ④ 离店反馈与调整 → ⑤ 动作评估 → ⑥ 趣味训练同步 → ⑦ 康复限制校验 → ⑧ 预约协同。<br><br>本操作会覆盖当前面板中的演示记录。</div>', function () {
      closeModal();
      try {
        M.resetBase();
        const steps = [];
        const m = M.getMember('M001');
        M.audit('01 会员档案', '核验统一会员档案 v' + m.version + '，读取目标、活动限制与专业意见', 'M001');
        steps.push({ n: '01', view: 'profile', title: '会员档案核验', text: m.display_name + '（M001）· 目标 ' + (m.goal || []).join('、') + ' · 活动限制 ' + ((m.voluntary.activity_restrictions || []).join('、') || '无') });
        const ck = M.addCheckin('M001', { body_feel: 3, fatigue: 7, sleep_hours: 5.8, sleep_quality: 3, pain: 2, pain_location: '腰部', training_intent: '核心稳定训练', notes: '演示：昨晚入睡偏晚，晨起疲劳。' });
        ui.lastCheckinId = ck.id;
        steps.push({ n: '02', view: 'checkin', title: '到店核对', text: '决策「' + ck.risk.label + '」· ' + ck.risk.reasons.map((r) => r.rule).join(' / ') });
        const p1 = M.generatePlan('M001', '演示：根据今日到店状态生成恢复版计划');
        steps.push({ n: '03', view: 'plan', title: '个性化计划', text: '生成 v' + p1.version + ' · ' + p1.training.length + ' 次/周 · 强度 ' + p1.training[0].intensity });
        const res = M.addFeedback('M001', { completed_sessions: 2, rpe: 5, fatigue: 5, sleep_hours: 7.0, pain: 1, notes: '演示：两次训练均完成，恢复良好。' });
        ui.lastFeedback = res;
        steps.push({ n: '04', view: 'feedback', title: '离店反馈与调整', text: '计划 v' + p1.version + ' → v' + res.plan.version + ' · ' + (res.changeType === 'progress' ? '恢复良好，小幅进阶' : res.changeType) });
        const as = M.addAssessment('M001', M.sampleCsv(), '普拉提核心床·足部序列');
        ui.movementResult = as;
        steps.push({ n: '05', view: 'movement', title: '动作评估', text: '识别 ' + as.reps + ' 次动作 · 评分 ' + as.metrics.score + '/100 · ' + as.checks.filter((c) => c.status !== 'pass').map((c) => c.name).join('、') });
        const game = M.syncGame('M001');
        M.save();
        steps.push({ n: '06', view: 'game', title: '趣味训练同步', text: '山径「' + game.trail + '」· ' + game.stage_name + ' · XP ' + game.xp + ' · ' + game.status_label });
        const guard = M.guardCheck(M.getMember('M001'), '安排仰卧起坐与负重深蹲，作为核心训练', 'training');
        ui.guardResult = guard;
        M.addFollowup('M001', { status: '稳定', notes: '演示：本次训练后无放射性疼痛，维持中立位核心训练与专业复核安排。', next_date: dateStr(U.addDays(28)) });
        M.audit('07 康复与慢病', '专业限制校验：' + guard.decision, 'M001');
        steps.push({ n: '07', view: 'rehab', title: '康复限制校验', text: guard.decision === 'professional_review' ? '检出 ' + guard.conflicts.length + ' 条冲突 → 转专业复核；已记录随访，建议改为中立位核心稳定' : guard.reason });
        const bdate = dateStr(nextWeekday(2));
        const bk = M.createBooking('M001', { date: bdate, time: '19:00', session_index: 0, coach: '周教练' });
        steps.push({ n: '08', view: 'booking', title: '预约协同', text: bdate + ' 19:00 · ' + bk.equipment + ' · ' + bk.status + ' · 器械准备 ' + bk.prep.length + ' 项' });
        M.save();
        nav('overview');
        openModal('连续演示完成', '<div class="small muted" style="margin-bottom:12px">同一会员 M001 · 全部记录按 member_id 关联 · 合成演示数据</div>' +
          '<div class="timeline">' + steps.map((s) => '<div class="t-item done"><div class="t-dot">' + s.n + '</div><div><div class="t-title">' + esc(s.title) + '</div><div class="t-body">' + esc(s.text) + '</div><div style="margin-top:6px"><button class="btn sm ghost" data-action="goto" data-view="' + s.view + '">查看本页 →</button></div></div></div>').join('') + '</div>',
          '<button class="btn primary" data-action="goto" data-view="records">查看八项任务证据</button><button class="btn" data-action="close-modal">关闭</button>');
      } catch (err) {
        toast('演示执行失败：' + err.message, 'danger');
      }
    });
  }

  function exportJson() {
    const payload = { exported_at: U.iso(), member: M.getMember(), report: M.buildReport(), raw: M.db };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mochu-health-' + M.currentMemberId + '-' + dateStr() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toast('已导出当前会员数据（JSON）。');
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'modal-back' && e.target !== btn) return;
    switch (action) {
      case 'goto': closeModal(); nav(btn.dataset.view); break;
      case 'close-modal': closeModal(); break;
      case 'confirm-yes': { const cb = ui.confirmCallback; ui.confirmCallback = null; closeModal(); if (cb) cb(); break; }
      case 'demo': runFullDemo(); break;
      case 'print': window.print(); break;
      case 'export-json': exportJson(); break;
      case 'reset-seed': confirmAction('恢复示例闭环', '<div class="small">将恢复一条历史核对、计划、反馈与动作评估，便于直接展示完整闭环。当前演示记录会被覆盖。</div>', function () { M.resetSeed(); ui.lastCheckinId = null; ui.lastFeedback = null; ui.movementResult = null; ui.guardResult = null; nav('overview'); toast('已恢复示例闭环。'); }); break;
      case 'reset-base': confirmAction('清空为本轮起点', '<div class="small">仅保留 M001 / M002 会员档案，清空核对、计划、反馈、评估、预约与审计记录，便于从零连续演示。</div>', function () { M.resetBase(); ui.lastCheckinId = null; ui.lastFeedback = null; ui.movementResult = null; ui.guardResult = null; nav('overview'); toast('已清空为本轮起点。'); }); break;
      case 'profile-edit': ui.profileEditing = true; render(); break;
      case 'profile-cancel': ui.profileEditing = false; render(); break;
      case 'preset': applyPreset(btn.dataset.preset); break;
      case 'plan-generate': {
        try {
          if (!M.latestCheckin()) { toast('请先完成到店核对，再生成计划。', 'warn'); nav('checkin'); return; }
          M.generatePlan(M.currentMemberId, '会员状态更新后重新生成');
          toast('已生成新的计划版本。');
          render();
        } catch (err) { toast(err.message, 'danger'); }
        break;
      }
      case 'movement-sample': ui.movementCsv = M.sampleCsv(); ui.movementFile = '内置示例 footwork_sample.csv'; setCsvLabel(); toast('已载入内置动作示例（12 次足部序列）。'); break;
      case 'movement-analyze': {
        try {
          if (!ui.movementCsv) { ui.movementCsv = M.sampleCsv(); ui.movementFile = '内置示例 footwork_sample.csv'; setCsvLabel(); }
          const exercise = document.getElementById('exercise-select')?.value || '普拉提核心床·足部序列';
          ui.movementResult = M.addAssessment(M.currentMemberId, ui.movementCsv, exercise);
          toast('动作评估完成：评分 ' + ui.movementResult.metrics.score + '/100。');
          render();
        } catch (err) { toast(err.message, 'danger'); }
        break;
      }
      case 'game-sync': M.syncGame(M.currentMemberId); M.save(); render(); toast('趣味训练状态已同步。'); break;
      case 'opinion-toggle': ui.opinionForm = !ui.opinionForm; render(); break;
      case 'booking-cancel': {
        const id = btn.dataset.id;
        confirmAction('取消预约', '<div class="small">取消后该时段与器械会释放，可在预约列表中重新创建。</div>', function () { M.updateBooking(id, { status: 'cancelled', note: '会员取消' }); toast('预约已取消。'); render(); }, true);
        break;
      }
      case 'booking-complete': {
        const id = btn.dataset.id;
        confirmAction('完成签到', '<div class="small">将预约标记为已完成，并回写一条训练记录、同步趣味训练。</div>', function () { M.updateBooking(id, { status: 'completed', note: '到店签到完成' }); toast('已回写训练记录。'); render(); });
        break;
      }
      case 'booking-reschedule': {
        const id = btn.dataset.id;
        const b = M.db.bookings.find((x) => x.id === id);
        if (!b) return;
        openModal('改约', '<form data-form="reschedule"><input type="hidden" name="booking_id" value="' + esc(id) + '">' +
          '<div class="field-row"><div class="field"><label>新日期</label><input class="input" type="date" name="date" value="' + esc(b.date) + '" required></div>' +
          '<div class="field"><label>新时间</label><input class="input" type="time" name="time" value="' + esc(b.time) + '" required></div></div>' +
          '<div class="field" style="margin-top:10px"><label>改约原因</label><input class="input" name="note" value="会员时间调整"></div>' +
          '<div class="btn-row" style="margin-top:14px"><button class="btn primary" type="submit">确认改约</button><button class="btn" type="button" data-action="close-modal">取消</button></div></form>');
        break;
      }
    }
  });

  function setCsvLabel() {
    const el = document.getElementById('csv-file-label');
    if (el) el.textContent = ui.movementFile || '未选择文件（可使用内置示例）';
  }

  document.addEventListener('change', function (e) {
    if (e.target.id === 'csv-file') {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () { ui.movementCsv = String(reader.result || ''); ui.movementFile = file.name; setCsvLabel(); toast('已读取：' + file.name); };
      reader.readAsText(file, 'utf-8');
    }
    if (e.target.id === 'member-select') {
      M.setMember(e.target.value);
      ui.lastCheckinId = null;
      ui.lastFeedback = null;
      ui.movementResult = null;
      ui.guardResult = null;
      ui.profileEditing = false;
      render();
    }
  });

  document.addEventListener('submit', function (e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    try {
      if (kind === 'checkin') {
        const ck = M.addCheckin(M.currentMemberId, collectCheckin(form));
        ui.lastCheckinId = ck.id;
        toast('核对完成：' + ck.risk.label);
        render();
      } else if (kind === 'profile') {
        const fd = new FormData(form);
        const m = M.getMember();
        m.display_name = fd.get('display_name') || m.display_name;
        m.age = Number(fd.get('age')) || m.age;
        m.membership = fd.get('membership') || m.membership;
        m.goal = String(fd.get('goal') || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
        m.goal_detail = fd.get('goal_detail') || '';
        m.training_experience = fd.get('training_experience') || '';
        const slots = [];
        [0, 1, 2].forEach((i) => {
          const day = fd.get('slot_day_' + i), start = fd.get('slot_time_' + i), min = fd.get('slot_min_' + i);
          if (day && start) slots.push({ day, start, minutes: Number(min) || 60 });
        });
        if (slots.length) m.available_time = slots;
        m.voluntary = m.voluntary || {};
        m.voluntary.diet = m.voluntary.diet || {};
        m.voluntary.diet.pattern = fd.get('diet_pattern') || '';
        m.voluntary.diet.allergies = String(fd.get('allergies') || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
        m.voluntary.sleep = m.voluntary.sleep || {};
        m.voluntary.sleep.target_hours = Number(fd.get('sleep_target')) || m.voluntary.sleep.target_hours;
        m.voluntary.activity_restrictions = String(fd.get('restrictions') || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
        m.version = (m.version || 1) + 1;
        m.updated_at = U.iso();
        (m.history || (m.history = [])).push({ version: m.version, at: m.updated_at, change: '编辑会员档案', fields: ['profile'] });
        M.audit('01 会员档案', '编辑档案并生成 v' + m.version, m.id);
        M.save();
        ui.profileEditing = false;
        toast('档案已保存为 v' + m.version + '。');
        render();
      } else if (kind === 'feedback') {
        const fd = new FormData(form);
        const res = M.addFeedback(M.currentMemberId, {
          completed_sessions: Number(fd.get('completed_sessions')) || 0,
          rpe: Number(fd.get('rpe')), fatigue: Number(fd.get('fatigue')), sleep_hours: Number(fd.get('sleep_hours')),
          pain: Number(fd.get('pain')), pain_location: fd.get('pain_location') || '',
          red_flags: fd.get('red_flag') ? ['胸痛/眩晕等'] : [],
          diet_notes: fd.get('diet_notes') || '', sleep_notes: fd.get('sleep_notes') || '', notes: fd.get('notes') || ''
        });
        ui.lastFeedback = res;
        toast('反馈已记录，计划更新至 v' + res.plan.version + '。');
        render();
      } else if (kind === 'guard') {
        const fd = new FormData(form);
        ui.guardResult = M.guardCheck(M.getMember(), fd.get('proposed') || '', fd.get('intent') || 'training');
        M.audit('07 康复与慢病', '专业限制校验：' + ui.guardResult.decision, M.currentMemberId);
        M.save();
        render();
      } else if (kind === 'opinion') {
        const fd = new FormData(form);
        M.addOpinion(M.currentMemberId, {
          source: fd.get('source'), role: fd.get('role'), date: fd.get('date'),
          text: fd.get('text'), restrictions: String(fd.get('restrictions') || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
          next_review: fd.get('next_review')
        });
        ui.opinionForm = false;
        toast('专业意见已保存，并同步到会员档案限制。');
        render();
      } else if (kind === 'followup') {
        const fd = new FormData(form);
        M.addFollowup(M.currentMemberId, { status: fd.get('status'), notes: fd.get('notes'), next_date: fd.get('next_date') });
        toast('随访已记录。');
        render();
      } else if (kind === 'booking') {
        const fd = new FormData(form);
        const b = M.createBooking(M.currentMemberId, {
          session_index: Number(fd.get('session_index')) || 0,
          date: fd.get('date'), time: fd.get('time'), coach: fd.get('coach')
        });
        toast('预约已创建：' + b.date + ' ' + b.time + ' · ' + b.equipment + '（' + b.status + '）');
        render();
      } else if (kind === 'reschedule') {
        const fd = new FormData(form);
        M.updateBooking(fd.get('booking_id'), { date: fd.get('date'), time: fd.get('time'), note: fd.get('note') });
        closeModal();
        toast('改约成功。');
        render();
      }
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  window.addEventListener('hashchange', function () {
    const v = (location.hash || '').replace('#', '');
    if (VIEWS[v] && v !== route) { route = v; render(); }
  });

  /* ---------------- boot ---------------- */
  render();
})();
