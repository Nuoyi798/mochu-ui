/* 蓦初·衡 — 核心数据、规则与引擎（与 Skill CLI 保持同一套规则） */
(function () {
  'use strict';

  const KEY = 'mochu_health_dashboard_v1';
  const SCHEMA = '1.0';
  const DEMO_MARK = '合成演示数据（非真实会员信息）';
  const TRAIL_STAGES = ['山门', '竹林', '溪谷', '石阶', '云亭', '松径', '山脊', '望湖', '峰顶'];
  const RISK_LABEL = {
    continue: '可以继续训练',
    supplement: '补充资料后训练',
    professional_review: '提交专业复核',
    suspend: '暂停活动'
  };
  const RISK_ORDER = { continue: 0, supplement: 1, professional_review: 2, suspend: 3 };
  const EQUIPMENT = ['普拉提核心床 1 号', '普拉提核心床 2 号', '普拉提核心床 3 号', '普拉提核心床 4 号'];
  const COACHES = ['周教练', '沈教练', '顾教练'];

  let db = null;
  let currentMemberId = 'M001';

  /* ---------------- utils ---------------- */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, n = 0) => { const p = Math.pow(10, n); return Math.round(v * p) / p; };
  const pad = (n) => String(n).padStart(2, '0');
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = (prefix) => prefix + '-' + Math.random().toString(16).slice(2, 10).toUpperCase();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function iso(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function dateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }
  function nextWeekday(target) {
    const d = new Date();
    const diff = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
  }
  function fmt(isoStr) {
    if (!isoStr) return '—';
    return String(isoStr).replace('T', ' ').slice(0, 16);
  }
  function dayName(dateString) {
    const d = new Date(dateString + 'T00:00:00');
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] || '';
  }

  /* ---------------- db ---------------- */
  function emptyDb() {
    return {
      schema_version: SCHEMA,
      created_at: iso(),
      updated_at: iso(),
      demo: true,
      demo_label: DEMO_MARK,
      members: {},
      checkins: [],
      plans: [],
      feedbacks: [],
      assessments: [],
      game: {},
      rehab: {},
      bookings: [],
      audit: []
    };
  }

  function save() {
    if (!db) return;
    db.updated_at = iso();
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 离线打开时可能被浏览器限制，仅保留内存状态 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schema_version === SCHEMA && parsed.members) {
          db = parsed;
          currentMemberId = parsed.current_member_id || (Object.keys(db.members)[0] || 'M001');
          if (!db.members[currentMemberId]) currentMemberId = Object.keys(db.members)[0];
          return;
        }
      }
    } catch (e) { /* ignore */ }
    db = seedDb();
    save();
  }

  function setMember(id) {
    if (!db.members[id]) return;
    currentMemberId = id;
    db.current_member_id = id;
    save();
  }

  function getMember(id) {
    return db.members[id || currentMemberId];
  }
  function memberList() { return Object.values(db.members); }
  function plansFor(id) { return db.plans.filter((p) => p.member_id === (id || currentMemberId)); }
  function activePlan(id) {
    const list = plansFor(id).filter((p) => p.status === 'active');
    if (!list.length) return null;
    return list.sort((a, b) => (a.version - b.version) || String(a.created_at).localeCompare(String(b.created_at))).slice(-1)[0];
  }
  function latestCheckin(id) {
    const list = db.checkins.filter((c) => c.member_id === (id || currentMemberId));
    return list.length ? list.slice().sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-1)[0] : null;
  }
  function latestRisk(id) {
    const c = latestCheckin(id);
    return c ? c.risk : null;
  }
  function feedbacksFor(id) { return db.feedbacks.filter((f) => f.member_id === (id || currentMemberId)); }
  function assessmentsFor(id) { return db.assessments.filter((a) => a.member_id === (id || currentMemberId)); }
  function bookingsFor(id) {
    return db.bookings.filter((b) => b.member_id === (id || currentMemberId))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }

  function audit(module, text, memberId) {
    db.audit.push({ id: uid('AU'), at: iso(), member_id: memberId || currentMemberId, module, text });
    if (db.audit.length > 400) db.audit = db.audit.slice(-400);
  }

  /* ---------------- risk engine ---------------- */
  function assessRisk(member, ck, recent) {
    const reasons = [];
    const restrictions = Array.from(new Set([...(member.voluntary?.activity_restrictions || [])]));
    (member.voluntary?.medical_advice || []).forEach((a) => (a.restrictions || []).forEach((r) => { if (!restrictions.includes(r)) restrictions.push(r); }));
    const add = (level, rule, text, source) => reasons.push({ level, rule, text, source });
    const red = ck.red_flags || [];
    const pain = ck.pain == null ? 0 : Number(ck.pain);
    const sleep = ck.sleep_hours == null || ck.sleep_hours === '' ? null : Number(ck.sleep_hours);
    const fatigue = ck.fatigue == null || ck.fatigue === '' ? null : Number(ck.fatigue);
    const intent = ck.training_intent || '';
    const diagnoses = member.voluntary?.diagnoses || [];
    const advice = member.voluntary?.medical_advice || [];

    if (red.length) add('suspend', 'R01', '出现红旗症状（' + red.join('、') + '），本次暂停训练并建议尽快就医评估。', '运动前健康筛查（PAR-Q+ / ACSM）红旗症状清单');
    if (pain >= 7) add('suspend', 'R02', '疼痛评分 ' + pain + '/10，达到暂停阈值（≥7）。', '场馆疼痛分级与转介流程');
    else if (pain >= 4) add('professional_review', 'R03', '疼痛评分 ' + pain + '/10，处于 4-6 区间，需先由康复/医疗专业人员复核。', '场馆疼痛分级与转介流程');
    if (ck.new_symptom) add('professional_review', 'R03b', '本次出现新发症状（' + ck.new_symptom + '），需专业复核后再决定负荷。', '康复筛查流程');

    const missing = [];
    if (ck.sleep_hours == null || ck.sleep_hours === '') missing.push('睡眠');
    if (ck.fatigue == null || ck.fatigue === '') missing.push('疲劳');
    if (ck.pain == null || ck.pain === '') missing.push('疼痛');
    if (ck.body_feel == null || ck.body_feel === '') missing.push('身体感受');
    if (missing.length) add('supplement', 'R06', '关键状态信息缺失（' + missing.join('、') + '），先补齐再进行负荷判断。', '统一会员档案字段规范');

    if (sleep != null && sleep < 5) add('supplement', 'R04', '睡眠 ' + sleep.toFixed(1) + ' 小时，低于 5 小时恢复阈值，本次降为恢复性训练并补充睡眠信息。', '睡眠与疲劳管理指引（场馆服务标准）');
    else if (sleep != null && sleep < 6) add('supplement', 'R04b', '睡眠 ' + sleep.toFixed(1) + ' 小时偏短，建议降低训练强度并记录午后状态。', '睡眠与疲劳管理指引（场馆服务标准）');
    if (fatigue != null && fatigue >= 8) add('supplement', 'R04c', '主观疲劳 ' + fatigue + '/10（≥8），本次不安排高负荷训练。', '自觉疲劳量表（RPE/疲劳自评）使用规范');
    else if (fatigue != null && fatigue >= 7) add('supplement', 'R04d', '主观疲劳 ' + fatigue + '/10 偏高，建议下调约 20% 训练量。', '自觉疲劳量表（RPE/疲劳自评）使用规范');

    const highLoad = ['高强度', '大重量', '爆发', '冲刺', '极限', '最大', '负重深蹲', '硬拉'];
    if (restrictions.length && highLoad.some((w) => intent.includes(w))) {
      add('professional_review', 'R05', '本次训练意图（' + intent + '）与档案活动限制存在冲突，需专业复核后调整。', '档案活动限制与专业意见优先原则');
    }
    if (restrictions.some((r) => r.includes('屈曲')) && ['卷腹', '仰卧起坐', '屈曲'].some((w) => intent.includes(w))) {
      add('professional_review', 'R05b', '训练意图包含脊柱屈曲动作，与档案限制冲突。', '康复专业意见（' + (advice[0]?.source || '档案') + '）');
    }
    const chronic = diagnoses.filter((d) => d.chronic);
    if (chronic.length && !advice.some((a) => a.date)) {
      add('professional_review', 'R07', '慢病会员缺少近期专业意见，先补齐评估与限制条件。', '慢病运动支持服务规范');
    }
    if (fatigue != null && fatigue >= 7 && (recent || []).length >= 2) {
      const last2 = recent.slice(-2);
      if (last2.every((c) => Number(c.fatigue) >= 7)) {
        add('professional_review', 'R08', '连续三次主观疲劳≥7，提示恢复不足，建议专业复核。', '疲劳累积监测规则');
      }
    }

    if (!reasons.length) {
      add('continue', 'R09', '本次未触发风险规则，可按当前计划训练，并维持热身与动作质量监控。', '运动前健康筛查（PAR-Q+ / ACSM）基础流程');
    }
    const decision = reasons.reduce((acc, r) => (RISK_ORDER[r.level] > RISK_ORDER[acc] ? r.level : acc), 'continue');
    const allowed = {
      continue: '按计划强度执行（RPE 5-7）',
      supplement: '恢复性训练（RPE 3-4），补齐资料后再评估',
      professional_review: '暂停加负荷，仅可做低强度活动，等待专业复核',
      suspend: '暂停训练，仅记录症状并联系专业人员'
    }[decision];
    const next = {
      continue: '按计划训练；如训练中出现胸痛、眩晕或疼痛加重，立即停止并上报。',
      supplement: '补录睡眠/疲劳/疼痛信息；本次改为呼吸、灵活性练习与低强度恢复。',
      professional_review: '将会员情况提交康复/医疗专业人员复核，复核前不安排加负荷训练。',
      suspend: '停止训练并启动转介流程；记录症状、时间和联系人。'
    }[decision];
    return {
      decision, label: RISK_LABEL[decision], reasons, restrictions, allowed_intensity: allowed, next_action: next,
      disclaimer: '本判断基于会员自报与档案信息，不构成医疗诊断或治疗建议。'
    };
  }

  function addCheckin(memberId, payload, persist = true) {
    const member = getMember(memberId);
    const recent = db.checkins.filter((c) => c.member_id === memberId).slice(-2);
    const ck = {
      id: uid('CK'), member_id: memberId, at: payload.at || iso(),
      body_feel: payload.body_feel, fatigue: payload.fatigue,
      sleep_hours: payload.sleep_hours, sleep_quality: payload.sleep_quality,
      pain: payload.pain == null ? 0 : Number(payload.pain), pain_location: payload.pain_location || '',
      red_flags: payload.red_flags || [], new_symptom: payload.new_symptom || '',
      training_intent: payload.training_intent || '', notes: payload.notes || '',
      source: '会员到店自报（演示为合成数据）'
    };
    ck.risk = assessRisk(member, ck, recent);
    db.checkins.push(ck);
    audit('02 到店核对', '到店核对：' + ck.risk.label, memberId);
    if (['professional_review', 'suspend'].includes(ck.risk.decision)) syncGame(memberId);
    if (persist) save();
    return ck;
  }

  /* ---------------- plan engine ---------------- */
  function goalKey(member) {
    const text = (member.goal || []).join(' ') + ' ' + (member.goal_detail || '');
    if (['体态', '康复', '产后', '腰', '姿'].some((k) => text.includes(k))) return 'posture';
    if (['减脂', '体重', '瘦'].some((k) => text.includes(k))) return 'fat_loss';
    if (['睡眠', '压力', '情绪', '放松'].some((k) => text.includes(k))) return 'sleep_stress';
    if (['力量', '增肌', '肌力'].some((k) => text.includes(k))) return 'strength';
    if (['慢病', '血糖', '血压', '糖前'].some((k) => text.includes(k))) return 'chronic';
    return 'general';
  }

  function sessionLibrary(key) {
    const lib = {
      posture: [
        { title: '核心稳定与脊柱中立位', duration_min: 60, intensity: 'RPE 4-5', focus: ['呼吸', '核心', '髋灵活'], items: ['呼吸与肋骨下沉 8 分钟', '普拉提核心床足部序列（中立位）15 分钟', '死虫式与鸟狗式 3×8/侧', '髋屈肌与胸椎灵活性 10 分钟', '低强度有氧收尾 10 分钟'] },
        { title: '下肢排列与髋主导力量', duration_min: 60, intensity: 'RPE 5-6', focus: ['下肢', '髋', '稳定'], items: ['动态热身 10 分钟', '箱式深蹲（轻负荷，控制幅度）3×10', '臀桥与单腿臀桥 3×10/侧', '侧向弹力带行走 3×12', '小腿与足底放松 8 分钟'] },
        { title: '上肢拉与肩胛控制', duration_min: 55, intensity: 'RPE 4-5', focus: ['肩胛', '上肢', '体态'], items: ['肩胛俯卧撑与墙壁滑动 10 分钟', '坐姿划船（轻负荷）3×12', '面拉 3×12', '普拉提侧卧系列 10 分钟', '呼吸放松 5 分钟'] }
      ],
      fat_loss: [
        { title: '全身力量循环', duration_min: 60, intensity: 'RPE 6-7', focus: ['全身', '力量', '能量消耗'], items: ['动态热身 10 分钟', '深蹲推举/壶铃硬拉 4 组循环', '划船与俯卧撑 4 组循环', '农夫行走 3×30 米', '低强度有氧 10 分钟'] },
        { title: '普拉提核心 + 低冲击有氧', duration_min: 55, intensity: 'RPE 5-6', focus: ['核心', '有氧', '控制'], items: ['核心床热身序列 10 分钟', '足部序列与侧卧系列 20 分钟', '坡度快走 20 分钟（能说话强度）', '拉伸与呼吸 5 分钟'] },
        { title: '上肢与背部力量', duration_min: 55, intensity: 'RPE 6-7', focus: ['上肢', '背部', '代谢'], items: ['热身 10 分钟', '高位下拉 4×10', '哑铃卧推 4×10', '单臂划船 3×12/侧', '战绳或划船机间歇 8 分钟'] }
      ],
      sleep_stress: [
        { title: '舒缓力量与呼吸', duration_min: 50, intensity: 'RPE 3-4', focus: ['呼吸', '舒缓', '睡眠'], items: ['90/90 呼吸 8 分钟', '普拉提核心床轻柔序列 15 分钟', '自重深蹲与臀桥 2×12', '延长呼气练习 10 分钟'] },
        { title: '户外低强度有氧', duration_min: 45, intensity: 'RPE 3-4', focus: ['有氧', '情绪', '恢复'], items: ['快走或骑行 30 分钟（鼻吸口呼）', '小腿与髋部拉伸 10 分钟', '睡前呼吸预演 5 分钟'] }
      ],
      strength: [
        { title: '下肢力量（髋主导）', duration_min: 65, intensity: 'RPE 6-7', focus: ['下肢', '力量', '髋'], items: ['热身 10 分钟', '箱式深蹲 4×8', '罗马尼亚硬拉 4×8', '保加利亚分腿蹲 3×10/侧', '核心抗旋转 3×10/侧'] },
        { title: '上肢推拉平衡', duration_min: 60, intensity: 'RPE 6-7', focus: ['上肢', '推拉', '肩胛'], items: ['热身 10 分钟', '卧推或哑铃推举 4×8', '引体/高位下拉 4×8', '单臂划船 3×10/侧', '肩胛与胸椎灵活性 8 分钟'] },
        { title: '普拉提核心与恢复', duration_min: 50, intensity: 'RPE 4-5', focus: ['核心', '恢复', '控制'], items: ['核心床足部序列 15 分钟', '侧卧系列 10 分钟', '死虫式 3×10/侧', '呼吸与拉伸 10 分钟'] }
      ],
      chronic: [
        { title: '低中强度有氧与监测', duration_min: 45, intensity: 'RPE 4-5', focus: ['有氧', '监测', '安全'], items: ['热身与关节活动 10 分钟', '快走或功率车 25 分钟（可对话强度）', '整理活动 5 分钟', '训练前后血压/血糖按医嘱记录'] },
        { title: '全身轻力量', duration_min: 50, intensity: 'RPE 5-6', focus: ['力量', '安全', '功能'], items: ['热身 10 分钟', '坐姿腿举或箱式深蹲 3×10', '弹力带划船 3×12', '墙壁俯卧撑 3×10', '呼吸与拉伸 10 分钟'] }
      ],
      general: [
        { title: '全身基础力量', duration_min: 55, intensity: 'RPE 5-6', focus: ['全身', '基础', '稳定'], items: ['动态热身 10 分钟', '深蹲/臀桥 3×10', '划船/俯卧撑 3×10', '核心稳定 3×10', '拉伸 8 分钟'] },
        { title: '有氧与灵活性', duration_min: 45, intensity: 'RPE 4-5', focus: ['有氧', '灵活', '恢复'], items: ['快走或骑行 30 分钟', '髋与胸椎灵活性 10 分钟', '呼吸放松 5 分钟'] }
      ]
    };
    return clone(lib[key] || lib.general);
  }

  function restrictionsOf(member) {
    const list = [...(member.voluntary?.activity_restrictions || [])];
    (member.voluntary?.medical_advice || []).forEach((a) => (a.restrictions || []).forEach((r) => { if (!list.includes(r)) list.push(r); }));
    return list;
  }

  function assignSlots(member, sessions) {
    const slots = member.available_time || [];
    return sessions.map((s, i) => {
      const slot = slots[i % Math.max(1, slots.length)] || { day: '待定', start: '19:00', minutes: s.duration_min };
      return Object.assign({}, s, {
        day: slot.day || '待定',
        time: slot.start || '19:00',
        duration_min: Math.min(s.duration_min, Number(slot.minutes) || s.duration_min)
      });
    });
  }

  function nutritionPlan(member, key) {
    const diet = member.voluntary?.diet || {};
    const principles = {
      posture: ['每餐保证一掌心优质蛋白，支持组织修复', '主食优先全谷物，控制精制糖', '训练日前后补充碳水与水分'],
      fat_loss: ['维持温和热量缺口，不采用极端节食', '每餐蛋白质 20-30g，优先鱼禽蛋豆', '蔬菜占餐盘一半，减少含糖饮料'],
      sleep_stress: ['晚餐不过饱，睡前 3 小时避免大量进食', '下午后减少咖啡因，睡前避免酒精', '补充富含色氨酸与镁的食物'],
      strength: ['训练日蛋白质按体重 1.4-1.6g/kg 分配', '每餐搭配优质碳水，支持训练表现', '训练后 2 小时内补充蛋白与碳水'],
      chronic: ['按医嘱控制总能量与钠摄入', '主食定量，优先低升糖指数食物', '不自行更改药物或治疗方案'],
      general: ['均衡搭配蛋白质、蔬菜与全谷物', '规律进餐，足量饮水', '训练日适当增加碳水']
    }[key];
    return {
      pattern: diet.pattern || '均衡饮食',
      principles,
      meals: [
        { meal: '早餐', example: '燕麦 + 无糖酸奶 + 蓝莓 + 水煮蛋' },
        { meal: '午餐', example: '糙米饭 + 清蒸鱼/鸡胸 + 两份时蔬' },
        { meal: '加餐', example: '一小把坚果或低糖水果' },
        { meal: '晚餐', example: '杂粮 + 豆腐/瘦肉 + 深色蔬菜' }
      ],
      hydration: '每日饮水约 30-35ml/kg，训练日额外补充 500ml 左右。',
      avoid: [...(diet.allergies || []), ...(key === 'sleep_stress' ? ['含酒精饮品'] : [])],
      note: '饮食建议为一般健康管理建议，不替代注册营养师或医生的个体化方案。'
    };
  }

  function sleepPlan(member, key) {
    const target = member.voluntary?.sleep?.target_hours || 7.5;
    return {
      target_hours: target,
      principles: ['固定起床时间，周末偏差不超过 1 小时', '睡前 60 分钟降低光照与屏幕刺激', '卧室温度保持 18-22℃，保持安静与黑暗'],
      routine: ['温水淋浴或泡脚 10 分钟', '4-7-8 呼吸 5 分钟', '纸质阅读或轻柔拉伸 10 分钟'],
      caffeine_cutoff: '14:00 后避免咖啡、浓茶与能量饮料',
      note: '持续失眠或情绪困扰应转介专业人员，本建议不构成医疗诊断。'
    };
  }

  function buildPlan(member, ck, risk) {
    const key = goalKey(member);
    let sessions = sessionLibrary(key);
    const targetCount = clamp((member.available_time || []).length || 2, 1, 3);
    sessions = assignSlots(member, sessions.slice(0, targetCount));
    const restrictions = restrictionsOf(member);
    if (risk && ['professional_review', 'suspend'].includes(risk.decision)) {
      const slot = (member.available_time || [])[0] || { day: '待定', start: '19:00' };
      sessions = [{
        day: slot.day || '待定', time: slot.start || '19:00',
        title: '恢复守护：呼吸与症状记录', duration_min: 25, intensity: 'RPE 1-2',
        focus: ['恢复', '监测', '专业复核'],
        items: ['仰卧 90/90 呼吸 8 分钟', '轻柔髋部与胸椎活动 7 分钟', '记录疼痛、疲劳与睡眠 5 分钟', '按专业意见联系康复/医疗人员']
      }];
    } else if (risk && risk.decision === 'supplement') {
      sessions = sessions.map((s) => Object.assign({}, s, {
        duration_min: Math.round(s.duration_min * 0.85),
        intensity: 'RPE 3-4（恢复版）',
        items: s.items.concat(['训练前补录睡眠/疲劳并请教练复核'])
      }));
    }
    return {
      id: uid('PLAN-' + member.id), member_id: member.id, version: 1, status: 'active',
      created_at: iso(),
      basis: {
        goal: member.goal || [], goal_key: key, available_time: member.available_time || [],
        training_experience: member.training_experience || '',
        latest_checkin: ck ? ck.id : null,
        risk_decision: risk ? risk.decision : '未核对',
        restrictions
      },
      training: sessions,
      nutrition: nutritionPlan(member, key),
      sleep: sleepPlan(member, key),
      limitations: restrictions.concat(['计划依据会员自报与档案信息生成，不构成医疗建议。', '如出现胸痛、眩晕、麻木或疼痛加重，立即停止并联系专业人员。']),
      review_date: dateStr(addDays(14)),
      change_reason: '首次生成', prev_plan_id: null, diff: []
    };
  }

  function generatePlan(memberId, reason, payload) {
    const member = getMember(memberId);
    const ck = latestCheckin(memberId);
    const risk = ck ? ck.risk : null;
    const prev = activePlan(memberId);
    const plan = buildPlan(member, ck, risk);
    if (prev) {
      plan.version = prev.version + 1;
      plan.prev_plan_id = prev.id;
      plan.change_reason = reason || (payload && payload.reason) || '根据最新状态重新生成';
      plan.diff = [{ field: 'plan', before: '版本 ' + prev.version, after: '版本 ' + plan.version, reason: plan.change_reason }];
      prev.status = 'superseded';
      prev.superseded_at = iso();
    }
    db.plans.push(plan);
    audit('03 个性化计划', '生成计划 v' + plan.version + '（' + plan.change_reason + '）', memberId);
    save();
    return plan;
  }

  /* ---------------- feedback & adaptation ---------------- */
  function summarizeFeedback(feedback, plan) {
    const planned = plan ? plan.training.length : 0;
    const completed = Number(feedback.completed_sessions) || 0;
    const adherence = planned ? Math.min(1, completed / planned) : null;
    return {
      adherence, planned_sessions: planned, completed_sessions: completed,
      fatigue: feedback.fatigue, sleep_hours: feedback.sleep_hours, pain: feedback.pain, rpe: feedback.rpe,
      note: feedback.notes || ''
    };
  }

  function deload(plan, ratio) {
    plan.training.forEach((s) => {
      s.duration_min = Math.max(20, Math.round(s.duration_min * (1 - ratio)));
      s.intensity = 'RPE 3-4（按反馈下调）';
      s.items = s.items.slice(0, -1).concat(['恢复性呼吸与拉伸 8 分钟']);
    });
    plan.nutrition.principles.push('恢复不足阶段优先保证蛋白质与水分，不额外增加热量。');
    plan.sleep.principles.push('本周将睡眠目标提前 30 分钟，并记录入睡时间。');
  }
  function reduceFrequency(plan) {
    if (plan.training.length > 1) plan.training = [plan.training[0]].concat(plan.training.slice(2));
    plan.training.forEach((s) => {
      s.duration_min = Math.max(20, Math.round(s.duration_min * 0.8));
      s.intensity = 'RPE 4-5（降低执行门槛）';
    });
  }
  function progressPlan(plan) {
    plan.training.forEach((s) => {
      s.duration_min = Math.min(90, Math.round(s.duration_min * 1.05));
      s.intensity = 'RPE 6-7（小幅进阶）';
    });
    plan.nutrition.principles.push('训练进阶期保证每餐蛋白质与训练后补充。');
  }

  function adaptPlan(memberId, feedback) {
    const member = getMember(memberId);
    const plan = activePlan(memberId);
    if (!plan) throw new Error('当前没有生效计划，请先生成计划。');
    const summary = summarizeFeedback(feedback, plan);
    const newPlan = clone(plan);
    newPlan.id = uid('PLAN-' + memberId);
    newPlan.version = plan.version + 1;
    newPlan.created_at = iso();
    newPlan.prev_plan_id = plan.id;
    newPlan.status = 'active';
    newPlan.diff = [];
    const reasons = [];
    const pain = Number(feedback.pain) || 0;
    const fatigue = feedback.fatigue == null || feedback.fatigue === '' ? null : Number(feedback.fatigue);
    const sleep = feedback.sleep_hours == null || feedback.sleep_hours === '' ? null : Number(feedback.sleep_hours);
    const adherence = summary.adherence;
    let changeType = 'maintain';

    if (pain >= 4 || (feedback.red_flags || []).length) {
      newPlan.training = [{
        day: plan.training[0]?.day || '待定', time: plan.training[0]?.time || '19:00',
        title: '恢复守护：暂停负荷，等待专业复核', duration_min: 20, intensity: '暂停训练',
        focus: ['暂停', '记录', '转介'],
        items: ['呼吸放松 5 分钟', '记录症状与疼痛变化', '联系康复/医疗专业人员复核', '复核通过后再恢复计划']
      }];
      reasons.push('反馈疼痛 ' + pain + '/10（≥4）或出现红旗症状，计划转为暂停负荷并启动专业复核。');
      newPlan.limitations = Array.from(new Set((newPlan.limitations || []).concat(['专业复核通过前，不恢复抗阻与高负荷训练。'])));
      changeType = 'safety_stop';
    } else if ((fatigue != null && fatigue >= 8) || (sleep != null && sleep < 5)) {
      deload(newPlan, 0.3);
      reasons.push('反馈疲劳 ' + fatigue + '/10、睡眠 ' + sleep + ' 小时，恢复不足，整体训练量下调约 30%。');
      changeType = 'deload';
    } else if ((fatigue != null && fatigue >= 7) || (sleep != null && sleep < 6)) {
      deload(newPlan, 0.2);
      reasons.push('反馈疲劳 ' + fatigue + '/10、睡眠 ' + sleep + ' 小时，训练量下调约 20%，并加强睡眠管理。');
      changeType = 'deload';
    } else if (adherence != null && adherence < 0.5) {
      reduceFrequency(newPlan);
      reasons.push('计划完成率 ' + Math.round(adherence * 100) + '%，低于 50%，减少一次训练并缩短单次时长。');
      changeType = 'reduce_frequency';
    } else if (adherence != null && adherence >= 0.8 && (fatigue == null || fatigue <= 5) && (sleep == null || sleep >= 6.5)) {
      progressPlan(newPlan);
      reasons.push('完成率 ' + Math.round(adherence * 100) + '% 且恢复良好，训练量小幅进阶约 5-10%。');
      changeType = 'progress';
    } else {
      reasons.push('反馈整体平稳，维持当前训练结构，仅微调恢复与记录重点。');
    }
    if (feedback.diet_notes) newPlan.nutrition.principles = Array.from(new Set(newPlan.nutrition.principles.concat(['结合离店反馈调整：' + feedback.diet_notes])));
    if (feedback.sleep_notes) newPlan.sleep.principles = Array.from(new Set(newPlan.sleep.principles.concat(['结合离店反馈调整：' + feedback.sleep_notes])));
    newPlan.diff = [{
      field: 'training',
      before: plan.training.length + ' 次 / 共 ' + plan.training.reduce((a, s) => a + s.duration_min, 0) + ' 分钟',
      after: newPlan.training.length + ' 次 / 共 ' + newPlan.training.reduce((a, s) => a + s.duration_min, 0) + ' 分钟',
      reason: reasons.join('；')
    }];
    newPlan.change_reason = reasons.join('；');
    newPlan.adjustment_type = changeType;
    newPlan.basis = Object.assign({}, newPlan.basis, { last_feedback_id: feedback.id });
    plan.status = 'superseded';
    plan.superseded_at = iso();
    db.plans.push(newPlan);
    feedback.plan_after_id = newPlan.id;
    syncGame(memberId);
    audit('04 离店反馈', '根据反馈调整计划 v' + plan.version + '→v' + newPlan.version + '（' + changeType + '）', memberId);
    save();
    return { plan: newPlan, summary, changeType, reasons };
  }

  function addFeedback(memberId, payload, persist = true) {
    const feedback = {
      id: uid('FB'), member_id: memberId, at: payload.at || iso(),
      completed_sessions: Number(payload.completed_sessions) || 0,
      rpe: payload.rpe, fatigue: payload.fatigue, sleep_hours: payload.sleep_hours,
      pain: payload.pain == null ? 0 : Number(payload.pain), pain_location: payload.pain_location || '',
      red_flags: payload.red_flags || [], diet_notes: payload.diet_notes || '',
      sleep_notes: payload.sleep_notes || '', notes: payload.notes || '',
      source: '会员离店反馈（演示为合成数据）'
    };
    db.feedbacks.push(feedback);
    const res = adaptPlan(memberId, feedback);
    feedback.summary = res.summary;
    feedback.change_type = res.changeType;
    if (persist) save();
    return Object.assign({ feedback }, res);
  }

  /* ---------------- movement ---------------- */
  function movingAverage(values, windowSize) {
    const half = Math.floor(windowSize / 2);
    const out = [];
    for (let i = 0; i < values.length; i++) {
      const lo = Math.max(0, i - half), hi = Math.min(values.length, i + half + 1);
      let sum = 0;
      for (let j = lo; j < hi; j++) sum += values[j];
      out.push(sum / (hi - lo));
    }
    return out;
  }

  function parseCsv(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 3) throw new Error('CSV 数据行不足。');
    const headers = lines[0].split(',').map((h) => h.trim());
    const rows = lines.slice(1).map((l) => l.split(',').map((v) => v.trim()));
    const col = (name, required) => {
      const idx = headers.indexOf(name);
      if (idx < 0) {
        if (required) throw new Error('CSV 缺少必需列：' + name);
        return null;
      }
      return rows.map((r) => {
        const v = Number(r[idx]);
        return Number.isFinite(v) ? v : null;
      });
    };
    return {
      t: col('t', true), knee: col('knee_angle', true), hip: col('hip_angle'),
      trunk: col('trunk_angle'), left: col('knee_angle_left'), right: col('knee_angle_right')
    };
  }

  function detectReps(knee) {
    const valid = [];
    knee.forEach((v, i) => { if (Number.isFinite(v)) valid.push(i); });
    if (valid.length < 10) throw new Error('有效关节角度数据不足（少于 10 个采样点）。');
    const vals = valid.map((i) => knee[i]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 10) throw new Error('膝关节角度变化幅度不足（<10°），无法识别动作周期。');
    const high = lo + (hi - lo) * 0.7, low = lo + (hi - lo) * 0.3;
    const reps = [];
    let state = 'high', highIdx = null, trough = null;
    valid.forEach((idx) => {
      const v = knee[idx];
      if (state === 'high') {
        if (v >= high) highIdx = idx;
        else if (v < low && highIdx != null) { state = 'low'; trough = idx; }
      } else {
        if (v < knee[trough]) trough = idx;
        if (v > high) {
          reps.push({ start: highIdx, trough, end: idx });
          state = 'high'; highIdx = idx;
        }
      }
    });
    return reps;
  }

  function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
  function pstdev(a) { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length); }

  function analyzeCsv(text, exercise) {
    const s = parseCsv(text);
    const knee = movingAverage(s.knee.map((v) => (v == null ? 0 : v)), 5);
    const reps = detectReps(knee);
    if (!reps.length) throw new Error('未识别到完整动作周期，请检查数据方向与采样频率。');
    const roms = [], temps = [], con = [], ecc = [];
    reps.forEach((r) => {
      const seg = knee.slice(r.start, r.end + 1);
      roms.push(Math.max(...seg) - Math.min(...seg));
      temps.push(s.t[r.end] - s.t[r.start]);
      ecc.push(s.t[r.trough] - s.t[r.start]);
      con.push(s.t[r.end] - s.t[r.trough]);
    });
    const romMean = mean(roms);
    const romCv = romMean ? pstdev(roms) / romMean : 1;
    const tempoMean = mean(temps);
    const tempoCv = tempoMean ? pstdev(temps) / tempoMean : 1;
    let symmetry = null;
    if (s.left && s.right) {
      const lr = [], rr = [];
      reps.forEach((r) => {
        const lseg = s.left.slice(r.start, r.end + 1).filter(Number.isFinite);
        const rseg = s.right.slice(r.start, r.end + 1).filter(Number.isFinite);
        if (lseg.length && rseg.length) {
          lr.push(Math.max(...lseg) - Math.min(...lseg));
          rr.push(Math.max(...rseg) - Math.min(...rseg));
        }
      });
      if (lr.length && rr.length) {
        const lm = mean(lr), rm = mean(rr);
        if (Math.max(lm, rm) > 0) symmetry = Math.min(lm, rm) / Math.max(lm, rm);
      }
    }
    let trunkRms = null;
    if (s.trunk) {
      const tv = s.trunk.filter(Number.isFinite);
      if (tv.length) {
        const tm = mean(tv);
        trunkRms = Math.sqrt(tv.reduce((sum, v) => sum + (v - tm) * (v - tm), 0) / tv.length);
      }
    }
    const romScore = clamp(romMean / 90 * 100, 0, 100);
    const tempoScore = clamp(100 - tempoCv * 300, 0, 100);
    const symScore = symmetry == null ? 80 : clamp(symmetry * 100, 0, 100);
    const stabScore = clamp(100 - (trunkRms == null ? 4 : trunkRms) * 6, 0, 100);
    const score = Math.round(0.3 * romScore + 0.25 * tempoScore + 0.25 * symScore + 0.2 * stabScore);
    const checks = [
      { name: '动作幅度（ROM）', value: romMean.toFixed(1) + '°（变异 ' + (romCv * 100).toFixed(1) + '%）', status: romCv <= 0.12 && romMean >= 70 ? 'pass' : (romCv <= 0.2 ? 'warn' : 'fail'), cue: romCv > 0.12 ? '保持每次下放与回收的幅度一致，必要时减小阻力。' : '幅度稳定，继续保持。' },
      { name: '节奏控制', value: '平均 ' + tempoMean.toFixed(1) + 's/次（变异 ' + (tempoCv * 100).toFixed(1) + '%）', status: tempoCv <= 0.12 ? 'pass' : (tempoCv <= 0.2 ? 'warn' : 'fail'), cue: tempoCv > 0.12 ? '用节拍器或口令控制 3 秒离心、2 秒向心。' : '节奏均匀，控制良好。' },
      { name: '左右对称', value: symmetry == null ? '未提供左右分侧数据' : '对称指数 ' + symmetry.toFixed(2), status: symmetry == null || symmetry >= 0.92 ? 'pass' : (symmetry >= 0.85 ? 'warn' : 'fail'), cue: symmetry != null && symmetry < 0.92 ? '弱侧先做、强侧不额外加次数；如持续不对称请康复评估。' : '左右差异在可接受范围。' },
      { name: '躯干稳定', value: trunkRms == null ? '未提供躯干角度' : '偏离均方根 ' + trunkRms.toFixed(1) + '°', status: trunkRms == null || trunkRms <= 4 ? 'pass' : (trunkRms <= 7 ? 'warn' : 'fail'), cue: trunkRms != null && trunkRms > 4 ? '降低阻力、收紧核心，保持肋骨下沉与骨盆中立。' : '躯干控制稳定。' }
    ];
    const issues = checks.filter((c) => c.status !== 'pass');
    let summary = '共识别 ' + reps.length + ' 次完整动作，动作质量评分 ' + score + '/100。';
    summary += issues.length ? ' 主要改进点：' + issues.map((c) => c.name).join('；') + '。' : ' 各项指标均在稳定区间，可维持当前负荷。';
    const rate = s.t.length > 1 && s.t[1] !== s.t[0] ? 1 / (s.t[1] - s.t[0]) : null;
    return {
      exercise: exercise || '普拉提核心床·足部序列',
      source_file: '会员训练数据（合成示例）',
      analyzed_at: iso(),
      method: '关节角度时间序列 → 平滑 → 阈值识别动作周期 → ROM、节奏、对称与躯干稳定性指标',
      sample_rate_hz: rate ? round(rate, 2) : null,
      reps: reps.length,
      metrics: {
        rom_mean_deg: round(romMean, 1), rom_cv: round(romCv, 3),
        tempo_mean_s: round(tempoMean, 2), tempo_cv: round(tempoCv, 3),
        concentric_mean_s: round(mean(con), 2), eccentric_mean_s: round(mean(ecc), 2),
        symmetry_index: symmetry == null ? null : round(symmetry, 3),
        trunk_rms_deg: trunkRms == null ? null : round(trunkRms, 2),
        score
      },
      checks,
      rep_details: reps.map((r, i) => ({ rep: i + 1, rom_deg: round(roms[i], 1), duration_s: round(temps[i], 2) })),
      summary,
      disclaimer: '动作评估用于训练反馈，不构成医学诊断；疼痛或功能障碍请转介专业人员。',
      _series: { t: s.t, knee }
    };
  }

  function addAssessment(memberId, text, exercise, persist = true) {
    const member = getMember(memberId);
    const result = analyzeCsv(text, exercise);
    result.id = uid('AS');
    result.member_id = memberId;
    db.assessments.push(result);
    syncGame(memberId);
    audit('05 动作评估', '动作评估：' + result.exercise + '，评分 ' + result.metrics.score, memberId);
    if (persist) save();
    return result;
  }

  function sampleCsv() {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const lines = ['t,knee_angle,hip_angle,trunk_angle,knee_angle_left,knee_angle_right'];
    let t = 0, prev = 158;
    for (let rep = 0; rep < 12; rep++) {
      const slow = [3, 4, 9, 10].includes(rep) ? 1.45 : 1.0;
      const asym = [2, 3, 4, 8, 9, 10].includes(rep) ? 0.78 : 0.97;
      const baseLow = rep % 3 ? 62 : 58;
      const baseHigh = rep % 4 ? 158 : 164;
      const phases = [[baseHigh, 2.2 * slow], [baseLow, 1.1 * slow], [baseHigh, 2.0 * slow]];
      phases.forEach((ph) => {
        const target = ph[0], dur = ph[1];
        const steps = Math.max(2, Math.floor(dur / 0.1));
        for (let i = 1; i <= steps; i++) {
          const val = prev + (target - prev) * (i / steps) + (rnd() * 2 - 1);
          t += 0.1;
          let trunk = 3.2 + (rnd() * 2.4 - 1.2);
          if (rep >= 9) trunk += rep === 9 ? 12 : (rep === 10 ? -7 : 6);
          const right = baseLow + (val - baseLow) * asym + (rnd() * 2 - 1);
          lines.push([t.toFixed(2), val.toFixed(1), (val * 0.62 + 18).toFixed(1), trunk.toFixed(1), (val + 0.8).toFixed(1), right.toFixed(1)].join(','));
          prev = val;
        }
      });
    }
    return lines.join('\n');
  }

  /* ---------------- game ---------------- */
  function syncGame(memberId) {
    const member = getMember(memberId);
    if (!member) return null;
    const cks = db.checkins.filter((c) => c.member_id === memberId);
    const fbs = db.feedbacks.filter((f) => f.member_id === memberId);
    const ass = db.assessments.filter((a) => a.member_id === memberId);
    let xp = cks.length * 40 + fbs.reduce((s, f) => s + Math.min(2, Number(f.completed_sessions) || 0) * 60, 0);
    xp += ass.reduce((s, a) => s + Math.round((a.metrics?.score || 0) * 0.5), 0) + fbs.length * 20;
    const stage = Math.min(TRAIL_STAGES.length - 1, Math.floor(xp / 250));
    const progress = round((xp % 250) / 250 * 100, 1);
    const badges = [];
    if (cks.length) badges.push('首次状态核对');
    if (fbs.length) badges.push('完成一次闭环');
    if (ass.some((a) => (a.metrics?.score || 0) >= 85)) badges.push('动作质量 85+');
    if (fbs.length >= 3) badges.push('连续三轮反馈');
    const risk = latestRisk(memberId);
    const plan = activePlan(memberId);
    const planPaused = !!(plan && (plan.adjustment_type === 'safety_stop' || plan.training.some((s) => (s.intensity || '').includes('暂停'))));
    const paused = !!((risk && ['professional_review', 'suspend'].includes(risk.decision)) || planPaused);
    let pauseReason = '';
    if (paused) {
      if (risk && ['professional_review', 'suspend'].includes(risk.decision)) pauseReason = risk.reasons[0].text;
      else if (plan) pauseReason = plan.change_reason || '计划已暂停，等待专业复核。';
    }
    const game = {
      member_id: memberId, trail: '栖霞山径', stage_index: stage, stage_name: TRAIL_STAGES[stage],
      progress_pct: progress, xp, level: xp < 500 ? '稳健行者' : (xp < 1000 ? '进阶行者' : '山径行者'),
      badges, status: paused ? 'paused' : 'active',
      status_label: paused ? '守护模式（训练暂停）' : '探索中', pause_reason: pauseReason,
      task: paused ? '呼吸练习 + 症状记录' : '完成计划训练并记录感受', updated_at: iso()
    };
    db.game[memberId] = game;
    return game;
  }

  /* ---------------- rehab ---------------- */
  function rehabOf(memberId) {
    if (!db.rehab[memberId]) db.rehab[memberId] = { opinions: [], followups: [] };
    if (!db.rehab[memberId].opinions) db.rehab[memberId].opinions = [];
    if (!db.rehab[memberId].followups) db.rehab[memberId].followups = [];
    return db.rehab[memberId];
  }

  function addOpinion(memberId, payload) {
    const member = getMember(memberId);
    const r = rehabOf(memberId);
    const opinion = {
      id: uid('OP'), member_id: memberId, source: payload.source || '未填写来源',
      role: payload.role || '专业人员', date: payload.date || dateStr(),
      text: payload.text || '', restrictions: payload.restrictions || [],
      next_review: payload.next_review || '', recorded_at: iso()
    };
    if (!opinion.text) throw new Error('专业意见内容不能为空。');
    r.opinions.push(opinion);
    if (opinion.restrictions.length) {
      member.voluntary = member.voluntary || {};
      const list = member.voluntary.activity_restrictions || (member.voluntary.activity_restrictions = []);
      opinion.restrictions.forEach((x) => { if (!list.includes(x)) list.push(x); });
      const med = member.voluntary.medical_advice || (member.voluntary.medical_advice = []);
      med.push({ source: opinion.source, date: opinion.date, text: opinion.text, restrictions: opinion.restrictions });
      member.version = (member.version || 1) + 1;
      member.updated_at = iso();
      (member.history || (member.history = [])).push({ version: member.version, at: member.updated_at, change: '录入专业意见并更新活动限制', fields: ['voluntary'] });
    }
    audit('07 康复与慢病', '录入专业意见：' + opinion.source, memberId);
    save();
    return opinion;
  }

  function addFollowup(memberId, payload) {
    getMember(memberId);
    const r = rehabOf(memberId);
    const item = {
      id: uid('FU'), member_id: memberId, date: payload.date || dateStr(),
      status: payload.status || '进行中', notes: payload.notes || '',
      next_date: payload.next_date || '', recorded_at: iso()
    };
    r.followups.push(item);
    audit('07 康复与慢病', '康复随访：' + item.status, memberId);
    save();
    return item;
  }

  function guardCheck(member, proposed, intent) {
    intent = intent || 'training';
    const text = proposed || '';
    const restrictions = restrictionsOf(member);
    const conflicts = [];
    restrictions.forEach((r) => {
      const keywords = ['屈曲', '负重', '旋转', '冲击', '爆发', '仰卧', '深蹲', '硬拉', '跑', '跳跃'].filter((k) => r.includes(k));
      const hit = keywords.filter((k) => text.includes(k));
      if (hit.length) conflicts.push({ restriction: r, matched: hit });
    });
    if (['diagnosis', 'treatment', 'medication_change'].includes(intent)) {
      return {
        allowed: false, decision: 'refuse', conflicts,
        reason: '本智能体不进行医疗诊断、治疗决策或药物调整；请由具备资质的专业人员处理。',
        professional_priority: true
      };
    }
    if (conflicts.length) {
      return {
        allowed: false, decision: 'professional_review', conflicts,
        reason: '拟议内容与专业限制冲突，专业限制优先于任何计划与互动安排。',
        suggested_alternative: '改为中立位核心稳定、呼吸与低负荷活动；待专业复核后再调整。',
        professional_priority: true
      };
    }
    return {
      allowed: true, decision: 'pass', conflicts: [],
      reason: '未发现与档案活动限制的直接冲突；仍需在训练中监测症状。',
      professional_priority: true
    };
  }

  /* ---------------- booking ---------------- */
  function busySlots(excludeId) {
    const busy = {};
    db.bookings.forEach((b) => {
      if (b.id === excludeId) return;
      if (['confirmed', 'requested', 'rescheduled'].includes(b.status)) {
        const key = b.date + ' ' + b.time;
        (busy[key] = busy[key] || []).push(b);
      }
    });
    return busy;
  }

  function createBooking(memberId, payload) {
    const member = getMember(memberId);
    const plan = activePlan(memberId);
    if (!plan) throw new Error('请先生成训练计划，再创建预约。');
    const date = payload.date || dateStr(addDays(1));
    const time = payload.time || (plan.training[0]?.time || '19:00');
    const idx = Number(payload.session_index) || 0;
    const session = plan.training[idx] || plan.training[0];
    const risk = latestRisk(memberId);
    const busy = busySlots()[date + ' ' + time] || [];
    const used = new Set(busy.map((b) => b.equipment));
    let equipment = payload.equipment || EQUIPMENT.find((e) => !used.has(e));
    if (payload.equipment) equipment = payload.equipment;
    const coach = payload.coach || COACHES[0];
    const status = equipment ? 'confirmed' : 'waitlist';
    const prep = ['训练服与室内鞋', '水杯', '毛巾'];
    const sessionText = (session.title || '') + ' ' + (session.items || []).join(' ');
    if (sessionText.includes('核心床')) prep.push('核心床阻力弹簧（中等）');
    if (sessionText.includes('弹力带')) prep.push('弹力带');
    if (restrictionsOf(member).length) prep.push('腰垫（按专业意见保护）', '康复教练在场确认');
    const booking = {
      id: uid('BK'), member_id: memberId, plan_id: plan.id, plan_version: plan.version,
      session_index: idx, date, time, coach, equipment: equipment || '等待空位',
      status, prep, risk_snapshot: risk ? risk.decision : '未核对',
      created_at: iso(), history: [{ at: iso(), from: null, to: status, note: '创建预约' }]
    };
    db.bookings.push(booking);
    audit('08 预约与服务', '创建预约：' + date + ' ' + time + '（' + status + '）', memberId);
    save();
    return booking;
  }

  function updateBooking(bookingId, payload) {
    const booking = db.bookings.find((b) => b.id === bookingId);
    if (!booking) throw new Error('预约不存在：' + bookingId);
    const allowed = ['requested', 'confirmed', 'rescheduled', 'cancelled', 'completed'];
    if (payload.status && !allowed.includes(payload.status)) throw new Error('非法状态：' + payload.status);
    const old = booking.status;
    let note = payload.note || '';
    if (payload.date || payload.time) {
      booking.date = payload.date || booking.date;
      booking.time = payload.time || booking.time;
      booking.status = payload.status || 'rescheduled';
      note = note || '改约';
    } else if (payload.status) {
      booking.status = payload.status;
    }
    booking.history.push({ at: iso(), from: old, to: booking.status, note });
    if (booking.status === 'completed') {
      db.feedbacks.push({
        id: uid('FB'), member_id: booking.member_id, at: iso(), completed_sessions: 1,
        rpe: payload.rpe, fatigue: payload.fatigue, sleep_hours: payload.sleep_hours,
        pain: payload.pain == null ? 0 : Number(payload.pain), pain_location: '', red_flags: [],
        diet_notes: '', sleep_notes: '', notes: '由预约完成回写：' + booking.id,
        source: '预约完成回写（演示为合成数据）'
      });
      syncGame(booking.member_id);
    }
    audit('08 预约与服务', '预约状态 ' + old + '→' + booking.status + (note ? '：' + note : ''), booking.member_id);
    save();
    return booking;
  }

  /* ---------------- report ---------------- */
  function buildReport(memberId) {
    const member = getMember(memberId);
    const plan = activePlan(memberId);
    const ck = latestCheckin(memberId);
    const game = db.game[memberId] || syncGame(memberId);
    const rehab = rehabOf(memberId);
    return {
      generated_at: iso(),
      member: {
        id: member.id, name: member.display_name, goal: member.goal || [],
        version: member.version, restrictions: member.voluntary?.activity_restrictions || []
      },
      latest_checkin: ck,
      active_plan: plan,
      plan_history: plansFor(memberId).map((p) => ({ id: p.id, version: p.version, status: p.status, created_at: p.created_at, reason: p.change_reason })),
      feedback_count: feedbacksFor(memberId).length,
      assessments: assessmentsFor(memberId).map((a) => ({ id: a.id, exercise: a.exercise, score: a.metrics.score, at: a.analyzed_at })),
      game, rehab,
      bookings: bookingsFor(memberId),
      audit_count: db.audit.filter((a) => a.member_id === memberId).length,
      disclaimer: '本报告基于合成演示数据与会员自报信息，不构成医疗建议；医疗诊断与治疗决策由具备资质的专业人员做出。'
    };
  }

  function memberCompleteness(member) {
    const checks = [
      member.display_name, (member.goal || []).length, member.training_experience,
      member.recent_activity && Object.keys(member.recent_activity).length,
      (member.available_time || []).length, member.voluntary?.diet?.pattern,
      member.voluntary?.sleep?.target_hours, (member.voluntary?.diagnoses || []).length,
      (member.voluntary?.medical_advice || []).length, member.consent?.health_data
    ];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }

  /* ---------------- demo data ---------------- */
  function demoMemberOne() {
    return {
      id: 'M001', display_name: '林知远', synthetic: true, age: 34, sex: 'male',
      membership: '私教年卡 · 普拉提', goal: ['体态改善', '减脂'],
      goal_detail: '久坐办公，希望改善圆肩与骨盆前倾，同时降低体脂；每周可训练 2 次。',
      training_experience: '规律健身 2 年，普拉提初学者；可完成基础自重与器械动作。',
      recent_activity: { weekly_sessions: 2, last_7d: ['周二 核心床 60 分钟', '周六 上肢力量 50 分钟'], notes: '近两周久坐后腰部紧张，未出现放射性疼痛。' },
      available_time: [{ day: '周二', start: '19:00', minutes: 60 }, { day: '周六', start: '10:00', minutes: 60 }],
      preferences: { equipment: ['普拉提核心床', '弹力带'], coach: '周教练', music: '轻音乐' },
      voluntary: {
        diet: { pattern: '均衡饮食，工作日外食为主', allergies: ['虾'], restrictions: ['乳糖不耐'] },
        sleep: { target_hours: 7.5, habit: '通常 00:30 入睡，7:00 起床' },
        diagnoses: [{ code: 'M51.1', label: '腰椎间盘突出（恢复期）', source: '会员自述 + 康复评估报告', date: '2026-09-18', chronic: false }],
        medical_advice: [{
          source: '康复治疗师 王医生', date: '2026-09-18',
          text: '恢复期可进行中立位核心稳定训练；避免脊柱屈曲负重与仰卧起坐；疼痛超过 3/10 停止训练并复诊。',
          restrictions: ['避免脊柱屈曲负重', '避免仰卧起坐', '疼痛>3/10 停止训练']
        }],
        activity_restrictions: ['避免脊柱屈曲负重', '避免仰卧起坐', '疼痛>3/10 停止训练']
      },
      consent: { health_data: true, professional_contact: true, demo_authorized: true },
      created_at: iso(), updated_at: iso(), version: 1,
      history: [{ version: 1, at: iso(), change: '创建会员档案', fields: ['demo'] }]
    };
  }

  function demoMemberTwo() {
    const m = demoMemberOne();
    m.id = 'M002'; m.display_name = '苏晚晴'; m.age = 29; m.sex = 'female';
    m.membership = '团课会员'; m.goal = ['睡眠改善', '压力缓解'];
    m.goal_detail = '咨询行业，入睡困难，希望建立规律运动与睡眠节奏。';
    m.training_experience = '瑜伽 1 年，力量训练新手。';
    m.available_time = [{ day: '周三', start: '20:00', minutes: 50 }];
    m.preferences = { equipment: ['瑜伽垫', '普拉提核心床'], coach: '沈教练' };
    m.voluntary = {
      diet: { pattern: '素食为主', allergies: [], restrictions: [] },
      sleep: { target_hours: 8, habit: '通常 01:00 后入睡' },
      diagnoses: [], medical_advice: [], activity_restrictions: []
    };
    m.recent_activity = { weekly_sessions: 1, last_7d: ['周三 瑜伽 50 分钟'], notes: '近期入睡时间偏晚。' };
    return m;
  }

  function installMembers() {
    [demoMemberOne(), demoMemberTwo()].forEach((m) => { db.members[m.id] = m; });
  }

  function baseDb() {
    const d = emptyDb();
    db = d;
    installMembers();
    currentMemberId = 'M001';
    d.current_member_id = 'M001';
    ['M001', 'M002'].forEach((id) => { syncGame(id); audit('系统', '载入合成演示会员档案', id); });
    save();
    return d;
  }

  function seedDb() {
    baseDb();
    const ckAt = iso(addDays(-3));
    const ck = {
      id: 'CK-SEED1', member_id: 'M001', at: ckAt,
      body_feel: 4, fatigue: 5, sleep_hours: 6.8, sleep_quality: 3,
      pain: 2, pain_location: '腰部', red_flags: [], new_symptom: '',
      training_intent: '核心稳定训练', notes: '久坐后腰部略紧，无放射痛。',
      source: '会员到店自报（演示为合成数据）'
    };
    ck.risk = assessRisk(db.members.M001, ck, []);
    db.checkins.push(ck);
    audit('02 到店核对', '历史到店核对：' + ck.risk.label, 'M001');
    const p1 = buildPlan(db.members.M001, ck, ck.risk);
    p1.created_at = iso(addDays(-3));
    db.plans.push(p1);
    const fb = {
      id: 'FB-SEED1', member_id: 'M001', at: iso(addDays(-2)),
      completed_sessions: 2, rpe: 5, fatigue: 4, sleep_hours: 7.1, pain: 1,
      pain_location: '', red_flags: [], diet_notes: '', sleep_notes: '',
      notes: '两次训练均完成，恢复良好。', source: '会员离店反馈（演示为合成数据）'
    };
    db.feedbacks.push(fb);
    const res = adaptPlan('M001', fb);
    fb.summary = res.summary;
    fb.change_type = res.changeType;
    db.rehab.M001 = {
      opinions: [],
      followups: [{
        id: 'FU-SEED1', member_id: 'M001', date: dateStr(addDays(-6)), status: '稳定',
        notes: '近两周无放射性疼痛，久坐后腰部紧张；维持中立位核心训练。',
        next_date: dateStr(addDays(40)), recorded_at: iso(addDays(-6))
      }]
    };
    const as = analyzeCsv(sampleCsv(), '普拉提核心床·足部序列');
    as.id = 'AS-SEED1'; as.member_id = 'M001'; as.analyzed_at = iso(addDays(-1));
    db.assessments.push(as);
    syncGame('M001');
    const bk = createBooking('M001', { date: dateStr(addDays(2)), time: '10:00', session_index: 0, coach: '周教练' });
    bk.status = 'confirmed';
    bk.history.push({ at: iso(addDays(-1)), from: 'confirmed', to: 'confirmed', note: '教练确认器械与时段' });
    audit('系统', '载入历史闭环记录（合成数据）', 'M001');
    save();
    return db;
  }

  function resetBase() { return baseDb(); }
  function resetSeed() { return seedDb(); }

  /* ---------------- expose ---------------- */
  window.Mochu = {
    KEY, SCHEMA, DEMO_MARK, TRAIL_STAGES, RISK_LABEL, RISK_ORDER, EQUIPMENT, COACHES,
    get db() { return db; },
    get currentMemberId() { return currentMemberId; },
    setMember, save, load,
    getMember, memberList, plansFor, activePlan, latestCheckin, latestRisk,
    feedbacksFor, assessmentsFor, bookingsFor, rehabOf,
    assessRisk, addCheckin, buildPlan, generatePlan, addFeedback, adaptPlan, summarizeFeedback,
    analyzeCsv, addAssessment, sampleCsv, syncGame,
    guardCheck, addOpinion, addFollowup,
    createBooking, updateBooking,
    buildReport, memberCompleteness, audit,
    resetBase, resetSeed,
    utils: { iso, dateStr, addDays, nextWeekday, fmt, dayName, esc, uid, clone, round, clamp }
  };

  load();
})();
