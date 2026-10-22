/* ============================================================
 * 学院考核 · 配置表  academy_data.js
 *  所有数值集中在此，方便后续调整（等级/卡组上限/价格/刷出概率/学时经验…）
 * ========================================================== */
import { CARD_LIST, CARDS } from './cards.js';
import { Rules } from './rules.js';
import { TOUR_DATA } from './tournament_data.js';

export const ACADEMY_CONF = {
  NAME: '雪景学院考核',
  START_HP: 100,            // 每人初始生命
  BATTLE_HP: 30,            // 考核战斗内的玩家生命（战斗胜负不影响 100 点生命，最终按"总输出"结算）
  PLAYER_DMG_MULT: 2,       // 攻击对手"本体"的伤害，在最终输出结算里 ×2
  PLAYERS: 8,               // 同台人数（玩家 + 7 AI）
  MAX_LEVEL: 5,
  /* 等级 0~5 的卡组张数上限。
   * 旧表 [5,8,12,16,20,25] 太宽松 → 玩家和 AI 都没有卡位压力，随便塞。
   * 收紧成 2/4/6/8/10/14：卡组 = "上场牌库"，每个卡位都要争 ——
   * 拿到新卡得先想"换掉谁"，而不是无脑塞进去。 */
  DECK_CAP: [2, 4, 6, 8, 10, 14],
  BAG_CAP: 14,                            // 背包（未上场备用）上限。
                                          // 卡位收紧到 2/4/6/8/10/14 后，卡组放不下多少东西，
                                          // "囤合星材料"全靠背包 —— 8 张不够用（实测背包只用 0.6 张、
                                          // 材料边合边空，3★ 停在 1.1）。
  // 战斗回合上限：按轮次缓慢提升，第 12 轮才到 12 回合（之后固定 LATE）
  // 旧表 [4,6,8,10,12] 是 5 轮就顶到 12，爬得太快 → 拉成 12 轮逐级上行
  ROUND_LIMIT: [4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 12],
  ROUND_LIMIT_LATE: 12,
  XUE_BASE: 3,                            // 每回合发放学时 = round((XUE_BASE + 等级) × XUE_MULT)
  XUE_MULT: 2.2,                          // 学时倍率（约原来的 2.2 倍）
  // 升级经验需求：大幅下调 → 靠"打比赛"（胜+2/负+1）升级更快；单位价格上调（EXP_BUY_COST / LEVEL_BUY_MULT ×2）
  // 使「买经验 / 买级」的总花费与旧版基本持平（旧合计 80 点 × 1；新合计 41 点 × 2 ≈ 80）
  LEVEL_EXP: [2, 5, 8, 11, 12],           // 升到 1/2/3/4/5 级所需经验（旧：[4,9,15,22,30]；五级需求再降 15→12）
  EXP_BUY_COST: 2,                        // 1 学时 = 2 经验（旧 1；单价翻倍，配合经验需求减半）
  LEVEL_BUY_MULT: 4,                      // 「直接买下一级」= 剩余经验 × 倍数（旧 2；同上，买级总价≈不变）
  SELL_RATIO: 0.5,                        // 出售回价 = 购入价的一半
  FREE_REFRESH: 2,                        // 每回合免费手动刷新次数
  REFRESH_BASE: 1,                        // 付费刷新的起始价
  REFRESH_EVERY: 2,                       // 每完成这么多次付费刷新，价格 +1
  LOCK_BLOCKS_BUY: true,                  // 锁定的商品：保留到下轮，且锁定期间不可购买
  HP_LOSS_PER_ROUND: 3,                   // 每轮结算扣血上限 = 当前轮次 × 该值
  /* 前期"硬顶"：在「轮次 × HP_LOSS_PER_ROUND」之外再压一层（与基础值取更小者）。
   *   [10, 15] → 第 1~9 轮：每轮最多扣 15 点
   *   [20, 20] → 第 10~19 轮：每轮最多扣 20 点
   *   第 20 轮起：不另设硬顶（回到纯「轮次 × 3」）
   * 只收紧、不放松：第 1~5 轮基础值本来就 ≤15，硬顶不介入（第 1 轮仍是 3 点）。
   * 用途：中期（6~19 轮）基础值已涨到 18~57，一场大胜就能把对手打掉半管血，
   * 前面的等级 / 构筑积累被单场翻盘抹平 —— 加硬顶让胜负更靠长期积累。 */
  CAP_TIERS: [[10, 15], [20, 20]],
  // 升星：仅怪物卡，2 张同名同星合成 1 张高一星（2★ 生命/攻击 ×2、3★ ×3）；可跨卡组/背包合成
  STAR_MERGE: 2,
  AWAKEN_STAR: 3,          // 达到该星级时觉醒：合成出来的这一刻抽定词条，之后固定在这张卡上
  STAR_MAX: 3,
  SHOP_SLOTS: 6,
  WIN_EXP: 2, LOSE_EXP: 1,                // 对战获得的经验
  BYE_XUE: 2,                             // 轮空补偿学时
  PRICE: {                                // 学时价格
    C: 2, B: 4, A: 8, S: 16,              // 怪物按等级
    equip: 3, food: 3, throw: 4, potion: 4,
    wand: 5, scroll: 5, trap: 5, ring: 5, treasure: 4
  },
  // 各等级商店刷出权重（合计 100）：C/B/A/S = 怪物品阶；其余为卡牌类型
  // 3/4 级上调 A 级权重；4/5 级上调 S 级权重（对应削减 C/B 权重，合计仍为 100）
  ODDS: [
    [{ k: 'C', w: 70 }, { k: 'B', w: 30 }],
    [{ k: 'C', w: 45 }, { k: 'B', w: 25 }, { k: 'equip', w: 15 }, { k: 'food', w: 15 }],
    [{ k: 'C', w: 30 }, { k: 'B', w: 20 }, { k: 'A', w: 3 }, { k: 'equip', w: 10 }, { k: 'food', w: 10 },
     { k: 'throw', w: 8 }, { k: 'potion', w: 8 }, { k: 'wand', w: 6 }, { k: 'scroll', w: 5 }],
    [{ k: 'C', w: 18 }, { k: 'B', w: 16 }, { k: 'A', w: 14 }, { k: 'S', w: 4 }, { k: 'equip', w: 8 }, { k: 'food', w: 8 },
     { k: 'throw', w: 7 }, { k: 'potion', w: 6 }, { k: 'wand', w: 6 }, { k: 'scroll', w: 5 }, { k: 'treasure', w: 8 }],
    [{ k: 'C', w: 9 }, { k: 'B', w: 9 }, { k: 'A', w: 16 }, { k: 'S', w: 7 }, { k: 'equip', w: 8 },
     { k: 'food', w: 6 }, { k: 'throw', w: 6 }, { k: 'potion', w: 6 }, { k: 'wand', w: 6 }, { k: 'scroll', w: 5 },
     { k: 'treasure', w: 8 }, { k: 'trap', w: 7 }, { k: 'ring', w: 7 }],
    [{ k: 'C', w: 8 }, { k: 'B', w: 8 }, { k: 'A', w: 14 }, { k: 'S', w: 14 }, { k: 'equip', w: 8 },
     { k: 'food', w: 6 }, { k: 'throw', w: 6 }, { k: 'potion', w: 6 }, { k: 'wand', w: 6 }, { k: 'scroll', w: 6 },
     { k: 'treasure', w: 6 }, { k: 'trap', w: 6 }, { k: 'ring', w: 6 }]
  ],
  // AI 经济策略参数
  AI: {
    LEVEL_BUFFER: 5,        // 买等级时至少留多少学时（用于买卡）。从 2 提到 5（实测 4 略差）：
                            // 等级只影响商店卡池的品阶分布，而"链差一张同名卡"是当前最大瓶颈，
                            // 学时优先保证能买满每轮额度（实测等级仍能到 3 级）。
    BUY_PER_ROUND: 4,       // AI 每回合最多买几张卡。
                            // 实测降到 3 反而更差（3★ 1.44→0.68）：链推进靠的是"购买次数"，
                            // 少买一次就少一张同名卡，刷新补不回来。
    REPLACE_MARGIN: 3,      // 卡组已满时，比最弱卡高多少分才替换
    HIGH_ATK: 4,            // 「高攻战斗怪」的攻击力门槛（C 级怪最高攻只有 4，故门槛取 4）
    HIGH_ATK_TARGET: [3, 5],// 卡组 5~8 张期间希望保有的高攻怪数量区间
    /* ---- 少卡高星路线（本轮重写） -----------------------------------
     * 旧思路：把卡组填到等级上限、广撒网攒构成、后期再清仓。
     * 新思路：**卡组精简到 ≈10 张**，资源全部砸在"把已有卡堆到高星"上 ——
     *   目标节奏（第 10 大轮前后）≈ 3 张 3★ + 2 张 2★，几乎不留 1★。
     * 因为学院对战是"卡组整体洗入牌库"，张数少 = 抽到高星卡的概率高。
     * ------------------------------------------------------------------ */
    TARGET_DECK: 10,        // 目标卡组张数（不再追求填满 deckCap）
    DECK_SOFT_MAX: 12,      // 超过这个张数：新卡（非合星）一律不值得买
    CHAIN_NEXT: 42,         // 手上已有 1 单位同名（1★×1）→ 买下正好凑成 2★
    CHAIN_MAX: 72,          // 手上已有 3 单位同名 → 买下正好凑成 3★（最高优先）
    NEW_CHAIN_PENALTY: 16,  // 手上没有同名卡 → 开新链的罚分（1★ 数值最低，最不该囤）
    FULL_DECK_PENALTY: 22,  // 卡组已过 SOFT_MAX 还硬塞新卡的罚分
    MIN_BUY_SCORE: 4,       // 最高分候选仍低于此值 → 这一轮先刷新找更好的，找不到就不买
                            // 没有这条时，排序后总会取第一名（哪怕它是负分的"开新链"卡），
                            // AI 就会不停开新链 —— 这是 3★ 上不去的直接原因
    MON_FLOOR: 6,           // 卡组里至少保有的怪物数（低于它时怪物大幅加分，防止被道具挤光）
    POTION_BONUS: 7,        // 药水额外加权（疾速/冰霜/毒气这种，用户点名"拿几张"）
    /* 怪物占比：从 ≈1:1 上调到 55%~70%。
     * 旧值 [0.45,0.52] 把怪物上限锁在 52% —— 卡组 8 张时最多 4 只怪，
     * 「4~6 只高星怪」在数学上就不可能达到（实测高星怪卡在 2.71）。
     * 高星怪本身也是"卡组整体洗入牌库"里最值钱的部分，多几只不吃亏。 */
    MON_RATIO: [0.65, 0.82],
    THROW_PENALTY: 8,       // 投掷物整体降权：商店池里 throw 权重最高(w=8)，AI 又逢卡就买，
                            // 结果卡组里塞了一批「飞刀/回旋镖」这类低效卡（垃圾卡来源）
    TIER_BAND: {            // 怪物内部档次区间：B/C 50~60% / A 20~30% / S 10~20%
      BC: [0.50, 0.60], A: [0.20, 0.30], S: [0.10, 0.20]
    },
    HARD_GATE: 8,           // 卡组 >= 该张数后才启用「硬构成过滤」
    /* 后期清仓（只作用于 AI 学生，不影响玩家）
     * 背景：原来只在"卡组超载"和"卡组+背包双满遇到更好的卡"两种被迫情况下才卖卡，
     * 后期卡组会被低分 1★ 卡塞住 —— 卡组全部洗入战斗牌库，弱卡既稀释抽牌、又占着位置换不来新卡。
     * 故从第 SELL_AFTER_ROUND 轮起主动清仓：卖掉"评分明显低于卡组均分"的卡，换成学时买更好的。 */
    SELL_AFTER_ROUND: 3,    // 从第 N 轮起开始清理（前期一律不卖：先攒构成，星级也还没起来）
    SELL_PER_ROUND: 0,      // 每轮最多卖几张（背包 + 卡组合计）；设 0 = 关闭清仓。
                            // 卡位收紧后（2/4/6/8/10/14）卡组本身就是硬约束，不再需要"清仓腾位"；
                            // 而清仓会把刚买来囤着的 1★ 合星材料当弱卡卖掉（实测背包只剩 0.3 张、
                            // 3★ 从 2.09 掉到 1.07）→ 直接关掉。
    SELL_RATIO: 0.55,       // 弱卡判据：评分 < 卡组均分 × 该比例
    SELL_ABS_MAX: 14,       // 绝对上限：评分高于此值的一律不卖（均分虚高时也不误伤好卡）
    SELL_KEEP_MIN: 4,       // 卡组保底张数（低于此值不再从卡组卖）
    SELL_KEEP_RATIO: 0.6,   // 卡组保底比例（不低于"等级上限 × 该比例"）
    /* 后期采购：不再买"孤立的 1★ 单卡"，改把学时花在刷新上（找高阶卡 / 能合星的同名卡）
     * 背景：后期卡组里会堆一批"1★ 且没有合星门票"的怪（买了也合不成 2★，数值还最低），
     * 它们稀释抽牌、占卡位。与其继续买这种单卡，不如刷新去碰 A/S 或"再买 1 张就能合星"的同名卡。 */
    EARLY_ROUNDS: 4,        // 「前期」的轮次界限。卡位收紧（2/4/6/8/10/14）后每个卡位都要争：
                            //   1★ 怪只有前期才占卡位，之后一律撤到背包等合星（至少 2★ 才上场）；
                            //   道具只有「强力道具」才占卡位。
    NO_LONE_AFTER: 1,       // 合星链上限从第 N 轮起生效。设为 1：第 1 轮就收口，
                            // 否则第 1 轮会一次买 4 张不同的怪 —— 那 4 条"1 单位僵尸链"
                            // 会永久占住链名额（实测占 2 条），主力链反而推不到 3★。
    MAX_LONE_CHAIN: 2,      // 同时最多开几条"在推进的合星链"（同名总投入 1~3 单位，还没到 3★）
                            // 实测 4 会更差（3★ 1.12→1.02）：链一多，资源摊薄，哪条都到不了 4 单位。
                            // 实测 1 条太慢（串行推不完）、3 条会摊薄（3★ 1.10、怪更散），2 条最优。
                            // 实测最优：串行集中资源，外加 pruneDeadChains 清理僵尸链。
                            // 开到 2 条时每轮购买额度被摊开（3★ 1.19→1.02）；3 条以上更差。
                            // 凑满 3★ 的链会自动释放名额，AI 接着开下一条。
    REFRESH_PER_ROUND: 14,  // 每轮最多把学时花在几次刷新上（先用免费次数，再按与玩家相同的价格阶梯付费）
                            // 少卡高星路线：目标明确（凑同名卡升星），刷新是在"找那几张卡"，值得多刷
    REFRESH_MIN_XUE: 4,     // 付费刷新的留手线：低于该学时就不刷了（留着买卡）。
                            // 实测降到 2 / 1 都更差（3★ 1.44→0.68/0.90）：刷新会把学时吸走，
                            // 导致当轮买不满卡 —— 链推进靠购买次数，不能为刷新牺牲采购。
    // 前期（1~2 级）以升星为主：道具只少量补，数量到顶就不再买；升到 ITEM_FREE_LEVEL 后放开
    //（实测前期会大量购入武器：卡组上限小、怪物又被占比守门挡住，AI 只能一直买装备）
    EARLY_ITEM_MAX: [2, 4], // 1 级 / 2 级时，非怪物卡（过牌 / 解场除外）最多持有几张。
                            // 少卡高星路线要"一半怪物、一半道具"，前期就别把道具卡太死
                            // 实测（40 届，第 3 轮快照）：武器 0.70→0.39（-44%）、防具 0.64→0.35、
                            // 怪物 4.00→4.48、2★以上 1.26→1.52（+21%）→ 前期确实转成"以升星为主"。
                            // 整届强度不掉反升：玩家平均名次 4.20→4.58、玩家夺冠 6/40→4/40。
    ITEM_FREE_LEVEL: 3,     // 升到该等级后不再限制道具数量（中后期再补道具）
    EARLY_SPARE_XUE: 10,    // 前期"学时富余"阈值：攒到这么多还没花掉就破例再买一件。
                            // 没有这条时，上限会把收入憋在手里（实测纯上限版玩家夺冠升到 9/40）→ 别让钱烂掉。
    BAG_PENDING_AFTER: 1,   // 从第 N 轮起：「还停在 1★、等着合星」的怪先放背包，不占战斗牌库的卡位。
                            // 卡组里的牌会全部洗入战斗牌库，1★ 数值最低、占着位置却打不出东西；
                            // 放背包不影响合星（同名卡跨卡组/背包合成），凑齐第二张会以 2★ 回到卡组。
    DEMOTE_PER_ROUND: 6,    // 每轮最多把几张"不值得占卡位的卡"挪进背包（腾位给高星怪 / 强力道具）
    SELL_FROM_DECK: 0,      // 是否也从"卡组"里卖（默认只清背包）：
                            // 学院里卡组全部洗入战斗牌库，且投掷物/法杖/装备本身就是输出，
                            // 实测卖卡组里的牌 → AI 累计输出 -60、高星卡 -0.7，是净亏 → 默认关
    SELL_TO_LEVEL: 0        // 清仓所得是否立刻补买等级：学院里"卡组越大 → 抽到好卡的概率越低"，
                            // 实测把卖卡钱换成等级（卡组上限变宽）反而拉低了 AI 的总输出 → 默认关闭
  }
};

export const ACADEMY_DATA = (function () {
  'use strict';

  var TYPE_GROUP = { equip: ['weapon', 'armor'] };

  function tierLabel(k) { return (['C', 'B', 'A', 'S'].indexOf(k) >= 0) ? (k + ' 级怪') : ({ equip: '装备', food: '食物', throw: '投掷物', potion: '药水', wand: '法杖', scroll: '卷轴', trap: '陷阱', ring: '戒指', treasure: '宝藏' }[k] || k); }

  // 某个类别的卡池（怪物按品阶，道具按类型；神器不进入商店）
  function poolOf(k) {
    var types = TYPE_GROUP[k] || [k];
    var out = [];
    CARD_LIST.forEach(function (c) {
      if (c.type === 'artifact') return;
      if (['C', 'B', 'A', 'S'].indexOf(k) >= 0) { if (c.type === 'monster' && c.tier === k) out.push(c.id); }
      else if (types.indexOf(c.type) >= 0) out.push(c.id);
    });
    return out;
  }

  // 卡牌条目：卡牌 id 或 { id, star }（学院考核里卡牌带星级）
  /* 是不是「强力道具」——卡位收紧后，AI 只让强力道具占卡位（弱道具腾位给高星怪）。
   * 判据就是上面的 STRONG_DISRUPT 有正分。用户点名的：疾速药水 / 冰霜药水 / 麻痹陷阱。 */
  function isStrongItem(id) { return (STRONG_DISRUPT[id] || 0) > 0; }

  function idOf(e) { return (e && typeof e === 'object') ? e.id : e; }
  function starOf(e) { return (e && typeof e === 'object') ? (e.star || 1) : 1; }
  // 学院里的卡是"实例"：{ id, star, awaken }。
  // awaken 在【合成出 3★ 的那一刻】抽定，之后召唤 / 回手 / 复活 / 镜像都沿用这一个。
  function mk(id, star, awaken) { return { id: id, star: star || 1, awaken: awaken || null }; }
  /* 抽一个觉醒词条。rng 可选：学院里传可复现的 rng，保证同一届同一轮结果一致。 */
  function rollAwaken(rng) {
    if (typeof AWAKEN_ORDER === 'undefined' || !AWAKEN_ORDER || !AWAKEN_ORDER.length) return null;
    var r = (typeof rng === 'function') ? rng() : Math.random();
    return AWAKEN_ORDER[Math.floor(r * AWAKEN_ORDER.length)];
  }
  function awakenOfEntry(e) { return (e && typeof e === 'object' && e.awaken) ? e.awaken : null; }
  function awakenStar() { return ACADEMY_CONF.AWAKEN_STAR; }
  function starMult(star) { return Math.max(1, Math.min(ACADEMY_CONF.STAR_MAX, star || 1)); }

  // 某张卡的学时价格（= 单张 1★ 的价格）
  function priceOf(e) {
    var c = CARDS[idOf(e)]; if (!c) return 99;
    if (c.type === 'monster') return ACADEMY_CONF.PRICE[c.tier] || 4;
    for (var g in TYPE_GROUP) if (TYPE_GROUP[g].indexOf(c.type) >= 0) return ACADEMY_CONF.PRICE[g] || 4;
    return ACADEMY_CONF.PRICE[c.type] || 4;
  }
  // 出售回价 = 购入总价的一半（升星投入按 3^(星-1) 计）
  function investOf(e) { return priceOf(e) * Math.pow(ACADEMY_CONF.STAR_MERGE, starOf(e) - 1); }
  function sellOf(e) { return Math.max(1, Math.floor(investOf(e) * ACADEMY_CONF.SELL_RATIO)); }

  // 付费刷新价格：前 3 次固定 1 学时，之后每 2 次 +1
  function refreshCost(paidDone) {
    var n = Math.max(1, Math.floor(paidDone || 0));
    if (n <= 3) return ACADEMY_CONF.REFRESH_BASE;
    return ACADEMY_CONF.REFRESH_BASE + Math.ceil((n - 3) / ACADEMY_CONF.REFRESH_EVERY);
  }

  // 商店刷出一张卡（按等级的权重表）
  function rollCard(lv, rng) {
    var table = ACADEMY_CONF.ODDS[Math.max(0, Math.min(ACADEMY_CONF.ODDS.length - 1, lv))];
    var total = 0; table.forEach(function (e) { total += e.w; });
    var r = rng() * total, acc = 0, key = table[0].k;
    for (var i = 0; i < table.length; i++) { acc += table[i].w; if (r < acc) { key = table[i].k; break; } }
    var pool = poolOf(key);
    if (!pool.length) return null;
    return pool[Math.floor(rng() * pool.length)];
  }

  // 概率说明（商店底部展示）
  function oddsText(lv) {
    var table = ACADEMY_CONF.ODDS[Math.max(0, Math.min(ACADEMY_CONF.ODDS.length - 1, lv))];
    var total = 0; table.forEach(function (e) { total += e.w; });
    return table.map(function (e) { return tierLabel(e.k) + ' ' + Math.round(100 * e.w / total) + '%'; }).join('　');
  }

  function roundLimit(round) {
    var arr = ACADEMY_CONF.ROUND_LIMIT;
    return round <= arr.length ? arr[round - 1] : ACADEMY_CONF.ROUND_LIMIT_LATE;
  }
  function xuePerRound(lv) { return Math.round((ACADEMY_CONF.XUE_BASE + lv) * ACADEMY_CONF.XUE_MULT); }

  /* ---------------- 学生 AI 构筑评分 ---------------- */
  // 卡牌定位：高攻战斗怪 / 战斗怪 / 干扰 / 过牌 / 解场 / 支持
  var STRONG_DISRUPT = {    // 道具权重（可正可负）：越高越优先买，负值＝AI 基本不碰
    'a-022-2': 15,          // 麻痹陷阱：直接结束对方回合
    'a-086-2': 15,          // 炸弹：6 点、跨回合压制
    'a-087-2': 13,          // 疾速药水：本回合 +1 召唤（抢节奏）
    'a-062-2': 13,          // 冰霜药水：对方下回合召唤 -1
    'a-063-2': 14,          // 催眠卷轴：全场一回合无法攻击
    'a-064-2': 11,          // 召唤陷阱
    'a-089-2': 12,          // 毒气陷阱
    'a-088-2': 9,           // 盛怒卷轴：全场随机伤害
    /* 传送卷轴（弃光手牌抽 4）：用户点名压到最低。
     * ⚠ 它带 mods.draw，除了这里的权重还会吃到「过牌」加分 +10~16，
     *   所以必须给负值才能盖住 —— -30 + 16 = -14，低于 MIN_BUY_SCORE(4)，AI 不再购买。 */
    'a-030-2': -30,
    /* 新卡 */
    'a-117-2': 12,          // 爆炸陷阱：对手召唤即 8 点伤害
    'a-116-2': 26,          // 镜像卷轴：复制我方强力怪 —— 少卡高星路线下"复制一只 3★"价值极高。
    /* ↑ 上表有正分的都算「强力道具」（疾速药水 / 冰霜药水 / 麻痹陷阱 / 炸弹 / 催眠卷轴…），
     *   卡位紧张时 AI 只让这些占卡位，其余弱道具一律不占（见 isStrongItem）。 */
                            // 它没有过牌/解场加成，只有这一项分，所以要给得比药水(13+9=22)更高才排得上去
    'a-115-2': 9            // 毒气药水：对方 +3 层毒气（配矿洞蜘蛛等毒气体系）
  };
  function isMonster(id) { var c = CARDS[id]; return !!c && c.type === 'monster'; }
  function isHighAtk(id) { var c = CARDS[id]; return !!c && c.type === 'monster' && c.atk >= ACADEMY_CONF.AI.HIGH_ATK; }
  function isDraw(id) {
    var c = CARDS[id]; if (!c) return false;
    if (c.type === 'treasure') return true;
    if (c.mods && c.mods.draw) return true;
    return false;
  }
  function isRemoval(id) {   // 解场：直接处理对方场面/生命的牌
    var c = CARDS[id]; if (!c) return false;
    if (c.type === 'throw') return true;
    if (c.type === 'wand') return true;
    if (id === 'a-088-2') return true;
    return false;
  }
  var MON_TRASH = ['a-077-2', 'a-076-2'];   // 咒缚灵 / 怨灵：杂鱼，学生 AI 绝不购买
  /* 「同名卡总投入」：合星是按同名同星的 2 张合成 1 张高一星，所以
   *   1★ = 1 单位、2★ = 2 单位、3★ = 4 单位。
   *   合成节点：凑满 2 单位 → 2★；凑满 4 单位 → 3★。
   * 用它来判断"再买 1 张这张卡，离下一次升星还有多远"—— 这是少卡高星路线的核心指标。 */
  function chainUnits(deck, bag, id) {
    var u = 0;
    (deck || []).concat(bag || []).forEach(function (x) {
      if (idOf(x) !== id) return;
      var s = starOf(x);
      u += (s >= 3) ? 4 : (s === 2 ? 2 : 1);
    });
    return u;
  }
  function tierCount(deckIds) {
    var t = { S: 0, A: 0, BC: 0, mon: 0 };
    deckIds.forEach(function (x) {
      var q = CARDS[x]; if (!q || q.type !== 'monster') return;
      t.mon++; if (q.tier === 'S') t.S++; else if (q.tier === 'A') t.A++; else t.BC++;
    });
    return t;
  }
  /* 学生 AI 选牌评分（思路同魔绫大赛）：
   *   · 怪物：优先「高数值战斗怪」（攻血双高）+ 档次（S/A 更优）；前期额外看攻击力
   *   · 道具：优先「过牌 + 强力道具」，全程高权重（小卡组过牌收益极高）
   *   · 构成：怪物 60~70%；怪物中 B/C 50~60% / A 20~30% / S 10~20%（区间守卫）
   *   · 杂鱼（咒缚灵/怨灵）绝不购买
   */
  function aiScore(id, arch, deckIds, E) {
    var c = CARDS[id]; if (!c) return -999;
    if (c.type === 'monster' && MON_TRASH.indexOf(id) >= 0) return -999;
    var A = ACADEMY_CONF.AI;
    var n = deckIds.length;
    /* 卡位收紧（2/4/6/8/10/14）后，"够不够"要跟卡位走，不能再是写死的常量：
     *   cap = 当前等级的卡组上限；怪物保底 = 卡位的一半（卡位很少时至少 1 只）。
     * 不传 E 的调用点（只做卡间比较、不关心等级）退回旧常量。 */
    var cap = E ? deckCap(E.lv) : A.TARGET_DECK;
    /* 怪物保底 = 卡位 ×0.6（下限 2）。
     * ⚠ 别写成"卡位的一半"：卡位收紧到 6/8 后，一半只有 3/4，而 AI 的怪本来就有 4 只，
     *   "怪不够 → +22 加分"这条就再也不触发 → 不再优先买怪 → 材料断供
     *   （实测：卡位旧表 3★ 2.05，换成 0.5 系数后掉到 1.15）。 */
    var monFloor = Math.max(2, Math.ceil(cap * 0.6));
    var s = ((arch != null && arch >= 0) ? TOUR_DATA.scoreOne(id, arch, deckIds) : 0) * 0.6;
    var tc = tierCount(deckIds);
    var mRatio = n ? tc.mon / n : 0;

    if (isMonster(id)) {
      // 高数值战斗怪：攻血双高（封顶，避免压过构成）
      s += 5 + Math.min(7, c.atk * 0.9 + c.hp * 0.4);
      s += ({ S: 14, A: 9, B: 3, C: 0 }[c.tier] || 0);           // S/A 是重点：高星 S/A 正是目标，基础分必须拉开
      if (n < 8) s += c.atk * 1.2;                               // 前期：攻击力直接决定对局走势
      if (n < 8 && isHighAtk(id) && deckIds.filter(isHighAtk).length < A.HIGH_ATK_TARGET[0]) s += 10;
      if (tc.mon < monFloor) s += 22;                            // 怪不够 → 必须补怪（没怪＝送分）
      // 卡位满了不在这里罚分：卡位是【硬约束】，由 placeCard / aiAddOk 处理
      //（会优先塞进背包，背包也满就替换卡组里最弱的一张）。
      // 这里再罚分会把"1★ 合星材料"一起挡在门外 —— 材料买不进来 → 直接掐断升星供应链
      //（实测：罚 22 时 3★ 1.07，罚 8 时 1.12，而卡位收紧前是 2.09）。
      if (n >= 4) {                                              // 怪物占比守卫（≈1:1）
        if ((tc.mon + 1) / (n + 1) > A.MON_RATIO[1]) s -= 14;    // 怪已够多 → 去买道具
        else if (mRatio < A.MON_RATIO[0]) s += 22;               // 怪不够 → 大幅优先
      }
      if (tc.mon >= 4) {                                         // 档次守卫（S/A 不再压制：高星 S/A 本就是目标）
        var band = c.tier === 'S' ? 'S' : (c.tier === 'A' ? 'A' : 'BC');
        var have = (band === 'S' ? tc.S : band === 'A' ? tc.A : tc.BC) / (tc.mon + 1);
        if (have < A.TIER_BAND[band][0]) s += 8;
        else if (have > A.TIER_BAND[band][1] && band !== 'BC') s -= 6;
      }
    } else {
      var dis = STRONG_DISRUPT[id] || 0;
      var draw = isDraw(id), rem = isRemoval(id);
      s += dis * (n >= 5 ? 1 : 0.75);                            // 强力道具：全程高权重（初期仅小幅打折）
      if (draw) s += (n < 10 ? 10 : 16);                         // 过牌：小卡组过牌收益极高
      if (rem) s += (n < 10 ? 7 : 13);                           // 解场
      if (c.type === 'weapon' || c.type === 'armor') s += 3;      // 装备：不抢位但有用
      if (c.type === 'food' || c.type === 'potion') s += 2;
      if (c.type === 'potion') s += A.POTION_BONUS;               // 药水：疾速/冰霜/毒气这种，多拿几张
      if (c.type === 'throw') s -= A.THROW_PENALTY;               // 投掷物（飞刀/回旋镖等）：低效，降权
      if (n >= cap) s -= 12;                                      // 卡位满了：道具也别再加张
      if (n >= 4) {                                              // 怪不够 → 道具降权；怪够多 → 道具提权
        if (mRatio >= A.MON_RATIO[0]) s += 10;
        else s -= 8;
      }
    }
    /* ★ 少卡高星路线的核心：优先"深挖已在推进的合星链"，而不是"开新链"。
     * 1★ 数值最低、又占着牌库位置 —— 卡组里越少越好。
     * ⚠ 只对【怪物】生效：tryMerge 里写着"升星只对怪物卡生效"（方案 A），
     *   道具永远停在 1★，给它算合星分/开新链罚分会让道具彻底买不进卡组。 */
    if (E && isMonster(id)) {
      var u = chainUnits(E.deck, E.bag, id);
      // 怪物占比已超标时，合星加分大幅打折 —— 否则"合星"会变成怪物的免死金牌，
      // 一路把怪物顶到 85%（实测过），道具买不进来。
      var chainK = 1;
      if (isMonster(id) && n >= 4 && (tc.mon + 1) / (n + 1) > A.MON_RATIO[1]) chainK = 0.15;
      if (u === 3) s += A.CHAIN_MAX * chainK;                    // 买下正好凑成 3★ → 压倒性优先
      else if (u === 1) s += A.CHAIN_NEXT * chainK;              // 买下正好凑成 2★
      else if (u === 2) s += A.CHAIN_NEXT * 0.6 * chainK;        // 已是 2★，再补两张可冲 3★
      else if (u >= 4) s -= 30;                                  // 已经 3★，再买纯属浪费
      else s -= (n >= cap ? A.NEW_CHAIN_PENALTY + 8 : A.NEW_CHAIN_PENALTY);   // 开新链：不划算
      // 特技【升星类】chainScore：推进中的链更值得买（让 AI 更愿意补同名卡）
      //（同 levelBuyCost：不能读裸 E._pm，否则特技可能"时有时无"）
      var pmc = perkModsOf(E);
      if (pmc.chainScore && u > 0 && u < 4) s += pmc.chainScore;
    }
    if (c.type === 'artifact') s -= 10;                          // 神器不进商店（保险）
    return s;
  }
  /* 硬构成过滤（卡组 >= HARD_GATE 张后才启用）：加怪只防超上限、加道具只防跌破下限（各 1.5% 容差）
   * 杂鱼（咒缚灵/怨灵）任何时候都不买 */
  function aiAddOk(deckIds, id) {
    var c = CARDS[id]; if (!c) return false;
    if (c.type === 'monster' && MON_TRASH.indexOf(id) >= 0) return false;
    var A = ACADEMY_CONF.AI, n = deckIds.length;
    if (n < A.HARD_GATE) return true;                            // 启动期不约束
    var tc = tierCount(deckIds);
    var isMon = isMonster(id);
    var r = (tc.mon + (isMon ? 1 : 0)) / (n + 1);
    if (isMon) {
      // 少卡高星路线：不再对 S/A 设数量上限（高星 S/A 正是目标），只守"怪物 ≤ 58%"这一条
      return r <= A.MON_RATIO[1] + 0.015;
    }
    return r >= A.MON_RATIO[0] - 0.015;
  }
  function deckCap(lv) { return ACADEMY_CONF.DECK_CAP[Math.max(0, Math.min(ACADEMY_CONF.MAX_LEVEL, lv))]; }
  /* 每轮结算的扣血上限 = min(轮次 × HP_LOSS_PER_ROUND, 前期硬顶 CAP_TIERS)。
   * 结算（academy.applyResults）/ 战报 / 对局内提示三处都走这一个函数，避免各算各的不一致。 */
  function lossCapOf(round) {
    var rd = Math.max(1, round || 1);
    var cap = rd * ACADEMY_CONF.HP_LOSS_PER_ROUND;
    var tiers = ACADEMY_CONF.CAP_TIERS || [];
    for (var i = 0; i < tiers.length; i++) {
      if (rd < tiers[i][0]) { cap = Math.min(cap, tiers[i][1]); break; }
    }
    return Math.max(1, cap);
  }
  function expNeed(lv) { return ACADEMY_CONF.LEVEL_EXP[Math.max(0, Math.min(ACADEMY_CONF.LEVEL_EXP.length - 1, lv))]; }
  /* 读特技汇总 mod。academy.js 里有一份同名的惰性缓存（perkMods），这里必须自带一份：
   * 本文件在 perks_data.js 之前加载，且 academy_data 不该反向依赖 academy。
   * ⚠ 以前这里直接读裸的 E._pm —— 而 _pm 是"用到才算"的缓存，pickPerk / grantPerk
   *   之后会被清成 null。于是"刚拿到【师承名门】就去看升学价格"会读到空缓存 → 原价。
   *   现在缺失就现算，保证任何时刻都拿得到正确的 mod。 */
  function perkModsOf(E) {
    if (!E) return {};
    if (!E._pm && typeof PERK_DATA !== 'undefined') E._pm = PERK_DATA.modsOf(E.perks || []);
    return E._pm || {};
  }
  function levelBuyCost(E) {
    var n = Math.max(1, Math.ceil(Math.max(0, expNeed(E.lv) - E.exp)) * ACADEMY_CONF.LEVEL_BUY_MULT);
    var pm = perkModsOf(E);
    if (pm.lvCostMul) n = Math.max(1, Math.ceil(n * pm.lvCostMul));   // 特技【师承名门】
    return n;
  }
  function addrOf(E) { var a = TOUR_DATA.ARCHETYPES[E.arch]; return a ? (a.t + ' ' + a.n) : '自由构筑'; }

  return {
    tierLabel: tierLabel, poolOf: poolOf, priceOf: priceOf, sellOf: sellOf, investOf: investOf,
    refreshCost: refreshCost, idOf: idOf, starOf: starOf, mk: mk, starMult: starMult,
    aiScore: aiScore, aiAddOk: aiAddOk, isHighAtk: isHighAtk, isMonster: isMonster, isDraw: isDraw, isRemoval: isRemoval,
    isStrongItem: isStrongItem,
    chainUnits: chainUnits, rollAwaken: rollAwaken, awakenOfEntry: awakenOfEntry, awakenStar: awakenStar,
    rollCard: rollCard, oddsText: oddsText,
    roundLimit: roundLimit, xuePerRound: xuePerRound, deckCap: deckCap,
    expNeed: expNeed, levelBuyCost: levelBuyCost, addrOf: addrOf, lossCapOf: lossCapOf
  };
})();