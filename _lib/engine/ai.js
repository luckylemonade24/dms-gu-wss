/* ============================================================
 * AI 对手  ai.js —— 四档难度（新手 novice / 业余 amateur / 专业 pro / 冠军 champion）
 * 通过 Engine.tryAction({... , _ai:true}) 行动；由 UI 以定时器驱动 step()。
 *  - novice  ：新手，最弱档（机械出牌；解场卡不按场面择机）
 *  - amateur ：业余（战术出牌阶梯；**不读牌**——只凭公开信息与经验判断；无明牌记忆/牌库推测，战斗阶段无卡库知识）
 *  - pro     ：专业（业余全部行为 + 读取约 65% 手牌 + 明牌记忆与牌库推测 + 全卡库知识 + 斩杀前瞻）
 *  - champion：冠军（专业全部行为 + 读取 90% 手牌 + 希望式抽卡 + 起手保底，见 aiHopePick / aiHandRig）
 *
 * 规则前提（读自 engine.js，AI 必须遵守）：
 *  - 对手场上有任意怪物（含"无法被攻击"者）时，禁止越怪打脸（引擎硬性 fail）。
 *  - 攻击怪物不触发反击：击杀敌方怪几乎没有代价，属"纯移除"。
 * ========================================================== */
import { CARDS } from './cards.js';
import { Rules } from './rules.js';
import { CARD_PLAY } from './card_play.js';

export function createAI(engine) {
  // 用 Proxy 转发：IIFE 内部所有 Engine.xxx 自动落到当前房间的引擎实例
  const Engine = new Proxy({}, {
    get(_t, k) {
      if (k === 'state') return engine.state;
      const v = engine[k];
      return typeof v === 'function' ? v.bind(engine) : v;
    }
  });

  const AI = (function () {
  'use strict';

  var diff = 'novice';  // novice | amateur | pro | champion

  /* ---------------- 可调参数（供无头对局扫参） ---------------- */
  var TUNE = {
    peekPro: 0.65,       // 专业档读牌比例
    peekAmateur: 0,      // 业余档读牌比例：0 = 不读牌（不偷看玩家手牌，只按公开信息出牌）
    peekChampion: 0.9,   // 冠军档读牌比例（90%）
    fuelMin: 6,          // 弃置收益门槛（知识库 fuelMin 未指定时的默认值）
    reserveMin: 3,       // 为收益弃牌时要求的"低费材料储备"
    chestCostMax: 14,    // 黄金宝箱可接受的最高弃牌代价（超过就这回合不开）
    chainScore: 0.5,     // 虚空锁链移动的收益阈值（越高越保守）
    mirrorMin: 4,        // 镜像卷轴：复制目标的"兑现价值"下限。旧实现是固定门槛 12（≈ 只有 atk≥6、
                         //   或 atk4+装备、或 DM-200/300 才配吃）→ 1/1 的怨灵永远用不上，场上只有弱怪时
                         //   卷轴还会一直烂在手里。现值 4 ≈ "复制体能打出 2 点以上"，或"1/1 但无法被攻击"
                         //   （v = 实际输出×2 + 武器 4 + 防具 3 + 无法被攻击 4）
    mirrorAvgMul: 1.5,   // 镜像卷轴：相对分——复制目标的价值 ≥ 我场平均值 × 该倍数（＝它确实是我方主力）时也算划算
    hpLowRatio: 0.25,    // 残血判定：<=该比例的最优作祭品
    jackalMinHand: 3,    // 豺狼巡查：手牌 <= 该值时不发动技能（保留手牌）
    jackalGainMul: 1.5,  // 豺狼巡查：收益须 > 代价 × 该倍数才发动
    preciousCost: 12,    // 手牌"珍贵"判定：最优弃牌代价 >= 该值视为珍贵 → 不发动可选技能
    healRatio: 0.35,     // 治疗类道具：按"单只怪掉血占其最大生命比例"触发（不用绝对阈值）
    hpTriggerMul: 1.6,   // 场上存在"靠掉血再次发动"的怪（黏咕/苍蝇群）时，治疗阈值放大倍数
    icePotionFloor: 0.8, // 冰霜药水：对手"下回合铺场意愿"打分 >= 该值/ez 才用（原 1.5 过保守，
                         // 玩家手牌少/满场时永远达不到 → 药水长期捏在手里）。效果作用于"对手下回合"，时机不敏感
    planL6: 1,           // L6 多回合计划性开关（1=开：两回合斩杀铺垫；0=关，用于 A/B 验证）
    planSeq: 1,          // L7 伤害排程开关（1=开：清场优先/省攻击次数留给打脸）
    planArch: 1,         // L7 流派针对 + 自我主线开关（1=开；0=关，用于 A/B 验证）
    enumAtk: 2,          // L8 攻击序列枚举：0=关（纯贪心）；1=替换贪心；2=辅助干预（默认）
                         // 实测（40 套 × 150 局 × 双向，双方专业档，各 12000 局）：
                         //   升级前：1 vs 0 = 47.79%（替换净亏 2.2）、2 vs 0 = 49.78（打平）
                         //   升级后：1 vs 0 = 48.53%（仍亏 1.5）、2 vs 0 = 50.16%（辅助转正）、2 vs 1 = 51.33%
                         // 升级内容（照引擎 doAttack/postAttackProps 逐条建模）：
                         //   ① 连杀全流程 DFS：击杀后给"蕾零安洁 a-95-2"追加出手；水道螃蟹EX a-011-2 按期望 +1 次
                         //   ② 攻击附加效果计入伤害：澪 a-100-2 +7、白化小鼠 a-044-2 +2、长矛 a-093-2 非对位追加、
                         //      碧灰双刃 a-99-2 概率追加取期望、盗贼B 脱隐 +3、疯狂强盗夺装备 +3、打脸附加
                         //   ③ targetPenalty 的"可否击杀"口径与贪心对齐（旧代码写死 true）
                         // 结论：辅助模式已略微超过纯贪心（+0.16，噪声内），逐套波动收窄到 48~52%；替换模式仍劣于贪心
                         //   （贪心还懂 preferEquipped / 斩杀模式 / 清场排程等未建模知识）→ 保持"贪心为主、枚举辅助"。
    enumAtkMin: 3,       // 辅助模式门槛：枚举计划需比"以贪心动作为起手的最优计划"高出该值才介入（0/3 同效，1 更差）
    holdThrowLethal: 1,  // 投掷物：判定"下回合可斩杀"时是否留手到斩杀回合（1=留手；条件已修正，见 lethalSoon）
    holdThrowClear: 0,   // 投掷物：手上投掷物总伤≥对方场面总血时是否攥着不用。
                         // 实测（4 套投掷卡组 × 400 局配对）：攥着会让专业档净亏 2.8 个点、投掷使用量 3.18→3.96 次/局，
                         // 且是"专业档在投掷流派反而输给新手档"的主因 → 默认关闭（0=照常削血）。
    holdBomb: 0,         // 炸弹：是否"攒到场面不利且能覆盖≥2只"才埋。
                         // 实测（4 套投掷卡组 × 400 局配对）：攒炸弹净亏 2.9 个点（逐套 1.8/1.3/3.5/5.0），对照卡组 ±0.0
                         // → 默认关闭（0=按普通投掷物照常埋，用 bestBombTarget 选怪堆）。
    holdSummon: 0,       // 专家档：A/S 怪是否"等择时窗口 / 等联动条件"才献祭召唤。
                         // 实测（双向各半、同种子配对，双方专业档）：关掉它 → 炸弹爆破 +13.8、极影潜行 +8.3、
                         // 姬莲投掷 +4.3、典藏集结 +5.5 个点，而占优组（不死复活/苍蝇之海/重装铁壁）无影响。
                         // 与"不能为了刻意收益最大化而放弃当前场面的控制权"的既定原则一致 → 默认关闭（0=能出就出）。
    throwKillFirst: 1,   // 投掷物目标：是否"能直接补刀就优先补刀"（1=补刀优先，0=保留旧的"先蹭A级防进化"）
    /* ---- 学院考核专用（engine 用 noHpFloor 标记：血量无下限、打满回合后按"累计输出"判分） ----
     * 关键差异：① 打脸伤害 ×playerDmgMult（学院 = 2）② 打怪也计输出（溢出不浪费）
     *          ③ 血量归零不判负 → 防守的意义只剩"阻止对手拿输出"
     * 全部开关只在学院战斗（state.noHpFloor）里生效，普通跑图行为不变。 */
    acadMode: 1,         // 学院考核决策总开关（0=关，用于 A/B 对照）
    acadThrow: 1,        // 投掷物：改用"伤害最高"的那张（学院里伤害=得分，不为斩杀留手）
    acadHeal: 1,         // 治疗玩家生命：只要掉过血就用（治疗按 1:1 抵消对手输出）
    acadCredit: 1,       // 攻击目标：按"能计入输出的伤害"选目标（少打高减伤/高护盾/免伤目标）
    acadEndgame: 1,      // 最后一轮：任何"留手"都是纯亏（伤害即得分）→ 全部立刻打出
    acadSacCompare: 1,   // 献祭召唤：先比较"新怪强度 vs 被献祭素材强度"（学院里 3★ 的 C/B 常强过 1★ 的 A，
                         // 强度不如素材就不升级；只在学院战斗生效，普通对局星级恒为 1★ 不受影响）
    acadStarSummon: 1,   // 召唤择优：一律按"星级后的实战数值"比较（2★ ×2、3★ ×3）→ 高星怪优先出场。
                         // 不改这条的话，排序只看 1★ 基础数值，会系统性把辛苦合出来的 2★/3★ 压在后面
                         // （学院里星级是核心成长线）。非学院星级恒为 1★，行为完全不变。
    /* ---- 召唤循环保护 ---- */
    bouncePenalty: 20,   // 「回合结束回手」的窗口卡（喷毒花 a-048-2）被回手后：本次召唤降权，
                         // 避免"只召它 → 我方空场 → 吃 +5 窗口 → 回合结束回手 → 又只召它"的死循环
    expertPick: 1,       // C/B 召唤是否用"按卡功能"的知识库选牌（0=退回按攻血排序）
    expertSac: 1,        // 献祭召唤时是否按知识库"择优牺牲"（0=退回按场上顺序）
    expertDiscard: 1,    // 法杖弃牌代价是否用知识库评估（0=退回场面/手牌粗评）
    prepEnum: 1,         // L9 准备阶段"出牌顺序"枚举（辅助，默认开）：0=关（走原阶梯）；1=开
                         // 实测（全 40 套、双向各半、1.6~2 万局配对）：开启后该侧胜率 +0.95 个点（约 2.4σ，介入率 3.3%），
                         // 仅改顺序、不改"能做什么"，且提升不足会自动退回阶梯 → 作为常态辅助开启。
    prepEnumMin: 1,      // 顺序枚举的干预门槛：比阶梯第一手的收益高出该值才改顺序（0 介入时该侧为 49.88%≈基线）
    prepEnumMode: 0,     // 只启用某类顺序收益（A/B 用）：0=全部；1=仅"先抽牌再召唤"；2=仅"伤害先于投掷"
    /* ---- 冠军档（champion）专用：希望式抽卡 + 起手保底 ---- */
    hopeMin: 0.4,        // 希望抽卡触发率下限（牌库满时 40%）
    hopeMax: 0.7,        // 希望抽卡触发率上限（牌库见底时 70%）：概率随牌库缩小线性增大
    hopeDrawBias: 4,     // 牌库还厚（>= hopeDrawDeckN）时，给"过牌卡"的额外希望权重
    hopeDrawDeckN: 10,   // "牌库还厚"的判定阈值
    hopeA: 0.6,          // 起手"A 卡保底"基准概率（实际 = hopeA × A卡占比/0.15，封顶 1）
    hopeDraw: 0.7        // 起手"过牌卡保底"概率
  };
  function setTuning(o) { if (o) for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) TUNE[k] = o[k]; }
  function peekRatio() {
    if (diff === 'champion') return TUNE.peekChampion;
    return diff === 'pro' ? TUNE.peekPro : TUNE.peekAmateur;
  }

  /* ============================================================
   * 情报系统（专业档）：明牌记忆 + 牌库/弃牌堆推测
   *   · 明牌：靠"可见效果"进入对手手牌的卡（衍生 / 回手），用 iid 追踪，
   *     不占用 peek 读牌额度，直到该牌被打出为止。
   *   · 推测：读取对手牌库（多重集、不含顺序）与弃牌堆，
   *     推断还有多少大规模解场 / 是否高概率升 A·S / 资源是否枯竭。
   * ========================================================== */
  var MEM = { base: null, maxIid: 0, revealed: {}, resolved: {}, turnTag: '', lastState: null };
  // 非怪物卡的威胁标签（clear=大规模解场/群伤，removal=单体解场，upgrade=升级资源，heal=治疗，draw=过牌，disrupt=干扰）
  var CARD_INTEL = {
    'a-068-2': { clear: 3, label: '解离法杖(穿透群伤)' },
    'a-088-2': { clear: 2, label: '盛怒卷轴(全场伤害)' },
    'a-086-2': { clear: 2, label: '炸弹(十字6)' },
    'a-089-2': { clear: 1.5, label: '毒气陷阱' },
    'a-054-2': { clear: 1.5, label: '魔化藤(毒气)' },
    'a-082-2': { clear: 1.5, label: '新生火元素(每回合群体-1)' },
    'a-081-2': { clear: 1, label: '腐烂之心(毒气放大)' },
    'a-012-2': { clear: 1, label: '黏咕(群体10伤)' },
    'a-021-2': { removal: 1, label: '魔弹法杖' },
    'a-091-2': { removal: 1, label: '冲击波法杖' },
    'a-067-2': { disrupt: 1, label: '焰浪法杖(弃手牌)' },
    'a-015-2': { removal: 0.6, label: '飞刀' },
    'a-016-2': { removal: 0.8, label: '苦无' },
    'a-061-2': { removal: 1, label: '飞斧' },
    'a-029-2': { upgrade: 2, label: '升级卷轴' },
    'a-033-2': { upgrade: 1.5, label: '破损纹章' },
    'a-019-2': { heal: 1, label: '治疗药水' },
    'a-059-2': { heal: 1, label: '肉馅饼' },
    'a-018-2': { heal: 0.7, label: '露珠' },
    'a-084-2': { heal: 0.7, label: '炖肉' },
    'a-013-2': { draw: 1, label: '神秘宝箱' },
    'a-014-2': { draw: 1, label: '黄金宝箱' },
    'a-060-2': { draw: 1, label: '补给箱' },
    'a-085-2': { draw: 1, label: '遗骸' },
    'a-023-2': { draw: 1, label: '财富戒指' },
    'a-041-2': { draw: 1, label: '女猎B(每回合抽1)' },
    'a-058-2': { draw: 1.5, label: '鼠王(每回合过牌)' },
    'a-030-2': { draw: 0.5, label: '传送卷轴' },
    'a-063-2': { disrupt: 1, label: '催眠卷轴' },
    'a-062-2': { disrupt: 0.6, label: '冰霜药水' }
  };
  // 一名玩家所有区域的卡实例（用于 iid 基线 / 新对局识别）
  function instsOf(p) {
    var out = [];
    p.hand.forEach(function (c) { out.push(c); });
    p.discard.forEach(function (c) { out.push(c); });
    p.deck.forEach(function (c) { out.push(c); });
    p.board.forEach(function (m) {
      if (!m) return;
      out.push(m);
      if (m.weapon) out.push(m.weapon);
      if (m.armor) out.push(m.armor);
    });
    if (p.wand) out.push(p.wand);
    return out;
  }
  // 每回合同步一次：识别新对局、登记新出现的"明牌"、清理已被打出的明牌
  function memSync(s) {
    // ① 先识别新对局——必须在 tag 早退之前判断，否则两局起手 tag 相同（都是 B|PREP|1）会沿用旧记忆。
    //    主判据：newGame 会替换 Engine.state（对象引用变化）；辅判据：iid 计数归零。
    var maxIid = 0;
    ['A', 'B'].forEach(function (k) {
      instsOf(s.players[k]).forEach(function (c) { if (c.iid > maxIid) maxIid = c.iid; });
    });
    if (MEM.lastState !== s || maxIid < MEM.maxIid) {
      MEM.base = null; MEM.revealed = {}; MEM.resolved = {}; MEM.turnTag = '';
      MEM.lastState = s;
    }
    MEM.maxIid = maxIid;
    var t = tag();
    if (MEM.turnTag === t) return;
    MEM.turnTag = t;
    if (!MEM.base) {                                   // 开局基线：此刻所有可见卡都不算"明牌"（含对手起始手牌）
      MEM.base = {};
      ['A', 'B'].forEach(function (k) {
        instsOf(s.players[k]).forEach(function (c) { MEM.base[c.iid] = 1; });
      });
    }
    var A = s.players.A;
    // ① 新 iid 出现在对手手牌 → 明牌（衍生 / 回手等可见来源）
    A.hand.forEach(function (c) {
      if (MEM.base[c.iid] || MEM.revealed[c.iid]) return;
      MEM.revealed[c.iid] = { cardId: c.cardId, turn: s.round, label: (CARDS[c.cardId] || {}).name || c.cardId };
    });
    // ② 明牌离开对手手牌 → 已被打出：移出记忆，并记录去向（进弃牌堆/上场/装入法杖栏）
    Object.keys(MEM.revealed).forEach(function (k) {
      var id = +k, how = 'used';
      if (A.hand.some(function (c) { return c.iid === id; })) return;
      if (A.discard.some(function (c) { return c.iid === id; })) how = 'discarded';
      else if (A.board.some(function (m) {
        return m && (m.iid === id || (m.weapon && m.weapon.iid === id) || (m.armor && m.armor.iid === id));
      })) how = 'onBoard';
      else if (A.wand && A.wand.iid === id) how = 'wand';
      MEM.resolved[id] = { cardId: MEM.revealed[k].cardId, how: how, turn: s.round };
      delete MEM.revealed[k];
    });
  }
  // 对手手牌里"我们确切知道"的明牌（按 cardId 计数）
  function revealedIds() {
    var out = {};
    Object.keys(MEM.revealed).forEach(function (k) {
      var id = MEM.revealed[k].cardId;
      out[id] = (out[id] || 0) + 1;
    });
    return out;
  }
  // 非专业档使用的"空情报"（结构一致，值全为 0，避免调用点判空）
  var NEUTRAL_INTEL = {
    deckCount: 0, deckBig: [], bigLeft: 0, mats: 0, clearThreat: 0, removalThreat: 0,
    healThreat: 0, drawLeft: 0, upgradeRisk: 0, windowOpen: false, foesPlan: null
  };

  /* ---------------- 流派识别（专业档） ----------------
   * 从"牌库 + 弃牌堆 + 场上 (+已知手牌)"把一套牌归类到战术流派：
   *   poison 毒气/腐烂体系 | throw 投掷点杀 | evolve 进化 A·S | spawn 衍生工厂 | equip 装备流
   * 用途：① 针对对手流派调整"击杀优先级 / 保命意愿" ② 确认自己本局主线（决定祭品与资源分配）
   */
  // 毒气体系的"持续收益型"发动机（魔化藤/克里弗斯之果/腐烂之心）——优先拆掉
  // 注意：腐烂触手(a-080-2)不列入——它是"死了才生效"的卡，击杀它等于替对手触发（已由 killPenalty 5 处理）
  var POISON_ENGINES = { 'a-054-2': 1, 'a-055-2': 1, 'a-081-2': 1 };
  var SPAWN_ENGINES = { 'a-058-2': 1, 'a-078-2': 1, 'a-079-2': 1, 'a-007-2': 1 };    // 鼠王/招魂法师/死灵法师/苍蝇群
  function planOf(cards) {
    var p = { poison: 0, throw: 0, evolve: 0, spawn: 0, equip: 0 };
    cards.forEach(function (c) {
      var cd = CARDS[c.cardId]; if (!cd) return;
      if (cd.type === 'throw' || c.cardId === 'a-090-2') p.throw += 1;               // 投掷物 + 神射戒指
      if (cd.type === 'weapon' || cd.type === 'armor' || c.cardId === 'a-043-2') p.equip += 1;
      if (cd.type === 'monster') {
        if ((cd.tags || []).indexOf('🫒') >= 0) p.poison += 1;
        if (SPAWN_ENGINES[c.cardId]) p.spawn += 2;                                    // 衍生发动机权重加倍
        if (cd.tier === 'A' || cd.tier === 'S') p.evolve += 1;
      }
      if (c.cardId === 'a-029-2' || c.cardId === 'a-033-2') p.evolve += 2;            // 升级卷轴 / 破损纹章
    });
    var main = null, best = 0;
    for (var k in p) { if (p[k] > best) { best = p[k]; main = k; } }
    p.main = main; p.mainW = best;
    return p;
  }
  // 我方主线（每回合算一次；供献祭/资源分配使用）
  var SELF = { tag: '', plan: null };
  function selfPlan(B) {
    var t = tag();
    if (SELF.tag === t && SELF.plan) return SELF.plan;
    SELF.tag = t;
    SELF.plan = planOf(B.deck.concat(B.discard, B.board.filter(Boolean), B.hand));
    return SELF.plan;
  }
  // 牌库（不含顺序）+ 弃牌堆 → 推测对手战术（knownArr：读牌已知的对手手牌）
  function buildIntel(s, knownArr) {
    var bigInKnown = (knownArr || []).some(function (c) {
      var cd = CARDS[c.cardId]; return cd && cd.type === 'monster' && (cd.tier === 'A' || cd.tier === 'S');
    });
    var A = s.players.A;
    var sums = { clear: 0, removal: 0, upgrade: 0, heal: 0, draw: 0, disrupt: 0 };
    var bigLeft = 0, deckBig = [];
    A.deck.forEach(function (c) {
      var t = CARD_INTEL[c.cardId], cd = CARDS[c.cardId];
      if (t) for (var k in t) if (k !== 'label' && sums[k] !== undefined) sums[k] += t[k];
      if (cd && cd.type === 'monster' && (cd.tier === 'A' || cd.tier === 'S')) { bigLeft++; deckBig.push(cd.name); }
    });
    var held = { clear: 0, removal: 0, heal: 0 };
    var rid = revealedIds();
    Object.keys(rid).forEach(function (id) {
      var t = CARD_INTEL[id]; if (!t) return;
      if (t.clear) held.clear += t.clear * rid[id];
      if (t.removal) held.removal += t.removal * rid[id];
      if (t.heal) held.heal += t.heal * rid[id];
    });
    var mats = alive('A').filter(function (m) { return m.tier === 'C' || m.tier === 'B'; }).length;
    var bigOnBoard = alive('A').some(function (m) { return m.tier === 'A' || m.tier === 'S'; });
    return {
      deckCount: A.deck.length,
      deckBig: deckBig,
      mats: mats,                                              // L6a：对手场上还有几只"低费献祭材料"
      bigLeft: bigLeft,                                        // 对手牌库里还剩多少 A/S 怪
      clearThreat: sums.clear + held.clear,                    // 还有多少"大规模解场/群伤"
      removalThreat: sums.removal + held.removal,              // 还有多少单体解场
      healThreat: sums.heal + held.heal,                       // 还有多少治疗
      drawLeft: sums.draw,                                     // 对手后续过牌能力
      // 高概率升 A/S：牌库还有 A/S（即将抽到）或手上已知有 A/S，且场上有材料/已有高级怪
      upgradeRisk: ((bigLeft > 0 || !!bigInKnown) && (mats >= 1 || bigOnBoard)) ? 1 : 0,
      // 对手流派识别（专业档）：牌库+弃牌堆+场上+已知手牌
      foesPlan: planOf(A.deck.concat(A.discard, A.board.filter(Boolean), knownArr || [])),
      windowOpen: (sums.clear + held.clear + sums.removal + held.removal) <= 0 && A.deck.length <= 8   // 对手资源枯竭
    };
  }

  var skip = {};        // 本阶段内无法使用的卡（iid）
  var skipMon = {};     // 本阶段内无法攻击的怪物（uid）
  var skipWand = false; // 本阶段法杖发动失败标记
  var skipChain = false;// 本阶段虚空锁链移动失败标记
  var turnTag = '';
  var skipState = null; // 上一次决策对应的引擎状态对象（换局时也要重置"本回合跳过"标记）
  var peekTag = '';     // 业余/专业档：本回合已读取手牌对应的回合标记
  var peekCache = null; // 业余/专业档：本回合读取到的手牌情报

  // 等级权重：高等级怪更值得优先处理（可能成长/特效更强）
  var TIER_W = { C: 0, B: 3, A: 6, S: 10 };

  /* ---------------- 公共 helper ---------------- */
  function C(inst) { return CARDS[inst.cardId]; }
  function alive(key) { return Engine.aliveMonsters(key); }
  function empty(key) { return Engine.emptySlots(key); }
  // 使用引擎的种子随机源：同种子下 AI 行为也可复现
  function pick(a) { return a.length ? a[Math.floor(Engine.rand() * a.length)] : null; }
  function slotOf(key, uid) { return Engine.slotOf(key, uid); }
  function setDifficulty(d) { diff = d; }
  function getDifficulty() { return diff; }
  function tag() { var s = Engine.state; return s.active + '|' + s.phase + '|' + s.round; }
  function usable(c) { return !skip[c.iid]; }
  /* 法杖栏为空时该放哪张：**优先【老法杖】**。
   * 旧实现按手牌顺序取第一张法杖 → 只要别的法杖先摸到，老法杖就永远躺在手里，
   * 而它必须先在法杖栏里才能"灌注"手牌中另一张法杖（engine 的 a-036-2 分支）
   * → 玩家看到的就是"AI 拿着老法杖却从不灌注"。
   * 另外老法杖自带"每回合施法次数 +1"，优先放它本身也不亏。
   * 手里没有别的法杖可灌注时仍按原顺序取第一张。 */
  function pickWandToPlace(hand) {
    var wands = hand.filter(function (c) { return C(c).type === 'wand'; });
    if (!wands.length) return null;
    var old = null, other = null;
    for (var i = 0; i < wands.length; i++) {
      if (wands[i].cardId === 'a-036-2') { if (!old) old = wands[i]; }
      else if (!other) other = wands[i];
    }
    return (old && other) ? old : wands[0];
  }
  // 学院考核模式：引擎在学院战斗里置 state.noHpFloor（血量无下限、按累计输出判分）
  function acad() { return !!(TUNE.acadMode && Engine.state && Engine.state.noHpFloor); }
  function acadOn(knob) { return !!TUNE[knob] && acad(); }
  // 献祭强度：怪物数值 × 星级（2★ 数值 ×2、3★ ×3）→ 用于"升不升级"的对比
  function sacStrength(cd, star) { return (cd.atk || 0) * (star || 1) * 2 + (cd.hp || 0) * (star || 1); }
  // 星级倍率：仅学院战斗按手牌/卡组的实际星级（普通对局恒为 1★ → 下面三个函数在普通对局等价原式）
  function starMul(inst) { return acadOn('acadStarSummon') ? Math.max(1, (inst && inst.star) || 1) : 1; }
  // 召唤择优用的"实战数值" = 基础数值 × 星级（高星怪自然排到前面）
  function smAtk(cd, inst) { return (cd.atk || 0) * starMul(inst); }
  function smHp(cd, inst) { return (cd.hp || 0) * starMul(inst); }
  // 学院考核：献祭召唤前比较"新召唤怪 vs 被献祭素材"的强度；不如素材则不升级
  //（3★ 的 C/B 数值可能是 1★ A 的两三倍，为稀有度降级是纯亏）
  function sacUpgradeOK(inst, victim) {
    if (!acadOn('acadSacCompare')) return true;              // 仅学院战斗生效
    if (!victim) return false;
    var cd = C(inst); if (!cd) return true;
    // ⚠ 两边必须用【同一口径】比较。
    //   旧写法左边是"卡面基础值 × 星级"，右边却直接读 victim.atk / victim.hp —— 那是**场上实时数值**，
    //   已经吃到了学院特技（perkAtkBonus / perkHpBonus）、觉醒【精英】、装备加成等后天增益。
    //   于是一只被加成过的 3★ 怨灵（C）会被判成"比 3★ 咒缚灵（A）更强"，
    //   AI 反而不敢献祭召唤（玩家反馈："手里有三星咒缚灵、场上是三星怨灵，反而不召唤"）。
    //   这里把素材也还原成"卡面基础值 × 星级"，与新卡同口径。
    var star = acadOn('acadStarSummon') ? Math.max(1, inst.star || 1) : 1;
    var newVal = (cd.atk || 0) * star * 2 + (cd.hp || 0) * star;
    var vcd = CARDS[victim.cardId] || {};
    var vStar = acadOn('acadStarSummon') ? Math.max(1, victim.star || 1) : 1;
    var oldVal = (vcd.atk || 0) * vStar * 2 + (vcd.hp || 0) * vStar;
    return newVal >= oldVal;
  }
  // 把"会被献祭的候选"按强度过滤（不达标的素材直接排除，避免为稀而降级）
  function sacVictims(B, needT, inst, skipMon) {
    return alive('B').filter(function (m) {
      return needT.indexOf(m.tier) >= 0 && !skipMon[m.uid] && sacUpgradeOK(inst, m);
    });
  }
  // 学院考核的最后一轮：此时"留手等斩杀"没有任何回报（打满回合就结算，伤害即得分）
  function acadLast() {
    var s = Engine.state;
    return !!(s && s.noHpFloor && s.maxRounds && s.round >= s.maxRounds);
  }
  // 卡牌战术知识（card_play.js）
  function cardPlay(id) { return (typeof CARD_PLAY !== 'undefined' && CARD_PLAY[id]) || null; }

  // 我方尚可攻击的怪物
  function myAttackers() {
    return alive('B').filter(function (m) {
      return (m.flags.attacked || 0) < (m.flags.attacksMax || 1) && !skipMon[m.uid];
    });
  }
  // 取攻击力最高者（并列比生命）
  function strongest(list) {
    return list.slice().sort(function (a, b) { return (b.atk - a.atk) || (b.hp - a.hp); })[0] || null;
  }
  // 按威胁评分取最高者
  function strongestByThreat(list, peek) {
    return list.slice().sort(function (a, b) { return threatOf(b, peek) - threatOf(a, peek); })[0] || null;
  }
  // 一只怪"每次攻击的实际输出"（如澪 0 攻但每击 7 伤）
  function atkOut(m) {
    var k = cardPlay(m.cardId) || {};
    return k.attackDmgOverride != null ? k.attackDmgOverride : Math.max(0, m.atk);
  }
  // 按"实际输出"取最强（0 攻高特效怪也能被选中出手）
  function strongestByOut(list) {
    return list.slice().sort(function (a, b) { return (atkOut(b) - atkOut(a)) || (b.hp - a.hp); })[0] || null;
  }
  // 该怪是否"攻击本身就有价值"（0 攻也要出手，如纯晶元素踢手牌）
  function attackWorth(m) { return (cardPlay(m.cardId) || {}).disruptAttack === true; }
  // 该目标本战斗阶段是否"再打也白打"：巨钳蟹（a-008-2）已受过一次攻击伤害 → 之后攻击免疫。
  // 只给专业/冠军用（新手/业余按设计保持粗放，会继续撞上去）。
  function attackImmuneNow(m) { return m.cardId === 'a-008-2' && !!m.flags.tookDamageThisBattle; }
  /* 击杀/攻击代价：打这只敌方怪会不会"帮到对手 / 伤到自己"（清单见 card_play.js）
   *   attackPenalty 攻击它本身有代价（被攻击触发对我方不利的效果）
   *   killPenalty   击杀它会触发对我方不利的"死亡/进弃牌堆"效果
   *   + 动态判定：骷髅遗言只打"对位"；巨钳蟹吃过一刀后再打是纯浪费 */
  function targetPenalty(B, m, willKill) {
    var k = cardPlay(m.cardId) || {};
    var pen = k.attackPenalty || 0;
    if (m.cardId === 'a-008-2' && m.flags.tookDamageThisBattle) pen += 8;   // 巨钳蟹：本战斗阶段已受伤 → 再打免疫，出力白费
    if (willKill) {
      pen += k.killPenalty || 0;
      if (m.cardId === 'a-071-2') {                                        // 骷髅：遗言只打"对位"，我方对位没人则不亏
        var s = slotOf('A', m.uid), mine = s >= 0 ? B.board[s] : null;
        if (mine) pen += (mine.hp <= 4 ? 6 : 3);
      }
    } else if (!m.flags.thugBuff) {                                        // 新卡：非致命攻击会把豺狼暴徒/重甲暴徒"喂大"（+4盾+攻）
      if (m.cardId === 'a-105-2' && m.hp < 4) pen += 5;
      if (m.cardId === 'a-108-2' && m.hp < 6) pen += 6;
    }
    return pen;
  }

  /* ---------------- 威胁评分（攻击目标优先级的核心） ---------------- */
  function threatOf(m, peek) {
    var s = m.atk + (TIER_W[m.tier] || 0) + (m.level || 0) * 3;
    if (peek) {
      if (m.tier === 'A' && peek.hasS) s += 25;
      if (peek.hasUpScroll && upgradableMon(m)) s += 8;
      // 情报：对手还有 A/S 待升 → 优先清掉他的低费献祭材料，掐断升级引擎
      // 注：曾试过"只剩最后一只材料时把加成提到 +8"，A/B 实测是负收益（会顶掉更危险的 A 级怪），已回退
      if (peek.intel && peek.intel.upgradeRisk && (m.tier === 'C' || m.tier === 'B')) s += 4;
      // 流派针对（专业档）：识别出对手是"体系滚雪球"型 → 优先拆掉它的发动机
      var fp = TUNE.planArch && peek.intel && peek.intel.foesPlan;
      if (fp) {
        if (fp.main === 'poison' && POISON_ENGINES[m.cardId]) s += 6;      // 毒气体系：魔化藤/克里弗斯之果等，每回合白赚，越早拆越值
        if (fp.main === 'spawn' && SPAWN_ENGINES[m.cardId]) s += 4;        // 衍生工厂：鼠王/招魂法/死灵法/苍蝇群
        if (fp.main === 'equip' && (m.weapon || m.armor)) s += 2;          // 装备流：优先打掉带装备的怪
      }
    }
    return s;
  }
  function upgradableMon(m) {
    if (m.weapon && CARDS[m.weapon.cardId] && CARDS[m.weapon.cardId].upgradable && m.weapon.level < 2) return true;
    if (m.armor && CARDS[m.armor.cardId] && CARDS[m.armor.cardId].upgradable && m.armor.level < 2) return true;
    return false;
  }
  // 场面对自己不利？（对手战力明显高于我方）——用于"解场/干扰类"卡的择机发动
  function boardUnfavorable() {
    var mine = alive('B'), foes = alive('A');
    if (!foes.length) return false;
    var mp = 0, fp = 0;
    mine.forEach(function (m) { mp += Math.max(0, m.atk) + m.hp * 0.4; });
    foes.forEach(function (m) { fp += Math.max(0, m.atk) + m.hp * 0.4; });
    return fp > mp * 1.15 || foes.length > mine.length + 1;
  }
  // 解场/干扰卡：盛怒卷轴 / 催眠卷轴（仅场面对自己不利时发动）
  var CONTROL_CARDS = { 'a-088-2': 1, 'a-063-2': 1 };

  /* ---------------- 执行一步 ---------------- */
  function step() {
    ensurePolicy();
    var s = Engine.state;
    if (!s || s.winner) return false;
    if (s.active !== 'B') return false;
    if (s.pending) return false;
    var t = tag();
    if (t !== turnTag || s !== skipState) { skipState = s; turnTag = t; skip = {}; skipMon = {}; skipWand = false; skipChain = false; peekTag = ''; peekCache = null; }
    for (var attempt = 0; attempt < 30; attempt++) {
      var act = decide();
      if (!act) return false;
      if (act.type === 'CONFIRM_BATTLE' || act.type === 'END_TURN') { Engine.tryAction(act); return false; }
      var r = Engine.tryAction(act);
      if (r && r.ok) return true;
      if (act.iid) skip[act.iid] = true;             // 该卡本阶段不可用，跳过
      if (act.attackerUid) skipMon[act.attackerUid] = true;
      if (act.type === 'ACTIVATE_WAND') skipWand = true;
      if (act.type === 'MOVE_MONSTER') skipChain = true;
    }
    // 保底推进：确保 AI 永不空转
    Engine.tryAction(s.phase === 'PREP' ? { type: 'CONFIRM_BATTLE', _ai: true } : { type: 'END_TURN', _ai: true });
    return false;
  }

  /* ---------------- 策略分发 ---------------- */
  var strategies = {
    novice:   { prep: prepNovice,  battle: battleNovice },    // 新手：最弱档
    amateur:  { prep: prepAmateur, battle: battleAmateur },   // 业余
    pro:      { prep: prepPro,     battle: battlePro },       // 专业
    champion: { prep: prepPro,     battle: battlePro }        // 冠军：专业全部行为 + 90% 读牌 + 希望抽卡/起手保底
  };

  function decide() {
    var s = Engine.state;
    var st = strategies[diff] || strategies.novice;
    if (s.phase === 'PREP') return st.prep(s.players.B, s.players.A);
    return st.battle();
  }

  // 选择弃置代价：优先弃非怪物卡
  function pickDiscard(B) {
    var nonMon = B.hand.filter(function (c) { return C(c).type !== 'monster'; });
    return nonMon.length ? pick(nonMon) : B.hand[0];
  }

  /* ============================================================
   * L9：准备阶段"出牌顺序"枚举（辅助，专业/冠军档）
   *   与 L8（战斗攻击序列枚举）同一思路，但只解决"**顺序**"：
   *     阶梯决定"能做什么"；本模块只在阶梯给出的候选动作之间比较**先后顺序**的收益差，
   *     取最优顺序的第一手执行；提升不足（< prepEnumMin）或阶梯第一手不在候选里 → 返回 null，完全走原阶梯。
   *   顺序收益来自本引擎的真实机制：
   *     ① 力量药水/治疗药水是"我方全场"效果 → 先召唤再吃药，能把新怪一起吃进去
   *     ② 武器/防具/升级卷轴是指定某只怪 → 先召唤再装，可落在刚上场（通常更强）的怪身上
   *     ③ 抽牌类宝藏 → 先抽再决定召唤谁（每回合只有 1 次召唤，先召唤＝放弃更好的选择）
   *     ④ 带"出场伤害"的怪 → 先召唤削血，再用投掷物补刀（否则伤害溢出/浪费）
   * ========================================================== */
  var PREP_ENUM_MAX = 4;                                   // 候选上限（4! = 24 种排列）
  var ON_SUMMON_DMG = { 'a-046-2': 8, 'a-082-2': 1, 'a-012-2': 1, 'a-107-2': 1 };   // 出场即伤害的怪（DM-200：对方全场怪物各 1 点 + 2 层毒气）
  function enumSummonCand(B, A, peek) {
    var hand = B.hand.filter(usable);
    var sacBest = null;
    for (var i = 0; i < hand.length; i++) {                // ① A/S 献祭召唤（与阶梯同判据）
      var cd = C(hand[i]);
      if (cd.type === 'monster' && (cd.tier === 'A' || cd.tier === 'S') && B.summonsLeft > 0) {
        var kk = cardPlay(cd.id) || {};
        var hasWin = !!(kk.summonWindow && kk.summonWindow.w);
        if (TUNE.holdSummon && hasWin && windowBonus(B, A, cd, kk, alive('A')) === 0 && !needBodyNow(B, A)) continue;
        if (TUNE.holdSummon && !bigSummonOK(B, kk)) continue;
        var needT = cd.tier === 'A' ? ['C', 'B'] : ['A'];
        var victims = sacVictims(B, needT, hand[i], skipMon);
        if (!victims.length) continue;
        var crit = cd.tier === 'S' ? sSacPriority : sacPriority;
        victims.sort(function (a, b) { return crit(a) - crit(b); });
        // 学院考核：按"星级后的实战数值"估价（2★/3★ 翻倍），否则顺序枚举会把高星怪判成低价值
        var eA = smAtk(cd, hand[i]), eH = smHp(cd, hand[i]);
        var cand = {
          kind: 'summon', act: { type: 'SACRIFICE', iid: hand[i].iid, targetUid: victims[0].uid, _ai: true },
          base: eA * 2 + eH + 8, newVal: eA * 2 + eH,
          newAtk: eA, newHp: eH, isBig: true, dmgOn: ON_SUMMON_DMG[cd.id] || 0, pot: 2
        };
        if (!acadOn('acadStarSummon')) return cand;        // 非学院：与阶梯一致，取第一个出得起的
        cand._sc = eA * 2 + eH + (cd.tier === 'S' ? 4 : 0);
        if (!sacBest || cand._sc > sacBest._sc) sacBest = cand;
      }
    }
    if (sacBest) return sacBest;
    if (!(B.summonsLeft > 0) || empty('B').length <= keepSlotNeeded(B)) return null;   // ② 普通召唤
    var cands = B.hand.filter(function (c) { var x = C(c); return usable(c) && x.type === 'monster' && (x.tier === 'C' || x.tier === 'B'); });
    if (!cands.length) return null;
    var e = expertPickSummon(B, A, cands, peek);            // 内部已按"星级后的实战数值"计分 → 高星优先
    if (!e) return null;
    var ec = C(e.inst), pA = smAtk(ec, e.inst), pH = smHp(ec, e.inst);
    return {
      kind: 'summon', act: { type: 'SUMMON', iid: e.inst.iid, slot: e.slot, _ai: true },
      base: pA * 2 + pH + 6, newVal: pA * 2 + pH,
      newAtk: pA, newHp: pH, isBig: false, dmgOn: ON_SUMMON_DMG[ec.id] || 0, pot: 2
    };
  }
  function enumDrawCand(B, A) {
    var treasures = B.hand.filter(function (c) { return usable(c) && C(c).type === 'treasure' && c.cardId !== 'a-033-2'; });
    for (var i = 0; i < treasures.length; i++) {
      var cd = C(treasures[i]);
      if (treasures[i].cardId === 'a-014-2') {             // 黄金宝箱：弃 1 抽 3（需要划算的弃置代价）
        if (B.hand.length < 2) continue;
        var chest = chestDiscard(B, A, treasures[i].iid);
        if (!chest) continue;
        return { kind: 'draw', act: { type: 'USE', iid: treasures[i].iid, discardIid: chest.iid, _ai: true }, base: 3 * 1.5 + 2, draw: 3 };
      }
      var n = (cd.mods && cd.mods.draw) || 1;
      return { kind: 'draw', act: { type: 'USE', iid: treasures[i].iid, _ai: true }, base: n * 1.5 + 2, draw: n };
    }
    return null;
  }
  function enumBoardCand(B) {                              // 全场增益/治疗（药水每回合限 1 张）
    if (B.flags.used && B.flags.used.potion) return null;
    var pills = B.hand.filter(function (c) { return usable(c) && C(c).type === 'potion'; });
    for (var i = 0; i < pills.length; i++) {
      var m = C(pills[i]).mods || {};
      if (m.buffAtkAll) return { kind: 'boardAll', act: { type: 'USE', iid: pills[i].iid, _ai: true }, base: 2 * alive('B').length, per: 2, pot: 2 };
      if (m.healMonsters) return { kind: 'boardAll', act: { type: 'USE', iid: pills[i].iid, _ai: true }, base: 1.5 * alive('B').length, per: 0, pot: 2 };
    }
    return null;
  }
  function enumEquipCand(B, A) {
    var eqs = B.hand.filter(function (c) { var x = C(c); return usable(c) && (x.type === 'weapon' || x.type === 'armor'); });
    for (var i = 0; i < eqs.length; i++) {
      var ec = C(eqs[i]);
      if (B.flags.used && B.flags.used[ec.type]) continue;                 // 同类每回合限 1 张
      var mine = alive('B').filter(function (m) {
        if (m.weapon || m.armor) return false;
        if (!ec.equip) return true;
        var val = ec.equip.stat === 'atk' ? (m.baseAtk + (m.growthAtk || 0) + (m.tempAtk || 0)) : m.maxHp;
        return val >= ec.equip.min;
      });
      if (!mine.length) continue;
      var mods = ec.mods || {};
      var val = (mods.atkBonus || 0) * 2 + (mods.dmgReduce || 0) * 1.5 + (mods.splash || 0) * 1.5 + 3;
      return { kind: 'equip', act: { type: 'EQUIP', iid: eqs[i].iid, targetUid: strongest(mine).uid, _ai: true }, base: val,
        need: ec.equip || null, pot: 3 };
    }
    return null;
  }
  function enumThrowCand(B, A, peek) {
    var throws = B.hand.filter(function (c) { return usable(c) && C(c).type === 'throw'; });
    if (!throws.length || !alive('A').length) return null;
    var dmgOf = function (c) { var m = C(c).mods || {}; return m.dmg || 0; };
    var lowTh = throws.filter(function (c) { return c.cardId !== 'a-086-2'; })
      .sort(function (a, b) { return dmgOf(a) - dmgOf(b); })[0];           // 炸弹交给阶梯
    if (!lowTh) return null;
    var t = chooseThrowTarget(lowTh, peek);
    if (!t) return null;
    var d = dmgOf(lowTh);
    return {
      kind: 'throw', act: { type: 'USE', iid: lowTh.iid, targetUid: t.uid, _ai: true },
      base: d * 1.2 + (t.hp <= d ? 6 : 0), dmg: d, uid: t.uid, pot: 5
    };
  }
  // 升级卷轴：只能升级"已装备在怪身上"的装备 / 法杖栏法杖（手牌里的装备不可升级）
  //   → 与"装备"存在真实顺序依赖：先装备、再升级（阶梯把升级排在装备之前，会白跳一次）
  function enumUpgradeCand(B, A) {
    var up = B.hand.filter(function (c) { return usable(c) && c.cardId === 'a-029-2'; })[0];
    if (!up) return null;
    var act = { type: 'USE', iid: up.iid, _ai: true }, now = false;
    alive('B').forEach(function (m) {
      if (m.weapon && CARDS[m.weapon.cardId].upgradable && m.weapon.level < 2) { act.targetUid = m.uid; now = true; }
      else if (m.armor && CARDS[m.armor.cardId].upgradable && m.armor.level < 2) { act.targetUid = m.uid; now = true; }
    });
    if (!now && B.wand && CARDS[B.wand.cardId].upgradable && B.wand.level < 2) { act.targetKind = 'wand'; now = true; }
    return { kind: 'upgrade', act: act, base: now ? 2.5 : 0, val: 2.5, needEquip: !now, pot: now ? 0 : 3 };
  }
  // 法杖施法：代价是弃一张手牌 → 顺序上"越晚越好"（别把手牌里要用的牌当代价弃掉）
  function enumWandCand(B, A, peek) {
    if (!B.wand || !(B.castsLeft > 0) || skipWand) return null;
    if (B.wand.cardId === 'a-036-2' && !B.wand.inheritId) {                // 法宝：吸收一张法杖（不消耗场面资源）
      var w2 = B.hand.filter(function (c) { return usable(c) && C(c).type === 'wand' && c.cardId !== 'a-036-2'; })[0];
      if (!w2) return null;
      return { kind: 'wand', act: { type: 'ACTIVATE_WAND', absorbIid: w2.iid, _ai: true }, base: 2, pot: 0 };
    }
    if (!B.hand.length) return null;
    var effId = (B.wand.cardId === 'a-036-2' && B.wand.inheritId) ? B.wand.inheritId : B.wand.cardId;
    var disc = null;
    try { disc = pickDiscardExpert(B, A); } catch (e) { disc = null; }
    if (!disc) return null;
    if (!wandWorth(B, A, effId, disc, peek)) return null;                   // 无效收益 / 弃牌代价高于收益 → 不发动
    var dmg = (CARDS[effId] && CARDS[effId].mods && CARDS[effId].mods.dmg) || 0;
    var act = { type: 'ACTIVATE_WAND', discardIid: disc.iid, _ai: true };
    if (['a-021-2', 'a-091-2'].indexOf(effId) >= 0) {                      // 需要指定目标的两把伤害法杖
      var tg = alive('A').filter(function (m) { return !m.flags.untargetable; })
        .sort(function (a, b) { return threatOf(b, peek) - threatOf(a, peek); })[0]
        || alive('A').sort(function (a, b) { return threatOf(b, peek) - threatOf(a, peek); })[0];
      if (!tg) return null;
      act.targetUid = tg.uid;
      return { kind: 'wand', act: act, base: 1.5 + dmg * 1.1, dmg: dmg, uid: tg.uid, pot: 5 };
    }
    return { kind: 'wand', act: act, base: 2, pot: 1 };                    // 功能类法杖
  }
  // 传送卷轴：弃光手牌抽 4 → 必须排在"要用的手牌"之后（顺序依赖强）
  function enumTeleportCand(B, A) {
    var tele = B.hand.filter(function (c) { return usable(c) && c.cardId === 'a-030-2'; })[0];
    if (!tele) return null;
    if (!teleportWorth(B, A)) return null;
    return { kind: 'teleport', act: { type: 'USE', iid: tele.iid, _ai: true }, base: 1, pot: 8 };
  }
  var HAND_USE_KINDS = { draw: 1, equip: 1, upgrade: 1, boardAll: 1, throw: 1 };
  // 排列生成（n ≤ 4 → ≤ 24 种）
  function prepPermute(arr, fn) {
    (function go(cur, rest) {
      if (!rest.length) { fn(cur); return; }
      for (var i = 0; i < rest.length; i++) go(cur.concat([rest[i]]), rest.slice(0, i).concat(rest.slice(i + 1)));
    })([], arr.slice());
  }
  // 一个顺序的总收益 = Σ 各动作本体分 + Σ 顺序加成
  function prepSeqScore(seq, ctx) {
    var sc = 0, iSum = -1, iDraw = -1, iThrow = -1, iEquip = -1, iBoard = -1, iUp = -1, iTele = -1;
    seq.forEach(function (c, i) {
      sc += c.base;
      if (c.kind === 'summon' && iSum < 0) iSum = i;
      if (c.kind === 'draw' && iDraw < 0) iDraw = i;
      if (c.kind === 'throw' && iThrow < 0) iThrow = i;
      if (c.kind === 'equip' && iEquip < 0) iEquip = i;
      if (c.kind === 'boardAll' && iBoard < 0) iBoard = i;
      if (c.kind === 'upgrade' && iUp < 0) iUp = i;
      if (c.kind === 'teleport' && iTele < 0) iTele = i;
    });
    var MODE = TUNE.prepEnumMode || 0;                       // 0=全部交互；1=仅"先抽牌再召唤"；2=仅"伤害先行"
    // ① 全场增益放在召唤之后 → 多吃一个新怪（治疗对满血新怪无意义，故 healAll 的 per=0）
    if (MODE === 0 && iSum >= 0 && iBoard >= 0 && iSum < iBoard) sc += (seq[iBoard].per || 0);
    // ② 装备放在召唤之后、且新怪更强且**满足装备要求** → 装在新怪身上（否则是假阳性）
    if (MODE !== 2 && iSum >= 0 && iEquip >= 0 && iSum < iEquip && seq[iSum].newVal >= ctx.bestMine) {
      var need = seq[iEquip].need;
      var okReq = !need || (need.stat === 'atk' ? seq[iSum].newAtk >= need.min : seq[iSum].newHp >= need.min);
      if (okReq) sc += seq[iEquip].base * 0.25;
    }
    // ③ 抽牌放在召唤之前 → 用抽到的牌提升召唤质量
    //    收紧（避免假阳性）：① A/S 献祭召唤是核心节拍，不为抽牌推迟；② 只按牌库"前 3 优怪均值"保守估计并封顶 2
    if ((MODE === 0 || MODE === 1) && iSum >= 0 && iDraw >= 0 && iDraw < iSum && !seq[iSum].isBig) {
      sc += Math.min(Math.max(0, ctx.deckMonAvg3 - seq[iSum].newVal) * 0.2, 2);
    }
    // ④ 伤害来源（出场伤害 / 伤害法杖）放在投掷之前 → 让投掷物从"削血"变成"补刀"
    if (MODE !== 1 && iThrow >= 0) {
      var e = null;
      for (var j = 0; j < ctx.enemies.length; j++) if (ctx.enemies[j].uid === seq[iThrow].uid) e = ctx.enemies[j];
      var pre = 0;
      seq.forEach(function (c, i) {
        if (i >= iThrow) return;
        if (c.dmgOn) pre += c.dmgOn;
        else if (c.kind === 'wand' && c.dmg) pre += c.dmg;
      });
      if (e && pre > 0 && e.hp > seq[iThrow].dmg && (e.hp - pre) <= seq[iThrow].dmg) sc += 5 + e.th * 0.2;
    }
    // ⑤ 升级卷轴必须排在"装备"之后：升级只作用于「已装备」的装备，先装备才有可升级目标（阶梯顺序恰好相反）
    if (MODE === 0 && iUp >= 0 && seq[iUp].needEquip && iEquip >= 0 && iEquip < iUp) sc += seq[iUp].val;
    // ⑥ 传送卷轴会弃光手牌 → 必须排在所有"要用手牌的动作"之后
    if (MODE === 0 && iTele >= 0) {
      var cnt = 0;
      seq.forEach(function (c, i) { if (i < iTele && HAND_USE_KINDS[c.kind]) cnt++; });
      sc += 2.5 * cnt;
    }
    return sc;
  }
  var ENUM_STAT = { calls: 0, fired: 0 };                   // L9 遥测（介入率）
  function prepEnumPlan(B, A, peek) {
    ENUM_STAT.calls++;
    var cands = [];
    [enumSummonCand(B, A, peek), enumDrawCand(B, A), enumBoardCand(B), enumEquipCand(B, A),
      enumUpgradeCand(B, A), enumWandCand(B, A, peek), enumTeleportCand(B, A), enumThrowCand(B, A, peek)]
      .forEach(function (c) { if (c) cands.push(c); });
    if (cands.length < 2) return null;
    // 选面：按"本体分 + 可能拿到的顺序加成上限"排序（否则像传送卷轴这种本体分低、全靠顺序的动作会被裁掉）
    cands.sort(function (a, b) { return (b.base + (b.pot || 0)) - (a.base + (a.pot || 0)); });
    if (cands.length > PREP_ENUM_MAX) cands = cands.slice(0, PREP_ENUM_MAX);
    // 阶梯本身的第一手（noEnum=true → 只跑阶梯，不递归）
    var ladderAct = prepTactical(B, A, peek, true, true);
    var li = -1;
    if (ladderAct) cands.forEach(function (c, i) { if (li < 0 && c.act.type === ladderAct.type && c.act.iid === ladderAct.iid) li = i; });
    if (li < 0) return null;                                   // 阶梯第一手不在候选里 → 不介入
    var ctx = { bestMine: 0, deckMonTop: 0, deckMonAvg3: 0, handN: B.hand.length, enemies: [] };
    alive('B').forEach(function (m) { var v = atkOut(m) * 2 + m.hp; if (v > ctx.bestMine) ctx.bestMine = v; });
    alive('A').forEach(function (m) { ctx.enemies.push({ uid: m.uid, hp: m.hp, th: threatOf(m, peek) }); });
    var tops = B.deck.filter(function (c) { var x = CARDS[c.cardId]; return x && x.type === 'monster'; })
      .map(function (c) { var x = CARDS[c.cardId]; return (x.atk || 0) * 2 + (x.hp || 0); })
      .sort(function (a, b) { return b - a; });
    ctx.deckMonTop = tops.length ? tops[0] : 0;
    var t3 = tops.slice(0, 3);
    ctx.deckMonAvg3 = t3.length ? t3.reduce(function (a, b) { return a + b; }, 0) / t3.length : 0;
    var best = null, bestSc = -1e9, ladderSc = -1e9;
    prepPermute(cands, function (seq) {
      var sc = prepSeqScore(seq, ctx);
      if (sc > bestSc) { bestSc = sc; best = seq; }
      if (seq[0] === cands[li] && sc > ladderSc) ladderSc = sc;
    });
    if (!best || ladderSc < -1e8) return null;
    if (best[0] === cands[li]) return null;                    // 最优顺序的第一手就是阶梯第一手 → 不干预
    if (bestSc - ladderSc < TUNE.prepEnumMin) return null;      // 提升不足 → 不干预
    ENUM_STAT.fired++;
    return best[0].act;
  }

  /* ============================================================
   * 新手（novice）—— 原始机械逻辑，最弱档（解场卡不按场面前置判断）
   * ========================================================== */
  function prepNovice(B, A) {
    var hand = B.hand.filter(usable);

    // 1) 献祭召唤：手上有 A/S 且场上有可献祭素材
    //    学院考核：多张都出得起时，按"星级后的实战强度"挑最强的那张（非学院仍取第一个，行为不变）
    var nSac = null;
    for (var i = 0; i < hand.length; i++) {
      var cd = C(hand[i]);
      if (cd.type === 'monster' && (cd.tier === 'A' || cd.tier === 'S') && B.summonsLeft > 0) {
        var need = cd.tier === 'A' ? ['C', 'B'] : ['A'];
        var victim = sacVictims(B, need, hand[i], skipMon)[0];
        if (!victim) continue;
        if (!acadOn('acadStarSummon')) return { type: 'SACRIFICE', iid: hand[i].iid, targetUid: victim.uid, _ai: true };
        var nsc = sacStrength(cd, starMul(hand[i])) + (cd.tier === 'S' ? 4 : 0);
        if (!nSac || nsc > nSac.sc) nSac = { sc: nsc, iid: hand[i].iid, uid: victim.uid };
      }
    }
    if (nSac) return { type: 'SACRIFICE', iid: nSac.iid, targetUid: nSac.uid, _ai: true };
    // 2) 普通召唤：优先高攻 C/B（不选位，从左到右）；学院按"星级后的实战数值"排
    if (B.summonsLeft > 0 && empty('B').length) {
      var cands = hand.filter(function (c) { var x = C(c); return x.type === 'monster' && (x.tier === 'C' || x.tier === 'B'); });
      if (cands.length) {
        cands.sort(function (a, b) {                       // 刚被回手的窗口卡（喷毒花）降权，避免空场死循环
          return (smAtk(C(b), b) + smHp(C(b), b) * 0.3 - bouncePenalty(b)) - (smAtk(C(a), a) + smHp(C(a), a) * 0.3 - bouncePenalty(a));
        });
        return { type: 'SUMMON', iid: cands[0].iid, _ai: true };
      }
    }
    // 3) 破损纹章（贴到防具上：减伤+1；同一防具限 1 张 → 跳过已贴过的）
    var emblem = hand.filter(function (c) { return c.cardId === 'a-033-2'; })[0];
    if (emblem) {
      var armor = B.hand.filter(function (c) { return CARDS[c.cardId].type === 'armor' && !(c.flags && c.flags.emblemReduce > 0); })[0];
      if (armor) return { type: 'USE', iid: emblem.iid, targetIid: armor.iid, _ai: true };
    }
    // 4) 升级卷轴
    var up = hand.filter(function (c) { return c.cardId === 'a-029-2'; })[0];
    if (up) {
      var ut = null;
      alive('B').forEach(function (m) {
        if (ut) return;
        if (m.weapon && CARDS[m.weapon.cardId].upgradable && m.weapon.level < 2) ut = { targetUid: m.uid };
        else if (m.armor && CARDS[m.armor.cardId].upgradable && m.armor.level < 2) ut = { targetUid: m.uid };
      });
      if (!ut && B.wand && CARDS[B.wand.cardId].upgradable && B.wand.level < 2) ut = { targetKind: 'wand' };
      if (ut) {
        var act = { type: 'USE', iid: up.iid, _ai: true };
        if (ut.targetUid != null) act.targetUid = ut.targetUid;
        if (ut.targetKind) act.targetKind = ut.targetKind;
        return act;
      }
    }
    // 5) 其他宝藏 / 抽牌类
    var treasure = hand.filter(function (c) { return C(c).type === 'treasure' && c.cardId !== 'a-033-2'; })[0];
    if (treasure) return { type: 'USE', iid: treasure.iid, _ai: true };
    // 6) 法杖放入法杖栏
    var wand = pickWandToPlace(hand);
    if (wand && !B.wand) return { type: 'PLACE_WAND', iid: wand.iid, _ai: true };
    // 7) 投掷物削血（可攻击"无法被攻击"的怪）
    var throws = hand.filter(function (c) { return C(c).type === 'throw'; });
    if (throws.length && alive('A').length) {
      var target = weakest('A');
      if (target) return { type: 'USE', iid: throws[0].iid, targetUid: target.uid, _ai: true };
    }
    // 8) 发动法杖
    if (B.wand && B.castsLeft > 0 && !skipWand) {
      var effId = (B.wand.cardId === 'a-036-2' && B.wand.inheritId) ? B.wand.inheritId : B.wand.cardId;
      if (B.wand.cardId === 'a-036-2' && !B.wand.inheritId) {
        var w2 = B.hand.filter(function (c) { return usable(c) && C(c).type === 'wand' && c.cardId !== 'a-036-2'; })[0];
        if (w2) return { type: 'ACTIVATE_WAND', absorbIid: w2.iid, _ai: true };
      } else if (B.hand.length) {
        var disc = pickDiscard(B);
        var needTarget = ['a-021-2', 'a-091-2'].indexOf(effId) >= 0;
        if (needTarget) {
          var tg = alive('A').filter(function (m) { return !m.flags.untargetable; }).sort(function (a, b) { return a.hp - b.hp; })[0]
            || alive('A').sort(function (a, b) { return a.hp - b.hp; })[0];
          if (tg && wandWorth(B, A, effId, disc)) return { type: 'ACTIVATE_WAND', discardIid: disc.iid, targetUid: tg.uid, _ai: true };
        } else if (wandWorth(B, A, effId, disc)) {
          return { type: 'ACTIVATE_WAND', discardIid: disc.iid, _ai: true };
        }
      }
    }
    // 8.5) 镜像卷轴（新卡）：必须指定我方怪物作为目标，否则使用会失败 → 复制当前最强的己方怪
    var mirror = hand.filter(function (c) { return c.cardId === 'a-116-2'; })[0];
    if (mirror && empty('B').length && alive('B').length) {
      var mt = alive('B').slice().sort(function (a, b) { return atkOut(b) - atkOut(a); })[0];
      return { type: 'USE', iid: mirror.iid, targetUid: mt.uid, _ai: true };
    }
    // 9) 增益食物 / 药水 / 卷轴（镜像卷轴需目标，已在上一步单独处理）
    var buff = hand.filter(function (c) { var t = C(c).type; return (t === 'food' || t === 'potion' || t === 'scroll') && c.cardId !== 'a-116-2'; })[0];
    if (buff) return { type: 'USE', iid: buff.iid, _ai: true };
    // 10) 装备：给己方最强怪装配（同部位不可替换，故需空槽）
    var eq = hand.filter(function (c) { var x = C(c); return x.type === 'weapon' || x.type === 'armor'; });
    for (var e = 0; e < eq.length; e++) {
      var ec = C(eq[e]);
      var mine = alive('B').filter(function (m) {
        if (m.weapon || m.armor) return false;
        if (!ec.equip) return true;
        var val = ec.equip.stat === 'atk' ? (m.baseAtk + (m.growthAtk || 0) + (m.tempAtk || 0)) : m.maxHp;
        return val >= ec.equip.min;
      });
      if (mine.length) {
        mine.sort(function (a, b) { return b.atk - a.atk; });
        return { type: 'EQUIP', iid: eq[e].iid, targetUid: mine[0].uid, _ai: true };
      }
    }
    // 11) 进入战斗
    return { type: 'CONFIRM_BATTLE', _ai: true };
  }

  function battleNovice() {
    var mine = myAttackers();
    if (!mine.length) return { type: 'END_TURN', _ai: true };
    var enemies = alive('A');
    var attackable = enemies.filter(function (m) { return !m.flags.untargetable; });
    // 新手也按"真实输出"挑攻击者：0 攻但每击 7 伤的澪 不该永远排在最后（其余判断仍保持新手档次）
    var atker = strongestByOut(mine);
    var ao = atkOut(atker);
    if (enemies.length === 0) return { type: 'ATTACK', attackerUid: atker.uid, targetKey: 'A', _ai: true };
    if (attackable.length === 0) return { type: 'END_TURN', _ai: true };
    var killable = attackable.filter(function (t) { return t.hp <= ao; });
    var target = killable[0] || weakest('A', true);
    if (!target) return { type: 'END_TURN', _ai: true };
    return { type: 'ATTACK', attackerUid: atker.uid, targetUid: target.uid, _ai: true };
  }

  function weakest(key, attackableOnly) {
    var list = alive(key).filter(function (m) { return !(attackableOnly && m.flags.untargetable); });
    if (!list.length) list = alive(key);
    list.sort(function (a, b) { return a.hp - b.hp; });
    return list[0];
  }

  /* ============================================================
   * 爱好者 / 业余 / 专业 —— 战术出牌（expert=true 时启用"按卡功能出牌"）
   * ========================================================== */
  function prepAmateur(B, A) { return prepTactical(B, A, peekHand(), false); }
  function prepPro(B, A) { return prepTactical(B, A, peekHand(), true); }

  function prepTactical(B, A, peek, expert, noEnum) {
    var hand = B.hand.filter(usable);
    // L9（辅助）：准备阶段"出牌顺序"枚举——只有顺序确实更优时才返回一个"阶梯体系内"的动作，否则完全走原阶梯
    if (expert && !noEnum && TUNE.prepEnum) {
      var po = prepEnumPlan(B, A, peek);
      if (po) return po;
    }

    // 1) 献祭召唤（专业档按卡功能判断时机，并按"该牺牲谁"择优）
    var sacBest = null;
    for (var i = 0; i < hand.length; i++) {
      var cd = C(hand[i]);
      if (cd.type === 'monster' && (cd.tier === 'A' || cd.tier === 'S') && B.summonsLeft > 0) {
        var kk = cardPlay(cd.id) || {};
        if (expert) {
          // 择时窗口（腐烂之心/新生火元素）：窗口没到、且场面不吃紧 → 先留着等时机（收益最大化）；
          // 但场面需要补位（空场 / 我方怪更少 / 场面吃紧）时立刻出场，绝不为等窗口放弃场面控制权。
          // 无窗口的 A/S 不受此条影响。
          var hasWin = !!(kk.summonWindow && kk.summonWindow.w);
          if (TUNE.holdSummon && hasWin && windowBonus(B, A, cd, kk, alive('A')) === 0 && !needBodyNow(B, A)) continue;
          if (TUNE.holdSummon && !bigSummonOK(B, kk)) continue;                     // 联动类 A/S（需法杖/卷轴/投掷物在场）
        }
        var need = cd.tier === 'A' ? ['C', 'B'] : ['A'];
        var victims = sacVictims(B, need, hand[i], skipMon);
        if (expert && TUNE.expertSac) {
          var crit = cd.tier === 'S' ? sSacPriority : sacPriority;                  // S 级：优先牺牲"最没用的 A 级"
          victims.sort(function (a, b) { return crit(a) - crit(b); });
          // 该卡指定了站位 → 在牺牲价值接近的候选里，优先牺牲"目标槽位"上的怪
          var want = wantSlotFor(B, A, kk);
          if (want != null) {
            var cand2 = victims.filter(function (m) { return slotOf('B', m.uid) === want; })[0];
            if (cand2 && crit(cand2) <= crit(victims[0]) + 1) {
              victims = [cand2].concat(victims.filter(function (m) { return m !== cand2; }));
            }
          }
        }
        var victim = victims[0];
        if (!victim) continue;
        // 学院考核：多张 A/S 都出得起时，按"星级后的实战强度"挑最强的那张
        //（非学院仍按原行为"第一个能出的就出"，不动已实测过的普通对局手感）
        if (!acadOn('acadStarSummon')) return { type: 'SACRIFICE', iid: hand[i].iid, targetUid: victim.uid, _ai: true };
        var tsc = sacStrength(cd, starMul(hand[i])) + (cd.tier === 'S' ? 4 : 0);
        if (!sacBest || tsc > sacBest.sc) sacBest = { sc: tsc, iid: hand[i].iid, uid: victim.uid };
      }
    }
    if (sacBest) return { type: 'SACRIFICE', iid: sacBest.iid, targetUid: sacBest.uid, _ai: true };
    // 2) 普通召唤：优先高价值怪并选择性站位（专业档按卡功能决定时机与位置）
    if (B.summonsLeft > 0 && empty('B').length > keepSlotNeeded(B)) {
      var cands = hand.filter(function (c) { var x = C(c); return x.type === 'monster' && (x.tier === 'C' || x.tier === 'B'); });
      if (cands.length) {
        var chosen = null, slot = null;
        if (expert && TUNE.expertPick) { var e = expertPickSummon(B, A, cands, peek); if (e) { chosen = e.inst; slot = e.slot; } }
        if (!chosen) {
          cands.sort(function (a, b) {                     // 刚被回手的窗口卡（喷毒花）降权，避免空场死循环
            // 学院考核：按"星级后的实战数值"排，高星怪优先出场
            return (smAtk(C(b), b) + smHp(C(b), b) * 0.3 - bouncePenalty(b)) - (smAtk(C(a), a) + smHp(C(a), a) * 0.3 - bouncePenalty(a));
          });
          chosen = cands[0]; slot = chooseSummonSlot(B, A, C(chosen));
        }
        var sact = { type: 'SUMMON', iid: chosen.iid, _ai: true };
        if (slot != null) sact.slot = slot;
        return sact;
      }
    }
    // 3) 破损纹章：给最高攻怪身上的防具 / 或手牌防具「贴纹章（减伤+1，不提升等级）」
    var emblem = hand.filter(function (c) { return c.cardId === 'a-033-2'; })[0];
    if (emblem) {
      // 同一防具限 1 张纹章 → 只挑"还没贴过"的防具（场上装备优先，其次手牌）
      var eqArmor = null;
      alive('B').slice().sort(function (a, b) { return b.atk - a.atk; }).forEach(function (m) {
        if (!eqArmor && m.armor && CARDS[m.armor.cardId].type === 'armor' && !(m.armor.flags && m.armor.flags.emblemReduce > 0)) eqArmor = { targetUid: m.uid };
      });
      if (eqArmor) return { type: 'USE', iid: emblem.iid, targetUid: eqArmor.targetUid, _ai: true };
      var armor = B.hand.filter(function (c) { return c.iid !== emblem.iid && CARDS[c.cardId].type === 'armor' && !(c.flags && c.flags.emblemReduce > 0); })[0];
      if (armor) return { type: 'USE', iid: emblem.iid, targetIid: armor.iid, _ai: true };
    }
    // 4) 升级卷轴：给"最值得升级"的目标
    var up = hand.filter(function (c) { return c.cardId === 'a-029-2'; })[0];
    if (up) {
      var ut = null;
      alive('B').slice().sort(function (a, b) { return b.atk - a.atk; }).forEach(function (m) {
        if (ut) return;
        if (m.weapon && CARDS[m.weapon.cardId].upgradable && m.weapon.level < 2) ut = { targetUid: m.uid };
        else if (m.armor && CARDS[m.armor.cardId].upgradable && m.armor.level < 2) ut = { targetUid: m.uid };
      });
      if (!ut && B.wand && CARDS[B.wand.cardId].upgradable && B.wand.level < 2) ut = { targetKind: 'wand' };
      if (ut) {
        var uact = { type: 'USE', iid: up.iid, _ai: true };
        if (ut.targetUid != null) uact.targetUid = ut.targetUid;
        if (ut.targetKind) uact.targetKind = ut.targetKind;
        return uact;
      }
    }
    // 5) 其他宝藏 / 抽牌类（黄金宝箱需自选弃置目标）
    var treasures = hand.filter(function (c) { return C(c).type === 'treasure' && c.cardId !== 'a-033-2'; });
    for (var tr = 0; tr < treasures.length; tr++) {
      if (treasures[tr].cardId === 'a-014-2') {                             // 黄金宝箱：弃 1 抽 3
        if (B.hand.length < 2) continue;
        var chest = chestDiscard(B, A, treasures[tr].iid);
        if (chest) return { type: 'USE', iid: treasures[tr].iid, discardIid: chest.iid, _ai: true };
        continue;                                                          // 没有划算的代价 → 本回合不用它
      }
      return { type: 'USE', iid: treasures[tr].iid, _ai: true };
    }
    // 6) 法杖放入法杖栏
    var wand = pickWandToPlace(hand);
    if (wand && !B.wand) return { type: 'PLACE_WAND', iid: wand.iid, _ai: true };
    // 7) 投掷物：先用低伤害的（高伤害留给"必须补刀"的场合）；炸弹只在不利且能覆盖≥2只敌怪时埋
    var throws = hand.filter(function (c) { return C(c).type === 'throw'; });
    if (throws.length && alive('A').length) {
      var dmgOf = function (c) { var m = C(c).mods || {}; return m.dmg || 0; };
      var normalTh = throws.filter(function (c) { return c.cardId !== 'a-086-2'; });
      var bombs = throws.filter(function (c) { return c.cardId === 'a-086-2'; });
      // ① 补刀：用"刚好够杀的最低伤害投掷物"
      var lowHp = alive('A').filter(function (m) { return !m.flags.untargetable; })
        .sort(function (a, b) { return a.hp - b.hp; })[0];
      if (lowHp) {
        var fin = normalTh.filter(function (c) { return dmgOf(c) >= lowHp.hp; })
          .sort(function (a, b) { return dmgOf(a) - dmgOf(b); })[0];
        if (fin) return { type: 'USE', iid: fin.iid, targetUid: lowHp.uid, _ai: true };
      }
      // L6c：两回合计划——为"下回合清场→打脸"精准削血（把最硬的挡路怪压到可一击清除）
      // 只在"下回合确实能斩杀"的局面生效（条件苛刻、不会为了投机而提前花掉伤害）
      if (expert && TUNE.planL6) {
        var pt = planThrowTarget(B, A, normalTh);
        if (pt) return { type: 'USE', iid: pt.iid, targetUid: pt.uid, _ai: true };
      }
      // ② 否则用伤害最低的普通投掷物（配姬莲梅錵回血 / 神射戒指回收）
      //    L6b：专业档只在"下回合即可斩杀（lethalSoon）"时收手留伤害；
      //    注意：不能为了"应对对手将来可能进化出的 A/S"而长期留手——投掷物点不死 14 血的 A 级怪，
      //    长期不削血等于放弃场面压制（实测会让专业档净亏 5 个点）。
      //    学院考核（acadThrow / 最后一轮）：伤害本身就是得分（打怪也全额计入输出）→ 直接打最疼的那张，不留手
      var acadTh = acadOn('acadThrow') || (acadOn('acadEndgame') && acadLast());
      var lowTh = acadTh
        ? normalTh.slice().sort(function (a, b) { return dmgOf(b) - dmgOf(a); })[0]
        : normalTh.slice().sort(function (a, b) { return dmgOf(a) - dmgOf(b); })[0];
      //    伤害排程：若"手上投掷物总伤害 ≥ 对方场面总血"，就只用投掷物清场（每次都是补刀），
      //    把攻击次数全部留给打脸——这里省下的不是伤害，而是"攻击次数"。
      var foeHpSum = 0; alive('A').forEach(function (m) { foeHpSum += m.hp; });
      var thSum = 0; normalTh.forEach(function (c) { thSum += dmgOf(c); });
      var itemClear = foeHpSum > 0 && thSum >= foeHpSum;
      var holdLethal = expert && TUNE.holdThrowLethal && !acadTh && lethalSoon(B, A);
      var holdClear = expert && TUNE.holdThrowClear && !acadTh && itemClear;
      if (lowTh && !(holdLethal || holdClear)) {
        var tTarget = chooseThrowTarget(lowTh, peek);
        if (tTarget) return { type: 'USE', iid: lowTh.iid, targetUid: tTarget.uid, _ai: true };
      }
      // ③ 炸弹：默认"场面对自己不利 且 对手怪≥2（能一次覆盖多只）才埋"
      //    （TUNE.holdBomb=0 时改为按普通投掷物照常埋，用于 A/B 对比"攒炸弹"是否划算）
      var bombOK = !expert || !TUNE.holdBomb || (boardUnfavorable() && alive('A').length >= 2);
      if (bombs.length && bombOK) {
        var bb = bestBombTarget(alive('A'));
        if (bb) return { type: 'USE', iid: bombs[0].iid, targetUid: bb.uid, _ai: true };
      }
    }
    // 8) 发动法杖（专业档优先以"弃牌即触发/功能已用完"的卡作代价）
    if (B.wand && B.castsLeft > 0 && !skipWand) {
      var effId = (B.wand.cardId === 'a-036-2' && B.wand.inheritId) ? B.wand.inheritId : B.wand.cardId;
      if (B.wand.cardId === 'a-036-2' && !B.wand.inheritId) {
        var w2 = B.hand.filter(function (c) { return usable(c) && C(c).type === 'wand' && c.cardId !== 'a-036-2'; })[0];
        if (w2) return { type: 'ACTIVATE_WAND', absorbIid: w2.iid, _ai: true };
      } else if (B.hand.length) {
        // 专业：按卡功能 + 场面/手牌评估；业余：按场面/手牌评估；爱好者：原计划（优先弃非怪物卡）
        var disc = (expert && TUNE.expertDiscard) ? pickDiscardExpert(B, A) : (peek ? pickDiscardSmart(B, A, false) : pickDiscard(B));
        var needTarget = ['a-021-2', 'a-091-2'].indexOf(effId) >= 0;
        if (needTarget) {
          var tg = alive('A').filter(function (m) { return !m.flags.untargetable; })
            .sort(function (a, b) { return threatOf(b, peek) - threatOf(a, peek); })[0]
            || alive('A').slice().sort(function (a, b) { return threatOf(b, peek) - threatOf(a, peek); })[0];
          if (tg && wandWorth(B, A, effId, disc, peek)) return { type: 'ACTIVATE_WAND', discardIid: disc.iid, targetUid: tg.uid, _ai: true };
          skipWand = true;                                    // 无有效目标 / 不划算 → 本回合不再考虑发动
        } else if (wandWorth(B, A, effId, disc, peek)) {
          return { type: 'ACTIVATE_WAND', discardIid: disc.iid, _ai: true };
        } else {
          skipWand = true;                                    // 弃牌代价高于收益 → 不发动（避免丢弃核心卡）
        }
      }
    }
    // 8.5) 传送卷轴：弃光手牌抽 4 —— 只在"手牌少 / 急缺怪 / 手里都是没用的牌"时用
    var tele = hand.filter(function (c) { return c.cardId === 'a-030-2'; })[0];
    if (tele && teleportWorth(B, A)) return { type: 'USE', iid: tele.iid, _ai: true };
    // 9) 增益食物 / 药水 / 卷轴：专业档按"时机评估"决定用不用（含手牌兜底，不会卡在手里）
    var buffs = hand.filter(function (c) {
      if (c.cardId === 'a-030-2') return false;                     // 传送卷轴已在上一步单独评估
      if (c.cardId === 'a-116-2') return false;                     // 镜像卷轴必须带目标 → 交给 10.7) mirrorScrollDecision
      var t = C(c).type; return t === 'food' || t === 'potion' || t === 'scroll';
    });
    for (var bi = 0; bi < buffs.length; bi++) {
      var bc = C(buffs[bi]), bm = bc.mods || {};
      if (CONTROL_CARDS[bc.id] && !boardUnfavorable()) continue;
      // 催眠卷轴是"双方全部不能攻击"（卡面：场上所有怪物）→ 本回合能斩杀时绝不冻住自己
      if (bc.id === 'a-063-2' && lethalNow(B, A)) continue;
      var worth = expert ? buffWorth(B, A, buffs[bi], peek)
                         // 业余档是粗评（有怪就喝）；但毒气药水额外要求"对手场上有怪"——毒气挂在对手身上，
                         // 对手空场时那几层会在不造成任何伤害的情况下白掉（与专业档 buffWorth 的口径一致）
                         : ((alive('B').length > 0 || bm.healPlayer || bm.healMonsters) &&
                            (bc.id !== 'a-115-2' || alive('A').length > 0 || handPressure(B)));
      if (worth) return { type: 'USE', iid: buffs[bi].iid, _ai: true };
    }
    // 10) 装备：专业档按卡的功能配对（肉盾/材料优先防具、战斗怪优先武器）
    var eq = hand.filter(function (c) { var x = C(c); return x.type === 'weapon' || x.type === 'armor'; });
    for (var e2 = 0; e2 < eq.length; e2++) {
      var ec = C(eq[e2]);
      var mine = alive('B').filter(function (m) {
        if (m.weapon || m.armor) return false;
        if (!ec.equip) return true;
        var val = ec.equip.stat === 'atk' ? (m.baseAtk + (m.growthAtk || 0) + (m.tempAtk || 0)) : m.maxHp;
        return val >= ec.equip.min;
      });
      if (mine.length) {
        mine.sort(function (a, b) {
          if (expert) return equipPriority(ec, a, peek) - equipPriority(ec, b, peek);
          if (ec.type === 'armor') return threatOf(b, peek) - threatOf(a, peek);
          return b.atk - a.atk;
        });
        return { type: 'EQUIP', iid: eq[e2].iid, targetUid: mine[0].uid, _ai: true };
      }
    }
    // 10.5) 虚空锁链：按"位置关系"做一次移动（炸弹覆盖 / 喷毒花对位 / 骷髅对位 / DM-100 对位）
    var chainAct = chainMoveDecision(B, A);
    if (chainAct) return chainAct;
    // 10.6) 时光沙漏（新卡神器）：对手明显压制时封锁一回合
    var tsAct = timeStopDecision(B, A);
    if (tsAct) return tsAct;
    // 10.7) 镜像卷轴（新卡）：复制我方最有价值的一只怪
    var mirrorAct = mirrorScrollDecision(B, A);
    if (mirrorAct) return mirrorAct;
    // 11) 进入战斗
    return { type: 'CONFIRM_BATTLE', _ai: true };
  }

  /* ---------------- 专业档：按卡功能出牌 ---------------- */
  // 献祭优先级（数字越小越优先被献祭）
  function sacPriority(m) {
    var k = cardPlay(m.cardId) || {};
    // 残血怪最该被献祭：升 A/S 会回满血，等于用"快死的单位"换一只满血高级怪
    if (m.hp <= 2 || (m.maxHp && m.hp / m.maxHp <= TUNE.hpLowRatio)) return -5;
    if (k.noSacrifice) return 100;                              // 蚱蜢等一次性战斗卡不牺牲
    // 自我主线：本局走毒气/腐烂体系时，别拿发动机（魔化藤/克里弗斯之果/腐烂之心）当祭品喂掉
    // （腐烂触手是 role:'material'，它的"死"本身就是体系收益，不受此条影响 → 仍是第一优先祭品）
    var sp = TUNE.planArch && selfPlan(Engine.state.players.B);
    if (sp && sp.main === 'poison' && (k.role === 'poisonSource' || k.role === 'poisonAmp' || k.role === 'poisonTank')) return 7;
    if (k.garrison === false) return 6;                         // 疯狂小偷等不驻场卡：不作优先材料
    if (k.role === 'material') return -3;                       // 献祭材料类（怨灵/腐烂触手/苍蝇群）最优先
    if (k.role === 'value' || k.role === 'utility') return 0;   // 召唤即见效/功能用完 → 优先献祭
    if (k.role === 'sacrifice') return 1;                       // 本就是献祭材料
    if (k.role === 'sacCombat') return 2;                       // 骷髅：献祭也触发效果，优于普通战斗怪
    return 3;                                                   // 其他战斗类最后考虑
  }
  // S 级献祭时"优先拿哪只 A 级当祭品"（数字越小越先被牺牲）
  function sSacPriority(m) {
    var k = cardPlay(m.cardId) || {};
    if (m.hp <= 2 || (m.maxHp && m.hp / m.maxHp <= TUNE.hpLowRatio)) return -5;  // 残血 A：升 S 会回满血，最划算
    if (k.role === 'value' || k.role === 'utility') return 0;         // 功能型 A（茉莉伊洛/极影铃虹/豺狼猎手）
    if (k.role === 'sacrifice') return 1;
    if (k.role === 'tank') return 2;                                  // 巨钳蟹：一次性吸伤，用过就贬值
    if (k.role === 'aoe' || k.role === 'poisonAmp') return 3;         // 新生火元素/腐烂之心：持续收益，尽量留
    if (k.role === 'combat') return 4;                                // 主力 A（绿野精灵/蕾零安洁/姬莲梅錵）
    return 2.5;
  }
  // 装备对象优先级（数字越小越优先）
  function equipPriority(eqCard, m, peek) {
    var k = cardPlay(m.cardId) || {};
    var t = m.tier === 'S' ? 0 : m.tier === 'A' ? 1 : m.tier === 'B' ? 2 : 3;
    var fighter = (k.role === 'combat' || k.role === 'sacCombat');
    // 暗影斗篷（到下个我方回合前无法被攻击）：只给"能留到那时候"的怪
    if (eqCard.id === 'a-039-2') {
      // 注意：斗篷的"无法被攻击"只挡攻击，挡不住投掷物与法杖 → 已知/推测对手有解场手段时价值下降
      var cloakPen = (peek && peek.canRemoveSmall) ? 6 : 0;
      if (k.garrison === false) return 20;                                            // 回合结束会回手 → 装了也白装
      if (k.role === 'factory' || k.role === 'material' || k.role === 'sacrifice') return 0 + cloakPen * 0.3;  // 工厂类/祭品类
      if (boardUnfavorable() && fighter) return 1 + cloakPen * 0.5;                    // 高压下的主力输出
      return 10 + cloakPen;
    }
    if (eqCard.type === 'weapon') {
      // 长矛：追加伤害按"每次攻击"结算 → 只给能多次攻击的怪（水道螃蟹EX / 丛林螃蟹）
      if (eqCard.id === 'a-093-2') return (m.cardId === 'a-011-2' || m.cardId === 'a-006-2') ? 0 : 9;
      if (fighter) return t;                                                          // 武器给战斗怪，A/S 优先
      return 5;
    }
    // 防具
    if (eqCard.id === 'a-092-2') return (m.tier === 'S' || m.tier === 'A') ? 0 : 6;   // 链甲：升级收益最高 → 优先 A/S
    if (eqCard.id === 'a-028-2') return (m.tier === 'S' || m.tier === 'A' || m.tier === 'B') ? 1 : 6;  // 皮甲 → B/A/S
    if (eqCard.id === 'a-026-2') return fighter ? t : 4;                              // 圆盾：攻防一体 → 优先主力
    if (t <= 1 && fighter) return t;
    if (k.equipPref === 'armor' || k.equip === 'armor' || k.role === 'sacrifice' || k.role === 'wall') return 2;  // 血色哨卫/战士B/大蜗牛
    if (fighter) return 3;
    return 5;
  }
  /* ---------------- 业余/专业：弃置代价评估 ----------------
   * 法杖发动必须弃 1 张手牌作为代价 —— 不"看到史莱姆就扔"，
   * 而是给每张手牌算【自身价值 − 弃掉能换到的即时收益】，弃代价最低的那张。
   * 评估会看：场上空位 / 场面优劣 / 有无可装备或可增益的怪、手牌数量、
   * 对手手牌数、对手怪血量、卡组剩余可检索目标、低费献祭材料储备。
   * 硬门槛：有弃置收益的怪必须"收益够高(≥6) 且 低费材料储备≥3"才允许被主动弃置。
   */
  // 低费前排储备：场上 + 手牌里的 C/B 怪（升 A/S 时要用作献祭材料）
  function materialReserve(B) {
    var n = 0;
    alive('B').forEach(function (m) { if (m.tier === 'C' || m.tier === 'B') n++; });
    B.hand.forEach(function (c) { var x = C(c); if (x.type === 'monster' && (x.tier === 'C' || x.tier === 'B')) n++; });
    return n;
  }
  // 这张卡"进弃牌堆"当下能换到的收益（0 = 触发不了 / 无意义）
  function fuelWorth(B, A, id) {
    if (id === 'a-049-2') {                                  // 繁花史莱姆：从卡组检索一张 🫒 怪
      if (B.hand.length >= Rules.HAND_LIMIT) return 0;        // 手牌已满，检索不进来
      if (!B.deck.some(function (c) { return (C(c).tags || []).indexOf('🫒') >= 0; })) return 0;  // 卡组没有目标
      return 7;
    }
    if (id === 'a-056-2') {                                  // 黄昏史莱姆：对手随机弃 1 手牌
      var n = A.hand.length;
      return n >= 3 ? 7 : n === 2 ? 5 : n === 1 ? 3 : 0;      // 对手手牌越多越赚
    }
    if (id === 'a-057-2') {                                  // 血红史莱姆：对手随机怪 -3
      var foes = alive('A');
      if (!foes.length) return 0;
      return foes.every(function (m) { return m.hp <= 3; }) ? 8 : 5;
    }
    if (id === 'a-001-2') return 5;                          // 宝箱怪：进弃牌堆抽 1 张（无可奈何时的优选弃牌）
    return 0;
  }
  // 门槛：收益太低 / 低费材料储备不足 → 不许为了收益主动弃掉这张怪
  function fuelUsable(B, A, id) {
    var k = cardPlay(id) || {};
    if (fuelWorth(B, A, id) < (k.fuelMin || TUNE.fuelMin)) return false;
    if (materialReserve(B) < TUNE.reserveMin) return false;
    return true;
  }
  // 牌库剩余量对"过牌类"卡价值的影响：牌库越少越不值钱，牌库清空 = 无价值
  function deckFactor(B) {
    if (!B.deck.length) return 0;
    return 0.4 + 0.6 * Math.min(1, B.deck.length / 12);
  }
  // 价值依赖牌库的"抽牌类"卡
  var DRAW_CARDS = { 'a-013-2': 1, 'a-014-2': 1, 'a-085-2': 1, 'a-060-2': 1, 'a-023-2': 1 };
  // 这张卡当前对局面的价值（越高越不该弃）
  function handValue(B, A, inst) {
    var cd = C(inst), k = cardPlay(cd.id) || {}, v;
    if (cd.type === 'monster') {
      v = cd.tier === 'S' ? 30 : cd.tier === 'A' ? 22 : cd.tier === 'B' ? 12 : 8;
      if (cd.tier === 'C' || cd.tier === 'B') {
        var r = materialReserve(B);
        if (r <= 1) v += 8; else if (r === 2) v += 4;         // 低费材料越少越珍贵
      }
      if (empty('B').length) v += 2;                          // 有空位 → 能立刻上场
      if (boardUnfavorable()) v += 3;                         // 场面吃紧 → 更需铺场
      if (k.role === 'material') v += 4;                      // 献祭体系材料：留在手里更值
      if (k.noDiscard) v += 12;                               // 从手牌弃置不触发其效果（腐烂触手）→ 绝不当代价
      if (k.garrison === false) v -= 2;                        // 不驻场卡：弃掉损失相对小
    } else if (cd.type === 'treasure') {
      v = 9 * (DRAW_CARDS[cd.id] ? deckFactor(B) : 1);        // 抽牌类：牌库越少越不值，牌库空 = 0
    } else if (cd.type === 'wand') v = 10;                    // 备用法杖（可灌注）
    else if (cd.type === 'trap') v = 9;                       // 手牌被动效果，别乱弃
    else if (cd.type === 'ring') {
      // 戒指都是"留在手牌即生效"的被动卡，按当前是否能吃到收益给分
      if (cd.id === 'a-023-2') v = 9 * deckFactor(B);         // 财富戒指：每回合过 1 张 → 依赖牌库
      else if (cd.id === 'a-090-2') v = B.discard.some(function (c) { return C(c).type === 'throw'; }) ? 9 : 4;  // 神射戒指：看弃牌堆有无投掷物
      else if (cd.id === 'a-065-2') v = B.hand.some(function (c) { var x = C(c); return x.type === 'monster' && x.tier === 'C'; }) ? 9 : 4; // 极速戒指：手牌要有 C 级怪
      else if (cd.id === 'a-066-2') v = alive('B').some(function (m) { return m.tier === 'B'; }) ? 9 : 4;        // 狂怒戒指：场上要有 B 级怪
      else v = 8;
    } else if (cd.type === 'weapon' || cd.type === 'armor') {
      v = alive('B').some(function (m) { return !m.weapon && !m.armor; }) ? 8 : 2;  // 没人能装 = 废牌
    } else if (cd.type === 'food' || cd.type === 'potion' || cd.type === 'scroll') {
      var heal = cd.mods && (cd.mods.healPlayer || cd.mods.healMonsters);
      v = (alive('B').length || heal) ? 7 : 2;                // 无怪可增益 = 废牌
    } else v = 5;
    if (B.hand.length <= 2) v += 4;                           // 手牌很少 → 每张都珍贵
    return v;
  }
  // 弃置代价 = 自身价值 − 弃置收益（越低越该弃）
  function discardCost(B, A, inst, useFuel) {
    var cost = handValue(B, A, inst);
    if (useFuel) {
      var id = C(inst).id, k = cardPlay(id);
      if (k && k.discardFuel && fuelUsable(B, A, id)) cost -= fuelWorth(B, A, id);
    }
    return cost;
  }
  // 选出"弃掉代价最低"的一张（useFuel=true 时才计入史莱姆类的弃置收益）
  function pickDiscardSmart(B, A, useFuel) {
    var best = null, bestCost = Infinity;
    for (var i = 0; i < B.hand.length; i++) {
      var c = discardCost(B, A, B.hand[i], useFuel);
      if (c < bestCost) { bestCost = c; best = B.hand[i]; }
    }
    return best || pickDiscard(B);
  }
  function pickDiscardExpert(B, A) { return pickDiscardSmart(B, A, true); }

  /* ---------------- 发动法杖的收益评估 ----------------
   * 修复：此前"只要法杖在栏里、本回合还能施法、自己手牌非空"就无条件发动 →
   *   ① 焰浪法杖（效果=弃对手手牌）在对手空手时也会发动，纯亏一张手牌；
   *   ② 会为了发动而弃掉核心卡（甚至把手牌腾空），越打越亏。
   * 现在先估收益，再要求"弃牌代价 ≤ 收益"才发动。
   */
  // 法杖收益估值（-99 = 当前局面下无意义/无效）
  function wandGain(A, effId) {
    var foes = alive('A'), oh = A.hand.length;
    switch (effId) {
      case 'a-067-2': return oh === 0 ? -99 : (oh <= 2 ? 12 : oh <= 4 ? 8 : 5);  // 焰浪：弃对手手牌；对手空手 → 纯亏
      case 'a-021-2': return foes.length ? 6 : -99;                              // 魔弹：需目标
      case 'a-091-2': return foes.length ? 5 : -99;                              // 冲击波：需目标
      case 'a-068-2': return foes.length ? foes.reduce(function (s, m, i) { return s + (2 + i * 2); }, 0) : -99;  // 解离：穿透全场
      default: return 6;                                                        // 老法杖灌注等（无弃牌代价）
    }
  }
  // 这次发动值不值：无效收益一律不发动；手牌顶上限时弃牌本身有收益 → 放行
  function wandWorth(B, A, effId, disc) {
    var g = wandGain(A, effId);
    if (g <= -50) return false;
    if (handPressure(B)) return true;
    return discardCost(B, A, disc, true) <= g;
  }

  /* ---------------- 黄金宝箱 / 传送卷轴：价值评估 ---------------- */
  // 黄金宝箱：必须指定弃置目标才能用。选一张"弃掉代价最低"的；代价太高（手牌都很值钱）就本回合不用
  function chestDiscard(B, A, chestIid) {
    var best = null, bestCost = Infinity;
    for (var i = 0; i < B.hand.length; i++) {
      if (B.hand[i].iid === chestIid) continue;
      var c = discardCost(B, A, B.hand[i], true);
      if (c < bestCost) { bestCost = c; best = B.hand[i]; }
    }
    return (best && bestCost <= TUNE.chestCostMax) ? best : null;
  }
  // 传送卷轴：弃光手牌抽 4。手牌越少 / 越缺怪 / 越无用的牌 → 越值得
  function teleportWorth(B, A) {
    var others = B.hand.filter(function (c) { return c.cardId !== 'a-030-2'; });
    var score = 0;
    var net = 4 - others.length;
    if (net >= 0) score += 2; else if (net >= -1) score += 1;          // 换完手牌不会变少
    var hasMon = others.some(function (c) { var x = C(c); return x.type === 'monster'; });
    if (!hasMon && alive('B').length <= 1) score += 2;                 // 急缺怪物卡
    var total = 0;
    others.forEach(function (c) { total += handValue(B, A, c); });
    var avg = others.length ? total / others.length : 99;
    if (avg <= 6) score += 2; else if (avg <= 9) score += 1;           // 手牌平均质量差
    return score >= 3;
  }

  /* ---------------- 道具时机评估（专业档） ---------------- */
  // 兜底：手牌快满时必须把它消化掉，避免"永远等不到时机"而烂在手里
  function handPressure(B) { return B.hand.length >= Rules.HAND_LIMIT - 1; }
  // 预估对手下回合铺场意愿（0~3.5 分）。注意：这是"打分"，只影响用不用它，不是硬门槛 → 不会卡死
  function foeDeployScore(A) {
    var s = 0;
    if (A.hand.length >= 4) s += 1;                                    // 手牌多
    if (A.hand.length >= 6) s += 1;
    if (3 - alive('A').length >= 2) s += 1;                            // 还有铺场空位
    if (A.deck.length > 0) s += 0.5;                                   // 牌库还有货
    return s;
  }
  // 手牌越多越不心疼 → 放宽道具使用限制（手牌少则正常节省）
  function ease(B) {
    var n = B.hand.length;
    if (n >= 8) return 1.5;
    if (n >= 6) return 1.25;
    if (n <= 3) return 0.85;
    return 1;
  }
  // 场上是否有"靠掉血再次发动技能"的怪（黏咕 / 苍蝇群）→ 有则回血要克制，留到引爆之后再回
  function hasHpTrigger(B) {
    return alive('B').some(function (m) { return m.cardId === 'a-012-2' || m.cardId === 'a-007-2'; });
  }
  // 这张增益/恢复道具"现在用值不值"
  function buffWorth(B, A, inst, peek) {
    var cd = C(inst), fb = handPressure(B);
    // 情报：对手资源枯竭（没解场 + 牌库见底）→ 放开手脚，把道具换成节奏
    var ez = ease(B) * ((peek && peek.intel && peek.intel.windowOpen) ? 1.2 : 1);
    // 流派针对：对手是投掷流（单体点杀）→ 保住关键怪一命的收益更高；对手是毒气流（每回合全场掉血）→ 治疗收益打折
    if (peek && peek.intel && peek.intel.foesPlan) {
      var fp0 = peek.intel.foesPlan;
      if (fp0.throw >= 3) ez *= 1.25;
      if (fp0.main === 'poison') ez *= 0.85;
    }
    var hurt = 0, worstRatio = 0;
    alive('B').forEach(function (m) {
      var d = Math.max(0, m.maxHp - m.hp);
      hurt += d;
      if (m.maxHp) worstRatio = Math.max(worstRatio, d / m.maxHp);
    });
    var fighters = alive('B').filter(function (m) { return m.atk > 0; }).length;
    // 极影铃虹：用卷轴可换"持续一回合无法被攻击" → 有它在场且还有次数时，卷轴更值得用（把卷轴当无敌符）
    if (cd.type === 'scroll' && cd.id !== 'a-030-2' && alive('B').some(function (m) {
      var x = cardPlay(m.cardId) || {};
      return x.spellSynergy === 'scrollShadow' && (m.flags.shadowUsed || 0) < 3;
    })) return true;
    switch (cd.id) {
      case 'a-017-2': return (acadOn('acadHeal') ? B.hp < B.maxHp : B.hp <= B.maxHp * Math.min(0.9, 0.6 * ez)) || fb;   // 口粮：学院里掉过血就吃（回血可抵消对手输出）
      case 'a-018-2': return true;                                               // 露珠：回合结束会消失，当回合必用
      case 'a-019-2': case 'a-059-2': {                                          // 治疗药水 / 肉馅饼：按比例，不用绝对阈值
        // 学院考核：卡面带"玩家回血"的（肉馅饼）掉过血就值得用 —— 治疗按 1:1 抵消对手输出
        if (acadOn('acadHeal') && (cd.mods || {}).healPlayer && B.hp < B.maxHp) return true;
        // 我方有怪正处在"对手投掷物正好能补刀"的血线里 → 赶紧回血抢救
        if (peek && peek.maxThrowDmg > 0 && alive('B').some(function (m) { return m.hp > 0 && m.hp <= peek.maxThrowDmg; })) return true;
        var thr = (TUNE.healRatio / ez) * (hasHpTrigger(B) ? TUNE.hpTriggerMul : 1);   // 无黏咕/苍蝇群时限制自动放宽
        return worstRatio >= thr || fb;
      }
      case 'a-084-2': return alive('B').length > 0 && (hurt >= 4 / ez || fighters >= 2 || fb);   // 炖肉
      case 'a-020-2': return fighters >= 2 || fb;                                // 力量药水：≥2 只战斗怪才划算
      case 'a-087-2': {                                                          // 疾速药水（本函数只在专业/冠军档被调用）
        // 专业档以上收紧：仅当"本回合召唤次数已用尽 + 手上确实还有能立刻召唤的怪"时才喝，
        // 喝掉后当回合会马上继续召唤（普通召唤需空位 / 献祭召唤需对应阶位祭品），
        // 避免"次数没用完就先喝掉""喝完没怪可召"这两种空用。
        if ((Engine.state.turnCount || 1) <= 1) return false;                   // 首回合喝无效果（引擎会白烧一张）
        var canSummonNow = function (c) {
          var x = C(c);
          if (!x || x.type !== 'monster') return false;
          if (x.tier === 'C' || x.tier === 'B') return empty('B').length > 0;
          var need = x.tier === 'A' ? ['C', 'B'] : ['A'];
          return alive('B').some(function (mm) { return need.indexOf(mm.tier) >= 0; });
        };
        return (B.summonsLeft === 0 && B.hand.some(canSummonNow)) || fb;
      }
      case 'a-062-2':                                                            // 冰霜药水：作用于"对手下回合"，时机不敏感 → 只要对手还可能铺场就压，别囤手里
        return foeDeployScore(A) >= (TUNE.icePotionFloor || 0.8) / ez || alive('A').length >= 1 || fb;
      case 'a-030-2': return false;                                              // 传送卷轴已在上一步单独评估
      /* ---- 新卡 ---- */
      case 'a-112-2': {                                                          // 全肉大饼：有肉馅饼=全场+2攻；否则只相当于弱化肉馅饼
        var hasPie = B.hand.some(function (c) { return c.cardId === 'a-059-2'; });
        if (hasPie) return alive('B').length > 0 || fb;
        return worstRatio >= (TUNE.healRatio / ez) || fb;
      }
      case 'a-115-2':                                                            // 毒气药水：对方场上有怪就用
        // 毒气是挂在【对手】身上的层数 Buff（engine: state.players[opp].poison += 3），
        // 对手每个回合开始时其【己方所有怪物】各掉 2 点（resolveBuffSettlement）→ 不需要自家有🫒怪配合。
        // 旧实现要求"自己场上已有🫒怪/毒气放大"才会用，而默认卡组（预置/跑图遭遇/多数大赛套路）里根本没有
        // 🫒 怪 → 专业/冠军档永远不满足、药水一直捏在手里（等于自废一张牌）；而且旧条件里的 B.poison 判的是
        // "自己身上的毒气"，与"给对手叠毒"无关，等于恒 false。现在改为"对手场上有怪就喝"，
        // 对手空场时仍留手（那几层毒会在对手没怪时白白递减）。
        return alive('A').length > 0 || fb;
      case 'a-113-2': return B.hand.length <= 8 || fb;                           // 水晶宝箱：抽卡类宝藏，手牌不满就值得
      case 'a-114-2': return alive('A').length > 0 || fb;                        // 回旋镖：每回合都会回手，有目标就打
      case 'a-116-2':                                                            // 镜像卷轴：有强力我方怪 + 有空位（具体目标由 mirrorScrollDecision 决定）
        return empty('B').length > 0 && alive('B').some(function (m) { return atkOut(m) >= 3 || m.weapon || m.armor; });
      default: return alive('B').length > 0 || fb;
    }
  }

  /* ---------------- 虚空锁链：按"位置关系"做一次移动 ---------------- */
  // 我方某槽位的危险度：对手炸弹覆盖 + 我方炸弹同列自伤 + 对位高攻怪
  function dangerAt(B, A, s) {
    var d = 0;
    (A.bombs || []).forEach(function (b) { if (s >= b.slot - 1 && s <= b.slot + 1) d += 2; });
    (B.bombs || []).forEach(function (b) { if (s === b.slot) d += 2; });
    var opp = A.board[s];
    if (opp) d += 0.3 + (opp.atk >= 5 ? 0.7 : 0);
    return d;
  }
  // 对方某槽位"被我方针对"的收益度：我方炸弹覆盖 / 我方喷毒花对位 / 我方骷髅对位 / 我方 DM-100 对位（免疫 → 负分）
  function harmAt(B, A, s) {
    var h = 0;
    (B.bombs || []).forEach(function (b) { if (s >= b.slot - 1 && s <= b.slot + 1) h += 2; });
    if (alive('B').some(function (m) { return m.cardId === 'a-048-2' && slotOf('B', m.uid) === s; })) h += 1.5;  // 喷毒花：对位有敌才 +5 攻
    if (alive('B').some(function (m) { return m.cardId === 'a-071-2' && slotOf('B', m.uid) === s; })) h += 1;    // 骷髅遗言打对位 4 伤
    if (alive('B').some(function (m) { return m.cardId === 'a-075-2' && slotOf('B', m.uid) === s; })) h -= 1.5;  // DM-100 打"非对位"→ 对位反而是安全位
    return h;
  }
  // 时光沙漏（新卡神器 a-120-2）：双方封杀一回合 —— 只在我方场面明显吃紧时开（否则等于白送对手一个喘息）
  function timeStopDecision(B, A) {
    if (skipChain) return null;
    if (!B.artifacts || !B.artifacts.some(function (a) { return a.cardId === 'a-120-2' && !(a.flags && a.flags.cd); })) return null;
    if (B.flags.timeStopUsed) return null;
    var mp = 0, fp = 0;
    alive('B').forEach(function (m) { mp += Math.max(0, m.atk) + m.hp * 0.4; });
    alive('A').forEach(function (m) { fp += Math.max(0, m.atk) + m.hp * 0.4; });
    if (!(fp > mp * 1.25)) return null;                       // 对手不明显更强 → 不用
    if (!alive('B').length && B.hand.filter(function (c) { return C(c).type === 'monster'; }).length < 2) return null;
    return { type: 'TIME_STOP', _ai: true };
  }
  // 镜像卷轴（新卡 a-116-2）：复制我方"最有价值"的怪（攻击同本体、生命 1）
  // 门槛调整（2026-10-15）：旧实现是绝对分 `if (!best || bs < 12) return null;` ——只有 atk≥6（或 atk4+装备、
  //   DM-200/300）的怪才配吃。实战后果：① 1/1 的怨灵永远用不上，而它恰恰是最值得复制的目标之一（复制体继承
  //   "无法被攻击"：对手攻击打不到它，又因我方场上有怪而不能打脸）；② 场上只有弱怪时卷轴会一直烂在手里。
  //   现在改成"低绝对下限(mirrorMin) / 相对我场平均值(mirrorAvgMul) / 手牌压力兜底"三者任一成立就用。
  // 顺序说明：本决策在阶梯 10.7 步，晚于 1)献祭召唤 与 2)普通召唤（见 prepTactical）→ 手里有 A、场上只有 C 时，
  //   会先献祭召唤出 A，再在之后的重评估里把镜像复制给 A（复制体连装备一起继承）。
  function mirrorScrollDecision(B, A) {
    if (skipChain) return null;
    var card = B.hand.filter(function (c) { return c.cardId === 'a-116-2'; })[0];
    if (!card) return null;
    if (B.flags.used && B.flags.used.scroll) return null;      // 每回合卷轴限一张
    if (!empty('B').length) return null;                        // 没有空位就没法衍生
    var mine = alive('B');
    if (!mine.length) return null;                              // 场上没怪＝没有可复制的目标
    var best = null, bs = 0, sum = 0;
    mine.forEach(function (m) {
      var v = atkOut(m) * 2 + (m.weapon ? 4 : 0) + (m.armor ? 3 : 0);
      // 复制"无法被攻击"的怪：engine createMirror 会连 innate 与"到期标记"一起复制 → 复制体同样免疫攻击
      // （对手只能靠投掷物/法杖清掉它，且它挡着打脸），所以额外加权。
      if (m.flags && m.flags.untargetable) v += 4;
      // 注意：镜像体【不会】触发"从手牌召唤上场时"效果（engine createMirror 不调 onSummon、也不走 checkSummonTrap），
      // 所以不再给 DM-200/DM-300 这类"召唤即见效"怪加分——旧实现按此加分，与引擎事实不符。
      sum += v;
      if (v > bs) { bs = v; best = m; }
    });
    if (!best) return null;
    var avg = sum / mine.length;
    // 三个放宽后的条件任一成立就用；手牌压力兜底额外要求 bs > 0（复制 0 攻怪没有兑现价值，宁可留手）
    if (!(bs >= TUNE.mirrorMin || bs >= avg * TUNE.mirrorAvgMul || (handPressure(B) && bs > 0))) return null;
    return { type: 'USE', iid: card.iid, targetUid: best.uid, _ai: true };
  }
  function chainMoveDecision(B, A) {
    if (skipChain) return null;
    if (!B.artifacts || !B.artifacts.some(function (a) { return a.cardId === 'a-094-2'; })) return null;
    if (B.flags.voidChainUsed) return null;
    var freeB = empty('B'), freeA = empty('A');
    if (!freeB.length && !freeA.length) return null;
    var best = null, bestScore = TUNE.chainScore;
    // ① 我方怪：值钱的挪离危险格；廉价的主动挪进危险格当挡箭牌
    alive('B').forEach(function (m) {
      var from = slotOf('B', m.uid);
      if (from < 0) return;
      var w = (Math.max(0, m.atk) * 2 + m.hp) - 8;         // >0 值钱，<0 廉价
      freeB.forEach(function (to) {
        var sc = (dangerAt(B, A, from) - dangerAt(B, A, to)) * w;
        if (sc > bestScore) { bestScore = sc; best = { uid: m.uid, slot: to }; }
      });
    });
    // ② 对方怪：挪进"我方收益高"的格子，或挪出"我方打不到"的格子（DM-100 对位）
    alive('A').forEach(function (m) {
      var from = slotOf('A', m.uid);
      if (from < 0) return;
      var w = 0.6 + Math.max(0, m.atk) / 10;
      freeA.forEach(function (to) {
        var sc = (harmAt(B, A, to) - harmAt(B, A, from)) * w;
        if (sc > bestScore) { bestScore = sc; best = { uid: m.uid, slot: to }; }
      });
    });
    if (!best) return null;
    return { type: 'MOVE_MONSTER', uid: best.uid, slot: best.slot, _ai: true };
  }

  /* ---------------- 交给引擎的 AI 策略：可选技能 + 定向选牌 ---------------- */
  // 卡牌价值（仅用于"检索哪张"）
  function cardValue(cd) {
    if (!cd) return 0;
    if (cd.type === 'monster') return cd.tier === 'S' ? 30 : cd.tier === 'A' ? 22 : cd.tier === 'B' ? 12 : 8;
    return 6;
  }
  // 检索时"该拿哪张"的排序分（按卡功能，而非固定价值）
  function searchScore(cd) {
    if (!cd) return 0;
    var m = cd.mods || {};
    if (cd.type === 'monster') return cd.tier === 'S' ? 30 : cd.tier === 'A' ? 22 : cd.tier === 'B' ? 12 : 8;
    if (cd.type === 'throw') return 4 + (m.dmg || 0);                        // 投掷物：伤害越高越优先（炸弹无 dmg → 4）
    if (cd.type === 'weapon') return 7 + (m.atkBonus || 0) + (m.dmgReduce || 0);
    if (cd.type === 'armor') return 7 + (m.dmgReduce || 0) * 2;              // 减伤越高越优先
    if (cd.type === 'wand') return 10;
    if (cd.type === 'treasure') return 9;
    return 6;
  }
  // 引擎里的"定向选牌"（弃置 / 检索）改由 AI 自己挑，而不是默认取手牌最前一张
  function aiPickChoice(actorKey, st, cands) {
    if (actorKey !== 'B' || !cands || !cands.length) return null;
    var s = Engine.state, B = s.players.B, A = s.players.A;
    var n = st.count || 1;
    if (st.from === 'hand') {
      // 弃置代价：与法杖弃牌同一套评估（自身价值 − 弃置收益）
      return cands.slice().sort(function (x, y) {
        return discardCost(B, A, x, true) - discardCost(B, A, y, true);
      }).slice(0, n).map(function (c) { return c.iid; });
    }
    // 检索：按"卡功能"挑，而不是固定价值（投掷物按伤害 / 武器按强度 / 💰怪按等级）
    return cands.slice().sort(function (x, y) { return searchScore(C(y)) - searchScore(C(x)); })
      .slice(0, n).map(function (c) { return c.iid; });
  }
  // 可选技能是否发动（豺狼巡查）：拿"手牌代价"和"牌库可检索价值"作比较
  function wantOptional(actorKey, inst, steps) {
    if (actorKey !== 'B') return true;
    var s = Engine.state, B = s.players.B, A = s.players.A;
    if (!B.hand.length) return true;                        // 没有手牌可弃 → 白拿一次检索
    if (B.hand.length <= TUNE.jackalMinHand) return false;  // 手牌太少 → 保留手牌，不发动技能
    var cost = Infinity;
    for (var i = 0; i < B.hand.length; i++) cost = Math.min(cost, discardCost(B, A, B.hand[i], true));
    if (cost >= TUNE.preciousCost) return false;            // 最好用的弃牌代价都很珍贵 → 不发动
    var pred = (steps && steps[1] && steps[1].pred) || null;  // 只统计"能被检索到"的卡
    var gain = 0;
    B.deck.forEach(function (c) {
      if (pred && !pred(c)) return;
      var x = C(c), v = cardValue(x);
      if (x.tier === 'A' || x.tier === 'S') v *= 0.6;        // 检索到手 ≠ 直接上场，打折
      if (v > gain) gain = v;
    });
    return gain > cost * TUNE.jackalGainMul;                 // 门槛提高：收益要明显大于代价才发动
  }
  /* ============================================================
   * 冠军档（champion）独占：希望式抽卡 + 起手保底
   *  · 希望抽卡：每次抽牌时，有 P(牌库) 的概率"直接从牌库取走最想要的那张"
   *    （挂载在 engine.js 的 draw() 策略通道上）→ 因为**所有抽牌**都经过 draw()，
   *    过牌卡越多就越容易连锁抽到更多希望卡。P 随牌库缩小线性升高（hopeMin 30% → hopeMax 60%）。
   *  · 希望卡评分：手牌状况（张数 / 手里有没有 A·S 要养）+ 场面控制权（是否需要铺场）
   *    + 卡组流派主线 + 知识库角色 + 牌库还厚时优先过牌。
   *  · 起手保底：必定 ≥1 张 C/B 怪；按卡组 A 卡占比提升"起手出 A"的概率；提高起手出过牌的概率。
   * ========================================================== */
  function otherKey(k) { return k === 'A' ? 'B' : 'A'; }
  function hopeChance(deckN) {
    var full = Math.max(1, Rules.DECK_START || 20);
    var t = 1 - Math.min(1, deckN / full);
    return TUNE.hopeMin + (TUNE.hopeMax - TUNE.hopeMin) * t;
  }
  function hopeScore(inst, B, A, plan) {
    var cd = CARDS[inst.cardId]; if (!cd) return -999;
    var k = cardPlay(cd.id) || {};
    var s = searchScore(cd);                                   // 基础：怪按等级/攻血，道具按类型
    var handN = B.hand.length, deckN = B.deck.length;
    var myN = alive('B').length, foeN = alive('A').length;
    var needBody = myN < Math.min(3, foeN + 1);                // 场面控制权：我方怪更少/空场 → 需要铺场
    var drawCard = (cd.type === 'treasure' || cd.type === 'ring');
    if (drawCard) {
      s *= deckFactor(B);                                      // 牌库越少越不值
      if (handN <= 3) s += 6;                                  // 手牌少 → 过牌更值
      if (deckN >= TUNE.hopeDrawDeckN) s += TUNE.hopeDrawBias; // 牌库还厚 → 提高过牌权重（连锁拿希望卡）
    }
    if (cd.type === 'monster') {
      if (needBody) s += 8;                                    // 场面控制权：需要铺场 → 能立刻落地的怪最值
      // ★关键：A/S 级怪没有"站场祭品"就上不了场，早拿在手里只会堵手牌（实测按卡面价值选牌会让冠军档失去优势）
      var hasMat = alive('B').some(function (m) { return m.tier === 'C' || m.tier === 'B'; });
      if ((cd.tier === 'A' || cd.tier === 'S') && !hasMat) s -= 8;
      if (plan && plan.main === 'poison' && (cd.tags || []).indexOf('🫒') >= 0) s += 4;   // 主线流派
      if (plan && plan.main === 'equip' && (cd.type === 'weapon' || cd.type === 'armor')) s += 4;
      if (hasBigInHand(B) && (cd.tier === 'C' || cd.tier === 'B')) s += 3;                // 手里有 A/S → 材料更值
      if (k.role === 'poisonSource' || k.role === 'poisonAmp' || k.role === 'value' ||
          k.role === 'poisonTank' || k.role === 'aoe') s += 3;                            // 体系/功能怪
    } else if (cd.type === 'weapon' || cd.type === 'armor') {
      s += alive('B').some(function (m) { return !m.weapon && !m.armor; }) ? 2 : -5;      // 没人能装 → 大幅降权
    } else if (cd.type === 'throw' || cd.type === 'wand') {
      if (foeN > 0) s += 2;
    } else if (cd.type === 'food' || cd.type === 'potion') {
      s += alive('B').length ? 1 : -3;
    }
    return s;
  }
  function aiHopePick(key, p) {
    if (!p || !p.isAI || diff !== 'champion') return null;
    if (!p.deck.length) return null;
    if (Engine.rand() >= hopeChance(p.deck.length)) return null;   // 未触发 → 正常抽牌库顶
    var A = Engine.state.players[otherKey(key)];
    var plan = selfPlan(p);
    var best = null, bestSc = -1e9;
    p.deck.forEach(function (c) { var sc = hopeScore(c, p, A, plan); if (sc > bestSc) { bestSc = sc; best = c; } });
    return best ? { iid: best.iid } : null;
  }
  function isBodyCard(c) { var cd = CARDS[c.cardId]; return cd && cd.type === 'monster' && (cd.tier === 'C' || cd.tier === 'B'); }
  function isBigCard(c) { var cd = CARDS[c.cardId]; return cd && cd.type === 'monster' && (cd.tier === 'A' || cd.tier === 'S'); }
  function isDrawerCard(c) { var cd = CARDS[c.cardId]; return cd && (cd.type === 'treasure' || cd.type === 'ring'); }
  // 用牌库里的一张"目标卡"换掉手牌里最可弃的一张（1 换 1，不改变牌库/手牌总数）
  function rigSwap(p, pred) {
    var di = -1;
    for (var i = 0; i < p.deck.length; i++) if (pred(p.deck[i])) { di = i; break; }
    if (di < 0) return false;
    var got = p.deck.splice(di, 1)[0];
    var back = 0, worst = 1e9;                                 // 换出：优先换掉"非怪物"的那张
    p.hand.forEach(function (c, idx) { var sc = isBodyCard(c) ? 2 : (CARDS[c.cardId].type === 'monster' ? 1 : 0); if (sc < worst) { worst = sc; back = idx; } });
    var out = p.hand.splice(back, 1)[0];
    p.deck.push(out);
    p.hand.push(got);
    return true;
  }
  function aiHandRig(key, p) {
    if (!p || !p.isAI || diff !== 'champion') return;
    if (!p.hand.some(isBodyCard)) rigSwap(p, isBodyCard);                       // ① 至少 1 张 C/B 怪（必定）
    var aN = 0, total = 0;
    p.deck.concat(p.hand).forEach(function (c) { total++; if (isBigCard(c)) aN++; });
    var pA = Math.min(1, TUNE.hopeA * ((total ? aN / total : 0) / 0.15));       // ② 起手"A 保底"（随卡组 A 占比提高）
    if (!p.hand.some(isBigCard) && Engine.rand() < pA) rigSwap(p, isBigCard);
    if (!p.hand.some(isDrawerCard) && Engine.rand() < TUNE.hopeDraw) rigSwap(p, isDrawerCard);   // ③ 起手过牌保底
  }

  // 绑定策略（引擎先于/后于本文件加载都能生效）
  var policyBound = false;
  function ensurePolicy() {
    if (policyBound || !Engine || !Engine.setAIPolicy) return;
    Engine.setAIPolicy({
      optional: wantOptional, pickChoice: aiPickChoice,
      hopePick: aiHopePick, handRig: aiHandRig
    });
    policyBound = true;
  }
  ensurePolicy();
  // 手牌是否已有 A/S 怪（决定"以召唤高级怪为目的"的材料选择）
  function hasBigInHand(B) {
    return B.hand.some(function (c) { var x = C(c); return x.type === 'monster' && (x.tier === 'A' || x.tier === 'S'); });
  }
  // 牌库是否还有任何"💰"怪（豺狼巡查的检索对象，不限等级）
  function deckHasCoin(B) {
    return B.deck.some(function (c) {
      var x = C(c);
      return x.type === 'monster' && (x.tags || []).indexOf('💰') >= 0;
    });
  }
  // 卡组里是否还有 A/S 级"💰"怪（豺狼巡查的优质检索目标）
  function deckHasBigCoin(B) {
    return B.deck.some(function (c) {
      var x = C(c);
      return x.type === 'monster' && (x.tier === 'A' || x.tier === 'S') && (x.tags || []).indexOf('💰') >= 0;
    });
  }
  // 是否还想要武器：卡组里有武器 且（场上/手牌还有怪能拿武器）
  function weaponWanted(B) {
    if (!B.deck.some(function (c) { return C(c).type === 'weapon'; })) return false;
    if (alive('B').some(function (m) { return !m.weapon; })) return true;
    return B.hand.some(function (c) { var x = C(c); return x.type === 'monster' && (x.tier === 'C' || x.tier === 'B'); });
  }
  /* ---------------- 召唤的"卡功能基础分" ----------------
   * 体系发动机（毒气源/毒气坦克/群伤）不能被当成"最差的怪"排在最后，
   * 否则会一直攥在手里 → 场面失控。
   */
  var ROLE_SCORE = {
    combat: 6, sacCombat: 6, value: 5, material: 4, wall: 5,
    poisonSource: 6, poisonTank: 6, poisonAmp: 5, aoe: 5, growth: 5
  };
  /* ---------------- 择时窗口（收益最大化） ----------------
   * 返回"窗口加成"：条件满足 = 收益最大化时机（大幅加分）；
   * 不满足 = 0 分，但**绝不排除该牌**——照常按自身数值/角色分参与，
   * 因为"为了等窗口而把手里的怪攥死"等于放弃场面控制权。
   */
  function windowBonus(B, A, cd, k, foes) {
    var w = k.summonWindow && k.summonWindow.w;
    if (!w) return 0;
    var b = k.summonWindow.bonus || 6;
    if (w === 'boardEmptyAndFoe') return (alive('B').length === 0 && foes.length > 0) ? b : 0;
    if (w === 'rotMarks>=4') {
      var rm = A.rotMarks || 0;
      return rm >= 4 ? b : (rm >= 2 ? b * 0.5 : 0);            // 攒到一半给半价，别死等满层
    }
    if (w === 'foeCount>=2') return foes.length >= 2 ? b : 0;
    if (w === 'hpBelow30') return B.hp < 30 ? b : 0;
    return 0;
  }
  // 场面是否需要立刻补位（空场 / 我方怪比对手少 / 场面吃紧）
  function needBodyNow(B, A) {
    var m = alive('B').length, f = alive('A').length;
    return m === 0 || m < f || boardUnfavorable();
  }
  /* ---------------- 召唤循环保护（喷毒花 a-048-2） ----------------
   * 卡面：对位有敌且「我方场上仅有此卡」时攻击+5，并且回合结束返回手牌。
   * 于是"只召它"会自锁：只召它 → 我方空场 → 窗口成立(+5) → 回合结束回手 → 又只召它……
   * 结果是手里一堆怪却永远不铺场、它反复出场回手。
   * 规则：刚被回手的窗口卡本回合不再无脑优先（窗口照旧可用，只是不做首选），
   *       手里还有别的怪时让位给它们 —— 场面一旦铺开，它就不再触发回手，自然变成常驻体。
   */
  function isBounceWindowCard(inst) {
    var k = cardPlay(inst.cardId) || {};
    return !!(k.summonWindow && k.summonWindow.w === 'boardEmptyAndFoe');
  }
  function bouncedRecently(inst) {
    // 判据是"这张手牌是**被回手**回来的"这个事实本身（不是限时窗口：限时会在隔一回合后失效，
    // 于是 AI 又召它 → 又回手 → 变成两回合一次的循环）
    return !!(inst && inst.returnedTurn);
  }
  function bouncePenalty(inst) {
    if (!TUNE.bouncePenalty) return 0;
    return (bouncedRecently(inst) && isBounceWindowCard(inst)) ? TUNE.bouncePenalty : 0;
  }
  // 按卡功能挑召唤目标（返回 {inst, slot} 或 null=本回合不召唤该）
  function expertPickSummon(B, A, cands, peek) {
    var foes = alive('A');
    var big = hasBigInHand(B);                                  // 手里有没有 A/S 等着被献祭进化
    var out = [];
    var myN = alive('B').length, foeN = foes.length;
    cands.forEach(function (inst) {
      var cd = C(inst), k = cardPlay(cd.id) || {};
      // 择时窗口只当"加分"，绝不当门槛：窗口没到就照常按数值/角色分参与，
      // 不能为了等收益最大化而把手里的怪攥死、丢掉场面控制权
      var winSc = windowBonus(B, A, cd, k, foes);
      // 按卡功能决定"这回合值不值得打出来"（不满足就走原计划，属"无奈可违背"）
      if (k.summonNeed === 'handA' && !big) return;                        // 怨灵/苍蝇群：手里没有可升的高级怪就不急着铺材料
      // 豺狼巡查：门槛放宽为"牌库还有任何💰怪"即可（技能可选；不发动就是普通 6/10 驻场怪）
      if (k.summonNeed === 'needCoinSearch' && !deckHasCoin(B) && !k.softSummon) return;
      if (k.summonNeed === 'needWeapon' && !weaponWanted(B) && !k.softSummon) return; // 活化石像：不需要武器就不打
      var role = k.role || 'combat';
      // 学院考核：用"星级后的实战数值"计分（2★/3★ 数值翻倍 → 自然排在高星一边）
      var sc = smAtk(cd, inst) * 2 + smHp(cd, inst) * 0.5 + (ROLE_SCORE[role] || 3) + winSc - bouncePenalty(inst);
      // 场面控制优先：我方怪比对手少（或已空场）时，体系卡也照常上场补位，绝不空过
      if (myN < foeN && (role === 'poisonSource' || role === 'poisonAmp' || role === 'poisonTank' || role === 'aoe')) sc += 2;
      // 肉盾类提权：只在"手里确实有 A/S 要升、需要祭品"时生效（无条件提权会顶掉更优质的铺场怪）
      if (big && k.summonBias) sc += k.summonBias;
      if (big && role === 'material') sc += 8;                             // 以召唤 A/S 为目的 → 优质祭品材料优先上场
      if (big && k.summonNeed === 'handA' && peek && !peek.canRemoveSmall) sc += 4;  // 我方材料（1血不可被攻击）不会被清 → 材料更安全
      if (peek && peek.weakHand) sc += 3;                                  // 已知玩家手牌很弱 → 更激进铺场
      if (peek && peek.intel && peek.intel.windowOpen) sc += 3;            // 对手解场/资源枯竭 → 放开手脚铺场
      if (k.summonNeed === 'needCoinSearch' && !deckHasBigCoin(B)) sc -= 4; // 豺狼巡查：只能检索到低阶💰怪 → 略降级
      if (k.garrison === false) sc -= 6;                                   // 不驻场卡不作优先材料
      var slot = expertSlot(B, A, cd, k);
      if (slot == null) return;
      out.push({ inst: inst, slot: slot, sc: sc });
    });
    if (!out.length) return null;
    out.sort(function (a, b) { return b.sc - a.sc; });
    return out[0];
  }
  // A/S 卡的"何时才值得献祭召唤"（联动类：场上有对应道具/联动怪才出）
  function bigSummonOK(B, k) {
    if (handPressure(B)) return true;                                   // 兜底：手牌快满就别再等了
    if (k.summonNeed === 'hasWand') return !!B.wand || B.hand.some(function (c) { return C(c).type === 'wand'; });          // 茉莉伊洛
    if (k.summonNeed === 'hasScroll') return B.hand.some(function (c) { return C(c).type === 'scroll'; });                  // 极影铃虹
    if (k.summonNeed === 'hasThrow') {                                  // 姬莲梅錵 / 豺狼猎手
      return B.hand.some(function (c) { return C(c).type === 'throw'; })
        || alive('B').some(function (m) { return (cardPlay(m.cardId) || {}).spellSynergy === 'throwHeal'; });
    }
    return true;
  }
  // 献祭召唤时"希望结果落在哪个槽位"（A/S 卡也吃 slotPref；结果槽=被献祭怪所在槽）
  function wantSlotFor(B, A, k) {
    if (k.slotPref === 'danger' || k.slotPref === 'safe') {
      var best = null, bv = (k.slotPref === 'danger') ? -1e9 : 1e9;
      for (var s = 0; s < 3; s++) {
        var d = slotDanger(A, s) + (B.board[s] ? 0.4 : 1.2);      // 倾向落在"有牺牲对象"的槽
        if (k.slotPref === 'danger' ? d > bv : d < bv) { bv = d; best = s; }
      }
      return best;
    }
    if (k.slotPref === 'leftmost') return 0;
    if (k.slotPref === 'oppositeThreat') {
      var foe = strongestByThreat(alive('A').filter(function (m) { return !m.flags.untargetable; }), null);
      return foe ? slotOf('A', foe.uid) : null;
    }
    return null;
  }
  // "必须保留的空位数"：天狗需要有空格才能移动 + 成长 + 产苦无
  function keepSlotNeeded(B) {
    var need = 0;
    alive('B').forEach(function (m) { var k = cardPlay(m.cardId) || {}; if (k.keepEmptySlot) need = Math.max(need, k.keepEmptySlot); });
    return need;
  }
  // 知识库 slotPref 指定的站位（返回 null = 无指定 / 条件不满足，交给原计划）
  function prefSlot(B, A, k) {
    var free = empty('B');
    if (!free.length) return null;
    if (k.slotPref === 'danger') {                     // 主动占最危险处（吸伤 / 挨打反毒 / 等被引爆）
      var w = free[0], wd = -1e9;
      free.forEach(function (s) { var d = slotDanger(A, s); if (d > wd) { wd = d; w = s; } });
      return w;
    }
    if (k.slotPref === 'safe') {                       // 强制最安全位（工厂类保场）
      var b = free[0], bd = 1e9;
      free.forEach(function (s) { var d = slotDanger(A, s); if (d < bd) { bd = d; b = s; } });
      return b;
    }
    if (k.slotPref === 'leftmost') return free.indexOf(0) >= 0 ? 0 : free[0];            // 疯狂强盗：留出右移空间
    if (k.slotPref === 'oppositeThreat') {             // 监狱守卫：放到对手最高威胁怪的对位
      var foe = strongestByThreat(alive('A').filter(function (m) { return !m.flags.untargetable; }), null);
      if (foe) { var fs = slotOf('A', foe.uid); if (fs >= 0 && free.indexOf(fs) >= 0) return fs; }
      return null;
    }
    return null;
  }
  // 按卡功能选召唤槽位
  function expertSlot(B, A, cd, k) {
    var free = empty('B');
    if (!free.length) return null;
    var id = cd.id;
    if (id === 'a-045-2') return free.indexOf(1) >= 0 ? 1 : free[0];                 // 食人鱼→中位
    // 喷毒花→目标对位；理想位被占就退用常规选位，绝不因为站位不理想而放弃召唤
    if (id === 'a-048-2') { var psl = poisonSlot(A, free); return psl != null ? psl : chooseSummonSlot(B, A, cd); }
    if (id === 'a-075-2') { var em = free.filter(function (s) { return !A.board[s]; }); return em.length ? em[0] : free[0]; } // DM-100→对位为空处
    var ps = prefSlot(B, A, k);                                                     // 知识库指定的站位优先
    if (ps != null) return ps;
    return chooseSummonSlot(B, A, cd);
  }
  // 喷毒花：找一个"对位为空"的敌方目标
  function poisonSlot(A, free) {
    var foes = alive('A').filter(function (m) { return !m.flags.untargetable; })
      .sort(function (a, b) { return threatOf(b, null) - threatOf(a, null); });
    for (var i = 0; i < foes.length; i++) {
      var s = slotOf('A', foes[i].uid);
      if (s >= 0 && free.indexOf(s) >= 0) return s;
    }
    return null;
  }

  // 召唤站位：贵怪放安全位；便宜/坦克怪填威胁位
  function slotDanger(A, s) {
    var d = 0;
    (A.bombs || []).forEach(function (b) {
      if (s >= b.slot - 1 && s <= b.slot + 1) d += 2;
    });
    var opp = A.board[s];
    if (opp) d += 0.5 + (opp.atk >= 5 ? 1 : 0);
    return d;
  }
  function chooseSummonSlot(B, A, monsterCd) {
    var free = empty('B');
    if (!free.length) return null;
    if (free.length === 1) return free[0];
    var value = monsterCd ? (monsterCd.atk * 2 + monsterCd.hp) : 5;
    var cheap = value <= 6;
    var best = free[0], bestScore = -1e9;
    free.forEach(function (s) {
      var d = slotDanger(A, s);
      var score = cheap ? d : -d;
      if (score > bestScore) { bestScore = score; best = s; }
    });
    return best;
  }

  // 投掷物目标：炸弹→打怪堆；普通→(专业读S)先打可能升S的A / 补刀 / 清不可攻击 / 最高威胁
  function chooseThrowTarget(th, peek) {
    var enemies = alive('A');
    if (!enemies.length) return null;
    if (th.cardId === 'a-086-2') return bestBombTarget(enemies);
    var dmgNow = (C(th).mods && C(th).mods.dmg) || 0;
    // ★ 补刀优先：投掷物伤害普遍只有 3~6 点，能直接击杀时绝不去蹭高血量目标
    //   （旧逻辑把"玩家手上有 S 卡 → 先打对方 A 级怪防进化"放在补刀之前，等于用低伤投掷物去磨 14 血大怪）
    if (TUNE.throwKillFirst && enemies.some(function (m) { return m.hp <= dmgNow; })) {
      return strongestByThreat(enemies.filter(function (m) { return m.hp <= dmgNow; }), peek);
    }
    if (peek && peek.hasS) {
      var aTier = enemies.filter(function (m) { return m.tier === 'A'; });
      if (aTier.length) return strongestByThreat(aTier, peek);
    }
    var dmg = (C(th).mods && C(th).mods.dmg) || 0;
    var finish = enemies.filter(function (m) { return m.hp <= dmg; });
    if (finish.length) return strongestByThreat(finish, peek);
    var un = enemies.filter(function (m) { return m.flags.untargetable; });
    if (un.length) return strongestByThreat(un, peek);
    return strongestByThreat(enemies, peek);
  }
  function bestBombTarget(enemies) {
    var best = enemies[0], bestN = -1;
    enemies.forEach(function (m) {
      var s = slotOf('A', m.uid);
      var n = 0;
      enemies.forEach(function (o) { var os = slotOf('A', o.uid); if (os >= s - 1 && os <= s + 1) n++; });
      if (n > bestN) { bestN = n; best = m; }
    });
    return best;
  }

  /* ---------------- 战斗（战术）：等级权重围攻 + 集火 ----------------
   * L1：战斗阶段的"卡库知识"（攻击代价规避 / 连杀 / 0攻特效怪 / 换装优先 / 最小输出调度）
   *     改为**专业档独占**——业余档退回"按威胁与血量挑目标"的粗逻辑。
   */
  function battleAmateur() { return battleSmart(peekHand(), false); }
  function battlePro() { return battleSmart(peekHand(), true); }   // 专业：卡库知识 + 斩杀前瞻

  function battleSmart(peek, expert) {
    var mine = myAttackers();
    if (!mine.length) return { type: 'END_TURN', _ai: true };
    var enemies = alive('A');
    var attackable = enemies.filter(function (m) { return !m.flags.untargetable; });
    if (enemies.length === 0) return { type: 'ATTACK', attackerUid: strongest(mine).uid, targetKey: 'A', _ai: true };
    if (attackable.length === 0) return { type: 'END_TURN', _ai: true };
    var atk = chooseAttack(Engine.state.players.B, Engine.state.players.A, mine, attackable, peek, expert);
    if (!atk) return { type: 'END_TURN', _ai: true };
    if (atk.face) return { type: 'ATTACK', attackerUid: atk.attackerUid, targetKey: 'A', _ai: true };   // L8：清场后剩余攻击打脸
    return { type: 'ATTACK', attackerUid: atk.attackerUid, targetUid: atk.targetUid, _ai: true };
  }

  // 攻击目标选择（专业档）
  //  ① 攻击者池 = 有实际输出的怪 + "0攻也要出手"的骚扰怪(disruptAttack)
  //  ② 偷装备怪(preferEquipped)：同威胁下优先打带装备的敌怪
  //  ③ 连杀怪(chainKill)：优先选"能一击必杀"的目标（击杀后可再攻击）
  //  ④ 其余：能杀 top（含集火）→打 top；打不死 → 先杀其他能杀的；都不会 → 削 top
  /* ---------------- L8 攻击序列枚举（专业档独占） ----------------
   * 把本回合"谁打谁"的整条序列全部枚举出来（最多 3 只攻击者 × (目标+打脸) → ≤64 种组合），
   * 用静态评估挑最优，然后**只执行第一步**（每次攻击后重算，天然适配战况变化）。
   *   评估 = Σ击杀收益(威胁值−击杀代价) + Σ削血×0.35 + Σ打脸伤害×1.0
   *   约束 = 对方场上还有怪时不能打脸（含"无法被攻击"的怪）；已死目标不能再打。
   * 与逐步贪心的区别：贪心是"每步局部最优"，会在"大怪打小怪"时白白溢出伤害；
   * 枚举做的是全局最优匹配（用最小够用的怪去清场，把大怪留给打脸/后续）。
   */
  // 攻击者档案：把引擎 doAttack/postAttackProps 里的"附加效果"提取出来，供 L8 评分使用
  //   extra    每次攻击固定附加伤害   posExtra 仅"非对位"追加（长矛）  faceBonus 打脸附加
  //   evTicket 期望额外出手（螃蟹 50% 可反复）  killTicket 击杀后 +1 次（蕾零安洁）  stealEq 攻击夺装备（疯狂强盗）
  function atkProfile(m) {
    var prof = { extra: 0, posExtra: 0, faceBonus: 0, evTicket: 0, killTicket: 0, stealEq: false };
    if (m.cardId === 'a-100-2') prof.extra += 7;                        // 澪：攻击后额外 7 伤
    if (m.cardId === 'a-044-2') prof.extra += 2;                        // 白化小鼠：目标生命-2
    if (m.cardId === 'a-050-2') prof.faceBonus += 3;                     // 蚱蜢：打脸额外 3（并离场）
    if (m.cardId === 'a-073-2' || m.cardId === 'a-074-2') prof.faceBonus += 1;  // 疯狂小偷/强盗：打脸夺牌
    if (m.cardId === 'a-074-2') prof.stealEq = true;                      // 疯狂强盗：攻击怪物可夺装备
    if (m.cardId === 'a-011-2') prof.evTicket += 1;                       // 水道螃蟹EX：50% 可反复 → 期望 +1 次
    if (m.cardId === 'a-95-2') prof.killTicket += 1;                      // 蕾零安洁：击杀后 +1 次出手
    if (m.cardId === 'a-038-2' && m.flags.rogueBonus) prof.extra += 3;    // 盗贼B：脱隐那一次 +3
    if (m.weapon) {
      var w = m.weapon.cardId, lv = m.weapon.level || 0, wm = (CARDS[w] || {}).mods || {};
      if (w === 'a-093-2') {                                             // 长矛：非对位追加（Lv0=1/Lv1=2/Lv2=4）
        prof.posExtra = lv >= 1 ? ((wm.upgrade && wm.upgrade[lv - 1] && wm.upgrade[lv - 1].splash) || 1) : (wm.splash || 1);
      }
      if (w === 'a-99-2') {                                              // 碧灰双刃：概率追加 → 期望值
        var ch = lv >= 1 ? ((wm.upgrade && wm.upgrade[lv - 1] && wm.upgrade[lv - 1].procChance) || 0) : (wm.procChance || 0);
        prof.extra += ch * (wm.procDmg || 0);
      }
    }
    return prof;
  }
  /* L8 攻击序列枚举：DFS 覆盖"连杀全流程"（击杀→额外出手）与"攻击附加效果"（澪+7/白化小鼠+2/长矛非对位追加/双刃概率/夺装备/打脸附加）
   * 辅助模式下额外记录"以贪心动作为起手"的最优分，只有明显更优才介入。
   * 节点上限 4000（超限即按已搜到的结果为准）→ 保证每次决策都在毫秒级。 */
  function planAttackSequence(B, A, mine, attackable, peek, greedy) {
    var foes = attackable.slice(0, 3);
    if (!foes.length) return null;
    var hasUnt = alive('A').some(function (m) { return m.flags.untargetable; });
    var tickets = [];
    mine.forEach(function (m) {
      var k = cardPlay(m.cardId) || {};
      if (!(atkOut(m) > 0 || k.attackWorth)) return;
      var prof = atkProfile(m);
      var left = Math.max(1, (m.flags.attacksMax || 1) - (m.flags.attacked || 0));
      var rep = Math.min(left + prof.evTicket, 3);
      var mslot = slotOf('B', m.uid);
      for (var i = 0; i < rep; i++) tickets.push({ m: m, uid: m.uid, dmg: atkOut(m), prof: prof, slot: mslot });
    });
    if (!tickets.length) return null;
    // 上限 5 → 分支 ≤ 5^5。按输出从高到低截断：原来按棋盘顺序截，后排的大怪/澪会被整段丢掉
    if (tickets.length > 5) tickets = tickets.slice().sort(function (a, b) { return b.dmg - a.dmg; }).slice(0, 5);
    var T = foes.length;
    var fslot = foes.map(function (f) { return slotOf('A', f.uid); });
    var val = foes.map(function (f) { return threatOf(f, peek); });
    var maxD = 0;
    tickets.forEach(function (t2) { var v = t2.dmg + t2.prof.extra + t2.prof.posExtra; if (v > maxD) maxD = v; });
    var pen = foes.map(function (f) { return targetPenalty(B, f, f.hp <= maxD); });
    var nodes = 0, best = null, bestSc = -1e9, gSc = -1e9;
    var t0 = tickets.slice();
    function matchesGreedy(step) {
      if (!greedy || !step) return false;
      if (step.uid !== greedy.attackerUid) return false;
      return greedy.face ? step.ti < 0 : (step.ti >= 0 && foes[step.ti].uid === greedy.targetUid);
    }
    (function dfs(i, hp, leftN, sc, plan) {
      if (nodes++ > 4000) return;
      if (i >= tickets.length) {
        if (sc > bestSc) { bestSc = sc; best = plan.slice(); }
        var f0 = null;
        for (var j = 0; j < plan.length; j++) if (plan[j]) { f0 = plan[j]; break; }
        if (matchesGreedy(f0) && sc > gSc) gSc = sc;
        return;
      }
      var tk = tickets[i];
      for (var choice = -1; choice < T; choice++) {              // -1 = 这张票不出手
        if (choice < 0) { plan.push(null); dfs(i + 1, hp, leftN, sc, plan); plan.pop(); continue; }
        if (hp[choice] <= 0) { plan.push(null); dfs(i + 1, hp, leftN, sc, plan); plan.pop(); continue; }
        var d = tk.dmg + tk.prof.extra;
        if (tk.prof.posExtra && tk.slot !== fslot[choice]) d += tk.prof.posExtra;     // 长矛非对位追加
        // 巨钳蟹本阶段已受伤 → 攻击免疫：枚举里也按 0 计（这段只被专业/冠军调用），
        // 免得出力白费。新手/业余不碰这条，保持原来的粗放行为。
        if (attackImmuneNow(foes[choice])) d = 0;
        var h2 = hp.slice(), l2 = leftN, s2 = sc;
        var killed = d >= h2[choice];
        if (killed) { s2 += val[choice] - pen[choice]; h2[choice] = 0; l2--; }
        else { s2 += d * 0.35; h2[choice] -= d; }
        if (killed && tk.prof.stealEq) { var f = foes[choice]; if (f.weapon || f.armor) s2 += 3; }
        plan.push({ uid: tk.uid, ti: choice });
        if (killed && tk.prof.killTicket) {                     // 连杀全流程：击杀后追加一张同怪的票
          tickets.push({ m: tk.m, uid: tk.uid, dmg: tk.dmg, prof: tk.prof, slot: tk.slot });
        }
        dfs(i + 1, h2, l2, s2, plan);
        if (tickets.length > t0.length && tickets[tickets.length - 1] === tk) tickets.pop();
        plan.pop();
      }
      // 打脸（场面已空且没有打不到的怪）；"不出手"已由上面 choice = -1 覆盖，避免重复分支
      if (leftN === 0 && !hasUnt) {
        var fd = Math.min(tk.dmg, Math.max(0, A.hp)) + tk.prof.faceBonus;   // 学院考核里 A.hp 可为负 → 打脸价值不为负
        plan.push({ uid: tk.uid, ti: -1 });
        dfs(i + 1, hp, leftN, sc + fd, plan);
        plan.pop();
      }
    })(0, foes.map(function (f) { return f.hp; }), T, 0, []);
    if (!best) return null;
    if (greedy) {                                               // 辅助模式：没明显更好 → 交回贪心
      if (gSc < -1e8) return null;
      if (bestSc - gSc < (TUNE.enumAtkMin || 3)) return null;
    }
    for (var m3 = 0; m3 < best.length; m3++) {
      if (!best[m3]) continue;
      return best[m3].ti < 0
        ? { attackerUid: best[m3].uid, targetUid: null, face: true }
        : { attackerUid: best[m3].uid, targetUid: foes[best[m3].ti].uid };
    }
    return null;
  }
  function chooseAttack(B, A, mine, attackable, peek, expert, noEnum) {
    // L8：专业档的"攻击序列枚举"。enumAtk=1 直接替换贪心；enumAtk=2（默认）改为辅助：
    //     先拿贪心的选择，只有枚举能证明"以贪心起手"明显更差时才介入（避免模型盲区造成误伤）。
    if (expert && TUNE.enumAtk && !noEnum) {
      var greedy = (TUNE.enumAtk === 2) ? chooseAttack(B, A, mine, attackable, peek, expert, true) : null;
      var sq = planAttackSequence(B, A, mine, attackable, peek, greedy);
      if (sq) return sq;
    }
    // 出手资格一律按"每次攻击的真实输出"：澪（0 攻、每击 7 伤）四档都要会用，不能站着当木桩。
    // 业余档保留"不精通"的部分：目标选择 / 斩杀前瞻 / 结算顺序仍不做（见下方 expert 分支）。
    var out = function (m) { return atkOut(m); };
    var pool = mine.filter(function (m) { return out(m) > 0 || (expert && attackWorth(m)); });
    if (!pool.length) return null;
    var remainingAtk = 0, maxAtk = 0;
    pool.forEach(function (m) { remainingAtk += out(m); if (out(m) > maxAtk) maxAtk = out(m); });
    // L3/L7 伤害排程：斩杀模式，或"本回合攻击输出足以清空对手场面"时，
    // 都改为"最省的清场优先"——清完场面后剩余攻击全部打脸（否则等于把打脸的输出浪费在场上）
    var lethal = expert && lethalNow(B, A);
    var clearAll = expert && TUNE.planSeq && !lethal && boardCanClear(A, pool);
    var steal = expert && pool.some(function (m) { return (cardPlay(m.cardId) || {}).preferEquipped; });
    // 学院考核：只有"真正计入输出"的伤害才有价值 → 高减伤/高护盾（会吃掉输出）的目标降权
    var acadCr = acadOn('acadCredit');
    var waste = function (m) { return Engine.dmgReduce(m) + (m.shield || 0); };
    var order = attackable.slice().sort(function (a, b) {
      if (lethal) return a.hp - b.hp;                                // 斩杀模式：最便宜的挡路怪先清
      var sa = threatOf(a, peek), sb = threatOf(b, peek);
      if (steal) { sa += (a.weapon || a.armor) ? 12 : 0; sb += (b.weapon || b.armor) ? 12 : 0; }
      if (expert) {                                                  // 卡库知识：击杀/攻击代价（会帮到对手的降优先）
        sa -= targetPenalty(B, a, a.hp <= maxAtk);
        sb -= targetPenalty(B, b, b.hp <= maxAtk);
      }
      if (acadCr) { sa -= waste(a) * 1.5; sb -= waste(b) * 1.5; }
      // 伤害排程：本回合能清空场面时，在"代价相同"的前提下优先清便宜的挡路怪（省攻击次数留给打脸）
      if (clearAll && sa === sb) return a.hp - b.hp;
      // 普通模式：已知对手有治疗 → 打不死的目标先别浪费输出。
      // 学院考核里"打怪同样按满额计入输出"，没有浪费一说（能多打一点就多拿一分）→ 该回避取消
      if (peek && peek.hasHeal && !acadCr) {
        if (a.hp > maxAtk) sa -= 4;
        if (b.hp > maxAtk) sb -= 4;
      }
      return sb - sa;
    });
    var top = order[0];
    var chainer = expert ? pool.filter(function (m) { return (cardPlay(m.cardId) || {}).chainKill; })[0] : null;
    var target;
    if (chainer) {                                                     // 连杀：优先能一击必杀的
      var kills = order.filter(function (e) { return e.hp <= out(chainer); });
      target = kills.length ? kills[0] : top;
    } else if (top.hp <= maxAtk || top.hp <= remainingAtk) {
      target = top;
    } else {
      var killables = order.filter(function (e) { return e.hp <= maxAtk || e.hp <= remainingAtk; });
      target = killables.length ? killables[0] : top;
    }
    if (!target) return null;
    /* 最优目标"打了也没收益"（如已免疫的巨钳蟹）→ 退而求其次，避免白费出力。
     * 学院考核里血量可以扣成负数 → lethalNow 几乎总是成立；旧写法用 "!lethal" 把这条一起跳过，
     * 于是 AI 会盯着"场上血最少、但本阶段其实免伤"的巨钳蟹白打一整轮（已用探针复现）。
     * 现在：完全免伤的目标一律规避（只有确实没有别的可打目标时才回头打它）；
     *       其它"打了不划算"的代价（澪的击杀代价等）仍保持只在非斩杀模式下回避，行为不变。 */
    if (expert && (attackImmuneNow(target) || (!lethal && targetPenalty(B, target, target.hp <= maxAtk) >= 8))) {
      var alt = order.filter(function (e) {
        return e !== target && !attackImmuneNow(e) && targetPenalty(B, e, e.hp <= maxAtk) < 8;
      })[0];
      if (alt) target = alt;
    }
    var atker = null;
    if (chainer && target.hp <= out(chainer)) atker = chainer;         // 让连杀怪出手，赚一次【再攻击】
    if (!atker && expert && target.hp <= maxAtk) {
      var enough = pool.filter(function (m) { return out(m) >= target.hp; })
        .sort(function (a, b) { return out(a) - out(b); });            // 刚好够杀的最小输出者（省下大怪打脸）
      atker = enough.length ? enough[0] : null;
    }
    if (!atker) atker = strongestByOut(pool);      // 一律按真实输出挑：0 攻特效怪也能被选中出手
    if (!atker) return null;
    return { attackerUid: atker.uid, targetUid: target.uid };
  }

  /* ---------------- L3 前瞻计算（专业档独占） ----------------
   * lethalNow  ：本回合能否直接带走对手——用"最小够用输出"贪心清空其场面后，剩余输出 ≥ 对手生命
   * lethalSoon ：下回合大概率能带走——我场输出 + 手上投掷物伤害 ≥ 对手生命，且其场面没有打不到的怪
   */
  function lethalNow(B, A) {
    var mine = myAttackers().filter(function (m) { return atkOut(m) > 0; });
    var foes = alive('A');
    if (!mine.length || !foes.length) return false;
    if (foes.some(function (m) { return m.flags.untargetable; })) return false;   // 有打不到的怪 → 无法清场
    var outs = mine.map(function (m) { return atkOut(m); }).sort(function (a, b) { return a - b; });
    var total = 0; outs.forEach(function (v) { total += v; });
    var need = foes.map(function (m) { return m.hp; }).sort(function (a, b) { return a - b; });
    var used = [], spent = 0;
    for (var i = 0; i < need.length; i++) {
      var hit = -1;
      for (var j = 0; j < outs.length; j++) { if (used.indexOf(j) < 0 && outs[j] >= need[i]) { hit = j; break; } }
      if (hit < 0) return false;                                                  // 清不掉场面 → 谈不上斩杀
      used.push(hit); spent += outs[hit];
    }
    return (total - spent) >= A.hp;
  }
  /* L6c：两回合斩杀计划（专业档独占）——本回合打不死，但"下回合能清场再打脸"时，
   * 用投掷物把"下回合一击清不掉的挡路怪"压到我方最强单体输出之下；
   * 而不是把伤害随手丢给最弱的怪。返回 {iid,uid} 或 null（没有值得做的铺垫）。 */
  function planThrowTarget(B, A, throws) {
    if (!throws || !throws.length) return null;
    if (alive('A').some(function (m) { return m.flags.untargetable; })) return null;
    var outs = alive('B').map(function (m) { return atkOut(m); }).filter(function (v) { return v > 0; });
    if (!outs.length) return null;
    var maxOut = Math.max.apply(null, outs);
    var boardOut = 0; outs.forEach(function (v) { boardOut += v; });
    var burst = 0;
    B.hand.forEach(function (c) { var cd = C(c); if (cd.type === 'throw') burst += (cd.mods && cd.mods.dmg) || 0; });
    var need = 0;
    alive('A').forEach(function (m) { need += m.hp; });
    if (!(boardOut + burst >= A.hp + need)) return null;             // 不是"下回合能斩杀"的局面 → 不做铺垫
    var hard = alive('A').filter(function (m) { return m.hp > maxOut; }).sort(function (a, b) { return b.hp - a.hp; });
    if (!hard.length) return null;
    var t = hard[0], gap = t.hp - maxOut;                            // 还差多少才够"下回合一击清除"
    var dmgOf = function (c) { var m = C(c).mods || {}; return m.dmg || 0; };
    var pick2 = throws.filter(function (c) { return dmgOf(c) >= gap; }).sort(function (a, b) { return dmgOf(a) - dmgOf(b); })[0];
    return pick2 ? { iid: pick2.iid, uid: t.uid, dmg: dmgOf(pick2) } : null;
  }
  // 伤害排程：当前攻击池的总输出能否清空对手场面（所有敌怪都可攻击时才有意义）
  function boardCanClear(A, pool) {
    var foes = alive('A');
    if (!foes.length) return false;
    if (foes.some(function (m) { return m.flags.untargetable; })) return false;
    var total = 0;
    (pool || []).forEach(function (m) { var v = atkOut(m); if (v > 0) total += v; });
    var need = 0;
    foes.forEach(function (m) { need += m.hp; });
    return total >= need;
  }
  function lethalSoon(B, A) {
    if (alive('A').some(function (m) { return m.flags.untargetable; })) return false;
    var boardOut = 0;
    alive('B').forEach(function (m) { boardOut += atkOut(m); });
    var handBurst = 0;
    B.hand.forEach(function (c) { var cd = C(c); if (cd.type === 'throw') handBurst += (cd.mods && cd.mods.dmg) || 0; });
    // ★ 修正：投掷物**只能打怪、且只能在准备阶段使用**（engine.js useThrow 要求怪物目标 + PREP）。
    //   所以"下回合能斩杀"的充分条件 = 手上的投掷物足够清空对方场面，且我方场上输出（全部打脸）≥ 对手生命
    //   → 门槛必须加上"对方场面总血"，否则条件极松，会让专业档长期攥着投掷物不出（净亏场面）。
    var need = 0;
    alive('A').forEach(function (m) { need += m.hp; });
    return (boardOut + handBurst) >= (A.hp + need);
  }

  /* ---------------- 读牌（专业/冠军档）；业余档 peekRatio()=0，即完全不读牌 ---------------- */
  function peekHand() {
    var pro = (diff === 'pro' || diff === 'champion');          // L2：情报系统（明牌记忆/牌库推测）为专业/冠军档独占
    var t = tag() + '|' + peekRatio() + '|' + diff;
    if (peekTag === t && peekCache) return peekCache;
    if (pro) memSync(Engine.state);                            // 同步情报：明牌记忆 + 牌库/弃牌堆推测
    var A = Engine.state.players.A;
    var n = Math.ceil(A.hand.length * peekRatio());
    var known = [];
    if (n > 0 && A.hand.length) {
      var idx = A.hand.map(function (_, i) { return i; });
      for (var k = 0; k < n && idx.length; k++) {
        var j = Math.floor(Engine.rand() * idx.length);
        known.push(A.hand[idx[j]]);
        idx.splice(j, 1);
      }
    }
    // 明牌：确切知道的对手手牌（衍生 / 回手），不占读牌额度 → 直接并入"已知手牌"（仅专业档）
    var rid = {}, exact = 0;
    if (pro) {
      rid = revealedIds();
      Object.keys(MEM.revealed).forEach(function (key) {
        var id = +key;
        var inst = A.hand.filter(function (c) { return c.iid === id; })[0];
        if (inst && known.indexOf(inst) < 0) { known.push(inst); exact++; }
      });
    }
    var hasS = known.some(function (c) { var cd = CARDS[c.cardId]; return cd && cd.type === 'monster' && cd.tier === 'S'; });
    var hasUp = known.some(function (c) { return c.cardId === 'a-029-2'; });
    // 玩家是否有"能清掉不可被攻击怪"的手段：投掷物 / 法杖（暗影斗篷挡不住它们）
    var hasRemoval = known.some(function (c) { var cd = CARDS[c.cardId]; return cd && (cd.type === 'throw' || cd.type === 'wand'); });
    // 已知投掷物里的最大伤害（判断我方残血怪是否落在"被补刀"血线内）
    var maxThrowDmg = 0;
    // 玩家是否有治疗手段（治疗药水/肉馅饼/露珠）→ 打不死的目标先别浪费输出
    var hasHeal = false;
    known.forEach(function (c) {
      var cd = CARDS[c.cardId]; if (!cd) return;
      if (cd.type === 'throw') maxThrowDmg = Math.max(maxThrowDmg, (cd.mods && cd.mods.dmg) || 6);
      if (c.cardId === 'a-019-2' || c.cardId === 'a-059-2' || c.cardId === 'a-018-2') hasHeal = true;
    });
    // 牌库（不含顺序）+ 弃牌堆推测：对手还剩多少解场 / 是否高概率升 A·S / 流派 / 资源是否枯竭（仅专业档）
    var intelObj = pro ? buildIntel(Engine.state, known) : NEUTRAL_INTEL;
    peekCache = {
      n: n, known: known, exact: exact, revealed: rid, intel: intelObj, pro: pro,
      // 能否处理掉我方的"1 血不可被攻击怪"＝ 手上解场 ∪（专业档）明牌/牌库还剩的解场
      canRemoveSmall: hasRemoval || (pro && (intelObj.clearThreat > 0 || intelObj.removalThreat > 0)),
      hasS: hasS, hasUpScroll: hasUp, hasRemoval: hasRemoval, maxThrowDmg: maxThrowDmg, hasHeal: hasHeal,
      weakHand: known.length > 0 && known.every(function (c) { var cd = CARDS[c.cardId]; return !cd || (cd.type !== 'monster' && cd.type !== 'throw'); })
    };
    peekTag = t;
    return peekCache;
  }

  return {
    step: step, setDifficulty: setDifficulty, getDifficulty: getDifficulty,
    setTuning: setTuning, TUNE: TUNE,
    // 情报系统对外只读视图（可用于调试/界面展示）
    memory: function () { return { revealed: MEM.revealed, resolved: MEM.resolved }; },
    intel: function () { return Engine.state ? buildIntel(Engine.state) : null; },
    enumStat: function () { return ENUM_STAT; },               // L9 准备阶段顺序枚举的调用/介入计数
    // 供无头对局工具使用（真实游戏只有 1 个实例，用不到）：把本实例的"策略通道"
    // （希望抽卡 / 起手保底）重新注册给引擎。双 AI 实例同引擎时必须显式指定由谁持有。
    bindPolicy: function () { policyBound = false; ensurePolicy(); }
  };
  })();

  return AI;
}