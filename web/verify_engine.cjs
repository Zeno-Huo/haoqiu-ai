// 好球Ai · 引擎逻辑验证（诊断回归测试）
// 覆盖：称号判定 / 并列第一 / 亮点选择 / 全0 / 极值 / 单球员 / 评分推导 / 位置分布 / 确定性
const esbuild = require('esbuild');
const path = require('path');

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log('  ✓ ' + label);
  } else {
    failures++;
    console.log('  ✗ FAIL ' + label);
  }
}

function mkStats(o) {
  return Object.assign({
    touches: 0, touchesSuccess: 0, turnovers: 0, dispossessed: 0,
    passes: 0, passesSuccess: 0, shots: 0, shotsOnTarget: 0,
    dribbles: 0, interceptions: 0, tackles: 0,
  }, o || {});
}

function mkPlayer(id, position) {
  return { id, name: 'P' + id, number: String(id), position };
}

function mkAnalysis(playerId, stats) {
  return { id: 'pa_' + playerId, matchId: 'm', playerId, score: 0, stats, insights: [], events: [] };
}

esbuild.build({
  entryPoints: [path.resolve('src/lib/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: '/tmp/engine_bundle.cjs',
  loader: { '.ts': 'ts' },
}).then(() => {
  const engine = require('/tmp/engine_bundle.cjs');
  const { analyzeMatch, assignTitlesAndHighlights, scoreFromStats } = engine;

  console.log('=== 1. 评分推导（1-10，1 位小数，clamp） ===');
  const zero = mkStats();
  assert(scoreFromStats(zero) === 6, '全 0 → 6.0 分（基准分）');
  const mid = mkStats({ touchesSuccess: 3, passesSuccess: 4, shotsOnTarget: 1, dribbles: 1, turnovers: 2 });
  assert(scoreFromStats(mid) === 7.3, '中间样本 → 7.3 分（6 + 0.6 + 1.0 + 0.5 + 0.4 - 1.2）');
  const high = mkStats({ touchesSuccess: 20, passesSuccess: 20, shotsOnTarget: 10 });
  assert(scoreFromStats(high) === 10, '极高分 → clamp 到 10.0');
  const low = mkStats({ turnovers: 20 });
  assert(scoreFromStats(low) === 3, '极低分 → clamp 到 3.0');
  const dispossessed = mkStats({ dispossessed: 1 });
  assert(scoreFromStats(dispossessed) === 5.5, '被断 1 次独立扣分，不并入其他失误');

  console.log('\n=== 2. 称号判定（全队某指标第一） ===');
  let players = [mkPlayer('A', '前锋'), mkPlayer('B', '前锋'), mkPlayer('C', '中场')];
  let analyses = [
    mkAnalysis('A', mkStats({ shots: 5, dribbles: 1, touches: 3, passes: 2, passesSuccess: 1, turnovers: 1 })),
    mkAnalysis('B', mkStats({ shots: 2, dribbles: 4, touches: 4, passes: 3, passesSuccess: 2 })),
    mkAnalysis('C', mkStats({ shots: 1, touches: 6, passes: 8, passesSuccess: 7, interceptions: 1, turnovers: 2 })),
  ];
  assignTitlesAndHighlights(analyses, players);
  assert(analyses[0].title === '射手', 'A 射门 5 全队第一 → 射手');
  assert(analyses[1].title === '突破王', 'B 突破 4 全队第一 → 突破王');
  assert(analyses[2].title === '传球大师', 'C 传球成功 7 全队第一（多项第一取最突出）→ 传球大师');
  assert(analyses.some((a) => a.title === '抢断王') === false, '抢断全 0 → 无人获抢断王');

  console.log('\n=== 3. 并列第一处理（共享称号） ===');
  players = [mkPlayer('D', '后卫'), mkPlayer('E', '后卫')];
  analyses = [
    mkAnalysis('D', mkStats({ tackles: 4, interceptions: 2 })),
    mkAnalysis('E', mkStats({ tackles: 4, interceptions: 1 })),
  ];
  assignTitlesAndHighlights(analyses, players);
  assert(analyses[0].title === '抢断王', 'D 抢断并列第一 → 抢断王');
  assert(analyses[1].title === '抢断王', 'E 抢断并列第一 → 抢断王（并列共享称号）');
  assert(analyses[0].title === analyses[1].title, '两人称号相同（并列共享）');

  console.log('\n=== 4. 亮点选择（位置重点指标里最突出者） ===');
  players = [mkPlayer('F', '前锋'), mkPlayer('G', '中场'), mkPlayer('H', '后卫')];
  analyses = [
    mkAnalysis('F', mkStats({ shots: 2, dribbles: 5, touches: 1 })),
    mkAnalysis('G', mkStats({ passes: 9, touches: 4 })),
    mkAnalysis('H', mkStats({ interceptions: 2, tackles: 6 })),
  ];
  assignTitlesAndHighlights(analyses, players);
  assert(analyses[0].highlight.key === 'dribbles' && analyses[0].highlight.value === 5, '前锋取突破 5（射门 2 / 突破 5 中更突出）');
  assert(analyses[1].highlight.key === 'passes' && analyses[1].highlight.value === 9, '中场取传球 9（传球 9 / 拿球 4 中更突出）');
  assert(analyses[2].highlight.key === 'tackles' && analyses[2].highlight.value === 6, '后卫取抢断 6（拦截 2 / 抢断 6 中更突出）');

  console.log('\n=== 5. 边界：数据全 0 不报错 ===');
  players = [mkPlayer('Z', '中场')];
  analyses = [mkAnalysis('Z', mkStats())];
  assignTitlesAndHighlights(analyses, players);
  assert(analyses[0].title === undefined, '全 0 → 无称号');
  assert(analyses[0].highlight.key === 'passes' && analyses[0].highlight.value === 0, '全 0 → 亮点退化为传球 0，不报错');

  console.log('\n=== 6. 边界：单球员 ===');
  players = [mkPlayer('S', '前锋')];
  analyses = [mkAnalysis('S', mkStats({ shots: 3, dribbles: 2, touches: 1, passes: 1, passesSuccess: 1 }))];
  assignTitlesAndHighlights(analyses, players);
  assert(analyses[0].title === '射手', '单球员多项第一 → 取最突出（射手 3）');
  assert(analyses[0].highlight.label === '射门', '单球员亮点 = 射门');

  console.log('\n=== 7. 边界：极值不报错 ===');
  players = [mkPlayer('X', '前锋'), mkPlayer('Y', '后卫')];
  analyses = [
    mkAnalysis('X', mkStats({ shots: 999, dribbles: 0 })),
    mkAnalysis('Y', mkStats({ tackles: 1, interceptions: 0 })),
  ];
  assignTitlesAndHighlights(analyses, players);
  assert(analyses[0].title === '射手' && analyses[0].highlight.value === 999, '极值 999 正常出称号/亮点');
  assert(analyses[1].title === '抢断王', '极值对照球员正常出称号');

  console.log('\n=== 8. 完整比赛：评分范围 / 确定性 / 数据一致性 / 位置分布 ===');
  const match = {
    id: 'm_test', name: '测试赛', date: '2026-08-22', type: '7v7', duration: 1200,
    teamName: '夜鹰队',
    players: [
      { id: 'p1', name: '张三', number: '9', position: '前锋' },
      { id: 'p2', name: '李四', number: '10', position: '前锋' },
      { id: 'p3', name: '王五', number: '7', position: '中场' },
      { id: 'p4', name: '赵六', number: '8', position: '中场' },
      { id: 'p5', name: '钱七', number: '5', position: '后卫' },
      { id: 'p6', name: '孙八', number: '3', position: '后卫' },
    ],
    createdAt: Date.now(),
  };
  const statKeys = ['touches', 'touchesSuccess', 'turnovers', 'dispossessed', 'passes', 'passesSuccess', 'shots', 'shotsOnTarget', 'dribbles', 'interceptions', 'tackles'];
  const r1 = analyzeMatch(match);
  const r2 = analyzeMatch(match);
  let ok = true;
  for (const a of r1) {
    if (a.score < 3 || a.score > 10) ok = false;
    if (Math.round(a.score * 10) !== a.score * 10) ok = false;
    for (const k of statKeys) if (typeof a.stats[k] !== 'number' || a.stats[k] < 0) ok = false;
    if (a.stats.touchesSuccess > a.stats.touches) ok = false;
    if (a.stats.passesSuccess > a.stats.passes) ok = false;
    if (a.stats.shotsOnTarget > a.stats.shots) ok = false;
    for (const e of a.events) {
      if (e.time < 0 || e.time > match.duration) ok = false;
      if (typeof e.type !== 'string' || typeof e.outcome !== 'string' || typeof e.note !== 'string') ok = false;
    }
    if (a.stats.dispossessed !== a.events.filter((e) => e.type === '被断').length) ok = false;
    if (!a.highlight || typeof a.highlight.value !== 'number') ok = false;
  }
  assert(ok, '评分 [3,10] 一位小数、统计非负且子项≤总量、被断独立统计、事件元数据完整且时间在时长内');
  assert(JSON.stringify(r1) === JSON.stringify(r2), '两次 analyzeMatch 结果一致（确定性）');

  const fwd = r1.filter((a) => match.players.find((p) => p.id === a.playerId).position === '前锋');
  const back = r1.filter((a) => match.players.find((p) => p.id === a.playerId).position === '后卫');
  const fwdAttack = fwd.reduce((s, a) => s + a.stats.shots + a.stats.dribbles, 0);
  const fwdDefense = fwd.reduce((s, a) => s + a.stats.interceptions + a.stats.tackles, 0);
  const backDefense = back.reduce((s, a) => s + a.stats.interceptions + a.stats.tackles, 0);
  const backAttack = back.reduce((s, a) => s + a.stats.shots + a.stats.dribbles, 0);
  assert(fwdDefense === 0, '前锋事件池不含拦截/抢断（防守数据为 0）');
  assert(backAttack === 0, '后卫事件池不含射门/突破（进攻数据为 0）');
  console.log(`    [位置分布] 前锋进攻=${fwdAttack} 防守=${fwdDefense}；后卫防守=${backDefense} 进攻=${backAttack}`);
  assert(fwdAttack > 0 && backDefense > 0, '前锋有进攻数据、后卫有防守数据');
  const titles = r1.map((a) => a.title).filter(Boolean);
  console.log('    [称号清单] ' + (titles.length ? titles.join('、') : '(无)'));
  assert(titles.length >= 1, '整场比赛至少产生一个称号');

  console.log('\n=== 总体: ' + (failures === 0 ? 'ALL OK ✅' : failures + ' FAIL ❌') + ' ===');
  process.exit(failures === 0 ? 0 : 1);
}).catch((e) => { console.error('BUILD ERR', e); process.exit(2); });
