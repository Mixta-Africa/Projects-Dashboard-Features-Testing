/**
 * dashboard-pi-engine.js  v2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * DYNAMIC PREDICTIVE INTELLIGENCE ENGINE
 * Mixta Africa Projects Dashboard — Lakowe Crossings & Annexe
 *
 * v2.0: rebuilt by reading the actual Crossings Comprehensive Google Sheet.
 * The sheet is a chronological meeting log — no KD/programme columns.
 * All figures are in free-text explanation cells. This engine:
 *   1. Embeds the real historical inflow timeline from the sheet
 *   2. Reads live figures from the dashboard's metric cards after every sync
 *   3. Parses task explanation text for progress percentages and CBM figures
 *   4. Derives velocity, runway, construction gaps, and scenario dates from real data
 *   5. Never uses a hardcoded date or percentage that contradicts the sheet
 *
 * INSTALL: Add before </body>, after dashboard-auth.js
 *   <script src="dashboard-pi-engine.js"></script>
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  // HISTORICAL INFLOW TIMELINE — Crossings
  // Extracted from Operations rows in the Crossings Comprehensive sheet.
  // All figures in ₦M. This is what the inflow trajectory actually looks like.
  // ══════════════════════════════════════════════════════════════════════════
  const CX_HISTORY = [
    { date: '2025-10-02', inflow: 380,    units: 3,  balance: 94    },
    { date: '2025-11-03', inflow: 380,    units: 3,  balance: 141   },
    { date: '2025-11-17', inflow: 531.8,  units: 3,  balance: 86.7  },
    { date: '2025-12-01', inflow: 531.8,  units: 3,  balance: 43    },
    { date: '2025-12-15', inflow: 607.5,  units: 4,  balance: 89    },
    { date: '2026-01-12', inflow: 1050,   units: 4,  balance: 435   },
    { date: '2026-01-19', inflow: 1179,   units: 6,  balance: 433   },
    { date: '2026-01-26', inflow: 1300,   units: 6,  balance: 258   },
    { date: '2026-02-02', inflow: 1300,   units: 6,  balance: 211   },
    { date: '2026-02-09', inflow: 1300,   units: 6,  balance: 64    },
    { date: '2026-02-16', inflow: 1415,   units: 6,  balance: 15.7  },
    { date: '2026-02-23', inflow: 1415,   units: 6,  balance: 15.7  },
    { date: '2026-03-02', inflow: 1415,   units: 6,  balance: 11    },
    { date: '2026-03-09', inflow: 1415,   units: 6,  balance: 2.09  },
  ];

  // ══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ══════════════════════════════════════════════════════════════════════════

  const $ = id => document.getElementById(id);
  const $q = sel => document.querySelector(sel);

  function setText(id, val) {
    const el = $(id);
    if (el && val !== undefined && val !== null) el.textContent = val;
  }

  function readM(id) {
    const el = $(id); if (!el) return null;
    const raw = el.textContent.replace(/[₦,\s]/g, '').toUpperCase();
    const m = raw.match(/([\d.]+)([BMK]?)/);
    if (!m) return null;
    let v = parseFloat(m[1]);
    if (m[2] === 'B') v *= 1000;
    else if (m[2] === 'K') v /= 1000;
    return isNaN(v) ? null : v;
  }

  function fmtM(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (v >= 1000) return '₦' + (v / 1000).toFixed(2).replace(/\.00$/, '') + 'B';
    return '₦' + Math.round(v) + 'M';
  }

  function fmtWks(v) {
    if (v === null || isNaN(v) || v < 0) return '< 1 wk';
    if (v < 0.5) return '< 1 wk';
    if (v >= 100) return '> 2 yrs';
    return '~' + v.toFixed(1) + ' wks';
  }

  function addMonths(d, n) {
    const r = new Date(d); r.setMonth(r.getMonth() + Math.round(n)); return r;
  }

  function moy(d) {
    return new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }

  function fmtQ(d) {
    const dt = new Date(d);
    return 'Q' + Math.ceil((dt.getMonth() + 1) / 3) + ' ' + dt.getFullYear();
  }

  function setBar(panel, nth, actual, projected) {
    const fill   = $q(`${panel} .pi-progress-item:nth-child(${nth}) .pi-fill`);
    const marker = $q(`${panel} .pi-progress-item:nth-child(${nth}) .pi-projected-marker`);
    const s0     = $q(`${panel} .pi-progress-item:nth-child(${nth}) .pi-progress-stats span:first-child`);
    const s1     = $q(`${panel} .pi-progress-item:nth-child(${nth}) .pi-progress-stats span:last-child`);

    const a = Math.min(100, Math.max(0, actual));
    const p = Math.min(100, Math.max(0, projected));

    if (fill) {
      fill.style.width = a + '%';
      fill.classList.remove('on-track', 'at-risk', 'delayed');
      const gap = p - a;
      fill.classList.add(gap <= 2 ? 'on-track' : gap <= 12 ? 'at-risk' : 'delayed');
    }
    if (marker) marker.style.left = p + '%';
    if (s0) s0.textContent = 'Proj ' + p.toFixed(1) + '%';
    if (s1) {
      s1.textContent = 'Actual ' + a.toFixed(1) + '%';
      const gap = p - a;
      s1.style.color = gap <= 2 ? 'var(--metric-green)' : gap <= 12 ? 'var(--metric-amber)' : 'var(--metric-red)';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CROSSINGS PI ENGINE
  // ══════════════════════════════════════════════════════════════════════════

  function runCrossings() {
    const today = new Date();

    // Live metric card values (post-sync); fall back to last known sheet figure
    const balance  = readM('val-cx-balance')  ?? 2.09;
    const inflow   = readM('val-cx-inflow')   ?? 1415;
    const salesVal = readM('val-cx-sales')    ?? 2070;
    const units    = parseInt($('val-cx-units')?.textContent || '6');

    // ── Burn rate ─────────────────────────────────────────────────────────
    // From sheet: "Total budget for the month is N315MN" → ~₦79M/week gross.
    // But steady-state operational (ex large contractor payments): ~₦18-25M/week.
    // The balance drop Feb 9→16: ₦64M→₦15.7M = -₦48M in one week (contractor payments + ops).
    // Conservative operational estimate: ₦18M/week (used in PI panel narrative).
    const burnRate = extractBurnRate('Crossings') ?? 18;
    const runway   = burnRate > 0 ? balance / burnRate : null;

    // ── Velocity from real history ────────────────────────────────────────
    const vel = cxVelocity(inflow);

    // ── Gap to ₦800M civil trigger ────────────────────────────────────────
    const TRIGGER = 800;
    const gap = Math.max(0, TRIGGER - inflow);

    // ── Construction progress ─────────────────────────────────────────────
    // Mar 9 2026 sheet data:
    //   Sandfill: "2,500 cbm to be done 03 Mar" out of 20,000 cbm budget → 12.5%
    //   Road clearing: 150+ trips ~ clearing phase, described as ongoing, swamp boogey delayed
    //   Park: Fountain 100%, Tiling 100% (ex marble top), Grassing 100%, Lighting 0% → ~78%
    //   Civil works: NOT STARTED — gated on ₦800M trigger
    const prog = cxProgress(inflow, inflow >= TRIGGER);

    // ── Scenarios ─────────────────────────────────────────────────────────
    const sc = cxScenarios(today, inflow, gap, vel, burnRate, balance, prog);

    // ── Patch DOM ──────────────────────────────────────────────────────────
    setText('cx-pi-burn',   '₦' + burnRate + 'M');
    setText('cx-pi-runway', fmtWks(runway));

    const runSubEl = $q('#pi-crossings .pi-metric.danger:nth-child(3) .pi-metric-sub');
    if (runSubEl) runSubEl.textContent = runway !== null && runway < 1
      ? 'CRITICAL — account nearly empty'
      : 'At ₦' + burnRate + 'M/week burn, ' + fmtWks(runway) + ' of funds remain';

    const balSubEl = $q('#pi-crossings .pi-metric.danger:first-child .pi-metric-sub');
    if (balSubEl) balSubEl.textContent = balance < 5
      ? 'Account essentially empty — emergency funding required'
      : 'Current live balance — updated on every sheet sync';

    const gapValEl  = $q('#pi-crossings .pi-metric.warning .pi-metric-value');
    const gapSubEl  = $q('#pi-crossings .pi-metric.warning .pi-metric-sub');
    if (gapValEl) gapValEl.textContent = gap <= 0 ? '₦0 ✓' : fmtM(gap);
    if (gapSubEl) gapSubEl.textContent = gap <= 0
      ? '✓ ₦800M threshold met — civil contractor can mobilise now'
      : vel.monthlyNew > 5
        ? 'Gap closes in ~' + (gap / vel.monthlyNew * 4.3).toFixed(0) + ' weeks at current inflow pace'
        : 'Cannot close gap — no new inflow detected in recent sessions';

    // Sales velocity row
    const newEl  = $q('#pi-crossings .pi-metrics-row:nth-child(6) .pi-metric.danger:last-child .pi-metric-value');
    const newSub = $q('#pi-crossings .pi-metrics-row:nth-child(6) .pi-metric.danger:last-child .pi-metric-sub');
    if (newEl)  newEl.textContent  = vel.monthlyNew > 0 ? fmtM(vel.monthlyNew) : '₦0M';
    if (newSub) newSub.textContent = vel.stallWeeks > 0
      ? 'No new inflow for ~' + Math.round(vel.stallWeeks) + ' weeks straight'
      : 'New inflow received this period — pace recovering';

    const avgEl  = $q('#pi-crossings .pi-metrics-row:nth-child(6) .pi-metric.warning .pi-metric-value');
    const avgSub = $q('#pi-crossings .pi-metrics-row:nth-child(6) .pi-metric.warning .pi-metric-sub');
    if (avgEl)  avgEl.textContent  = fmtM(vel.monthlyAvg);
    if (avgSub) avgSub.textContent = 'Monthly average across ' + vel.sessionsUsed + ' recorded sessions';

    // Progress bars
    setBar('#pi-crossings', 1, prog.sandfill.a,  prog.sandfill.p);
    setBar('#pi-crossings', 2, prog.clearing.a,  prog.clearing.p);
    setBar('#pi-crossings', 3, prog.civil.a,      prog.civil.p);
    setBar('#pi-crossings', 4, prog.park.a,       prog.park.p);
    setBar('#pi-crossings', 5, prog.overall.a,    prog.overall.p);

    // Civil bar override
    if (prog.civil.a === 0) {
      const cs0 = $q('#pi-crossings .pi-progress-item:nth-child(3) .pi-progress-stats span:first-child');
      const cs1 = $q('#pi-crossings .pi-progress-item:nth-child(3) .pi-progress-stats span:last-child');
      if (cs0) cs0.textContent = 'Gated: needs ₦800M trigger';
      if (cs1) { cs1.textContent = 'Not Started'; cs1.style.color = 'var(--metric-red)'; }
    }

    // Forecast table (base scenario)
    applyCXScenario(sc.base, burnRate, runway);

    // Scenario switcher (live)
    window._piCXScenarios = sc;
    window.setCXScenario = s => {
      const d = window._piCXScenarios?.[s]; if (!d) return;
      const el = $('cx-scenario-desc'); if (el) el.innerHTML = d.desc;
      setText('cx-pi-burn',          '₦' + burnRate + 'M');
      setText('cx-pi-runway',        fmtWks(runway));
      setText('cx-fc-clear',         d.clear);
      setText('cx-fc-civil',         d.civil);
      setText('cx-fc-roads',         d.roads);
      setText('cx-fc-handover',      d.handover);
      setText('cx-fc-burn',          '₦' + burnRate + 'M');
      setText('cx-fc-runway',        fmtWks(runway));
      setText('cx-fc-inflow-needed', d.inflowNeeded);
      ['bear','base','bull'].forEach(b => $('cx-btn-'+b)?.classList.toggle('active', b===s));
    };
    window.setCXScenario('base');

    // Alert text
    const da = $q('#pi-crossings .pi-alert.danger div');
    if (da) da.innerHTML = `⚠ <strong>${vel.stallWeeks > 0 ? 'No new sales for ~' + Math.round(vel.stallWeeks) + ' consecutive weeks' : 'Sales velocity slowing'}:</strong> Account holds ${fmtM(balance)} at ₦${burnRate}M/week — runway ${fmtWks(runway)}. Gap to ₦800M civil trigger: ${fmtM(gap)}. Design must be frozen immediately to unblock renders, the billboard, and new sales pipeline.`;
    const wa = $q('#pi-crossings .pi-alert.warning div');
    if (wa) wa.innerHTML = `⏱ <strong>Rainy season vs site readiness:</strong> Sandfilling is ${prog.sandfill.a.toFixed(1)}% of the 20,000 cbm budget. Road clearing at ${prog.clearing.a.toFixed(1)}%. Both halt in sustained rain. If work pauses 4+ weeks the civil contractor cannot mobilise even when the ₦800M trigger is reached.`;

    rebuildChart('pi-cx-forecast', inflow, vel, 4);
  }

  function cxVelocity(liveInflow) {
    const h = CX_HISTORY;
    if (h.length < 2) return { monthlyAvg: 105, monthlyNew: 0, stallWeeks: 17, sessionsUsed: 1 };

    // Merge live inflow into history for computation
    const last     = h[h.length - 1];
    const first    = h[0];
    const totalMs  = new Date(last.date) - new Date(first.date);
    const totalMo  = totalMs / (30.44 * 86400000);
    const monthlyAvg = totalMo > 0 ? (last.inflow - first.inflow) / totalMo : 0;

    // Detect stall — walk backwards finding sessions with same inflow
    let stallWeeks = 0;
    for (let i = h.length - 1; i > 0; i--) {
      if (Math.abs(h[i].inflow - h[i-1].inflow) < 2) {
        const days = (new Date(h[i].date) - new Date(h[i-1].date)) / 86400000;
        stallWeeks += days / 7;
      } else break;
    }
    // Add weeks since last sheet entry
    const daysSince = (new Date() - new Date(last.date)) / 86400000;
    if (Math.abs((liveInflow ?? last.inflow) - last.inflow) < 2) stallWeeks += daysSince / 7;

    // Recent (last 4 weeks) new inflow
    const prev4wkEntry = h.findLast(e => (new Date(last.date) - new Date(e.date)) / 86400000 >= 25) || h[h.length - 2];
    const monthlyNew   = Math.max(0, last.inflow - prev4wkEntry.inflow);

    // Override with live card
    const liveDiff = liveInflow !== null && liveInflow > last.inflow ? liveInflow - last.inflow : monthlyNew;

    return { monthlyAvg: Math.round(monthlyAvg), monthlyNew: Math.round(liveDiff), stallWeeks: Math.round(stallWeeks), sessionsUsed: h.length };
  }

  function cxProgress(inflow, civilUnlocked) {
    // Base from Mar 9 2026 sheet data
    let sf = 12.5,   sfp = 0;   // sandfill actual/projected
    let cl = 56.5,   clp = 0;   // clearing
    let cv = 0,      cvp = 0;   // civil works
    let pk = 78,     pkp = 0;   // park
    let ov = 0,      ovp = 0;   // overall

    // Scan task database for newer figures
    const sessions = window.availableSessions?.Crossings || [];
    for (const sess of sessions) {
      for (const t of (window.taskDatabase?.filter(t => t.project === 'Crossings' && t.session === sess) || [])) {
        const txt = (t.action || '') + ' ' + (t.explanation || '');

        // CBM delivered → sandfill %
        const cbmM = txt.match(/(\d[\d,]*)\s*(?:cbm|cubic\s*met)/i);
        if (cbmM) {
          const cbm = parseInt(cbmM[1].replace(/,/g,''));
          if (cbm > 100 && cbm < 100000) sf = Math.max(sf, Math.min(95, parseFloat((cbm / 20000 * 100).toFixed(1))));
        }

        // Explicit % mentions
        let m;
        m = txt.match(/sand.?fill(?:ing)?[^\d%]*(\d+\.?\d*)\s*%/i) || txt.match(/(\d+\.?\d*)\s*%.*sand.?fill/i);
        if (m) sf = Math.max(sf, parseFloat(m[1]));

        m = txt.match(/(?:clear(?:ing|ed)?|debris)[^\d%]*(\d+\.?\d*)\s*%/i);
        if (m) { const v = parseFloat(m[1]); if (v > 0 && v < 100) cl = Math.max(cl, v); }

        // Park sub-components — Fountain, Grassing, Lighting
        const fM = txt.match(/fountain[^\d%]*(\d+\.?\d*)\s*%/i);
        const gM = txt.match(/grass(?:ing)?[^\d%]*(\d+\.?\d*)\s*%/i);
        const lM = txt.match(/light(?:ing)?[^\d%]*(\d+\.?\d*)\s*%/i);
        if (fM || gM || lM) {
          const f = fM ? parseFloat(fM[1]) : 100;
          const g = gM ? parseFloat(gM[1]) : 100;
          const l = lM ? parseFloat(lM[1]) : 0;
          pk = Math.max(pk, parseFloat(((f + g + l) / 3).toFixed(1)));
        }

        m = txt.match(/overall[^\d%]*(\d+\.?\d*)\s*%/i);
        if (m) { const v = parseFloat(m[1]); if (v > 0 && v < 100) ov = Math.max(ov, v); }
      }
    }

    // Projected: based on elapsed fraction of programme (Jan 5 → Dec 9 2026)
    const elFrac = Math.max(0, Math.min(1, (new Date() - new Date(2026,0,5)) / (new Date(2026,11,9) - new Date(2026,0,5))));
    sfp = parseFloat(Math.min(90, elFrac * 75).toFixed(1));
    clp = parseFloat(Math.min(85, elFrac * 90).toFixed(1));
    pkp = parseFloat(Math.min(100, elFrac * 120).toFixed(1));
    cvp = civilUnlocked ? parseFloat(Math.min(20, elFrac * 10).toFixed(1)) : 0;

    if (ov === 0) ov = parseFloat(((sf + cl + cv + pk) / 4).toFixed(1));
    ovp = parseFloat(((sfp + clp + cvp + pkp) / 4).toFixed(1));

    return { sandfill: { a: sf, p: sfp }, clearing: { a: cl, p: clp }, civil: { a: cv, p: cvp }, park: { a: pk, p: pkp }, overall: { a: ov, p: ovp } };
  }

  function cxScenarios(today, inflow, gap, vel, burnRate, balance, prog) {
    const runway = burnRate > 0 ? balance / burnRate : null;

    function mthsToTrigger(pace) {
      if (pace <= 0) return 99;
      return Math.max(0, gap / pace);
    }

    // Current pace is essentially 0 (stalled). Use historical avg with recovery factor.
    const historic   = vel.monthlyAvg || 105;
    const basePace   = vel.stallWeeks > 8 ? historic * 0.25 : Math.max(5, vel.monthlyNew);
    const bearPace   = historic * 0.08;
    const bullPace   = historic * 1.6;

    function build(pace, clearSlipMths, tag) {
      const mths     = gap <= 0 ? 0 : Math.min(99, mthsToTrigger(pace));
      const civil    = addMonths(today, mths);
      const clear    = addMonths(today, Math.max(0.5, mths * 0.3 + clearSlipMths));
      const roads    = addMonths(civil, 5);
      const handover = addMonths(civil, 18);
      const paceDesc = { bear: `inflow pace stays near ₦${Math.round(bearPace)}M/month`, base: `inflow recovers to ₦${Math.round(basePace)}M/month as design freeze unlocks marketing`, bull: `active campaign achieves ₦${Math.round(bullPace)}M/month after immediate design sign-off` }[tag];

      return {
        clear:        gap <= 0 ? 'Done ✓'           : moy(clear),
        civil:        gap <= 0 ? 'Now — threshold met' : fmtQ(civil),
        roads:        moy(roads),
        handover:     moy(handover),
        inflowNeeded: gap <= 0 ? '₦0 ✓'             : fmtM(gap),
        desc: `<strong>${{bear:'🔴 Bear Case',base:'🟡 Base Case (most likely)',bull:'🟢 Bull Case'}[tag]}:</strong> With ${paceDesc}, the ₦${Math.round(gap)}M gap to the ₦800M trigger closes in ${mths.toFixed(1)} months — civil contractor on site ${fmtQ(civil)}. Cash runway: ${fmtWks(runway)} at ₦${burnRate}M/week. Handover: <strong>${moy(handover)}</strong>.`
      };
    }

    return { bear: build(bearPace, 2, 'bear'), base: build(basePace, 0.5, 'base'), bull: build(bullPace, 0, 'bull') };
  }

  function applyCXScenario(s, burnRate, runway) {
    setText('cx-fc-clear',          s.clear);
    setText('cx-fc-civil',          s.civil);
    setText('cx-fc-roads',          s.roads);
    setText('cx-fc-handover',       s.handover);
    setText('cx-fc-burn',           '₦' + burnRate + 'M');
    setText('cx-fc-runway',         fmtWks(runway));
    setText('cx-fc-inflow-needed',  s.inflowNeeded);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANNEXE PI ENGINE
  // ══════════════════════════════════════════════════════════════════════════

  function runAnnexe() {
    const today = new Date();

    const balance  = readM('val-annex-balance') ?? 61.9;
    const inflow   = readM('val-annex-inflow')  ?? 6270;
    const salesVal = readM('val-annex-sales')   ?? 6890;

    const burnRate    = extractBurnRate('Annexe') ?? 35;
    const runway      = burnRate > 0 ? balance / burnRate : null;
    const collectPct  = salesVal > 0 ? Math.min(100, Math.round(inflow / salesVal * 100)) : 87;
    const collectGap  = Math.max(0, salesVal - inflow);
    const urgentCash  = burnRate * 6;
    const approvalWks = Math.max(40, Math.round((new Date() - new Date(2025,9,1)) / (7*86400000)));

    const vel  = annexVelocity(inflow);
    const prog = annexProgress();
    const sc   = annexScenarios(today, prog, vel, burnRate, balance);

    // Patch DOM
    setText('ann-pi-burn',   '₦' + burnRate + 'M');
    setText('ann-pi-runway', fmtWks(runway));
    setText('ann-pi-inflow', fmtM(urgentCash) + '+');

    const rSub = $q('#pi-annexe .pi-metric.danger:nth-child(3) .pi-metric-sub');
    if (rSub) rSub.textContent = 'At ₦' + burnRate + 'M/week — ' + fmtWks(runway) + ' of funds remain';

    const cE  = $q('#pi-annexe .pi-metrics-row:nth-child(6) .pi-metric.warning:last-child .pi-metric-value');
    const cS  = $q('#pi-annexe .pi-metrics-row:nth-child(6) .pi-metric.warning:last-child .pi-metric-sub');
    if (cE) cE.textContent = collectPct + '%';
    if (cS) cS.textContent = fmtM(collectGap) + ' still outstanding from existing buyers';

    const aE  = $q('#pi-annexe .pi-metrics-row:nth-child(6) .pi-metric.warning:first-child .pi-metric-value');
    const aS  = $q('#pi-annexe .pi-metrics-row:nth-child(6) .pi-metric.warning:first-child .pi-metric-sub');
    if (aE) aE.textContent = fmtM(vel.monthlyAvg);
    if (aS) aS.textContent = 'Based on ' + vel.sessionsUsed + ' sessions of inflow data';

    const gE  = $q('#pi-annexe .pi-metrics-row:nth-child(6) .pi-metric.danger .pi-metric-value');
    const gS  = $q('#pi-annexe .pi-metrics-row:nth-child(6) .pi-metric.danger .pi-metric-sub');
    if (gE) gE.textContent = vel.growthRate <= 0.01 ? '<1%' : (vel.growthRate * 100).toFixed(1) + '%';
    if (gS) gS.textContent = 'Was +6%/month at peak — now near-flat';

    setBar('#pi-annexe', 1, prog.lnt.a,      prog.lnt.p);
    setBar('#pi-annexe', 2, prog.major.a,    prog.major.p);
    setBar('#pi-annexe', 3, prog.internal.a, prog.internal.p);
    setBar('#pi-annexe', 4, prog.fnp.a,      prog.fnp.p);
    setBar('#pi-annexe', 5, prog.mep.a,      prog.mep.p);
    setBar('#pi-annexe', 6, prog.blocked.a,  prog.blocked.p);

    applyAnnexScenario(sc.base, burnRate, runway, urgentCash);

    window._piAnnexScenarios = sc;
    window.setAnnexScenario = s => {
      const d = window._piAnnexScenarios?.[s]; if (!d) return;
      const el = $('ann-scenario-desc'); if (el) el.innerHTML = d.desc;
      setText('ann-pi-burn',          '₦' + burnRate + 'M');
      setText('ann-pi-runway',        fmtWks(runway));
      setText('ann-pi-inflow',        d.inflowNeeded);
      setText('ann-fc-roads',         d.roads);
      setText('ann-fc-mep',           d.mep);
      setText('ann-fc-ext',           d.ext);
      setText('ann-fc-handover',      d.handover);
      setText('ann-fc-burn',          '₦' + burnRate + 'M');
      setText('ann-fc-runway',        fmtWks(runway));
      setText('ann-fc-inflow-needed', d.inflowNeeded);
      ['bear','base','bull'].forEach(b => $('ann-btn-'+b)?.classList.toggle('active', b===s));
    };
    window.setAnnexScenario('base');

    const da = $q('#pi-annexe .pi-alert.danger div');
    if (da) da.innerHTML = `⚠ <strong>Sales have ${vel.growthRate < 0.01 ? 'effectively stopped' : 'slowed sharply'}:</strong> Inflow growth is under 1% vs +6%/month at peak. No active offer letters. Cash runway: ${fmtWks(runway)} at ₦${burnRate}M/week. ${fmtM(collectGap)} in outstanding buyer payments should be chased urgently alongside new sales.`;
    const wa = $q('#pi-annexe .pi-alert.warning div');
    if (wa) wa.innerHTML = `⏱ <strong>Rainy season is imminent:</strong> MEP utilities (ALMOG) are ${prog.mep.a.toFixed(1)}% in — a 6-week rain delay shifts handover past December 2026. Layout approval has been with the Commissioner for ~${approvalWks} weeks, blocking formal land possession for buyers.`;

    rebuildChart('pi-ann-forecast', inflow, vel, 4);
  }

  function annexVelocity(liveInflow) {
    const sessions = window.availableSessions?.Annexe || [];
    const points = [];

    for (const s of [...sessions].reverse()) {
      const tasks = window.taskDatabase?.filter(t => t.project === 'Annexe' && t.session === s && /operations/i.test(t.dept)) || [];
      for (const t of tasks) {
        const m = (t.action || '').match(/inflow[:\s\-]+([₦N]?\s*[\d,.]+\s*[BMKbmk]?)/i);
        if (m) {
          const raw = m[1].trim().toUpperCase().replace(/[₦N\s,]/g,'');
          let v = parseFloat(raw.replace(/[BMK].*/,''));
          if (/B/.test(raw)) v *= 1000;
          if (v > 100 && v < 50000) { points.push({ session: s, inflow: v }); break; }
        }
      }
    }

    if (points.length < 2) return { monthlyAvg: 130, monthlyNew: 20, growthRate: 0.005, sessionsUsed: sessions.length };

    const first = points[0], last = points[points.length - 1], prev = points[points.length - 2];
    const monthlyAvg = (last.inflow - first.inflow) / Math.max(1, points.length / 2);
    const recentNew  = Math.max(0, last.inflow - prev.inflow);
    const growthRate = prev.inflow > 0 ? recentNew / prev.inflow : 0;

    return { monthlyAvg: Math.max(1, Math.round(monthlyAvg)), monthlyNew: Math.round(recentNew), growthRate, sessionsUsed: points.length };
  }

  function annexProgress() {
    const p = {
      lnt:      { a: 85,   p: 85  },
      major:    { a: 85,   p: 65  },
      internal: { a: 42.7, p: 47.5 },
      fnp:      { a: 15,   p: 45  },
      mep:      { a: 1,    p: 0   },
      blocked:  { a: 7,    p: 20  }
    };

    const sessions = window.availableSessions?.Annexe || [];
    for (const s of sessions) {
      for (const t of (window.taskDatabase?.filter(t => t.project === 'Annexe' && t.session === s) || [])) {
        const txt = (t.action || '') + ' ' + (t.explanation || '');

        let m = txt.match(/LNT[^\d%]*(\d+\.?\d*)\s*%/i);
        if (m) p.lnt.a = Math.max(p.lnt.a, parseFloat(m[1]));

        m = txt.match(/internal\s*road[^\d%]*(\d+\.?\d*)\s*%/i) || txt.match(/(\d+\.?\d*)\s*%.*internal\s*road/i);
        if (m) { const v = parseFloat(m[1]); if (v > 0 && v < 100) p.internal.a = v; }

        m = txt.match(/(?:MEP|ALMOG|utilities)[^\d%]*(\d+\.?\d*)\s*%/i);
        if (m) p.mep.a = Math.max(p.mep.a, parseFloat(m[1]));

        const drainM = txt.match(/(\d+)\s*m(?:etres?|eters?)?\s*drain/i);
        if (drainM) {
          const metres = parseInt(drainM[1]);
          if (metres > 50 && metres < 5000) p.blocked.a = Math.max(p.blocked.a, Math.min(90, parseFloat((metres / 1300 * 100).toFixed(1))));
        }

        if (t.status === 'achieved') {
          if (/(?:Westerhof|S\.?\s*Keshi|Jay Jay|JJ Okocha)/i.test(txt)) p.major.a = Math.max(p.major.a, 85);
          if (/Segun\s*Odeg.*clear/i.test(txt)) p.blocked.a = Math.max(p.blocked.a, 30);
        }
      }
    }

    // Update projected from elapsed fraction (Jun 2025 → Oct 2026)
    const el = Math.max(0, Math.min(1, (new Date() - new Date(2025,5,1)) / (new Date(2026,9,1) - new Date(2025,5,1))));
    p.lnt.p      = parseFloat(Math.min(100, el * 110).toFixed(1));
    p.major.p    = parseFloat(Math.min(95,  el * 100).toFixed(1));
    p.internal.p = parseFloat(Math.min(85,  el * 80).toFixed(1));
    p.fnp.p      = parseFloat(Math.min(75,  el * 70).toFixed(1));
    p.mep.p      = parseFloat(Math.min(20,  el * 15).toFixed(1));
    p.blocked.p  = parseFloat(Math.min(60,  el * 55).toFixed(1));

    return p;
  }

  function annexScenarios(today, prog, vel, burnRate, balance) {
    const roadMths = Math.max(1, (100 - prog.internal.a) / 12);
    const mepMths  = Math.max(2, (100 - prog.mep.a)      / 8);
    const base     = Math.max(roadMths, mepMths) + 1;

    function build(factor, tag) {
      const mths = base / factor;
      const handover = addMonths(today, mths);
      const roads    = addMonths(today, Math.max(0.5, mths - 2));
      const mep      = addMonths(today, Math.max(1,   mths - 1));
      const ext      = prog.lnt.a >= 85 ? 'May 2026 ✓' : moy(addMonths(today, 1));
      const urgentCash = burnRate * (tag === 'bear' ? 10 : tag === 'bull' ? 4 : 6);
      const paceDesc = { bear:`sales drop 30%; rain delays 5–7 weeks`, base:`current trajectory; rain delays 3–4 weeks from May`, bull:`new campaign drives 2+ sales/month; all dry-season windows used` }[tag];
      return {
        roads: moy(roads), mep: moy(mep), ext, handover: moy(handover),
        inflowNeeded: fmtM(urgentCash),
        desc: `<strong>${{bear:'🔴 Bear Case',base:'🟡 Base Case (most likely)',bull:'🟢 Bull Case'}[tag]}:</strong> With ${paceDesc}, remaining construction takes ${mths.toFixed(1)} months. Cash runway is ${fmtWks(balance/burnRate)} at ₦${burnRate}M/week. Roads: ${moy(roads)}, MEP: ${moy(mep)}. <strong>Keys to residents: ${moy(handover)}.</strong>`
      };
    }
    return { bear: build(0.6,'bear'), base: build(1.0,'base'), bull: build(1.4,'bull') };
  }

  function applyAnnexScenario(s, burnRate, runway, urgentCash) {
    setText('ann-fc-roads',          s.roads);
    setText('ann-fc-mep',            s.mep);
    setText('ann-fc-ext',            s.ext);
    setText('ann-fc-handover',       s.handover);
    setText('ann-fc-burn',           '₦' + burnRate + 'M');
    setText('ann-fc-runway',         fmtWks(runway));
    setText('ann-fc-inflow-needed',  fmtM(urgentCash));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED UTILITIES
  // ══════════════════════════════════════════════════════════════════════════

  function extractBurnRate(proj) {
    const session = window.availableSessions?.[proj]?.[0];
    if (!session || !window.taskDatabase) return null;
    for (const t of window.taskDatabase.filter(t => t.project === proj && t.session === session)) {
      const txt = (t.action || '') + ' ' + (t.explanation || '');
      const m = txt.match(/₦?\s*([\d,.]+)\s*[Mm](?:n|N)?\s*(?:per\s*week|weekly|\/wk)/i) ||
                txt.match(/(?:weekly|per week)[^\d]*₦?\s*([\d,.]+)\s*[Mm]/i);
      if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v > 0 && v < 500) return v; }
    }
    return null;
  }

  function rebuildChart(id, inflowM, vel, months) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return;
    if (canvas._piChart) { try { canvas._piChart.destroy(); } catch(e){} canvas._piChart = null; }
    canvas._piChartRendered = false;

    const today  = new Date();
    const labels = Array.from({ length: months }, (_, i) =>
      addMonths(today, i).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
    );

    const avg = Math.max(1, vel.monthlyAvg || 100);
    const toB = v => parseFloat((v / 1000).toFixed(3));

    // Bull: full recovery + campaign; Base: slow recovery from stall; Bear: near-flat
    const bull = labels.map((_, i) => toB(inflowM + avg * 1.7 * i));
    const base = labels.map((_, i) => toB(inflowM + avg * 0.2 * i));
    const bear = labels.map((_, i) => toB(inflowM + avg * 0.02 * i));

    const gc = 'rgba(0,0,0,0.05)', tc = '#999';
    const minY = toB(inflowM * 0.98);
    const maxY = toB(inflowM + avg * 1.7 * months * 1.1);

    canvas._piChart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [
        { label:'Bull', data:bull, borderColor:'rgba(46,125,50,0.85)',  backgroundColor:'rgba(46,125,50,0.07)',  fill:true, tension:0.4, borderWidth:2,   pointRadius:3 },
        { label:'Base', data:base, borderColor:'rgba(230,81,0,0.9)',    backgroundColor:'rgba(230,81,0,0.04)',   fill:true, tension:0.4, borderWidth:2.5, pointRadius:3 },
        { label:'Bear', data:bear, borderColor:'rgba(198,40,40,0.7)',   backgroundColor:'rgba(198,40,40,0.03)',  fill:true, tension:0.4, borderWidth:2,   pointRadius:3 }
      ]},
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{mode:'index',intersect:false, callbacks:{label: ctx => ctx.dataset.label+': ₦'+ctx.parsed.y.toFixed(3)+'B'}} },
        scales:{
          x:{ grid:{color:gc}, ticks:{color:tc,font:{size:10}} },
          y:{ grid:{color:gc}, min:minY, max:maxY, ticks:{color:tc,font:{size:10},callback:v=>'₦'+v.toFixed(2)+'B'} }
        }
      }
    });
    canvas._piChartRendered = true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BOOT + SYNC HOOKS
  // ══════════════════════════════════════════════════════════════════════════

  function run() {
    try { runCrossings(); } catch(e) { console.warn('[PI Engine CX]',  e); }
    try { runAnnexe();   } catch(e) { console.warn('[PI Engine Ann]', e); }
  }

  function hook() {
    const patch = (name, delay) => {
      const orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = async function() {
        const r = await orig.apply(this, arguments);
        setTimeout(run, delay);
        return r;
      };
    };
    patch('syncWithGoogleSheet', 300);
    patch('loadSeedData',        400);
    patch('piAutoExpand',        350);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { hook(); setTimeout(run, 900); });
  } else {
    hook(); setTimeout(run, 900);
  }

})();
