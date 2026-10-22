/* ============================================================
 * 《地牢决斗师-踏上征途》对局引擎  engine.js
 * 事件驱动状态机 + 触发窗口效果栈（策划案 2.6 / 6.4）
 * 所有规则数值以 Rules / cards.js 为准，勿在此处自创。
 * 对外接口：Engine.newGame(opts) / Engine.tryAction(action) /
 *           Engine.resolvePrompt(accept) / Engine.state
 * ========================================================== */
import { Rules, PRESET_DECKS, makeRng, randomSeed } from './rules.js';
import { CARDS } from './cards.js';
import { AWAKEN_ORDER } from './awaken_data.js';

export function createEngine() {
  return (function () {
  'use strict';

  var state = null;
  var iid = 1, uid = 1;
  var listeners = [];

  // 种子随机：本局所有"抽取/概率"都由 seed 决定，同种子可复现
  var seedVal = 0;
  var rngFn = Math.random;
  function rand() { return rngFn(); }
  function seedRandom(seed) {
    seedVal = (seed >>> 0) || 1;
    rngFn = makeRng(seedVal);
    return seedVal;
  }

  /* ---------------- 工具 ---------------- */
  function other(k) { return k === 'A' ? 'B' : 'A'; }
  function ln(i) { return i === 0 ? '左' : i === 2 ? '右' : '中'; }
  function rnd(n) { return Math.floor(rand() * n); }
  function pick(arr) { return arr.length ? arr[rnd(arr.length)] : null; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // 成就用：每次刷新扫一遍己方场面，记录"达到过的最高值"（攻击力 / 护盾 / 场上数量）
  function achScan() {
    var a = state.ach;
    if (!a || a.off) return;
    var mine = aliveMonsters('A');
    if (mine.length > a.maxBoard) a.maxBoard = mine.length;
    for (var i = 0; i < mine.length; i++) {
      var m = mine[i];
      if (m.atk > a.maxAtk) a.maxAtk = m.atk;
      if (m.cardId === 'a-083-2' && m.atk > a.tenguMax) a.tenguMax = m.atk;
      if (m.cardId === 'a-005-2' && m.atk > a.snailMax) a.snailMax = m.atk;
      if (m.shield > a.maxShield) a.maxShield = m.shield;
    }
  }
  function notify() { achScan(); for (var i = 0; i < listeners.length; i++) listeners[i](state); }
  function on(fn) { listeners.push(fn); }
  function log(text, cls) { state.log.push({ text: text, cls: cls || '' }); if (state.log.length > 200) state.log.shift(); }
  function emit(evt) { state.events.push(evt); }

  /* ---------------- 卡牌实例 ---------------- */
  // star：怪物星级（学院考核合成用）：1★ = 原始数值，2★ = ×2，3★ = ×3
  // awaken：3★ 觉醒词条 id（学院考核专属）。跟着实例走 —— 回手 / 复生 / 镜像都不丢。
  function makeInstance(cardId, level, star, awaken) {
    return { iid: iid++, cardId: cardId, level: level || 0, star: star || 1, awaken: awaken || null };
  }
  function cardOf(inst) { return CARDS[inst.cardId]; }
  /* 兜底掷词条：只在"3★ 实例上没有 awaken"时用（预设卡组 / 测试直接造 3★ 的情况）。
   * 正常流程下词条是学院【合成 3★】时抽定并写在实例上的，引擎只负责沿用。
   * 用引擎自己的 seeded rand()，同一颗种子结果可复现。 */
  function rollAwaken() {
    if (typeof AWAKEN_ORDER === 'undefined' || !AWAKEN_ORDER || !AWAKEN_ORDER.length) return null;
    return AWAKEN_ORDER[Math.floor(rand() * AWAKEN_ORDER.length)];
  }

  function makePlayer(key, name, isAI, deckIds) {
    // 卡组元素可以是卡牌 id，也可以是 {id, star}（学院考核的升星卡）
    var deck = deckIds.map(function (cid) {
      if (cid && typeof cid === 'object') return makeInstance(cid.id, 0, cid.star || 1, cid.awaken);
      return makeInstance(cid);
    });
    return {
      key: key, name: name, isAI: isAI,
      hp: Rules.PLAYER_HP, maxHp: Rules.PLAYER_HP,
      deck: deck, hand: [], discard: [],
      board: [null, null, null],
      wand: null, artifacts: [], bombs: [],
      poison: 0, acid: 0, rotMarks: 0, poisonBonus: 0,
      summonsLeft: 0, summonsMax: 0, castsLeft: 0, castsMax: 0,
      flags: {}
    };
  }

  /* ---------------- 联机：装载服务器下发的状态 ----------------
   * 联机模式下客户端不参与结算，只把服务器发来的状态放进这个引擎实例当"渲染容器"。
   * 这样 ui.js 里所有 Engine.state 的读法完全不用改 —— 单机/联机共用同一套界面代码。 */
  function load(snap) {
    if (!snap || typeof snap !== 'object') return false;
    state = snap;
    if (typeof snap._iid === 'number') iid = snap._iid;   // 服务端若带了实例计数器就一并同步
    if (typeof snap._uid === 'number') uid = snap._uid;
    notify();
    return true;
  }

  /* ---------------- 建立对局 ---------------- */
  function newGame(opts) {
    opts = opts || {};
    iid = 1; uid = 1;
    state = {
      round: 1, active: 'A', phase: 'PREP',
      players: {
        A: makePlayer('A', opts.playerName || '玩家', false, opts.playerDeck || PRESET_DECKS.starter),
        B: makePlayer('B', opts.aiName || '对手', true, opts.aiDeck || PRESET_DECKS.raider)
      },
      winner: null, log: [], events: [], pending: null, busy: false, seed: 0,
      maxRounds: (opts.maxRounds != null ? opts.maxRounds : Rules.MAX_ROUNDS),   // 可按模式覆盖（学院考核：4~12 回合上限）
      noHpFloor: !!opts.noHpFloor,                                                // 学院考核：血量无下限、不因血量≤0提前结束（比的是总输出）
      dealt: { A: 0, B: 0 },                                                     // 双方"造成的总伤害"（学院考核按输出判定胜负）
      healed: { A: 0, B: 0 },                                                    // 双方"恢复的玩家生命"（学院考核里可抵消对手的输出）
      dmgBy: { A: {}, B: {} },                                                   // 按"怪物卡"归因的伤害（key → {卡id: 伤害}），大赛赛后输出排行用
      playerDmgMult: (opts.playerDmgMult != null ? opts.playerDmgMult : 1),      // 对玩家本体的伤害在输出统计里的倍率（学院考核 = 2）
      // ---- 学院特技（战斗 / 种族类）：按阵营打包的 mod 表，由 academy.js 的 newBattleState 传入 ----
      perk: { A: opts.perkA || null, B: opts.perkB || null },
      // ---- 成就统计（由 achievements.js 读取；off = 本局不计入成就，例如学院考核的模拟对局）----
      ach: {
        off: !!opts.achOff, mode: opts.mode || 'battle', done: false,
        throwKills: 0, bombsThisTurn: 0, bombsMax: 0, stolen: 0,
        killsThisTurn: 0, killsMaxTurn: 0, maxHit: 0, maxAtk: 0, maxShield: 0, maxBoard: 0,
        tenguMax: 0, snailMax: 0, crabStreak: 0, crabAttackedTurn: -1, crabReTurn: -1,
        potion: 0, food: 0, scroll: 0, playerAttacked: 0
      }
    };
    // 本局种子：决定洗牌与所有概率判定（同种子可完全复现）
    state.seed = seedRandom(opts.seed != null ? opts.seed : randomSeed());
    // 初始生命（跑图时玩家生命跨战斗继承；难度可调整对手生命）
    if (opts.playerMax) { state.players.A.maxHp = opts.playerMax; state.players.A.hp = opts.playerMax; }
    if (opts.playerHp != null) state.players.A.hp = Math.max(1, Math.min(opts.playerHp, state.players.A.maxHp));
    if (opts.aiHp) { state.players.B.maxHp = opts.aiHp; state.players.B.hp = opts.aiHp; }
    // 神器（遗物）直接置入神器栏，不参与洗牌与抽牌
    // 其余卡牌按种子洗牌后再起手抽 4 张
    ['A', 'B'].forEach(function (k) {
      var p = state.players[k];
      p.artifacts = p.deck.filter(function (c) { return cardOf(c).type === 'artifact'; });
      p.deck = p.deck.filter(function (c) { return cardOf(c).type !== 'artifact'; });
      shuffle(p.deck);
      p.discard = [];
    });
    state.tutorial = !!opts.tutorial;                                          // 教程局：牌库空的提示不刷屏（教程的牌都由步骤发放）
    // ---- BOSS 闯关（晋升之路）：预置 BOSS + 本体锁血 + 技能钩子 ----
    state.bodyLock = !!opts.bodyLock;                                           // 对手本体锁血（不低于 1，永远打不死 → 只能击破 BOSS 取胜）
    state.bossHooks = (opts.bossHooks && typeof opts.bossHooks === 'object') ? opts.bossHooks : null;
    state.bossState = {};
    if (opts.boss) { placeBoss(opts.boss); bossHook('init'); }
    draw('A', Rules.START_HAND, true, { deal: true });
    draw('B', Rules.START_HAND, true, { deal: true });
    var firstKey = (opts.first === 'B') ? 'B' : 'A';
    state.active = firstKey;
    // 后手补偿（通用规则，双方适用）：后手方的初始手牌必定至少含 1 张 C/B 怪物卡
    secondHandCompensate(other(firstKey));
    // AI 起手整备（策略通道）：如"冠军"档的 A 卡 / 过牌保底（由 ai.js 决定，引擎不关心规则）
    if (aiPolicy && aiPolicy.handRig) {
      ['A', 'B'].forEach(function (k) { aiPolicy.handRig(k, state.players[k]); });
    }
    log('—— 对局开始：第 1 大回合，' + state.players[firstKey].name + '先手 ——', 'hl');
    log('本局种子：' + state.seed, 'dim');
    startTurn(firstKey, true);
    notify();
    return state;
  }

  /* 后手补偿：后手方初始手牌保底 1 张 C/B 怪物卡（用 1 换 1，不改变牌库/手牌总数）。
   * 若牌库里没有 C/B 怪则不做任何事（例如纯道具卡组）。 */
  function secondHandCompensate(key) {
    var p = state.players[key];
    if (!p) return;
    var hasBody = p.hand.some(function (c) { var cd = cardOf(c); return cd.type === 'monster' && (cd.tier === 'C' || cd.tier === 'B'); });
    if (hasBody) return;
    var di = -1;
    for (var i = 0; i < p.deck.length; i++) {
      var d = cardOf(p.deck[i]);
      if (d.type === 'monster' && (d.tier === 'C' || d.tier === 'B')) { di = i; break; }
    }
    if (di < 0) return;
    var got = p.deck.splice(di, 1)[0];
    var back = 0;                                  // 换出：优先换掉非怪物卡
    for (var h = 0; h < p.hand.length; h++) { if (cardOf(p.hand[h]).type !== 'monster') { back = h; break; } }
    var out = p.hand.splice(back, 1)[0];
    p.deck.push(out);
    p.hand.push(got);
    log(p.name + '（后手补偿）：初始手牌保底 1 张 C/B 怪物卡', 'eff');
  }

  function removeFromHand(p, iidv, silent) {
    for (var i = 0; i < p.hand.length; i++) {
      if (p.hand[i].iid === iidv) { var c = p.hand.splice(i, 1)[0]; if (!silent) {} return c; }
    }
    return null;
  }
  function removeFromBoard(p, uidv) {
    for (var i = 0; i < p.board.length; i++) if (p.board[i] && p.board[i].uid === uidv) { var m = p.board[i]; p.board[i] = null; return { inst: m, slot: i }; }
    return null;
  }

  /* ---------------- 抽牌 / 弃牌 ---------------- */
  function draw(key, n, silent, opts) {
    var p = state.players[key];
    for (var i = 0; i < n; i++) {
      if (p.deck.length === 0) { if (!silent && !state.tutorial) log(p.name + ' 牌库已空，无法抽牌（不判负）', 'dim'); break; }
      // 「希望抽卡」（AI 策略通道，见 ai.js 的 champion 档）：由 AI 决定是否直接从牌库里取走"最想要的那张"。
      // 挂在 draw() 里，因此**所有抽牌**（每回合抽牌、宝箱/过牌效果）都会经过它 → 过牌越多越容易连锁拿到希望卡。
      // 开局发牌（opts.deal）不走这里——开局由"起手保底"规则单独负责，避免双重叠加。
      var c = null;
      // 手牌已满时不要挑希望卡：否则挑走的好牌会立刻被"手牌上限溢出"洗回牌库底，等于白白浪费一次机会
      if (p.isAI && aiPolicy && aiPolicy.hopePick && !(opts && opts.deal) && p.hand.length < Rules.HAND_LIMIT) {
        var hope = aiPolicy.hopePick(key, p);
        if (hope && hope.iid != null) {
          for (var di = 0; di < p.deck.length; di++) {
            if (p.deck[di].iid === hope.iid) { c = p.deck.splice(di, 1)[0]; break; }
          }
          // 静默计数（仅内部遥测，不写日志、不显示给玩家：属于隐蔽的难度补偿）
          if (c) state.hopeDraws = (state.hopeDraws || 0) + 1;
        }
      }
      if (!c) c = p.deck.pop();
      if (p.hand.length >= Rules.HAND_LIMIT) {
        // 手牌上限溢出：洗回牌库底
        p.deck.unshift(c);
        if (!silent) log(p.name + ' 手牌已满，' + cardOf(c).name + ' 洗回牌库', 'dim');
        continue;
      }
      p.hand.push(c);
      if (!silent) log(p.name + ' 抽了一张牌');
      // 灵能弓：抽牌时对随机敌方怪物造成1点伤害
      var w = findWeaponWith(cardOf(c), 'onDrawDmg') || weaponOnDraw(p);
      if (w) triggerWeaponDraw(w, key);
    }
  }
  function weaponOnDraw(p) {
    for (var i = 0; i < p.board.length; i++) {
      var m = p.board[i];
      if (m && m.weapon && cardOf(m.weapon).mods && cardOf(m.weapon).mods.onDrawDmg) return m;
    }
    return null;
  }
  function findWeaponWith(card, prop) { return null; }
  function triggerWeaponDraw(m, key) {
    var oppKey = other(key);
    var targets = aliveMonsters(oppKey);
    if (!targets.length) return;
    var t = pick(targets);
    log(cardOf(m.weapon).name + ' 触发：对 ' + t.name + ' 造成 ' + cardOf(m.weapon).mods.onDrawDmg + ' 点伤害', 'eff');
    damageMonster(t, oppKey, cardOf(m.weapon).mods.onDrawDmg, {});
  }

  function discardCard(key, iidv, reason) {
    var p = state.players[key];
    var c = removeFromHand(p, iidv);
    if (!c) return null;
    toDiscard(key, c, false);
    var cd = cardOf(c);
    // 露珠：回合结束若存于手牌则进弃牌堆（此处用于通用弃牌时不需要）
    if (reason !== 'hand') log('弃置 ' + cd.name, 'dim');
    return c;
  }
  function discardRandom(key, n) {
    var p = state.players[key];
    for (var i = 0; i < n; i++) {
      if (!p.hand.length) break;
      var idx = rnd(p.hand.length);
      var c = p.hand.splice(idx, 1)[0];
      toDiscard(key, c, false);
      log(p.name + ' 随机弃置 ' + cardOf(c).name, 'dim');
    }
  }
  // 「进入弃牌堆时」效果：卡面未写「从场上」者，手牌/场上进入弃牌堆均触发
  function onDiscard(inst, key, fromField) {
    var cid = inst.cardId, opp = other(key), op = state.players[opp];
    // 破损纹章补偿：被贴了纹章、且当前等级>0 的防具进入弃牌堆时，在手牌衍生【升级卷轴】
    if (CARDS[cid].type === 'armor' && inst.flags && inst.flags.emblem && inst.level > 0) {
      deriveCard(key, 'a-029-2');
      log('破损纹章补偿：' + cardOf(inst).name + '（Lv' + inst.level + '）进入弃牌堆 → 衍生【升级卷轴】', 'eff');
    }
    switch (cid) {
      case 'a-001-2': draw(key, 1); break;                                  // 宝箱怪：抽1
      case 'a-049-2': searchDeckRandom(key, function (c) { var cd = CARDS[c.cardId]; return cd.type === 'monster' && (cd.tags || []).indexOf('🫒') >= 0; }, 1); break;  // 繁花史莱姆（随机🫒怪物）
      case 'a-056-2': discardRandom(opp, 1); break;                          // 黄昏史莱姆
      case 'a-057-2': { var t2 = pick(aliveMonsters(opp)); if (t2) damageMonster(t2, opp, 3, {}); break; }  // 血红史莱姆
      case 'a-077-2': requestChoices(key, [{ from: 'deck', count: 1, pred: function (c) { return CARDS[c.cardId].type === 'weapon'; }, label: '检索一张武器' }]); break;  // 咒缚灵（定向检索）
      default: break;
    }
  }
  // 统一入口：卡牌进入弃牌堆 + 触发「进入弃牌堆时」效果
  function toDiscard(ownerKey, inst, fromField) {
    state.players[ownerKey].discard.push(inst);
    onDiscard(inst, ownerKey, !!fromField);
  }

  /* 觉醒词条：实例生成时的效果（【庞大】改生命、【号令】给友军加攻） */
  function applyAwakenSpawn(inst, key) {
    if (inst.awaken === 'titan') {               // 【庞大】生命在三星基础上翻倍
      inst.maxHp = inst.maxHp * 2;
      inst.hp = inst.maxHp;
    }
    // 【暴怒】的攻击次数也要在这里设一次：回合开始的重置只覆盖"已在场"的怪，
    // 而准备阶段当回合召唤出来的暴怒怪拿到的是创建时的 1，于是当回合只能打一次。
    if (inst.awaken === 'fury') inst.flags.attacksMax = 2;
    // 【号令】召唤时随机一只友军攻击力翻倍（不含自己；已被号令过的跳过，避免叠加）
    if (inst.awaken === 'command') {
      var mates = aliveMonsters(key).filter(function (m) {
        return m.uid !== inst.uid && !m.flags.commanded;
      });
      if (mates.length) {
        var m2 = mates[Math.floor(rand() * mates.length)];
        m2.flags.commanded = true;
        m2.baseAtk = m2.baseAtk * 2;
        recalc(m2);
        log('【号令】' + inst.name + '：' + m2.name + ' 攻击力翻倍（→' + m2.atk + '）', 'eff');
      }
    }
  }

  /* ---------------- 怪物实例化 ---------------- */
  function spawnMonster(key, cardInst, slot) {
    var p = state.players[key], cd = cardOf(cardInst);
    var star = cardInst.star || 1;                 // 星级：2★ 数值 ×2，3★ 数值 ×3
    var bHp = cd.hp * star, bAtk = cd.atk * star;
    // 3★ 觉醒词条（只可能在学院考核出现）：沿用实例上【合成那一刻抽定】的那一个。
    // 召唤 / 回手 / 复活 / 镜像复制都带着它走 —— 一张卡觉醒成什么，在它被合出来时就定死了。
    // 只有实例上确实没有词条时才现掷一次（预设卡组 / 测试直接造 3★），并写回实例，
    // 保证"同一个实例永远是同一个词条"。
    var awaken = cardInst.awaken || null;
    if (!awaken && star >= 3) { awaken = rollAwaken(); cardInst.awaken = awaken; }
    var inst = {
      uid: uid++, cardId: cd.id, name: cd.name, tier: cd.tier, star: star,
      awaken: awaken,
      baseHp: bHp, maxHp: bHp, hp: bHp,
      baseAtk: bAtk, atk: bAtk, growthAtk: cardInst.growthAtk || 0, tempAtk: 0,
      level: 0, weapon: null, armor: null, shield: 0,
      buffs: {}, flags: { attacked: false, attacksMax: 1 },
      slot: slot
    };
    if (awaken) applyAwakenSpawn(inst, key);
    // 学院特技（战斗 / 种族类）的生命加成
    var _pHp = perkHpBonus(CARDS[inst.cardId], key);
    if (_pHp) { inst.maxHp += _pHp; inst.hp += _pHp; }
    if (slot === undefined || slot === null || p.board[slot]) slot = firstEmpty(p);
    p.board[slot] = inst;
    applyInnateFlags(inst);
    recalc(inst);
    log(key === 'A' ? '召唤 ' + cd.name + ' 到' + ln(slot) + '位' : '对手召唤 ' + cd.name + ' 到' + ln(slot) + '位', 'summon');
    emit({ type: 'summon', uid: inst.uid, key: key, cardId: inst.cardId, slot: slot });
    onSummon(inst, key);
    // 召唤陷阱 / 爆炸陷阱：对方召唤后触发
    checkSummonTrap(other(key), key, inst);
    return inst;
  }
  // 固有状态：怨灵在战斗阶段永久无法被攻击（标记为"固有"，暗影斗篷/极影铃虹的临时免疫到期时不会误清）
  function applyInnateFlags(inst) {
    if (inst.cardId === 'a-076-2') { inst.flags.untargetable = true; inst.flags.untargetableInnate = true; }
  }
  function firstEmpty(p) { for (var i = 0; i < p.board.length; i++) if (!p.board[i]) return i; return -1; }
  function emptySlots(key) { var p = state.players[key], r = []; for (var i = 0; i < p.board.length; i++) if (!p.board[i]) r.push(i); return r; }
  function aliveMonsters(key) { return state.players[key].board.filter(Boolean); }
  function findMonster(key, uidv) { var b = state.players[key].board; for (var i = 0; i < b.length; i++) if (b[i] && b[i].uid === uidv) return b[i]; return null; }
  function slotOf(key, uidv) { var b = state.players[key].board; for (var i = 0; i < b.length; i++) if (b[i] && b[i].uid === uidv) return i; return -1; }

  /* ---------------- BOSS 闯关（晋升之路）支援 ----------------
   * placeBoss：把 BOSS 预置到对手中位（自定义血量，不触发"召唤时"效果）
   * bossHook：在关键时机（回合开始/结束、BOSS 离场等）回调模式提供的技能
   * bossApi ：暴露给技能实现的安全接口
   */
  function placeBoss(cfg) {
    var p = state.players.B, cd = CARDS[cfg.cardId];
    if (!cd) return null;
    var slot = (cfg.slot != null) ? cfg.slot : 1;                    // 默认中位
    var hp = (cfg.hp != null) ? cfg.hp : cd.hp;
    var atk = (cfg.atk != null) ? cfg.atk : cd.atk;
    var inst = {
      uid: uid++, cardId: cd.id, name: cd.name, tier: cd.tier, star: 1,
      baseHp: hp, maxHp: hp, hp: hp, baseAtk: atk, atk: atk,
      growthAtk: 0, tempAtk: 0, level: 0, weapon: null, armor: null, shield: 0,
      buffs: {}, flags: { attacked: false, attacksMax: 1, isBoss: true }, slot: slot, isBoss: true
    };
    if (cfg.untargetable) { inst.flags.untargetable = true; inst.flags.untargetableInnate = true; }
    if (cfg.noAttack) inst.flags.noAttack = true;
    p.board[slot] = inst;
    applyInnateFlags(inst);
    recalc(inst);
    state.bossUid = inst.uid;
    log('★ BOSS【' + cd.name + '】降临（生命 ' + hp + '）', 'hl');
    emit({ type: 'summon', uid: inst.uid, key: 'B', cardId: inst.cardId, slot: slot });
    return inst;
  }
  function bossInst() { return state.bossUid ? findMonster('B', state.bossUid) : null; }
  function bossApi() {
    return {
      state: state,
      boss: bossInst,
      player: function () { return state.players.A; },
      foe: function () { return state.players.B; },
      alive: function (k) { return aliveMonsters(k); },
      empty: function (k) { return emptySlots(k); },
      slotOf: slotOf,
      damage: function (m, k, n) { return damageMonster(m, k || 'A', n || 0, {}); },
      damagePlayer: function (k, n) { damagePlayer(k || 'A', n || 0, {}); },
      heal: function (m, n) { healMonster(m, n || 0); },
      derive: function (k, id) { deriveCard(k, id); },
      token: function (k, id) { return summonToken(k, id); },
      tokenAt: function (k, id, slot) { return summonToken(k, id, { slot: slot }); },   // 指定栏位衍生（该位必须为空）
      summonEffect: function (m) { if (m && CARDS[m.cardId]) onSummon(m, 'B'); },        // 触发"从手牌召唤上场时"效果
      draw: function (k, n) { draw(k, n || 1); },
      discardRandom: function (k, n) { discardRandom(k, n || 1); },
      destroy: function (m, k, o) { destroyMonster(m, k || 'B', o || {}); },
      recalc: function (m) { recalc(m); },
      rand: rand, log: log
    };
  }
  function bossHook(name, arg) {
    if (!state.bossHooks || state.winner) return;
    var fn = state.bossHooks[name];
    if (typeof fn === 'function') fn(bossApi(), arg);
  }

  /* ---------------- 数值重算 ---------------- */
  // 装备数值随等级替换（策划案：升级提升行数值直接替换基准值）
  function eqModValue(eq, key) {
    if (!eq) return 0;
    var m = CARDS[eq.cardId].mods || {};
    var v = m[key] || 0;
    if (eq.level > 0 && m.upgrade) {
      var u = m.upgrade[Math.min(eq.level, m.upgrade.length) - 1];
      if (u && u[key] != null) v = u[key];
    }
    return v;
  }
  /* 学院特技（战斗 / 种族类）的加成查询。
   * 战斗类：atkAll / hpAll（全场）+ summonAdd（每回合多召唤）
   * 种族类：tagAtk / tagHp 按卡面 tags（🫒 💰 💎…）匹配；tagAllAtk / tagAllHp 对"带任意标签"的怪生效 */
  function perkOf(key, k) {
    var pk = state.perk && state.perk[key];
    return (pk && pk[k]) ? pk[k] : 0;
  }
  function perkAtkBonus(cd, key) {
    var pk = state.perk && state.perk[key];
    if (!pk) return 0;
    var b = pk.atkAll || 0, tags = cd.tags || [];
    if (pk.tagAtk) tags.forEach(function (t) { b += pk.tagAtk[t] || 0; });
    if (pk.tagAllAtk && tags.length) b += pk.tagAllAtk;
    return b;
  }
  function perkHpBonus(cd, key) {
    var pk = state.perk && state.perk[key];
    if (!pk) return 0;
    var b = pk.hpAll || 0, tags = cd.tags || [];
    if (pk.tagHp) tags.forEach(function (t) { b += pk.tagHp[t] || 0; });
    if (pk.tagAllHp && tags.length) b += pk.tagAllHp;
    return b;
  }
  function recalc(inst) {
    var cd = CARDS[inst.cardId], owner = null, ownerKey = null;
    ['A', 'B'].forEach(function (k) { if (findMonster(k, inst.uid)) { owner = state.players[k]; ownerKey = k; } });
    var atk = inst.baseAtk + inst.growthAtk + inst.tempAtk;
    atk += eqModValue(inst.weapon, 'atkBonus');
    atk += eqModValue(inst.armor, 'atkBonus');
    // 金色蜜蜂：我方玩家生命 < 30 时攻击+4（卡面固定阈值 30，不随跑图继承的最大生命变化）
    if (cd.id === 'a-047-2' && owner && owner.hp < Rules.PLAYER_HP) atk += 4;
    // 喷毒花：对位存在怪物且我方场上仅有此卡时攻击+5
    if (cd.id === 'a-048-2' && ownerKey) {
      var opp = state.players[other(ownerKey)];
      var myIdx = slotOf(ownerKey, inst.uid);
      if (aliveMonsters(ownerKey).length === 1 && opp.board[myIdx]) atk += 5;
    }
    if (inst.awaken === 'elite') atk *= 2;      // 觉醒【精英】：攻击力在三星基础上翻倍
    if (ownerKey) atk += perkAtkBonus(cd, ownerKey);   // 学院特技：全场 / 按标签的攻击加成
    inst.atk = Math.max(0, atk);
  }
  function recalcAll() { ['A', 'B'].forEach(function (k) { aliveMonsters(k).forEach(recalc); }); }
  function dmgReduce(inst) {
    var r = 0;
    r += eqModValue(inst.armor, 'dmgReduce');
    if (inst.armor && inst.armor.flags) r += (inst.armor.flags.emblemReduce || 0);   // 破损纹章：每张 +1 减伤（不改变防具等级）
    if (inst.cardId === 'a-005-2') r += 2;      // 大蜗牛：战斗阶段受到伤害-2
    if (inst.cardId === 'a-032-2') r += 1;      // 战士B：受到伤害-1
    if (inst.awaken === 'armor8') r += 8;       // 觉醒【重甲】：自带 8 点减伤
    r -= (inst.reduceCut || 0);                 // 新卡：狼萨满系削减减伤（每层 -1）
    return Math.max(0, r);
  }
  // 狼萨满系（青狼B a-106-2 / 紫狼A a-109-2）：主动攻击后，若目标减伤＞1，则其减伤-1
  // mul：卡牌效果倍率（紫狼萨满作 BOSS 时由【萨满王】放大，见 atk.flags.effectMul）
  function cutTargetReduce(t, srcId, mul) {
    if (!t || t.flags.dead) return;
    mul = mul || 1;
    if (dmgReduce(t) > 1) {
      t.reduceCut = (t.reduceCut || 0) + mul;
      log(CARDS[srcId].name + '：' + t.name + ' 减伤-' + mul + '（现减伤 ' + dmgReduce(t) + '）', 'eff');
    }
  }

  /* ---------------- 伤害 ---------------- */
  // 伤害归因：记录"某一方造成的总伤害"（学院考核比总输出用；credit 传 null 表示自伤，不计给任何一方）
  function creditDamage(side, n) {
    if (!side || !(n > 0)) return;
    state.dealt[side] = (state.dealt[side] || 0) + n;
  }
  /* 伤害来源记账：记"某张怪物卡打出了多少伤害"（大赛赛后输出排行用）。
   * 只有由怪物主动攻击（含攻击附带的追加伤害、打脸）产生的伤害才带 opts.src；
   * 反击（黏咕/遗言）、毒气、投掷物、法杖等不传 src → 不计入排行。 */
  function creditSrc(src, n) {
    if (!src || !src.card || !(n > 0)) return;
    var by = src.by || 'A';
    var m = state.dmgBy[by] || (state.dmgBy[by] = {});
    m[src.card] = (m[src.card] || 0) + n;
  }
  // 记录"局内恢复的玩家生命"：学院考核结算时用来抵消对手输出
  function creditHeal(side, n) {
    if (!side || !(n > 0) || !state.healed) return;
    state.healed[side] = (state.healed[side] || 0) + n;
  }
  function damageMonster(inst, ownerKey, amount, opts) {
    opts = opts || {};
    if (inst.flags.dead) return 0;
    var dmg = amount;
    if (opts.attack) {
      // 巨钳蟹：战斗阶段中仅受到一次伤害
      if (inst.cardId === 'a-008-2') {
        if (inst.flags.tookDamageThisBattle) { log('巨钳蟹 本战斗阶段已受伤，免疫该次伤害', 'eff'); return 0; }
        inst.flags.tookDamageThisBattle = true;
      }
      // 闪避（水道巨蛇）
      if (inst.cardId === 'a-003-2' && rand() < 0.4) { log(inst.name + ' 触发【闪避】', 'eff'); emit({ type: 'float', uid: inst.uid, text: '闪避', kind: 'dodge' }); return 0; }
      // 反伤（卡面带【反伤】词缀，当前卡库暂无，预留）
      // 觉醒【破甲】：这次攻击无视对方减伤
      if (!opts.ignoreReduce) dmg = Math.max(0, dmg - dmgReduce(inst));
    }
    if (dmg <= 0 && opts.attack) { emit({ type: 'float', uid: inst.uid, text: '0', kind: 'dmg' }); return 0; }
    // 护盾优先吸收
    if (inst.shield > 0 && dmg > 0) {
      var absorb = Math.min(inst.shield, dmg);
      inst.shield -= absorb; dmg -= absorb;
      log(inst.name + ' 护盾吸收 ' + absorb + ' 点（剩余护盾 ' + inst.shield + '）', 'eff');
      if (dmg <= 0) { emit({ type: 'float', uid: inst.uid, text: '盾', kind: 'dodge' }); return 0; }
    }
    inst.hp -= dmg;
    creditDamage((opts.credit !== undefined) ? opts.credit : other(ownerKey), dmg);
    creditSrc(opts.src, dmg);                                   // 按怪物卡归因（攻击流程才带 src）
    emit({ type: 'float', uid: inst.uid, text: '-' + dmg, kind: 'dmg' });
    log(inst.name + ' 受到 ' + dmg + ' 点伤害（剩余 ' + Math.max(0, inst.hp) + '）', 'dmg');
    // 新卡：豺狼暴徒（B）/ 重甲暴徒（A）—— 生命跌破阈值时获得 4 点护盾与攻击加成；
    // 回血到阈值以上后标记解除（同黏咕），再次跌破可再次发动
    if (inst.hp > 0 && (inst.cardId === 'a-105-2' || inst.cardId === 'a-108-2') && !inst.flags.thugBuff) {
      var thr = (inst.cardId === 'a-105-2') ? 4 : 6;
      if (inst.hp < thr) {
        var ab = (inst.cardId === 'a-105-2') ? 3 : 5;
        inst.flags.thugBuff = true;
        inst.shield += 4; inst.baseAtk += ab; recalc(inst);
        log(inst.name + ' 触发：生命＜' + thr + ' → 获得 4 点护盾，攻击+' + ab, 'eff');
        emit({ type: 'float', uid: inst.uid, text: '+4盾', kind: 'heal' });
      }
    }
    // 苍蝇群：仅"本体"（非衍生体）在生命＜6 时可衍生一张 1/1 苍蝇群；恢复至 ≥6 后可再次触发
    if (inst.cardId === 'a-007-2' && !inst.flags.token) {
      if (inst.hp >= 6) inst.flags.flySpawned = false;
      else if (inst.hp > 0 && !inst.flags.flySpawned) {
        inst.flags.flySpawned = true;
        if (emptySlots(ownerKey).length) { summonToken(ownerKey, 'a-007-2', { hp: 1, atk: 1 }); log('苍蝇群：衍生一张 1/1 苍蝇群', 'eff'); }
      }
    }
    // 克里弗斯之果：受到主动攻击时，对方叠加 2 层【毒气】+ 我方每张 🫒 怪额外 +1
    if (opts.attack && inst.cardId === 'a-055-2') {
      // 「我方场上每有一张🫒类怪物额外+1层」：含自身（自身也带🫒标签）
      var olives = aliveMonsters(ownerKey).filter(function (m) { return (CARDS[m.cardId].tags || []).indexOf('🫒') >= 0; }).length;
      var addP = 2 + olives;
      state.players[other(ownerKey)].poison += addP;
      log('克里弗斯之果：对方叠加 ' + addP + ' 层【毒气】', 'eff');
    }
    // 天狗：受到伤害时移动
    if (inst.cardId === 'a-083-2' && inst.hp > 0) tenguMove(inst, ownerKey);
    // 黏咕：生命≤10 时对敌方所有怪物造成10点伤害
    if (inst.cardId === 'a-012-2' && inst.hp <= 10 && !inst.flags.gumBurst) {
      inst.flags.gumBurst = true;
      log('黏咕 触发：对敌方所有怪物造成 10 点伤害', 'eff');
      aliveMonsters(other(ownerKey)).slice().forEach(function (m) { damageMonster(m, other(ownerKey), 10, {}); });
    }
    if (inst.hp <= 0) destroyMonster(inst, ownerKey, opts);
    // BOSS 技能：本体受伤后（【磁塔】等"生命降到阈值以下"需即时触发，会影响本回合后续攻击）
    else if (state.bossUid && inst.uid === state.bossUid) bossHook('bossDamaged', inst);
    return dmg;
  }
  function damagePlayer(key, amount, opts) {
    opts = opts || {};
    var p = state.players[key];
    if (state.winner) return;
    p.hp -= amount;
    creditDamage(other(key), amount * (state.playerDmgMult || 1));   // 打脸输出可加倍（学院考核 ×2）
    creditSrc(opts.src, amount);                                     // 打脸也算该怪物卡的输出
    // BOSS 闯关：对手本体锁血（不低于 1，永远打不死 → 只能靠击破 BOSS 取胜）
    if (state.bodyLock && key === 'B' && p.hp < 1) p.hp = 1;
    emit({ type: 'float', player: key, text: '-' + amount, kind: 'dmg' });
    log(p.name + ' 受到 ' + amount + ' 点伤害（剩余 ' + (state.noHpFloor ? p.hp : Math.max(0, p.hp)) + '）', 'dmg');
    if (state.bodyLock && key === 'B') return;                        // 锁血方不参与胜负判定
    // 学院考核（noHpFloor）：血量可以扣成负数，对局继续打满回合上限，只比双方累计输出
    if (!state.noHpFloor && p.hp <= 0) { p.hp = 0; state.winner = other(key); log('—— ' + state.players[state.winner].name + ' 获胜！——', 'hl'); }
  }
  function healMonster(inst, amount) {
    var before = inst.hp; inst.hp = Math.min(inst.maxHp, inst.hp + amount);
    var d = inst.hp - before; if (d > 0) { emit({ type: 'float', uid: inst.uid, text: '+' + d, kind: 'heal' }); log(inst.name + ' 恢复 ' + d + ' 点生命', 'heal'); }
    // 苍蝇群本体：恢复到 ≥6 生命后，可再次触发衍生
    if (inst.cardId === 'a-007-2' && inst.hp >= 6) inst.flags.flySpawned = false;
    // 黏咕：回血到 >10 后重新具备"生命≤10 时群体10伤"的引爆能力（可二次引爆）
    if (inst.cardId === 'a-012-2' && inst.hp > 10) inst.flags.gumBurst = false;
    // 豺狼暴徒 a-105-2（阈值 4）/ 重甲暴徒 a-108-2（阈值 6）：回血到阈值以上后，重新具备
    // 「生命＜阈值时获得 4 点护盾并攻击提升」的能力 → 与黏咕一致，可再次发动
    if (inst.flags.thugBuff) {
      var thugThr = (inst.cardId === 'a-105-2') ? 4 : (inst.cardId === 'a-108-2') ? 6 : 0;
      if (thugThr && inst.hp >= thugThr) {
        inst.flags.thugBuff = false;
        log(inst.name + '：生命回到 ' + inst.hp + '（≥' + thugThr + '），技能可再次发动', 'dim');
      }
    }
  }
  function healPlayer(key, amount) {
    var p = state.players[key], before = p.hp; p.hp = Math.min(p.maxHp, p.hp + amount);
    var d = p.hp - before;
    if (d > 0) { creditHeal(key, d); emit({ type: 'float', player: key, text: '+' + d, kind: 'heal' }); log(p.name + ' 恢复 ' + d + ' 点生命', 'heal'); }
  }

  /* ---------------- 死亡 / 弃置 ---------------- */
  // 收牌：手牌未满则进手牌，满了洗回牌库（遵循"溢出洗回"规则）
  function gainCard(p, card, label) {
    if (p.hand.length >= Rules.HAND_LIMIT) { p.deck.unshift(card); log((label || '') + '手牌已满，' + cardOf(card).name + ' 洗回牌库', 'dim'); }
    else p.hand.push(card);
  }
  // 统一处理：怪物离开场上（死亡/献祭/返回手牌/离场）时，其装备必须回归手牌并保留等级
  function returnEquipment(m, ownerKey) {
    var p = state.players[ownerKey];
    // 镜像卷轴带来的装备：离场时直接消失，不回手
    if (m.weapon && m.weapon.isMirror) { log('镜像装备 ' + cardOf(m.weapon).name + ' 随镜像一同消失', 'dim'); m.weapon = null; }
    if (m.armor && m.armor.isMirror) { log('镜像装备 ' + cardOf(m.armor).name + ' 随镜像一同消失', 'dim'); m.armor = null; }
    if (m.weapon) { var w = m.weapon; m.weapon = null; log(m.name + ' 的 ' + cardOf(w).name + ' 回归手牌（保留 Lv' + (w.level || 0) + '）', 'dim'); gainCard(p, w, m.name + ' 的装备'); }
    if (m.armor) { var a = m.armor; m.armor = null; log(m.name + ' 的 ' + cardOf(a).name + ' 回归手牌（保留 Lv' + (a.level || 0) + '）', 'dim'); gainCard(p, a, m.name + ' 的装备'); }
  }
  // 怪物离场（返回手牌 / 进入弃牌堆）：装备统一归还，本体按去向处理
  function leaveBoard(m, ownerKey, toDisc) {
    var p = state.players[ownerKey];
    var i = slotOf(ownerKey, m.uid);
    if (i >= 0) p.board[i] = null;
    if (state.bossUid && m.uid === state.bossUid) bossHook('bossLeave', m);   // BOSS 离场（如疯狂强盗回手）
    returnEquipment(m, ownerKey);
    m.flags.offBoard = true;
    // ★ 镜像体（镜像卷轴 a-116-2 / 觉醒【幻象】产生）永远不会变成手牌：
    //   任何"返回手牌"一律视作销毁（进弃牌堆）—— 否则镜像的 深蓝蝾螈 / 喷毒花 / 疯狂小偷 等
    //   "回合结束返回手牌"的怪会把复制体送回手牌，等于凭空多出一张真卡。
    if (!toDisc && m.flags.mirror) { log('镜像体 ' + m.name + ' 无法返回手牌 → 视作销毁', 'eff'); toDisc = true; }
    if (toDisc) { toDiscard(ownerKey, makeInstance(m.cardId, m.level, m.star, m.awaken), true); return null; }
    var ni = makeInstance(m.cardId, m.level, m.star, m.awaken);
    ni.growthAtk = m.growthAtk || 0;
    ni.returnedTurn = state.turnCount;      // 「本回合被回手」标记：供 AI 识别"反复出场回手"的自我循环
    gainCard(p, ni, m.name + ' 返回手牌：');
    return ni;
  }

  function destroyMonster(inst, ownerKey, opts) {
    opts = opts || {};
    inst.flags.dead = true;
    var p = state.players[ownerKey];
    var slot = slotOf(ownerKey, inst.uid);
    // 澪：首次进入弃牌堆后复活并恢复至10点生命
    if (inst.cardId === 'a-100-2' && !inst.flags.revived) {
      inst.flags.revived = true;
      inst.hp = 10; inst.flags.dead = false;
      log('澪 触发复活：恢复至 10 点生命', 'eff');
      emit({ type: 'float', uid: inst.uid, text: '复活', kind: 'heal' });
      return;
    }
    // 觉醒【复生】：死亡时以 10 点生命复活一次（照 a-100-2 的范式）
    if (inst.awaken === 'reborn' && !inst.flags.reborned) {
      inst.flags.reborned = true;
      inst.hp = Math.min(10, inst.maxHp);
      inst.flags.dead = false;
      log('【复生】' + inst.name + ' 以 ' + inst.hp + ' 点生命复活', 'eff');
      emit({ type: 'float', uid: inst.uid, text: '复生', kind: 'heal' });
      return;
    }
    // BOSS 技能：本体将死（可被技能救回，如【意志】；救回后本次死亡取消）
    if (state.bossUid && inst.uid === state.bossUid) {
      bossHook('bossDying', inst);
      if (!inst.flags.dead) return;
    }
    // 成就「双杀」：本回合击破敌方怪物数（献祭等自己消除的不算）
    if (state.ach && !state.ach.off && ownerKey === 'B' && !opts.sacrifice) {
      state.ach.killsThisTurn += 1;
      if (state.ach.killsThisTurn > state.ach.killsMaxTurn) state.ach.killsMaxTurn = state.ach.killsThisTurn;
    }
    p.board[slot] = null;
    // 装备回归手牌并保留升级等级
    returnEquipment(inst, ownerKey);
    // 怪物卡进弃牌堆（触发「进入弃牌堆时」效果）
    toDiscard(ownerKey, makeInstance(inst.cardId, inst.level, inst.star, inst.awaken), true);
    log(inst.name + ' 被击破', 'death');
    emit({ type: 'death', uid: inst.uid });
    // BOSS 闯关：击破 BOSS 立即通关（无需击败对手本体）
    if (state.bossUid && inst.uid === state.bossUid && !state.winner) {
      state.bossDown = true;
      state.winner = 'A';
      log('—— ★ BOSS【' + inst.name + '】被击破，通关！——', 'hl');
    }
    onDeath(inst, ownerKey, slot, opts);
    checkVictory();
  }

  /* ---------------- 回合流程 ---------------- */
  /* 本回合的法杖施法次数上限 = 基础 1 + 场上法师B ×N + 法杖栏里的老法杖。
   * ⚠ 抽成函数是因为它**不该只在回合开始时才算**：这回合中途把老法杖放进法杖栏
   *   （actPlaceWand）、或召唤出法师B（actSummon），都要立刻补上次数 ——
   *   否则"装备上去的那一回合没有加成，要等下回合才生效"。 */
  function castsMaxOf(key) {
    var p = state.players[key], n = Rules.WAND_BASE_CASTS;
    aliveMonsters(key).forEach(function (m) {
      if (m.cardId === 'a-035-2') n += 1;                    // 法师B
    });
    if (p.wand && p.wand.cardId === 'a-036-2') n += 1;       // 老法杖（只能入法杖栏，不能装备到怪物）
    return n;
  }
  /* 上限变化时刷新剩余次数：**保留本回合已经用掉的次数**，只调整余量。
   * 直接写 castsLeft = 上限 会把已用次数抹掉（等于白送次数）。 */
  function refreshCasts(key) {
    var p = state.players[key];
    if (p.castsMax == null) { p.castsMax = castsMaxOf(key); p.castsLeft = p.castsMax; return; }
    var used = Math.max(0, p.castsMax - (p.castsLeft || 0));
    p.castsMax = castsMaxOf(key);
    p.castsLeft = Math.max(0, p.castsMax - used);
  }
  function startTurn(key, silent) {
    var p = state.players[key], opp = state.players[other(key)];
    state.active = key; state.phase = 'PREP';
    // 回合计数与坐标系无关：turnCount = 双方各自已过的回合数之和，round = 第几个大回合。
    // 这样"大回合上限"天然让双方回合数相等（旧实现固定按 A 方递增 → B 先手时会多打一回合）。
    state.turnCount = (state.turnCount || 0) + 1;
    state.round = Math.ceil(state.turnCount / 2);
    // 成就：重置"本回合"计数；并在玩家新回合开始时结算「你被骗了」（水道螃蟹EX 连续未触发再攻击）
    if (state.ach && !state.ach.off && key === 'A') {
      var ach = state.ach, prevTurn = (state.turnCount || 0) - 2;   // 上一个属于 A 的回合
      if (ach.crabAttackedTurn === prevTurn) ach.crabStreak = (ach.crabReTurn === prevTurn) ? 0 : ach.crabStreak + 1;
      else ach.crabStreak = 0;
      ach.bombsThisTurn = 0;
      ach.killsThisTurn = 0;
    }
    p.summonsMax = Rules.SUMMON_PER_TURN + perkOf(key, 'summonAdd');   // 学院特技：每回合多召唤 N 次
    p.summonsLeft = p.summonsMax;
    p.flags.used = { food: 0, potion: 0, scroll: 0, weapon: 0, armor: 0 };  // 每回合各类限1张的计数
    // 冰霜药水：本回合召唤次数-1（一次性）
    if (p.flags.summonDebuff) { p.summonsLeft = Math.max(0, p.summonsLeft - p.flags.summonDebuff); log(p.name + ' 受冰霜药水影响：召唤次数 -' + p.flags.summonDebuff, 'eff'); p.flags.summonDebuff = 0; }
    // 法杖施法次数 = 基础1 + 场上提供+1的卡（法师B / 法杖栏中的老法杖），可叠加无上限
    // 回合开始 = 重置为满次数（具体算法见 castsMaxOf）
    p.castsMax = castsMaxOf(key);
    p.castsLeft = p.castsMax;
    // 重置怪物攻击次数 & 战斗阶段临时状态
    aliveMonsters(key).forEach(function (m) {
      m.flags.attacked = false;
      // 觉醒【禁锢】：解除"已经过期"的禁锢。
      // ⚠ 不能写成一进自己回合就清 —— 那样被禁锢的怪轮到自己时早解锁了，禁锢等于不存在。
      //   stunRound 记的是"第几大轮不能攻击"（A/B 在同一 round 内各有一个回合，
      //   所以 A 在 round N 被禁锢 → 它的下个回合正好也是 round N+1）。
      if (m.flags.stunRound && m.flags.stunRound < state.round) m.flags.stunRound = 0;
      m.flags.attacksMax = (m.awaken === 'fury') ? 2 : 1;   // 觉醒【暴怒】：每回合固定 2 次攻击
      m.flags.tookDamageThisBattle = false;
      m.flags.hunterDrawn = false;                        // 女猎B 每回合可再触发一次
      m.flags.robbedPlayer = false;                       // 疯狂小偷：本回合是否打脸夺到手牌
      m.flags.reattacked = false;                         // 螃蟹/水道螃蟹EX 的【再攻击】每回合可再触发
      // 盗贼B：上个对方回合若处于"无法被攻击"，则本次攻击+3（同一段"无法被攻击"只结算一次，避免与暗影斗篷的即时加成重复）
      if (m.cardId === 'a-038-2' && m.flags.untargetable && !m.flags.rogueBonusGranted) m.flags.rogueBonus = true;
      // 临时免疫到期（暗影斗篷 / 极影铃虹 / 食人鱼中位）：只撤销"临时"来源，保留固有【无法被攻击】
      if (m.flags.untargetableUntilOwnerTurn) {
        m.flags.untargetableUntilOwnerTurn = false;
        m.flags.untargetable = !!m.flags.untargetableInnate;
        m.flags.rogueBonusGranted = false;
      }
    });
    p.flags.voidChainUsed = 0;                            // 虚空锁链：准备阶段限一次
    // 时光沙漏（新卡神器 a-120-2）：冷却递减；若是"由自己发动"的时停 → 在自己回合开始时解除
    p.artifacts.forEach(function (a) {
      if (a.flags && a.flags.cd > 0) a.flags.cd -= 1;
      if (a.cardId === 'a-120-2' && a.flags && a.flags.active) {
        a.flags.active = false;
        state.players.A.flags.tsNoAttack = 0; state.players.B.flags.tsNoAttack = 0;
        state.players.A.flags.tsNoThrowWand = 0; state.players.B.flags.tsNoThrowWand = 0;
        log('时光沙漏：时停结束（' + p.name + ' 的回合开始）', 'eff');
      }
    });
    // 回旋镖（新卡）：持有者回合开始时，从弃牌堆返回手牌
    for (var dq = p.discard.length - 1; dq >= 0; dq--) {
      var dcard = p.discard[dq];
      if (dcard.returnAtTurn) {
        dcard.returnAtTurn = false;
        p.discard.splice(dq, 1);
        if (p.hand.length < Rules.HAND_LIMIT) { p.hand.push(dcard); log('回旋镖返回手牌', 'eff'); }
        else { p.deck.unshift(dcard); log('回旋镖：手牌已满，洗回牌库', 'dim'); }
      }
    }
    if (!silent) log('—— ' + p.name + ' 的回合（第 ' + state.round + ' 大回合）——', 'hl');
    // ① 全局状态 Buff 结算（毒气 / 酸气，作用于该玩家自己的怪物）
    resolveBuffSettlement(key);
    // ② 准备阶段开始时效果
    log(p.name + ' 进入准备阶段', 'phase');
    resolvePrepStart(key);
    // BOSS 技能：回合开始时（B = AI 回合 / A = 玩家回合）
    bossHook(key === 'B' ? 'aiTurnStart' : 'foeTurnStart');
    if (state.winner) { notify(); return; }
    // ③ 抽 1 张
    draw(key, Rules.DRAW_PER_TURN, false);
    if (!state.winner) notify();
  }

  // 毒气 / 酸气：己方回合开始时，己方所有在场怪物掉血；层数递减（对称机制）
  function resolveBuffSettlement(key) {
    var p = state.players[key];
    if (p.poison > 0) {
      var pd = 2 + (p.poisonBonus || 0);
      if (typeof state.poisonDmgFn === 'function') pd = state.poisonDmgFn(key, pd);   // BOSS 技能可改写毒气伤害
      log(p.name + ' 结算【毒气】' + p.poison + ' 层：己方所有怪物生命 -' + pd, 'eff');
      aliveMonsters(key).slice().forEach(function (m) {
        if (m.cardId === 'a-045-2') return; // 食人鱼免疫
        damageMonster(m, key, pd, {});
      });
      p.poison -= 1;
    }
    if (p.acid > 0) {
      var dmg = Math.ceil(p.acid / 2) * (state.acidMul || 1);   // DM-201【酸蚀】：本局【酸气】造成的伤害翻倍
      log(p.name + ' 结算【酸气】' + p.acid + ' 层：己方所有怪物生命 -' + dmg, 'eff');
      aliveMonsters(key).slice().forEach(function (m) {
        if (m.cardId === 'a-045-2') return;
        damageMonster(m, key, dmg, {});
      });
      p.acid = Math.floor(p.acid / 2);
    }
  }

  function resolvePrepStart(key) {
    var p = state.players[key];
    // 炸弹延迟爆破：在你的下一个准备阶段开始时，对敌方原位置及其十字方向各造成伤害
    if (p.bombs && p.bombs.length) {
      var ob = state.players[other(key)].board, oppKey = other(key);
      var mb = state.players[key].board;   // 纵向：同一列对侧（投掷者己方）的怪物
      var bombs = p.bombs; p.bombs = [];
      bombs.forEach(function (b) {
        log('炸弹爆破：第 ' + (b.slot + 1) + ' 位（左右）及对位受 ' + Rules.BOMB_DAMAGE + ' 点伤害', 'eff');
        // 十字横向：原位置及其左右
        [b.slot - 1, b.slot, b.slot + 1].forEach(function (idx) {
          if (idx < 0 || idx >= ob.length) return;
          if (ob[idx]) damageMonster(ob[idx], oppKey, Rules.BOMB_DAMAGE, {});
        });
        // 十字纵向：同一列对侧（投掷者己方）的怪物
        if (b.slot >= 0 && b.slot < mb.length && mb[b.slot]) damageMonster(mb[b.slot], key, Rules.BOMB_DAMAGE, { credit: null });   // 己方同列自伤：不计入任何一方的输出
      });
    }
    // 戒指 / 神器 / 怪物 PREP_START
    // 财富戒指：在手牌则额外抽一张
    if (p.hand.some(function (c) { return c.cardId === 'a-023-2'; })) { log('财富戒指 触发：额外抽一张牌', 'eff'); draw(key, 1); }
    // 先见护符
    if (p.artifacts.some(function (a) { return a.cardId === 'a-070-2'; }) && aliveMonsters(key).length > 1) {
      var opp = state.players[other(key)];
      var traps = opp.hand.filter(function (c) { return cardOf(c).type === 'trap'; });
      if (traps.length) { var t = pick(traps); removeFromHand(opp, t.iid); opp.discard.push(t); log('先见护符 触发：弃置对方陷阱 ' + cardOf(t).name, 'eff'); }
    }
    // 极速戒指：随机召唤手牌一张 C 级怪
    if (p.hand.some(function (c) { return c.cardId === 'a-065-2'; }) && emptySlots(key).length) {
      var cs = p.hand.filter(function (c) { var cd = cardOf(c); return cd.type === 'monster' && cd.tier === 'C'; });
      if (cs.length) { var cc = pick(cs); removeFromHand(p, cc.iid); log('极速戒指 触发：随机召唤 C 级怪物', 'eff'); spawnMonster(key, cc, null); }
    }
    // 狂怒戒指：己方随机一张B级怪攻击次数+1
    if (p.hand.some(function (c) { return c.cardId === 'a-066-2'; })) {
      var bs = aliveMonsters(key).filter(function (m) { return m.tier === 'B'; });
      if (bs.length) {
        var b = pick(bs);
        b.flags.attacksMax += 1;
        // 日志要写明"哪一格"生效 —— 玩家得能在场上对应到具体是哪只怪
        log('狂怒戒指 触发：' + ln(slotOf(key, b.uid)) + '位 ' + b.name + ' 攻击次数+1（→ ' + b.flags.attacksMax + ' 次）', 'eff');
      }
    }
    // 怪物自身 PREP_START
    aliveMonsters(key).slice().forEach(function (m) { prepStartMonster(m, key); });
  }

  function endTurn(key) {
    var p = state.players[key];
    bossHook('turnEnd', key);            // BOSS 技能：回合结束时（key = 刚行动的方）
    if (state.winner) { notify(); return; }
    // 回合结束时效果
    aliveMonsters(key).slice().forEach(function (m) { turnEndMonster(m, key); });
    // 露珠：若回合结束存于手牌则进弃牌堆
    for (var i = p.hand.length - 1; i >= 0; i--) {
      if (p.hand[i].cardId === 'a-018-2') { var c = p.hand.splice(i, 1)[0]; p.discard.push(c); log('露珠 回合结束进入弃牌堆', 'dim'); }
    }
    // DM-100 已在 turnEndMonster 处理
    p.flags.noAttack = false; // 催眠卷轴效果在该玩家回合结束时失效
    if (state.winner) { notify(); return; }
    var nk = other(key);
    // 大回合上限：按"累计回合数"判停 —— 双方各打到上限回合数后结束，回合数恒等
    // （旧实现固定按"A 方"递增、且在交给 A 方时判停 → B 先手时 B 白拿一整个回合 → 学院按累计输出判分时系统性偏袒 B 槽）
    if ((state.turnCount || 0) >= 2 * (state.maxRounds || Rules.MAX_ROUNDS)) { finishByHp(); notify(); return; }
    startTurn(nk, false);
    notify();
  }

  // 回合上限结算：血量高者胜；相同则平局
  function finishByHp() {
    var lim = state.maxRounds || Rules.MAX_ROUNDS;
    // BOSS 闯关：本体锁血 → 不能按血量判胜负；回合上限到了 BOSS 仍存活即为挑战失败
    if (state.bodyLock) {
      var bi = bossInst();
      log('已达 ' + lim + ' 大回合上限，BOSS【' + (bi ? bi.name : '—') + '】仍存活 → 挑战失败', 'hl');
      state.winner = 'B';
      return;
    }
    var a = state.players.A.hp, b = state.players.B.hp;
    log('已达 ' + lim + ' 大回合上限，按血量结算：' + state.players.A.name + ' ' + a + ' vs ' + state.players.B.name + ' ' + b, 'hl');
    if (a > b) state.winner = 'A';
    else if (b > a) state.winner = 'B';
    else state.winner = 'draw';
  }

  /* ---------------- 各卡牌效果实现 ---------------- */
  function onSummon(inst, key) {
    var opp = other(key), cd = CARDS[inst.cardId], p = state.players[key];
    switch (inst.cardId) {
      case 'a-107-2': {   // DM-200（新卡）：对方叠加 2 层毒气 + 其场上怪物各 1 点伤害
        var op2 = state.players[opp];
        op2.poison += 2;
        log('DM-200：对方叠加 2 层【毒气】，其场上怪物受到 1 点伤害', 'eff');
        aliveMonsters(opp).slice().forEach(function (x) { damageMonster(x, opp, 1, {}); });
        break;
      }
      case 'a-111-2': {   // DM-300（新卡）：令对手的毒气/酸气层数翻倍
        var op3 = state.players[opp];
        log('DM-300：对方【毒气】' + op3.poison + ' → ' + (op3.poison * 2) + '，【酸气】' + op3.acid + ' → ' + (op3.acid * 2), 'eff');
        op3.poison *= 2; op3.acid *= 2;
        break;
      }
      case 'a-031-2': deriveCard(key, 'a-033-2'); break;                    // 战士C → 破损纹章
      case 'a-034-2': deriveCard(key, 'a-036-2'); break;                    // 法师C → 老法杖
      case 'a-037-2': deriveCard(key, 'a-039-2'); break;                    // 盗贼C → 暗影斗篷
      case 'a-040-2': deriveCard(key, 'a-042-2'); break;                    // 女猎C → 灵能弓
      case 'a-002-2': draw(key, 1); break;                                  // 啮齿小鼠：抽1
      case 'a-010-2': requestChoices(key, [{ from: 'deck', count: 2, pred: function (c) { return CARDS[c.cardId].type === 'throw'; }, label: '检索两张投掷物' }]); break; // 豺狼猎手（定向检索）
      case 'a-043-2': requestChoices(key, [{ from: 'deck', count: 1, pred: function (c) { return CARDS[c.cardId].type === 'weapon'; }, label: '检索一张武器' }]); break; // 活化石像（定向检索）
      case 'a-004-2': { // 豺狼巡查：可选技能（弃 1 张手牌 → 检索 1 张"💰"怪）
        var jackalSteps = [
          { from: 'hand', count: 1, pred: function () { return true; }, label: '弃置一张手牌' },
          { from: 'deck', count: 1, pred: function (c) { return CARDS[c.cardId].type === 'monster' && (CARDS[c.cardId].tags || []).indexOf('💰') >= 0; }, label: '检索一张"💰"类怪物' }
        ];
        if (!p.deck.some(jackalSteps[1].pred)) { log('豺狼巡查：牌库已无"💰"怪物，技能不发动', 'dim'); break; }
        if (p.isAI) {
          // AI：按"手牌代价 vs 牌库价值"自行决定发不发动
          var wantIt = !aiPolicy || !aiPolicy.optional || aiPolicy.optional(key, inst, jackalSteps);
          if (!wantIt) { log('豺狼巡查：不发动技能（保留手牌）', 'dim'); break; }
          requestChoices(key, jackalSteps);
          break;
        }
        // 人类玩家：弹出"是否发动"选择
        state.pending = {
          kind: 'OPTION_SKILL', actorKey: key, label: '豺狼巡查', steps: jackalSteps,
          desc: '弃置一张手牌，从牌库检索一张"💰"类怪物加入手牌。'
        };
        break;
      }
      case 'a-072-2': prisonGuard(inst, key); break;                        // 监狱守卫
      case 'a-081-2': { // 腐烂之心：每 2 层腐烂标记使对手受到的毒气伤害+1，然后清空
        var p2 = state.players[opp], bonus = Math.floor(p2.rotMarks / 2);
        if (bonus > 0) { p2.poisonBonus = (p2.poisonBonus || 0) + bonus; log('腐烂之心：对手受到的【毒气】伤害 +' + bonus + '（腐烂标记 ' + p2.rotMarks + ' 已清空）', 'eff'); }
        p2.rotMarks = 0; break;
      }
      default: break;
    }
    // 食人鱼：召唤于中位的回合无法被攻击（持续至我方下个回合开始）
    if (inst.cardId === 'a-045-2' && slotOf(key, inst.uid) === 1) { inst.flags.untargetable = true; inst.flags.untargetableUntilOwnerTurn = true; }
    recalcAll();
  }

  /* 觉醒词条：回合开始时的效果（自愈 / 潜伏 / 幻象）。只对己方怪物调用。 */
  function applyAwakenPrep(m, key, opp, op) {
    // 【自愈】每回合开始恢复 30% 生命
    if (m.awaken === 'regen' && m.hp < m.maxHp) {
      var amt = Math.ceil(m.maxHp * 0.3);
      log('【自愈】' + m.name + ' 恢复 ' + amt + ' 点生命', 'eff');
      healMonster(m, amt);
    }
    // 【潜伏】每隔一回合进入不可选中（每次到自己回合翻转一次；固有不可选中不会被误清）
    if (m.awaken === 'stealth') {
      m.flags.stealthOn = !m.flags.stealthOn;
      if (m.flags.stealthOn) {
        m.flags.untargetable = true;
        log('【潜伏】' + m.name + ' 进入不可选中状态', 'eff');
      } else if (!m.flags.untargetableInnate) {
        m.flags.untargetable = false;
      }
    }
    // 【幻象】在己方随机空位衍生一张 1 命同攻的同名怪（镜像卷轴效果）
    if (m.awaken === 'mirror') {
      var es = emptySlots(key);
      if (es.length) {
        log('【幻象】' + m.name + ' 衍生镜像', 'eff');
        createMirror(key, m, pick(es));
      }
    }
  }

  function prepStartMonster(m, key) {
    var opp = other(key), op = state.players[opp];
    if (m.awaken) applyAwakenPrep(m, key, opp, op);
    switch (m.cardId) {
      case 'a-104-2': {   // 能源塔（新卡）：对对位怪物 3 点伤害，己方💎类怪物各获得 1 点护盾
        var ei = slotOf(key, m.uid);
        var om = (ei >= 0) ? op.board[ei] : null;
        if (om) { log('能源塔：对对位 ' + om.name + ' 造成 3 点伤害', 'eff'); damageMonster(om, opp, 3, {}); }
        var gems = aliveMonsters(key).filter(function (x) { return (CARDS[x.cardId].tags || []).indexOf('💎') >= 0; });
        gems.forEach(function (x) { x.shield += 1; });
        if (gems.length) log('能源塔：己方 ' + gems.length + ' 张【💎】类怪物各获得 1 点护盾', 'eff');
        break;
      }
      case 'a-005-2': healMonster(m, 6); break;                             // 大蜗牛
      case 'a-046-2': { var t = pick(aliveMonsters(opp)); if (t) { log('血色哨卫：对 ' + t.name + ' 造成 8 点伤害', 'eff'); damageMonster(t, opp, 8, {}); } break; }
      case 'a-078-2': if (emptySlots(key).length) summonToken(key, 'a-076-2'); break;  // 招魂法师 → 怨灵
      case 'a-079-2': necro(m, key); break;                                 // 死灵法师
      case 'a-054-2': op.poison += 1; log('魔化藤：对方叠加 1 层【毒气】', 'eff'); break;
      case 'a-009-2': damagePlayer(opp, 1, {}); break;                      // 腐臭老鼠
      case 'a-082-2': {
        var n = aliveMonsters(opp).length;
        if (n > 0) {
          var feDmg = (state.fireElemMult || 1);                      // 晋升之路·新生火元素【燃火】：效果 ×3
          log('新生火元素：对方场上 ' + n + ' 只怪物各 -' + feDmg, 'eff');
          aliveMonsters(opp).slice().forEach(function (x) { damageMonster(x, opp, feDmg, {}); });
          if (state.fireElemToPlayer) damagePlayer(opp, n * feDmg, {});   // 【惧燃】：效果同时影响玩家本体
        }
        break;
      }
      case 'a-041-2': { var p = state.players[key]; if (!m.flags.hunterDrawn && p.hand.some(function (c) { return CARDS[c.cardId].type === 'throw'; })) { m.flags.hunterDrawn = true; log('女猎B：手牌含投掷物，抽一张牌', 'eff'); draw(key, 1); } break; }
      case 'a-058-2': { // 鼠王：准备阶段开始时，在手牌「衍生」一张神秘宝箱 + 一张名字含"鼠"的怪物（凭空造卡，从所有含"鼠"怪物中随机）
        deriveCard(key, 'a-013-2');
        var ratIds = Object.keys(CARDS).filter(function (id) { var cd = CARDS[id]; return cd.type === 'monster' && cd.name.indexOf('鼠') >= 0; });
        if (ratIds.length) deriveCard(key, ratIds[rnd(ratIds.length)]);
        break;
      }
      default: break;
    }
  }

  function turnEndMonster(m, key) {
    var opp = other(key), op = state.players[opp];
    switch (m.cardId) {
      case 'a-075-2': { // DM-100
        var myIdx = slotOf(key, m.uid);
        var cands = aliveMonsters(opp).filter(function (x) { return slotOf(opp, x.uid) !== myIdx; });
        if (cands.length) { var t = pick(cands); log('DM-100：对 ' + t.name + ' 造成 5 点伤害', 'eff'); damageMonster(t, opp, 5, {}); }
        break;
      }
      case 'a-048-2': { // 喷毒花：仅当"攻击力提升条件满足"（我方仅此一怪 且 对位有敌 → +5）时回合结束返回手牌；否则留在场上
        var poisonIdx = slotOf(key, m.uid);
        var boosted = aliveMonsters(key).length === 1 && op.board[poisonIdx];
        if (boosted) { log('喷毒花 回合结束返回手牌', 'dim'); leaveBoard(m, key, false); }
        else log('喷毒花：加成条件未满足，留在场上', 'dim');
        break;
      }
      case 'a-051-2': { // 深蓝蝾螈：返回手牌 + 攻击永久+1（装备一并归还）
        log('深蓝蝾螈 返回手牌（攻击+1）', 'dim');
        var ni = leaveBoard(m, key, false);
        if (ni) ni.growthAtk = (m.growthAtk || 0) + 1;
        break;
      }
      case 'a-073-2': // 疯狂小偷：仅"本回合攻击玩家且夺到手牌"时才返回手牌；攻击怪物不返回，继续驻场
        if (m.flags.robbedPlayer) { log('疯狂小偷 已夺取手牌，回合结束返回手牌', 'dim'); leaveBoard(m, key, false); }
        else log('疯狂小偷：本回合未夺取手牌（打怪/没抢到不算），留在场上', 'dim');
        break;
      case 'a-083-2': tenguMove(m, key); break; // 天狗移动
      default: break;
    }
  }

  // 仅处理卡面写明「从场上进入弃牌堆时」的效果（其余「进入弃牌堆时」效果见 onDiscard）
  function onDeath(inst, key, slot, opts) {
    var opp = other(key), op = state.players[opp];
    switch (inst.cardId) {
      case 'a-071-2': { var t = op.board[slot]; if (t) { log('骷髅遗言：对位 ' + t.name + ' 造成 4 点伤害', 'eff'); damageMonster(t, opp, 4, {}); } break; }  // 骷髅（从场上）
      case 'a-080-2': op.poison += 1; op.rotMarks += 1; log('腐烂触手：对方 +1 层【毒气】、+1 腐烂标记', 'eff'); break;  // 腐烂触手（从场上）
      default: break;
    }
    // 觉醒【自爆】：死亡时对手场上的随机两只怪物死亡
    // （带递归深度保护：被炸死的怪若也带【自爆】，最多连锁 3 层，不会无限炸下去）
    if (inst.awaken === 'boom') {
      var bd = (opts && opts.boomDepth) || 0;
      if (bd < 3) {
        var foes = aliveMonsters(opp).slice();
        var take = Math.min(2, foes.length);
        for (var bi = 0; bi < take; bi++) {
          var fi = Math.floor(rand() * foes.length);
          var fb = foes.splice(fi, 1)[0];
          if (fb) {
            log('【自爆】' + inst.name + ' 带走 ' + fb.name, 'eff');
            destroyMonster(fb, opp, { boomDepth: bd + 1 });
          }
        }
      }
    }
    // BOSS 技能：己方（B）有怪物离场后重新评估本体状态（【保护】依赖【能源塔】是否存活）
    if (state.bossUid && key === 'B') bossHook('bossAllyLeft', inst);
  }

  function summonToken(key, cardId, override) {
    var p = state.players[key], cd = CARDS[cardId];
    if (!cd) return null;
    var s = -1;
    // override.slot：指定栏位衍生（BOSS 技能用，如【呼唤】随机空位、【磁塔】按位替换）
    if (override && override.slot != null) {
      s = override.slot;
      if (s < 0 || s >= p.board.length || p.board[s]) return null;
    } else {
      if (!emptySlots(key).length) return null;
      s = firstEmpty(p);
    }
    var hp = (override && override.hp != null) ? override.hp : cd.hp;
    var atk = (override && override.atk != null) ? override.atk : cd.atk;
    var inst = { uid: uid++, cardId: cardId, name: cd.name, tier: cd.tier, baseHp: hp, maxHp: hp, hp: hp, baseAtk: atk, atk: atk, growthAtk: 0, tempAtk: 0, level: 0, weapon: null, armor: null, shield: 0, buffs: {}, flags: { attacked: false, attacksMax: 1, token: true } };
    p.board[s] = inst;
    applyInnateFlags(inst);
    recalc(inst);
    log('衍生：' + cd.name + ' 出现在' + ln(s) + '位', 'eff');
    return inst;
  }
  function necro(m, key) {
    var p = state.players[key];
    var hasSkel = aliveMonsters(key).some(function (x) { return x.cardId === 'a-071-2'; });
    if (!hasSkel) { if (emptySlots(key).length) summonToken(key, 'a-071-2'); }
    else { aliveMonsters(key).filter(function (x) { return x.cardId === 'a-071-2'; }).forEach(function (s) { s.growthAtk += 1; log('死灵法师：骷髅攻击+1', 'eff'); }); }
  }
  function prisonGuard(inst, key) {
    var opp = other(key), op = state.players[opp];
    var cands = aliveMonsters(opp);
    if (!cands.length) return;
    var t = pick(cands);
    var mySlot = slotOf(key, inst.uid);
    if (op.board[mySlot]) { /* 对位被占，跳过移动 */ }
    else { moveMonsterTo(opp, t, mySlot); log('监狱守卫：将 ' + t.name + ' 移动到对位', 'eff'); }
    var dmg = Math.max(0, inst.atk - dmgReduce(t));
    log('监狱守卫 立刻攻击 ' + t.name, 'eff');
    damageMonster(t, opp, inst.atk, { attack: true });
  }
  // ★ 天狗成长：移动到任意位置都会触发（不只自己的回合结束 / 受伤害）。
  //   所有「移动怪物」的入口（见 moveMonsterTo）都会调用它，所以被虚空锁链 / 监狱守卫 /
  //   冲击波法杖等移动时也会成长。
  function tenguGrow(m, key) {
    m.growthAtk += 1; m.maxHp += 1; m.hp += 1;
    deriveCard(key, 'a-016-2');
    log('天狗：移动至' + ln(slotOf(key, m.uid)) + '位，攻击+1、生命+1，衍生【苦无】', 'eff');
  }
  // 统一的「把一只怪物移动到本方某空位」入口。
  // ⚠ 所有移动方式都必须走这里，否则天狗的成长就不会触发（本次修复的根因：
  //   锁链 / 监狱守卫 / 冲击波法杖之前都是裸操作棋盘，绕过了 tenguMove）。
  function moveMonsterTo(mKey, inst, to) {
    var bp = state.players[mKey];
    var from = slotOf(mKey, inst.uid);
    if (from === to) return;
    bp.board[from] = null;
    bp.board[to] = inst;
    if (inst.cardId === 'a-083-2') tenguGrow(inst, mKey);   // 天狗：被任意方式移动都成长
  }
  function tenguMove(m, key) {
    var empt = emptySlots(key);
    if (!empt.length) return;
    moveMonsterTo(key, m, pick(empt));
  }

  /* ---------------- 检索 / 衍生 ---------------- */
  function deriveCard(key, cardId) {
    var p = state.players[key];
    if (p.hand.length >= Rules.HAND_LIMIT) { log('手牌已满，无法衍生 ' + CARDS[cardId].name, 'dim'); return; }
    p.hand.push(makeInstance(cardId));
    log('衍生：' + CARDS[cardId].name + ' 加入手牌', 'eff');
  }
  function searchDeckToHand(key, pred, n) {
    var p = state.players[key], got = 0;
    for (var i = p.deck.length - 1; i >= 0 && got < n; i--) {
      if (pred(p.deck[i])) {
        if (p.hand.length >= Rules.HAND_LIMIT) break;
        var c = p.deck.splice(i, 1)[0]; p.hand.push(c); got++;
        log('检索：' + CARDS[c.cardId].name + ' 加入手牌', 'eff');
      }
    }
    if (!got) log('检索：卡组中没有满足条件的卡', 'dim');
  }
  // 随机检索（仅用于卡面明确写「随机」的卡，如 繁花史莱姆 / 补给箱）
  function searchDeckRandom(key, pred, n) {
    var p = state.players[key], got = 0;
    var cands = p.deck.filter(pred);
    for (var k = 0; k < n && cands.length; k++) {
      if (p.hand.length >= Rules.HAND_LIMIT) break;
      var c = cands.splice(rnd(cands.length), 1)[0];
      var di = p.deck.indexOf(c); if (di >= 0) p.deck.splice(di, 1);
      p.hand.push(c); got++;
      log('检索（随机）：' + CARDS[c.cardId].name + ' 加入手牌', 'eff');
    }
    if (!got) log('检索：卡组中没有满足条件的卡', 'dim');
  }
  // 定向选择：让 actorKey 从卡组/手牌中「自行选择」若干张卡（检索 / 弃置）
  // steps: [{ from:'deck'|'hand', count:N, pred:function(inst){}, label:'...' }]
  // 人类玩家 → 弹出选择提示（state.pending）；AI → 自动选择（取候选前 N 张），流程不阻塞。
  function requestChoices(actorKey, steps, done) {
    var p = state.players[actorKey];
    var valid = [];
    steps.forEach(function (st) {
      var zone = st.from === 'deck' ? p.deck : p.hand;
      var hits = zone.filter(st.pred);
      if (hits.length) {
        // 候选一并算成**纯数据**存进 pending：联机时 pending 要经过 JSON 传输，函数会丢，
        // 客户端没法再用 pred 过滤（以前会直接导致"渲染异常"）。
        valid.push({
          from: st.from, count: st.count, pred: st.pred, label: st.label, to: st.to,
          exact: !!st.exact,      // ★ true = 必须选够 count 张（焰浪法杖等），见 applyChoice
          cands: hits.map(function (c) {
            var cd = cardOf(c);
            return { iid: c.iid, cardId: c.cardId, name: cd.name, tier: cd.tier || '', type: cd.type };
          })
        });
      } else log((st.label || '检索') + '：没有满足条件的卡', 'dim');
    });
    if (!valid.length) { if (done) done(); return; }
    if (p.isAI) {
      valid.forEach(function (st) { applyChoice(actorKey, st, chooseAuto(actorKey, st)); });
      if (done) done();
      return;
    }
    state.pending = { kind: 'CHOOSE_CARDS', actorKey: actorKey, steps: valid, idx: 0, done: done || function () { } };
  }
  // to: 'hand'(检索入牌,默认) | 'discard'(弃置,默认) | 'summon'(召唤上场)
  function applyChoice(actorKey, st, iids) {
    var p = state.players[actorKey];
    iids = iids || [];
    /* 先去重：联机客户端可能把同一个 iid 报两次。重复项会让下面的"补足"误判成已选够，
     * 而实际只处理一张（第二遍 findIndex 已经找不到它了）→ 又变成"少弃"。 */
    var seen = {};
    iids = iids.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
    /* ★ exact 步骤（卡面写着"必须弃掉 N 张"的，如焰浪法杖）：
     *   count 从「最多 N 张」变成「恰好 N 张」——选少了就从候选里补足（手牌不足时按可选项数封顶）。
     *   补足放在这里而不是 UI：AI 路径、联机被绕过 UI 的调用、旧客户端，全都统一生效。
     *   未标记 exact 的（检索类）保持原来的"最多 N 张"语义，不强制。 */
    var need = 0;
    if (st && st.exact) need = Math.min(st.count || 0, (st.cands && st.cands.length) || 0);
    if (iids.length < need) {
      var has = {};
      iids.forEach(function (x) { has[x] = 1; });
      (st.cands || []).forEach(function (c) {
        if (iids.length < need && !has[c.iid]) { iids.push(c.iid); has[c.iid] = 1; }
      });
    }
    iids.forEach(function (iid) {
      if (st.from === 'deck') {
        var i = p.deck.findIndex(function (c) { return c.iid === iid; });
        if (i >= 0 && p.hand.length < Rules.HAND_LIMIT) { var c = p.deck.splice(i, 1)[0]; p.hand.push(c); log('检索：' + cardOf(c).name + ' 加入手牌', 'eff'); }
      } else {
        var j = p.hand.findIndex(function (c) { return c.iid === iid; });
        if (j >= 0) {
          var c2 = p.hand.splice(j, 1)[0];
          if (st.to === 'summon') { log('召唤陷阱：召唤 ' + cardOf(c2).name, 'eff'); spawnMonster(actorKey, c2, null); }
          else { toDiscard(actorKey, c2, false); log('弃置：' + cardOf(c2).name, 'dim'); }
        }
      }
    });
  }
  /* ---------------- AI 选牌 / 可选技能策略（由 ai.js 注册） ---------------- */
  // 未注册时退化为"取候选前 N 张"（旧行为）
  var aiPolicy = null;
  function setAIPolicy(p) { aiPolicy = p; }
  function chooseAuto(actorKey, st) {
    var p = state.players[actorKey];
    var zone = st.from === 'deck' ? p.deck : p.hand;
    var cands = zone.filter(st.pred);
    if (aiPolicy && aiPolicy.pickChoice) {
      var picked = aiPolicy.pickChoice(actorKey, st, cands);
      if (picked && picked.length) return picked.slice(0, st.count);
    }
    return cands.slice(0, st.count).map(function (c) { return c.iid; });
  }

  /* ---------------- 召唤陷阱 ---------------- */
  function checkSummonTrap(holderKey, summonedKey, summoned) {
    var p = state.players[holderKey];
    // 召唤陷阱：将手牌一张C级怪召唤到己方随机空位（C级怪物由持卡者定向选择）
    var st = p.hand.filter(function (c) { return c.cardId === 'a-064-2'; })[0];
    if (st && emptySlots(holderKey).length) {
      var cs = p.hand.filter(function (c) { var cd = CARDS[c.cardId]; return cd.type === 'monster' && cd.tier === 'C'; });
      if (cs.length) {
        removeFromHand(p, st.iid); p.discard.push(st);
        log(holderKey === 'A' ? '召唤陷阱 发动！' : '对手发动 召唤陷阱！', 'eff');
        emit({ type: 'trap', key: holderKey, cardId: 'a-064-2' });
        requestChoices(holderKey, [{ from: 'hand', count: 1, pred: function (c) { var cd = CARDS[c.cardId]; return cd.type === 'monster' && cd.tier === 'C'; }, label: '选择一张 C 级怪物召唤', to: 'summon' }]);
      }
    }
    // 毒气陷阱：对方叠加3层毒气
    var gt = p.hand.filter(function (c) { return c.cardId === 'a-089-2'; })[0];
    if (gt) {
      removeFromHand(p, gt.iid); p.discard.push(gt);
      state.players[summonedKey].poison += 3;
      log((holderKey === 'A' ? '毒气陷阱' : '对手的毒气陷阱') + ' 发动：对方叠加 3 层【毒气】', 'eff');
      emit({ type: 'trap', key: holderKey, cardId: 'a-089-2' });
    }
    // 爆炸陷阱（新卡 a-117-2）：对手召唤怪物时立即发动，对该怪物造成 8 点伤害
    var bt = p.hand.filter(function (c) { return c.cardId === 'a-117-2'; })[0];
    if (bt && summoned && !summoned.flags.dead) {
      removeFromHand(p, bt.iid); p.discard.push(bt);
      log((holderKey === 'A' ? '爆炸陷阱' : '对手的爆炸陷阱') + ' 发动：' + summoned.name + ' 受到 ' + CARDS['a-117-2'].mods.dmg + ' 点伤害', 'eff');
      emit({ type: 'trap', key: holderKey, cardId: 'a-117-2' });
      damageMonster(summoned, summonedKey, CARDS['a-117-2'].mods.dmg, {});
    }
  }

  /* ---------------- 玩家操作 ---------------- */
  function tryAction(action) {
    if (!state || state.winner) return fail('对局已结束');
    if (state.pending) return fail('请先处理弹出的提示');
    var a = state.active, p = state.players[a];
    if (p.isAI && !action._ai) return fail('当前不是你的回合');
    state.events = [];
    try {
      switch (action.type) {
        case 'SUMMON': return actSummon(a, action);
        case 'SACRIFICE': return actSacrifice(a, action);
        case 'USE': return actUse(a, action);
        case 'EQUIP': return actEquip(a, action);
        case 'PLACE_WAND': return actPlaceWand(a, action);
        case 'ACTIVATE_WAND': return actActivateWand(a, action);
        case 'ATTACK': return actAttack(a, action);
        case 'MOVE_MONSTER': return actMoveMonster(a, action);
        case 'TIME_STOP': return actTimeStop(a);
        case 'CONFIRM_BATTLE': return actConfirmBattle(a);
        case 'END_TURN': return actEndTurn(a);
        default: return fail('未知操作');
      }
    } finally {
      recalcAll();
      if (!state.pending) notify();
      else notify();
    }
  }
  function ok(msg) { notify(); return { ok: true, msg: msg || '' }; }
  function fail(msg) { return { ok: false, msg: msg || '操作不合法' }; }

  function actSummon(key, action) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可召唤');
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    var cd = cardOf(inst);
    if (cd.type !== 'monster') return fail('该卡不是怪物卡');
    if (cd.tier === 'A' || cd.tier === 'S') return fail('该等级需献祭召唤');
    if (p.summonsLeft <= 0) return fail('本阶段已召唤');
    if (!emptySlots(key).length) return fail('己方怪物区已满');
    var slot = (action.slot != null && !p.board[action.slot]) ? action.slot : firstEmpty(p);
    removeFromHand(p, inst.iid);
    // 觉醒【迅捷】：召唤这张卡不消耗召唤次数（手牌实例上还没掷词条，这里按规则现算）
    // 觉醒【迅捷】：词条就在实例上（学院合成 3★ 时抽定的），直接读即可。
    var awSummon = inst.awaken || null;
    if (awSummon !== 'swift') p.summonsLeft -= 1;
    spawnMonster(key, inst, slot);
    refreshCasts(key);      // 召唤出的是法师B → 本回合立刻多 1 次施法
    return ok();
  }

  function actSacrifice(key, action) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可召唤');
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    var cd = cardOf(inst);
    if (cd.type !== 'monster' || (cd.tier !== 'A' && cd.tier !== 'S')) return fail('该卡无法献祭召唤');
    var victim = findMonster(key, action.targetUid);
    if (!victim) return fail('需献祭己方场上怪物');
    if (cd.tier === 'A' && !(victim.tier === 'C' || victim.tier === 'B')) return fail('A 级需献祭 C/B 级怪物');
    if (cd.tier === 'S' && victim.tier !== 'A') return fail('S 级需献祭 A 级怪物');
    if (p.summonsLeft <= 0) return fail('本阶段已召唤');
    var slot = slotOf(key, victim.uid);
    removeFromHand(p, inst.iid);
    p.summonsLeft -= 1;
    log('献祭 ' + victim.name + ' 召唤 ' + cd.name, 'eff');
    var wasGhost = victim.cardId;   // 记录祭品，用于进化继承判定
    destroyMonster(victim, key, { sacrifice: true });
    var nM = spawnMonster(key, inst, slot);
    // 咒缚灵：由【怨灵】献祭进化时，继承怨灵的【无法被攻击】
    if (cd.id === 'a-077-2' && wasGhost === 'a-076-2') { nM.flags.untargetable = true; nM.flags.untargetableInnate = true; log('咒缚灵 进化：继承【怨灵】的【无法被攻击】', 'eff'); }
    refreshCasts(key);      // 献祭召唤出法师B → 同样要立刻多 1 次施法
    return ok();
  }

  function actUse(key, action) {
    var p = state.players[key];
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    var cd = cardOf(inst);
    var opp = other(key), op = state.players[opp];
    if (state.phase !== 'PREP') return fail('仅准备阶段可使用');
    // 每回合限制：食物 / 药水 / 卷轴 各限 1 张（宝藏/投掷物不限量）
    var limited = ['food', 'potion', 'scroll'].indexOf(cd.type) >= 0;
    var used = p.flags.used || (p.flags.used = {});
    if (limited && used[cd.type]) return fail('本回合该种卡使用次数已耗尽');
    var okflag = false;
    switch (cd.type) {
      case 'treasure': okflag = useTreasure(key, inst, cd, action); break;
      case 'throw': okflag = useThrow(key, inst, cd, action); break;
      case 'food': okflag = useFood(key, inst, cd); break;
      case 'potion': okflag = usePotion(key, inst, cd); break;
      case 'scroll': okflag = useScroll(key, inst, cd, action); break;
      case 'ring': return fail('戒指在手牌中持续生效，无需使用');
      case 'trap': return fail('陷阱需在对手回合条件触发');
      default: return fail('该卡不能直接使用');
    }
    if (okflag === true) {
      if (limited) used[cd.type] = 1;
      // 成就：各类道具使用次数（药师 / 食神 / 卷轴学者）
      if (key === 'A' && state.ach && !state.ach.off) {
        if (cd.type === 'potion') state.ach.potion += 1;
        else if (cd.type === 'food') state.ach.food += 1;
        else if (cd.type === 'scroll') state.ach.scroll += 1;
      }
      emit({ type: 'play', key: key, cardId: cd.id, verb: '使用' });   // 供 UI 回放"谁打出了哪张牌"
      return ok();
    }
    // 子函数可用 fail() 返回具体原因（如"该防具已贴过纹章"），此处原样透出，不再统一吞成"使用条件不满足"
    if (okflag && okflag.ok === false) return okflag;
    return fail('使用条件不满足');
  }

  function useTreasure(key, inst, cd, action) {
    var p = state.players[key], m = cd.mods || {};
    if (cd.id === 'a-033-2') { // 破损纹章：对"一张防具卡"使用（可选手牌中的防具，或已装备在怪物上的防具）
      var armor = null, where = '';
      if (action.targetUid != null) {                       // 已装备的防具
        var mm = findMonster(key, action.targetUid);
        if (mm && mm.armor && CARDS[mm.armor.cardId].type === 'armor') { armor = mm.armor; where = mm.name + ' 的'; }
      }
      if (!armor && action.targetIid != null) {             // 手牌中的防具卡
        armor = p.hand.filter(function (c) { return c.iid === action.targetIid && CARDS[c.cardId].type === 'armor'; })[0] || null;
      }
      if (!armor) return false;
      // 限制：同一张防具最多贴 1 张【破损纹章】（不能叠加）。
      // 必须在"消耗纹章"之前判定 —— 否则纹章会被白烧掉一张。
      if (armor.flags && armor.flags.emblemReduce > 0) return fail('该防具已贴过【破损纹章】，无法叠加（同一防具限 1 张）');
      removeFromHand(p, inst.iid); p.discard.push(inst);
      // 破损纹章只提升「减伤能力 +1」，不改动防具等级（等级只由升级卷轴/灌注提升；等级仍单独用于"弃置补偿"判定）
      armor.flags = armor.flags || {};
      armor.flags.emblem = true;
      armor.flags.emblemReduce = 1;
      log('破损纹章：' + where + CARDS[armor.cardId].name + ' 减伤能力 +1（现额外减伤 1 点，防具 Lv' + (armor.level || 0) + '）', 'eff');
      return true;
    }
    if (cd.id === 'a-014-2') { // 黄金宝箱：必须由玩家选择弃置一张手牌（不能随机），然后抽三张
      if (inst.iid === undefined || p.hand.length < 2) return false;
      var cost = p.hand.filter(function (c) { return c.iid === action.discardIid && c.iid !== inst.iid; })[0];
      if (!cost) return false;                              // 未指定弃置目标
      removeFromHand(p, inst.iid); p.discard.push(inst);
      removeFromHand(p, cost.iid); toDiscard(key, cost, false);
      log(cd.name + '：弃置 ' + cardOf(cost).name + '，抽 ' + (m.draw || 3) + ' 张牌', 'eff');
      draw(key, m.draw || 3);
      return true;
    }
    removeFromHand(p, inst.iid); p.discard.push(inst);
    if (m.draw) { if (m.discard) discardRandom(key, m.discard); log(cd.name + '：抽 ' + m.draw + ' 张牌', 'eff'); draw(key, m.draw); }
    if (cd.id === 'a-060-2') searchDeckRandom(key, function (c) { var t = CARDS[c.cardId].type; return t === 'food' || t === 'potion' || t === 'scroll'; }, 1);
    if (cd.id === 'a-113-2') searchDeckRandom(key, function (c) { var t = CARDS[c.cardId].type; return t === 'wand' || t === 'ring'; }, 1);   // 水晶宝箱（新卡）：随机检索法杖/戒指
    if (cd.id === 'a-085-2') { draw(key, 1); if (rand() < 0.5) deriveCard(key, 'a-076-2'); }
    return true;
  }
  function useThrow(key, inst, cd, action) {
    var opp = other(key);
    var p = state.players[key];
    if (p.flags.tsNoThrowWand) { log('时停中：无法使用投掷物', 'dim'); return false; }      // 时光沙漏
    var t = findMonster(opp, action.targetUid);
    if (!t) return false;
    removeFromHand(p, inst.iid); p.discard.push(inst);
    if (cd.id === 'a-086-2') { // 炸弹：埋设，在你的下一个准备阶段开始时对原位置及十字方向（左右）各造成 6 点伤害
      var slot = slotOf(opp, t.uid);
      p.bombs = p.bombs || [];
      p.bombs.push({ slot: slot });
      // 成就「买一送一」：本回合使用的炸弹数
      if (key === 'A' && state.ach && !state.ach.off) {
        state.ach.bombsThisTurn += 1;
        if (state.ach.bombsThisTurn > state.ach.bombsMax) state.ach.bombsMax = state.ach.bombsThisTurn;
      }
      log('炸弹已埋设：你的下一个准备阶段开始时，对敌方第 ' + (slot + 1) + ' 位及其左右各造成 ' + Rules.BOMB_DAMAGE + ' 点伤害', 'eff');
      return true;
    }
    var dmg = cd.mods.dmg;
    log(cd.name + '：对 ' + t.name + ' 造成 ' + dmg + ' 点伤害', 'eff');
    damageMonster(t, opp, dmg, {});
    // 成就：投掷物击杀数 / 单次最高伤害
    if (key === 'A' && state.ach && !state.ach.off) {
      if (dmg > state.ach.maxHit) state.ach.maxHit = dmg;
      if (t.flags.dead) state.ach.throwKills += 1;
    }
    // 回旋镖（新卡 a-114-2）：你的下一个回合开始时返回手牌
    if (cd.mods && cd.mods.returnToHand) { inst.returnAtTurn = true; log('回旋镖：将在你的下一个回合开始时返回手牌', 'dim'); }
    // 姬莲梅錵：每使用一张投掷物恢复5生命
    healOnThrowUsed(key);
    // 神射戒指计数
    countThrowForRing(key);
    return true;
  }
  // 姬莲梅錵：每使用一张投掷物卡，我方姬莲梅錵恢复 5 点生命
  function healOnThrowUsed(key) {
    aliveMonsters(key).forEach(function (x) { if (x.cardId === 'a-98-2') { healMonster(x, 5); log('姬莲梅錵：投掷物结算后恢复 5 点生命', 'eff'); } });
  }
  // 神射戒指：在手牌时，每打出三张投掷物卡，从弃牌堆随机回收一张投掷物
  function countThrowForRing(key) {
    var p = state.players[key];
    if (!p.hand.some(function (c) { return c.cardId === 'a-090-2'; })) return;
    p.flags.throwCount = (p.flags.throwCount || 0) + 1;
    if (p.flags.throwCount % 3 === 0) {
      // 卡面：从弃牌堆"随机"选中一张投掷物卡返回手牌
      var ths = p.discard.filter(function (c) { return CARDS[c.cardId].type === 'throw'; });
      var rc = pick(ths);
      if (rc) {
        var ii = p.discard.indexOf(rc); if (ii >= 0) p.discard.splice(ii, 1);
        // 回旋镖：已被"提前捞回"手牌 → 清除待回手标记，否则日后以非使用方式被弃置会异常回手
        if (rc.returnAtTurn) { rc.returnAtTurn = false; log('回旋镖已被回收，取消本次回手', 'dim'); }
        p.hand.push(rc);
        log('神射戒指：从弃牌堆随机回收投掷物 ' + CARDS[rc.cardId].name, 'eff');
      }
    }
  }
  function useFood(key, inst, cd) {
    var p = state.players[key];
    removeFromHand(p, inst.iid); p.discard.push(inst);
    var m = cd.mods || {};
    if (m.healPlayer) healPlayer(key, m.healPlayer);
    if (cd.id === 'a-084-2') { var t = pick(aliveMonsters(key)); if (t) { healMonster(t, 4); t.growthAtk += 1; log('炖肉：' + t.name + ' 恢复4生命且攻击+1', 'eff'); } }
    if (cd.id === 'a-059-2') { healPlayer(key, 4); aliveMonsters(key).forEach(function (t) { healMonster(t, 4); }); }
    // 全肉大饼（新卡 a-112-2）：丢一张【肉馅饼】→ 己方全场怪攻击+2；没有肉馅饼 → 己方怪仅恢复 4 生命
    if (cd.id === 'a-112-2') {
      var pie = p.hand.filter(function (c) { return c.cardId === 'a-059-2'; })[0];
      if (pie) {
        removeFromHand(p, pie.iid);          // 必须先从手牌移除，否则【肉馅饼】会留在手里
        toDiscard(key, pie, false);
        aliveMonsters(key).forEach(function (t2) { t2.growthAtk += 2; recalc(t2); });
        log('全肉大饼：丢弃【肉馅饼】，己方所有怪物攻击+2', 'eff');
      } else {
        aliveMonsters(key).forEach(function (t2) { healMonster(t2, 4); });
        log('全肉大饼：手牌中没有【肉馅饼】，己方怪物恢复 4 点生命', 'eff');
      }
    }
    // 丰饶号角：每使用一张食物抽一张
    if (p.artifacts.some(function (a) { return a.cardId === 'a-024-2'; })) { log('丰饶号角 触发：抽一张牌', 'eff'); draw(key, 1); }
    return true;
  }
  function usePotion(key, inst, cd) {
    var p = state.players[key], opp = other(key);
    removeFromHand(p, inst.iid); p.discard.push(inst);
    var m = cd.mods || {};
    if (m.healMonsters) aliveMonsters(key).forEach(function (t) { healMonster(t, m.healMonsters); });
    if (m.buffAtkAll) aliveMonsters(key).forEach(function (t) { t.growthAtk += m.buffAtkAll; log(t.name + ' 攻击+1', 'eff'); });
    if (cd.id === 'a-062-2') { state.players[opp].flags.summonDebuff = (state.players[opp].flags.summonDebuff || 0) + 1; log('冰霜药水：对方下回合召唤次数-1', 'eff'); }
    if (cd.id === 'a-087-2') { if ((state.turnCount || 1) <= 1) { log('疾速药水：首回合使用无效果', 'dim'); } else { p.summonsLeft += 1; log('疾速药水：本回合召唤次数+1', 'eff'); } }
    // 毒气药水（新卡 a-115-2）：对方叠加 3 层【毒气】
    if (m.poisonStacks) { state.players[opp].poison += m.poisonStacks; log('毒气药水：对方叠加 ' + m.poisonStacks + ' 层【毒气】', 'eff'); }
    return true;
  }
  function useScroll(key, inst, cd, action) {
    var p = state.players[key], opp = other(key);
    /* 极影铃虹：**使用任何卷轴卡后**触发（持续一回合无法被攻击，限 3 次）。
     * ⚠ 早期实现只写在本函数末尾，而「升级卷轴 / 镜像卷轴」在中间就 return true 了
     *   → 用这两张卷轴时极影铃虹完全不触发（玩家反馈的"镜像卷轴无法触发极影铃虹"）。
     *   现在收成一个函数，所有卷轴分支都必须调它。 */
    function afterScroll() {
      aliveMonsters(key).forEach(function (t) {
        if (t.cardId === 'a-97-2' && (t.flags.shadowUsed || 0) < 3) {
          t.flags.shadowUsed = (t.flags.shadowUsed || 0) + 1;
          t.flags.untargetable = true;
          t.flags.untargetableUntilOwnerTurn = true;
          log('极影铃虹：持续一回合无法被攻击（第 ' + t.flags.shadowUsed + '/3 次）', 'eff');
        }
      });
    }
    if (cd.id === 'a-029-2') { // 升级卷轴：对武器/防具/法杖使用，等级+1（由玩家指定目标）
      var target = null, kind = '';
      if (action.targetKind === 'wand') {
        if (!p.wand || !CARDS[p.wand.cardId].upgradable || p.wand.level >= 2) return false;
        target = p.wand; kind = '法杖栏';
      } else if (action.targetUid != null) {
        var mm = findMonster(key, action.targetUid);
        if (!mm) return false;
        if (mm.weapon && CARDS[mm.weapon.cardId].upgradable && mm.weapon.level < 2) { target = mm.weapon; kind = mm.name + ' 的武器'; }
        else if (mm.armor && CARDS[mm.armor.cardId].upgradable && mm.armor.level < 2) { target = mm.armor; kind = mm.name + ' 的防具'; }
        else return false;
      } else return false;  // 未指定升级目标
      removeFromHand(p, inst.iid); p.discard.push(inst);
      target.level += 1;
      log('升级卷轴：' + kind + ' ' + CARDS[target.cardId].name + ' 升至 Lv' + target.level, 'eff');
      recalcAll();
      afterScroll();          // 卷轴已使用 → 极影铃虹也要触发
      return true;
    }
    // 镜像卷轴（新卡 a-116-2）：对一张我方怪物使用，在我方随机空位衍生一张同名怪物（攻击同本体、生命为 1）
    if (cd.id === 'a-116-2') {
      var src = (action.targetUid != null) ? findMonster(key, action.targetUid) : null;
      if (!src) return false;
      var empt = emptySlots(key);
      if (!empt.length) return false;
      removeFromHand(p, inst.iid); p.discard.push(inst);
      createMirror(key, src, pick(empt));
      afterScroll();          // 卷轴已使用 → 极影铃虹也要触发（镜像卷轴同样算卷轴）
      return true;
    }
    removeFromHand(p, inst.iid); p.discard.push(inst);
    var m = cd.mods || {};
    if (m.discardAll) { var snap = p.hand.slice(); p.hand = []; snap.forEach(function (c) { toDiscard(key, c, false); }); log('传送卷轴：弃置所有手牌', 'eff'); draw(key, m.draw); }
    if (cd.id === 'a-063-2') {
      // 催眠卷轴：卡面 =「你的下回合开始前，**场上所有怪物**无法攻击」→ 双方都要标记（含使用者自身）。
      // 时长由 endTurn 的 `p.flags.noAttack = false` 保证：各自在自己回合结束时解除，
      // 因此使用者的战斗阶段（本回合）与对方的战斗阶段（其下回合）都被封住，正好等于"到使用者下回合开始前"。
      state.players.A.flags.noAttack = true;
      state.players.B.flags.noAttack = true;
      log('催眠卷轴：你的下回合开始前，场上所有怪物无法攻击', 'eff');
    }
    if (cd.id === 'a-088-2') { // 盛怒卷轴：全场每只怪物「各自」随机选一只怪物（可含自身）的攻击力作为伤害来源
      var pool = aliveMonsters('A').concat(aliveMonsters('B'));
      if (pool.length) {
        pool.slice().forEach(function (t) {
          var src = pick(pool), k = findMonster('A', t.uid) ? 'A' : 'B';
          log('盛怒卷轴：' + t.name + ' 受到（随机来源 ' + src.name + ' 的）' + src.atk + ' 点伤害', 'eff');
          damageMonster(t, k, src.atk, {});
        });
      }
    }
    afterScroll();          // 极影铃虹：使用卷轴后触发
    return true;
  }

  function actEquip(key, action) {
    var p = state.players[key];
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    var cd = cardOf(inst);
    if (cd.type !== 'weapon' && cd.type !== 'armor') return fail('该卡不是装备');
    if (state.phase !== 'PREP') return fail('仅准备阶段可装备');
    // 每回合限制：武器 / 防具 各限打出 1 张
    var used = p.flags.used || (p.flags.used = {});
    if (used[cd.type]) return fail('本回合已打出' + (cd.type === 'weapon' ? '武器' : '防具') + '（限 1 张）');
    var t = findMonster(key, action.targetUid);
    if (!t) return fail('需指定己方怪物');
    // 每只怪物仅可携带一件装备（武器或防具二选一），且不可主动卸下/替换
    if (t.weapon) return fail('该怪物已装备武器（每只怪物仅可装备一件）');
    if (t.armor) return fail('该怪物已装备防具（每只怪物仅可装备一件）');
    // 装备要求校验
    var eq = cd.equip;
    if (eq) {
      // 计算装备要求时，把后天的攻击提升（力量药水/成长等）也计入攻击力
      var val = eq.stat === 'atk' ? (t.baseAtk + (t.growthAtk || 0) + (t.tempAtk || 0)) : t.maxHp;
      if (val < eq.min) return fail('不满足装备要求（' + (eq.stat === 'atk' ? '攻击力' : '血量上限') + '≥' + eq.min + '）');
    }
    removeFromHand(p, inst.iid);
    if (cd.type === 'weapon') t.weapon = inst; else t.armor = inst;
    // 暗影斗篷：装备后该怪物无法被攻击。盗贼B 一进入「无法被攻击」立即获得本次攻击+3（不再延迟到下一回合）
    if (cd.id === 'a-039-2') { t.flags.untargetable = true; t.flags.untargetableUntilOwnerTurn = true; if (t.cardId === 'a-038-2') { t.flags.rogueBonus = true; t.flags.rogueBonusGranted = true; } }
    used[cd.type] = 1;
    log('为 ' + t.name + ' 装备 ' + cd.name, 'eff');
    emit({ type: 'play', key: key, cardId: cd.id, verb: '装备' });
    recalcAll();
    return ok();
  }

  function actPlaceWand(key, action) {
    var p = state.players[key];
    var inst = p.hand.filter(function (c) { return c.iid === action.iid; })[0];
    if (!inst) return fail('手牌中没有该卡');
    if (cardOf(inst).type !== 'wand') return fail('该卡不是法杖');
    if (state.phase !== 'PREP') return fail('仅准备阶段可放置法杖');
    removeFromHand(p, inst.iid);
    if (p.wand) { p.discard.push(p.wand); log('替换法杖，旧的 ' + cardOf(p.wand).name + ' 进入弃牌堆', 'dim'); }
    p.wand = inst;
    log('将 ' + cardOf(inst).name + ' 放入法杖栏', 'eff');
    emit({ type: 'play', key: key, cardId: inst.cardId, verb: '放置' });
    refreshCasts(key);      // 放的是老法杖 → 本回合立刻多 1 次施法（不能等到下回合）
    return ok();
  }

  function actActivateWand(key, action) {
    var p = state.players[key];
    if (!p.wand) return fail('法杖栏为空');
    if (state.phase !== 'PREP') return fail('仅准备阶段可发动法杖');
    if (p.flags.tsNoThrowWand) return fail('时停中：无法使用法杖');      // 时光沙漏
    if (p.castsLeft <= 0) return fail('本回合施法次数已用尽');
    var cd = cardOf(p.wand), opp = other(key);
    // 老法杖：未灌注时，选择手牌中另一张法杖进行灌注（继承其能力并提升法杖等级）
    if (cd.id === 'a-036-2' && !p.wand.inheritId) {
      // ⚠ 不能拿另一张【老法杖】来灌注自己：老法杖本身没有可继承的施法能力，
      //   灌注它只会白加一次法杖等级，纯属浪费（而且很容易误操作）。
      var pick = p.hand.filter(function (c) { return c.iid === action.absorbIid; })[0];
      if (pick && pick.cardId === 'a-036-2') return fail('老法杖不能灌注老法杖，请选择其他法杖');
      var abs = p.hand.filter(function (c) { return c.iid === action.absorbIid && CARDS[c.cardId].type === 'wand'; })[0];
      if (!abs) return fail('老法杖需选择一张手牌中的法杖进行灌注');
      removeFromHand(p, abs.iid); p.discard.push(abs);
      p.wand.inheritId = abs.cardId;
      p.wand.level = Math.min(2, p.wand.level + 1);
      log('老法杖 灌注 ' + CARDS[abs.cardId].name + '：继承其能力，法杖等级升至 Lv' + p.wand.level, 'eff');
      emit({ type: 'play', key: key, cardId: abs.cardId, verb: '灌注' });
      p.castsLeft -= 1;
      grantBingShield(key);
      return ok();
    }
    if (!p.hand.length) return fail('发动法杖需弃置一张手牌作为代价');
    var cost = p.hand.filter(function (c) { return c.iid === action.discardIid; })[0];
    if (!cost) return fail('请先选择要弃置的手牌作为代价');
    // 老法杖已灌注 → 以继承的法杖能力发动
    var effCd = (cd.id === 'a-036-2' && p.wand.inheritId) ? CARDS[p.wand.inheritId] : cd;
    var lv = p.wand.level;
    var needTarget = ['a-021-2', 'a-091-2'].indexOf(effCd.id) >= 0;
    var tgt = null;
    if (needTarget) { tgt = findMonster(opp, action.targetUid); if (!tgt) return fail('请先选择一张敌方怪物作为目标'); }
    removeFromHand(p, cost.iid); toDiscard(key, cost, false);   // 作为代价弃置：需触发「进入弃牌堆时」效果
    log('发动 ' + cd.name + (effCd !== cd ? '（灌注：' + effCd.name + '）' : '') + '：弃置 ' + cardOf(cost).name + ' 作为代价', 'eff');
    var m = effCd.mods || {};
    var dmg = m.dmg ? (lv >= 1 && m.upgrade && m.upgrade[0].dmg ? m.upgrade[0].dmg : m.dmg) : 0;
    if (dmg && tgt) { log('对 ' + tgt.name + ' 造成 ' + dmg + ' 点伤害', 'eff'); damageMonster(tgt, opp, dmg, {}); }
    // ★ 焰浪法杖：卡面写的是"弃置对方 N 张手牌"，必须是**恰好 N 张**（对手手牌不足时才少弃）。
    //   以前 count 只被当成"最多"，对手点 1 张就能确定 → 实际强度与卡面严重不符（联机更容易被钻）。
    if (effCd.id === 'a-067-2') {
      var n = lv >= 1 ? 2 : 1;
      requestChoices(opp, [{
        from: 'hand', count: n, exact: true, pred: function () { return true; },
        label: '弃置 ' + n + ' 张手牌'
      }]);
    }
    if (effCd.id === 'a-068-2') { var base = 2, en = aliveMonsters(opp).slice(); en.forEach(function (t2, i) { var d = base + i * (lv >= 1 ? 4 : 2); log('解离法杖穿透 ' + t2.name + ' ' + d + ' 点', 'eff'); damageMonster(t2, opp, d, {}); }); }
    // 冲击波法杖：伤害已由上方通用 m.dmg 结算（卡面 2 点 / 升级 4 点），这里只负责「向右移动一位」；
    // 切勿再 damageMonster，否则会与上面重复结算（修复前：同一次发动打了两遍伤害）。
    if (effCd.id === 'a-091-2' && tgt) { moveRight(opp, tgt); }
    emit({ type: 'play', key: key, cardId: effCd.id, verb: '施法', wand: cd.id });
    p.castsLeft -= 1;
    grantBingShield(key);
    return ok();
  }
  // 茉莉伊洛：每使用一次法杖获得 2 点护盾
  function grantBingShield(key) {
    aliveMonsters(key).forEach(function (x) { if (x.cardId === 'a-96-2') { x.shield += 2; log('茉莉伊洛：获得 2 点护盾', 'eff'); } });
  }
  // 虚空锁链（神器）：准备阶段限一次，将场上任意一只怪物移动到其本方空位
  function actMoveMonster(key, action) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可发动');
    if (!p.artifacts.some(function (a) { return a.cardId === 'a-094-2'; })) return fail('未装备【虚空锁链】');
    if (p.flags.voidChainUsed) return fail('虚空锁链每回合限用一次');
    var mKey = null, inst = null;
    ['A', 'B'].forEach(function (k) { var f = findMonster(k, action.uid); if (f) { mKey = k; inst = f; } });
    if (!inst) return fail('未找到目标怪物');
    var bp = state.players[mKey];
    var to = action.slot;
    if (to == null || to < 0 || to >= bp.board.length || bp.board[to]) return fail('目标位置不合法（需为其本方空位）');
    moveMonsterTo(mKey, inst, to);
    p.flags.voidChainUsed = 1;
    log('虚空锁链：' + inst.name + ' 移动至' + ln(to) + '位', 'eff');
    return ok();
  }
  // 时光沙漏（新卡神器 a-120-2）：准备阶段发动 —— 直到你的下回合开始前，双方无法使用投掷物/法杖，场上所有怪物无法攻击；冷却 6 回合
  function actTimeStop(key) {
    var p = state.players[key];
    if (state.phase !== 'PREP') return fail('仅准备阶段可发动');
    var art = p.artifacts.filter(function (a) { return a.cardId === 'a-120-2'; })[0];
    if (!art) return fail('未装备【时光沙漏】');
    var left = (art.flags && art.flags.cd) || 0;
    if (left > 0) return fail('时光沙漏冷却中（还需 ' + left + ' 回合）');
    art.flags = art.flags || {};
    art.flags.cd = CARDS['a-120-2'].mods.cooldown;
    art.flags.active = true;
    p.flags.tsNoThrowWand = 1; state.players[other(key)].flags.tsNoThrowWand = 1;
    p.flags.tsNoAttack = 1; state.players[other(key)].flags.tsNoAttack = 1;
    log('时光沙漏 发动：时停 —— 直到 ' + p.name + ' 的下回合开始前，双方无法使用投掷物/法杖，场上所有怪物无法攻击', 'eff');
    emit({ type: 'play', key: key, cardId: 'a-120-2', verb: '发动' });
    return ok();
  }
  // 镜像卷轴：衍生体（同名、攻击同本体、生命 1；继承装备与状态；镜像装备离场时直接消失）
  function cloneMirrorEquip(e) {
    var c = makeInstance(e.cardId, e.level || 0, e.star || 1, e.awaken);
    c.isMirror = true;
    if (e.flags) { try { c.flags = JSON.parse(JSON.stringify(e.flags)); } catch (err) { c.flags = {}; } }
    return c;
  }
  function createMirror(key, src, slot) {
    var p = state.players[key], cd = CARDS[src.cardId];
    var inst = {
      uid: uid++, cardId: cd.id, name: cd.name, tier: cd.tier, star: src.star || 1,
      baseHp: 1, maxHp: 1, hp: 1,
      baseAtk: src.baseAtk, atk: src.baseAtk, growthAtk: src.growthAtk || 0, tempAtk: src.tempAtk || 0,
      level: src.level || 0, weapon: null, armor: null, shield: src.shield || 0,
      buffs: {}, flags: { attacked: false, attacksMax: src.flags.attacksMax || 1, token: true, mirror: true },
      reduceCut: src.reduceCut || 0
    };
    if (src.flags.untargetable) {
      inst.flags.untargetable = true;
      inst.flags.untargetableInnate = !!src.flags.untargetableInnate;
      // 只要源怪不是【固有免疫】，镜像体一律给一个"到拥有者下回合开始"的到期标记。
      // ⚠ 不能只照抄源怪的 untargetableUntilOwnerTurn：
      //   觉醒【潜伏】(stealth, 见 applyAwakenPrep) 是"只写 untargetable、靠自己的 awaken 逻辑
      //   每回合翻转"的**合法**写法（源怪不需要 until 标记），但镜像体没有 awaken（上面的 inst 里
      //   没有 awaken 字段），照抄只会得到 until=false → 回合开始的清理（startTurn）永远不命中
      //   → 镜像体永久【无法被攻击】+ 永久挡脸。这就是玩家反馈的"对面的镜像一直无法选中"。
      //   innate=true（怨灵 / 咒缚灵 / BOSS）保持永久，符合"按卡面效果来"。
      inst.flags.untargetableUntilOwnerTurn = src.flags.untargetableInnate ? false : true;
    }
    applyInnateFlags(inst);
    if (src.weapon) inst.weapon = cloneMirrorEquip(src.weapon);
    if (src.armor) inst.armor = cloneMirrorEquip(src.armor);
    p.board[slot] = inst;
    recalc(inst);
    emit({ type: 'summon', uid: inst.uid, key: key, cardId: inst.cardId, slot: slot });
    log('镜像卷轴：在' + ln(slot) + '位衍生镜像 ' + cd.name + '（攻击 ' + inst.atk + ' / 生命 1）', 'eff');
    return inst;
  }
  function moveRight(key, inst) {
    var p = state.players[key]; var i = slotOf(key, inst.uid);
    if (i >= 0 && i < 2 && !p.board[i + 1]) { moveMonsterTo(key, inst, i + 1); log(inst.name + ' 向右移动一位', 'dim'); return true; }
    return false;
  }

  function actAttack(key, action) {
    if (state.phase !== 'BATTLE') return fail('仅战斗阶段可攻击');
    var p = state.players[key], opp = other(key), op = state.players[opp];
    var atk = findMonster(key, action.attackerUid);
    if (!atk) return fail('未找到攻击者');
    if (atk.flags.noAttack) return fail('该怪物无法攻击');                      // BOSS 技能（懒惰等）：本体无法攻击
    if (atk.flags.stunRound === state.round) return fail('该怪物被【禁锢】，本回合无法攻击');
    if (atk.flags.attacked && atk.flags.attacksMax <= 1) return fail('该怪物本回合已攻击');
    if (atk.flags.attacked >= atk.flags.attacksMax) return fail('该怪物攻击次数已用尽');
    if (p.flags.noAttack) return fail('受催眠卷轴影响，无法攻击');
    if (p.flags.tsNoAttack) return fail('时停中：场上所有怪物无法攻击');      // 时光沙漏
    // 对方场上有怪物（含"无法被攻击"者）时，只能攻击怪物；无法被攻击的怪需靠投掷物等非攻击手段清除
    var hasEnemy = aliveMonsters(opp).length > 0;
    if (action.targetUid) {
      var t = findMonster(opp, action.targetUid);
      if (!t) return fail('未找到目标');
      if (t.flags.untargetable) return fail('该目标无法被攻击');
      /* 觉醒【牺牲】：对方场上有【牺牲】怪时，本次攻击**强制改判**到牺牲怪身上（多张时任选其一）。
       * ⚠ 旧写法是直接 fail（"必须优先攻击它"）—— 但 AI 选目标时并不知道这条规则，
       *   被拒之后常常直接放弃本回合，表现出来就是"对手有牺牲怪 → 完全不攻击了"。
       *   改成自动改判：攻击照常打出，只是目标落在牺牲怪上。 */
      var sacs = aliveMonsters(opp).filter(function (m) { return m.awaken === 'sacrifice' && !m.flags.untargetable; });
      if (sacs.length && t.awaken !== 'sacrifice') {
        var forced = sacs[0];
        log('【牺牲】' + forced.name + ' 吸引攻击（' + t.name + ' → ' + forced.name + '）', 'eff');
        t = forced;
      }
      doAttack(key, atk, t, false);
    } else if (action.targetKey === opp) {
      if (hasEnemy) return fail('对方场上有怪物，只能攻击怪物');
      doAttackPlayer(key, atk);
    } else return fail('目标不合法');
    atk.flags.attacked = (atk.flags.attacked || 0) + 1;
    recalcAll();
    checkVictory();
    return ok();
  }

  function doAttack(key, atk, t, isRe) {
    var opp = other(key);
    var SRC = { by: key, card: atk.cardId };        // 本次攻击的输出都归到这张怪物卡
    var dmg = Math.max(0, atk.atk);
    if (atk.cardId === 'a-038-2' && atk.flags.rogueBonus) { dmg += 3; atk.flags.rogueBonus = false; log('盗贼B：本次攻击 +3（此前处于无法被攻击）', 'eff'); }
    log(atk.name + ' 攻击 ' + t.name + '（' + dmg + ' 点）', 'attack');
    // 带上"位置"信息：目标可能被这一击打死（DOM 已消失），UI 需要用格子回退定位才能画出连线
    emit({
      type: 'attack', from: atk.uid, to: t.uid,
      fromKey: key, fromSlot: slotOf(key, atk.uid), toKey: opp, toSlot: slotOf(opp, t.uid)
    });
    var oppCntAtDeclare = aliveMonsters(opp).length;   // 攻击宣言时对方场上怪物数（蚱蜢按"攻击时"判定）
    var dealt = damageMonster(t, opp, dmg, { attack: true, src: SRC, ignoreReduce: atk.awaken === 'sunder' });
    if (key === 'A' && state.ach && !state.ach.off && dealt > state.ach.maxHit) state.ach.maxHit = dealt;   // 成就「秒杀」
    // 攻击后附加效果
    postAttackProps(key, atk, t, opp, oppCntAtDeclare, dealt);
    // 澪：攻击后额外对目标造成7点伤害
    if (atk.cardId === 'a-100-2' && !t.flags.dead) { log('澪：额外对 ' + t.name + ' 造成 7 点伤害', 'eff'); damageMonster(t, opp, 7, { src: SRC }); }
    // 再攻击：攻击后 50% 获得一次额外攻击机会（由玩家/AI 再次选择目标，不自动追打同一目标）
    // 丛林螃蟹 a-006-2：每回合触发一次；水道螃蟹EX a-011-2：可反复触发（每次攻击后均可再判定）
    if (atk.cardId === 'a-011-2' || atk.cardId === 'a-006-2') {
      var oncePerTurn = atk.cardId === 'a-006-2';
      var reOk = false;
      if (!(oncePerTurn && atk.flags.reattacked) && rand() < 0.5) {
        reOk = true;
        atk.flags.reattacked = true;
        atk.flags.attacksMax = (atk.flags.attacksMax || 1) + 1;
        log(atk.name + ' 触发【再攻击】：获得一次额外攻击机会', 'eff');
      }
      // 成就「你被骗了」：记录水道螃蟹EX 本回合攻击过 / 是否触发再攻击
      if (atk.cardId === 'a-011-2' && key === 'A' && state.ach && !state.ach.off) {
        state.ach.crabAttackedTurn = state.turnCount;
        if (reOk) state.ach.crabReTurn = state.turnCount;
      }
    }
    // 蕾零安洁：击杀敌方怪物后获得一次【再攻击】机会（与螃蟹一致：给额外攻击机会，由玩家/AI 再次选择目标）
    if (atk.cardId === 'a-95-2' && t.flags.dead) {
      atk.flags.attacksMax = (atk.flags.attacksMax || 1) + 1;
      log('蕾零安洁 击杀后触发【再攻击】：获得一次额外攻击机会', 'eff');
    }
    // ---- 觉醒词条（学院专属，只在 3★ 卡上存在）----
    // 【穿透】攻击怪物时对对手本体造成等量伤害（用实际造成的伤害 dealt，自动排除减伤/闪避/护盾）
    if (atk.awaken === 'pierce' && dealt > 0) {
      log('【穿透】' + atk.name + '：对本体造成 ' + dealt + ' 点伤害', 'eff');
      damagePlayer(opp, dealt, { src: SRC });
    }
    // 【荆棘】受到伤害时对攻击者造成"该卡攻击力"等量的伤害
    if (t.awaken === 'thorn' && !t.flags.dead) {
      log('【荆棘】' + t.name + '：对 ' + atk.name + ' 造成 ' + t.atk + ' 点伤害', 'eff');
      damageMonster(atk, key, t.atk, { src: { by: opp, card: t.cardId } });
    }
    // 【禁锢】攻击这张卡的怪物下回合无法攻击（记轮次号，而不是布尔标记）
    if (t.awaken === 'bind' && !atk.flags.dead) {
      atk.flags.stunRound = state.round + 1;
      log('【禁锢】' + atk.name + ' 下一轮无法攻击', 'eff');
    }
    // 【汲取】每击杀一只怪物，永久获得其 50% 攻击力（向下取整）
    if (atk.awaken === 'drain' && t.flags.dead) {
      var gain = Math.floor((t.atk || 0) * 0.5);
      if (gain > 0) {
        atk.growthAtk = (atk.growthAtk || 0) + gain;
        recalc(atk);
        log('【汲取】' + atk.name + ' 永久 +' + gain + ' 攻击（吞噬 ' + t.name + '）', 'eff');
      }
    }
    // 【贪婪】击杀怪物时额外获得 6 学时（学院专属：引擎只记账，学院结算时发给对应的学生）
    if (atk.awaken === 'greed' && t.flags.dead) {
      state.greedGain = state.greedGain || { A: 0, B: 0 };
      state.greedGain[key] = (state.greedGain[key] || 0) + 6;
      log('【贪婪】' + atk.name + ' 击杀 ' + t.name + '：额外获得 6 学时', 'eff');
    }
  }
  function postAttackProps(key, atk, t, opp, oppCntAtDeclare, dealt) {
    var SRC = { by: key, card: atk.cardId };        // 攻击附带的追加伤害也算这张卡的输出
    // ---- 新卡：攻击后效果 ----
    // a-101 吸血蝙蝠：自身与相邻友方恢复"造成伤害"的等量生命
    if (atk.cardId === 'a-101-2' && dealt > 0) {
      var batIdx = slotOf(key, atk.uid);
      var healedN = 0;
      aliveMonsters(key).slice().forEach(function (m) {
        var mi = slotOf(key, m.uid);
        if (mi === batIdx || Math.abs(mi - batIdx) === 1) { var before = m.hp; healMonster(m, dealt); if (m.hp > before) healedN++; }
      });
      if (healedN) log('吸血蝙蝠：自身与相邻友方怪物恢复 ' + dealt + ' 点生命', 'eff');
    }
    // a-102 矿洞蜘蛛：对方每有一层【毒气】，其场上怪物受到 1 点伤害
    // ⚠ 必须"一次性结算 stacks 点"，绝不能循环 stacks 次打 1 点：
    //   伤害【次数】会触发一切"受到伤害时"的效果，最典型的是天狗
    //   （受到伤害时移动 → 攻击+1、生命+1）。3 层毒气循环打就是让天狗一次受伤 3 回 = 攻+3 血+3，
    //   反而白赚（"秒恢复 + 超高成长"）。减伤等仍按一次伤害正常结算。
    if (atk.cardId === 'a-102-2') {
      var stacks = state.players[opp].poison || 0;
      if (stacks > 0) {
        log('矿洞蜘蛛：借对方 ' + stacks + ' 层【毒气】对其全场造成 ' + stacks + ' 点伤害', 'eff');
        aliveMonsters(opp).slice().forEach(function (m) { damageMonster(m, opp, stacks, { src: SRC }); });
      }
    }
    // a-103 赤狼萨满：目标攻击-1；（a-109 紫狼萨满：攻击-1 且削减减伤）
    // flags.effectMul：本体自身卡牌效果倍率（【萨满王】提升 500% → ×6，仅作用于本体这张卡）
    if ((atk.cardId === 'a-103-2' || atk.cardId === 'a-109-2') && !t.flags.dead) {
      var aMul = (atk.cardId === 'a-109-2') ? (atk.flags.effectMul || 1) : 1;
      t.baseAtk -= aMul; recalc(t);
      log(CARDS[atk.cardId].name + '：' + t.name + ' 攻击-' + aMul + '（现 ' + t.atk + '）', 'eff');
    }
    // a-106 青狼萨满 / a-109 紫狼萨满：若目标减伤＞1，其减伤-1
    if ((atk.cardId === 'a-106-2' || atk.cardId === 'a-109-2') && !t.flags.dead) {
      cutTargetReduce(t, atk.cardId, (atk.cardId === 'a-109-2') ? (atk.flags.effectMul || 1) : 1);
    }
    // a-110 DM-201：对方叠加 3 层【酸气】
    if (atk.cardId === 'a-110-2') { state.players[opp].acid += 3; log('DM-201：对方叠加 3 层【酸气】', 'eff'); }
    // a-111 DM-300：主动攻击时，令"非目标"的敌方怪物卡受到 6 点伤害（晋升之路【保护】可永久放大，上限 +5）
    if (atk.cardId === 'a-111-2') {
      var dm = 6 + Math.min(5, state.protectBonus || 0);
      log('DM-300：歼灭模式 —— 非目标敌方怪物受到 ' + dm + ' 点伤害', 'eff');
      aliveMonsters(opp).slice().forEach(function (m) { if (m.uid !== t.uid) damageMonster(m, opp, dm, { src: SRC }); });
    }
    if (atk.cardId === 'a-044-2') { log('白化小鼠：目标生命-2', 'eff'); if (!t.flags.dead) damageMonster(t, opp, 2, { src: SRC }); }
    // 蚱蜢：条件按"攻击时对方场上有怪物"判定（即使这一击打死了最后一只怪，也照常 -3 并弃置）
    if (atk.cardId === 'a-050-2' && oppCntAtDeclare > 0) { log('蚱蜢：对方玩家生命-3，蚱蜢进入弃牌堆', 'eff'); damagePlayer(opp, 3, { src: SRC }); leaveBoard(atk, key, true); }
    if (atk.cardId === 'a-052-2') { var p2 = state.players[opp]; var mons = p2.hand.filter(function (c) { return CARDS[c.cardId].type === 'monster'; }); if (mons.length) { var mc = pick(mons); removeFromHand(p2, mc.iid); var di = Math.floor(rand() * (p2.deck.length + 1)); p2.deck.splice(di, 0, mc); log('纯晶元素：对方一张手牌怪物洗回卡组（随机位置）', 'eff'); } }
    if (atk.cardId === 'a-074-2') { // 疯狂强盗：夺取目标装备，然后右移；无法右移则返回手牌
      var owner = state.players[key];
      if (!t.flags.dead && owner.hand.length < Rules.HAND_LIMIT) {
        if (t.weapon) { owner.hand.push(t.weapon); log('疯狂强盗：夺取 ' + t.name + ' 的 ' + cardOf(t.weapon).name, 'eff'); t.weapon = null; }
        else if (t.armor) { owner.hand.push(t.armor); log('疯狂强盗：夺取 ' + t.name + ' 的 ' + cardOf(t.armor).name, 'eff'); t.armor = null; }
      }
      banditAfterAttack(key, atk);
    }
    // 长矛：仅当目标"非对位"时追加伤害（等级越高追加越多：Lv0=1 / Lv1=2 / Lv2=4）
    if (atk.weapon && atk.weapon.cardId === 'a-093-2' && !t.flags.dead) {
      var lsw = CARDS['a-093-2'].mods;
      var s = atk.weapon.level >= 1 ? lsw.upgrade[atk.weapon.level - 1].splash : lsw.splash;
      var as = slotOf(key, atk.uid), ts = slotOf(opp, t.uid);
      if (as >= 0 && ts >= 0 && as !== ts) { log('长矛：目标非对位，追加 ' + s + ' 点伤害', 'eff'); damageMonster(t, opp, s, { src: SRC }); }
      else log('长矛：目标为对位，不触发追加伤害', 'dim');
    }
    // 碧灰双刃/镶钉手套 概率效果
    if (atk.weapon && atk.weapon.cardId === 'a-99-2') { var mm = CARDS['a-99-2'].mods; var ch = atk.weapon.level >= 1 ? mm.upgrade[atk.weapon.level - 1].procChance : mm.procChance; if (!t.flags.dead && rand() < ch) { log('碧灰双刃：额外造成 ' + mm.procDmg + ' 点伤害', 'eff'); damageMonster(t, opp, mm.procDmg, { src: SRC }); } }
  }
  /* a-074 疯狂强盗：攻击后向右移动一位，无法移动则返回手牌。
   * 卡面写的是"攻击后"，**不分攻击对象** —— 打怪（doAttack）和打脸（doAttackPlayer）都要走。
   * ⚠ 以前只在 doAttack 里调：打脸时既不移动也不回手。最直接的受害者是 BOSS 版疯狂强盗——
   *   【独行】会把玩家手里的非 A/S 怪丢光，玩家场上没有 A/S 怪时 BOSS 只能打脸，
   *   于是它永远不会"走不动而回手"。【逃跑】（本体回手 = 玩家失败）形同虚设。 */
  function banditAfterAttack(key, atk) {
    if (!moveRight(key, atk)) { log('疯狂强盗无法右移，返回手牌', 'dim'); leaveBoard(atk, key, false); }
  }
  function doAttackPlayer(key, atk) {
    var opp = other(key);
    var dmg = Math.max(0, atk.atk);
    if (atk.cardId === 'a-038-2' && atk.flags.rogueBonus) { dmg += 3; atk.flags.rogueBonus = false; log('盗贼B：本次攻击 +3（此前处于无法被攻击）', 'eff'); }
    log(atk.name + ' 直接攻击 ' + state.players[opp].name + '（' + dmg + ' 点）', 'attack');
    emit({ type: 'attack', from: atk.uid, toPlayer: opp, fromKey: key, fromSlot: slotOf(key, atk.uid) });   // 供 UI 画"打向玩家"的连线
    damagePlayer(opp, dmg, { src: { by: key, card: atk.cardId } });
    if (opp === 'A' && state.ach && !state.ach.off) state.ach.playerAttacked += 1;   // 成就「皇家卫士」用
    // 疯狂小偷 / 疯狂强盗：对玩家攻击时获得其一张手牌
    // 疯狂小偷的「回合结束返回手牌」以此为准：只有真的打脸夺到手牌才返回（攻击怪物不返回）
    if (atk.cardId === 'a-073-2' || atk.cardId === 'a-074-2') {
      var op = state.players[opp];
      var thief = atk.cardId === 'a-073-2' ? '疯狂小偷' : '疯狂强盗';
      if (op.hand.length && state.players[key].hand.length < Rules.HAND_LIMIT) {
        var c = op.hand.splice(rnd(op.hand.length), 1)[0];
        state.players[key].hand.push(c);
        atk.flags.robbedPlayer = true;
        if (key === 'A' && atk.cardId === 'a-073-2' && state.ach && !state.ach.off) state.ach.stolen += 1;   // 成就「妙手神偷」
        log(thief + '：获得对方一张手牌（' + cardOf(c).name + '）', 'eff');
      } else {
        log(thief + '：对方无手牌可取（或我方手牌已满），本次未夺牌', 'dim');
      }
    }
    // 疯狂强盗：打脸同样要"攻击后右移、走不动则回手"（与打怪保持一致，见 banditAfterAttack）
    if (atk.cardId === 'a-074-2') banditAfterAttack(key, atk);
  }

  function actConfirmBattle(key) {
    if (state.phase !== 'PREP') return fail('当前不在准备阶段');
    beginBattle(key);
    return { ok: true };
  }
  function beginBattle(key) {
    state.phase = 'BATTLE';
    log(state.players[key].name + ' 进入战斗阶段', 'phase');
    // 巨钳蟹：免疫标记按"战斗阶段"重置（攻守双方都重置，避免它在对方战斗阶段仍被当作"本阶段已受伤"而完全免疫）
    ['A', 'B'].forEach(function (k) { aliveMonsters(k).forEach(function (m) { m.flags.tookDamageThisBattle = false; }); });
    // 觉醒【灵视】：战斗阶段开始时，永久清除一只敌方怪物的不可选中状态
    ['A', 'B'].forEach(function (k) {
      var seer = aliveMonsters(k).filter(function (m) { return m.awaken === 'insight'; })[0];
      if (!seer) return;
      var foe = aliveMonsters(other(k)).filter(function (m) { return m.flags.untargetable; })[0];
      if (!foe) return;
      foe.flags.untargetable = false;
      foe.flags.untargetableInnate = false;               // 永久解除
      foe.flags.untargetableUntilOwnerTurn = false;
      log('【灵视】' + seer.name + '：解除 ' + foe.name + ' 的不可选中状态', 'eff');
    });
    // 镶钉手套：战斗阶段开始时概率抽一张牌
    aliveMonsters(key).forEach(function (m) {
      if (m.weapon && m.weapon.cardId === 'a-069-2') {
        var mm = CARDS['a-069-2'].mods;
        var ch = m.weapon.level >= 1 ? mm.upgrade[m.weapon.level - 1].procChance : mm.procChance;
        if (rand() < ch) { log('镶钉手套 触发：抽一张牌', 'eff'); draw(key, 1); }
      }
    });
    checkVictory();
    var opp = other(key);
    var op = state.players[opp];
    // 麻痹陷阱：对方进入战斗阶段时立刻发动，结束对方回合
    var trap = op.hand.filter(function (c) { return c.cardId === 'a-022-2'; })[0];
    if (!trap) { notify(); return; }
    if (op.isAI) {
      // AI 判断：若对方场上有怪物则发动
      if (aliveMonsters(key).length > 0) {
        removeFromHand(op, trap.iid); op.discard.push(trap);
        log('对手发动【麻痹陷阱】：结束你的回合', 'eff');
        emit({ type: 'trap', key: opp, cardId: 'a-022-2' });
        endTurn(key); // 跳过战斗阶段
      } else notify();
    } else {
      // actorKey 必须是**要做决定的人**（陷阱持有者 opp）。以前误写成 key（被麻痹的一方），
      // 导致联机时"等你选择"的弹窗发到了被麻痹者那边，持有者反而看不到；被麻痹的人另存 victimKey。
      state.pending = { kind: 'TRAP_PARALYZE', trapIid: trap.iid, actorKey: opp, victimKey: key };
      notify();
    }
  }
  function resolvePrompt(accept) {
    if (!state.pending) return;
    var pd = state.pending;
    // 定向选择：accept 可传 { iids:[...] } 或 [iids]；未指定时自动选择（兼容旧驱动）
    if (pd.kind === 'CHOOSE_CARDS') {
      var st = pd.steps[pd.idx];
      var iids = null;
      if (accept && typeof accept === 'object' && Array.isArray(accept.iids)) iids = accept.iids;
      else if (Array.isArray(accept)) iids = accept;
      if (!iids) iids = chooseAuto(pd.actorKey, st);
      applyChoice(pd.actorKey, st, iids);
      pd.idx += 1;
      if (pd.idx >= pd.steps.length) { state.pending = null; pd.done(); }
      notify();
      return;
    }
    state.pending = null;
    if (pd.kind === 'OPTION_SKILL') {
      // 可选技能（豺狼巡查）：发动 → 进入选牌流程；不发动 → 直接跳过
      // 必须补一次 notify()：requestChoices 只是写了 state.pending，靠 notify 才会弹弃牌窗口。
      // 否则点「发动」后没反应，要等玩家再点别的（例如任意手牌）触发一次渲染才弹出来。
      if (accept) { requestChoices(pd.actorKey, pd.steps); notify(); }
      else { log('放弃发动【' + pd.label + '】的技能', 'dim'); notify(); }
      return;
    }
    if (pd.kind === 'TRAP_PARALYZE') {
      var holder = pd.actorKey;                              // 决定者 = 陷阱持有者
      var victim = pd.victimKey || other(pd.actorKey);       // 被麻痹的人（旧数据兜底）
      if (accept) {
        var hp = state.players[holder];
        removeFromHand(hp, pd.trapIid); hp.discard.push(makeInstance('a-022-2'));
        log(state.players[holder].name + ' 发动【麻痹陷阱】：结束对方回合', 'eff');
        emit({ type: 'trap', key: holder, cardId: 'a-022-2' });
        endTurn(victim);
      } else { log('放弃发动【麻痹陷阱】', 'dim'); notify(); }
    }
  }

  function actEndTurn(key) {
    if (state.phase === 'PREP') { beginBattle(key); return { ok: true }; }
    endTurn(key);
    return { ok: true };
  }

  function checkVictory() {
    if (state.noHpFloor) return;                 // 学院考核：血量无下限，不在这里判胜负
    ['A', 'B'].forEach(function (k) { if (state.players[k].hp <= 0 && !state.winner) { state.winner = other(k); log('—— ' + state.players[state.winner].name + ' 获胜！——', 'hl'); } });
    if (state.players.A.hp <= 0) state.players.A.hp = 0;
    if (state.players.B.hp <= 0) state.players.B.hp = 0;
  }

  /* ---------------- 查询接口（供 UI / AI 使用） ---------------- */
  function canSummonNormally(key) { return state.players[key].summonsLeft > 0 && emptySlots(key).length > 0; }
  function handCard(key, iidv) { return state.players[key].hand.filter(function (c) { return c.iid === iidv; })[0] || null; }

  return {
    get state() { return state; },
    load: load,                                     // 联机：装载服务器下发的状态
    newGame: newGame, tryAction: tryAction, resolvePrompt: resolvePrompt,
    on: on, notify: notify,
    aliveMonsters: aliveMonsters, emptySlots: emptySlots, firstEmpty: firstEmpty,
    findMonster: findMonster, slotOf: slotOf, other: other, dmgReduce: dmgReduce,
    rand: rand, seedRandom: seedRandom,
    canSummonNormally: canSummonNormally, handCard: handCard, cardOf: cardOf,
    setAIPolicy: setAIPolicy
  };
  })();
}