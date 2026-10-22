/* ============================================================
 * 《地牢决斗师-踏上征途》规则常量  rules.js
 * 严格依据策划案第二、三、四章；实现时不要自创数值。
 * ========================================================== */
export const Rules = {
  // 构建标记：改完代码/打包后手动更新一位，用来确认设备上跑的是哪份构建（设置面板里会显示）
  BUILD: '2026-10-14·v73（新增状态标签悬停看效果；修正「不可选中」说明：不挡卡牌、但也不能绕过它打脸）',
  DESIGN_W: 1280,
  DESIGN_H: 720,

  PLAYER_HP: 30,          // 玩家初始 HP（心形格条显示）
  START_HAND: 4,          // 起手张数
  DRAW_PER_TURN: 1,       // 每准备阶段开始时抽卡
  HAND_LIMIT: 10,         // 手牌上限，溢出洗回牌库
  BOARD_SIZE: 3,          // 每方场上怪物槽位
  DECK_MIN: 20,
  DECK_MAX: 50,
  DECK_START: 20,         // 组卡器/初始卡组固定张数（进入跑图的起始卡组须恰为 20 张；20–50 规则仍保留）
  SUMMON_PER_TURN: 1,     // 每准备阶段手动召唤 ≤1（含献祭召唤）
  WAND_BASE_CASTS: 1,     // 法杖基础每回合发动 1 次（+1 效果可叠加且无上限）
  MAX_ROUNDS: 60,         // 大回合上限；达到后按血量高者获胜，防止僵局
  BOMB_DAMAGE: 6,         // 炸弹延迟爆破伤害（原位置 + 十字方向各 6 点）

  // 怪物等级 → 卡组同名单卡上限
  TIER_MAX: { C: 6, B: 4, A: 3, S: 2 },
  ITEM_MAX: 4,            // 道具类每种 ≤4
  ARTIFACT_MAX: 1,        // 神器最多携带 1

  // 卡牌类型中文名
  TYPE_NAME: {
    monster: '怪物', treasure: '宝藏', throw: '投掷物', food: '食物',
    potion: '药水', wand: '法杖', trap: '陷阱', ring: '戒指',
    artifact: '神器', weapon: '武器', armor: '防具', scroll: '卷轴'
  },

  // 触发窗口（策划案 2.6）
  WINDOW: {
    PREP_START: 'PREP_START',
    BATTLE_START: 'BATTLE_START',
    ATTACK_DECLARED: 'ATTACK_DECLARED',
    DAMAGED: 'DAMAGED',
    DEATH: 'DEATH',
    TURN_END: 'TURN_END'
  },

  // 怪物标签（用于检索类效果）
  TAGS: { COIN: '💰', MEAT: '🍖', OLIVE: '🫒', GEM: '💎' }
};

/* ---------- 种子随机工具（由种子决定抽取结果，同种子可复现） ---------- */
// 32 位整数种子 → [0,1) 伪随机序列（mulberry32）
export function makeRng(seed) {
  var s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 由若干数值/字符串合成一个稳定的 32 位种子
// ⚠ 以前是 `h ^= (arguments[i] | 0)` —— 而 `'reward' | 0 === 0`、`'w3' | 0 === 0`，
//   任何字符串都被压成 0，等于这个参数白传。魔绫大赛的赛后奖励就是这样变成
//   "每场奖励完全一样"的：hashSeed(st.seed, 'reward', matchId) 实际等于
//   hashSeed(st.seed, 0, 0)，与 matchId 无关。
//   现在字符串按字符逐个混入（数字分支保持原样，不改变既有调用结果）。
export function hashSeed() {
  var h = 2166136261;
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (typeof v === 'string') {
      for (var j = 0; j < v.length; j++) {
        h ^= v.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
      h ^= 0x1f;                 // 分隔符：避免 'a'+'bc' 与 'ab'+'c' 撞成同一个种子
      h = Math.imul(h, 16777619);
    } else {
      h ^= (v | 0);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}
// 生成一个随机种子（非确定，用于"不填种子"时）
export function randomSeed() {
  return ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/* ---------- 预置卡组（M1 打预置卡组，20 张） ---------- */
export const PRESET_DECKS = {
  // 玩家初始卡组：C/B 怪 + 基础道具
  starter: [
    'a-005-2', 'a-005-2',              // 大蜗牛C ×2
    'a-101-2',                        // 吸血蝙蝠C（新卡）
    'a-002-2', 'a-002-2',              // 啮齿小鼠C ×2
    'a-031-2', 'a-031-2',              // 战士C ×2
    'a-034-2',                        // 法师C
    'a-037-2',                        // 盗贼C
    'a-040-2',                        // 女猎C
    'a-003-2', 'a-003-2',              // 水道巨蛇C ×2
    'a-013-2', 'a-013-2',              // 神秘宝箱 ×2
    'a-015-2',                        // 飞刀
    'a-114-2',                        // 回旋镖（新卡）
    'a-019-2',                        // 治疗药水
    'a-025-2',                        // 短剑
    'a-026-2',                        // 圆盾
    'a-022-2'                         // 麻痹陷阱
  ],
  // AI 卡组：稍偏进攻（含 B 级怪）
  raider: [
    'a-005-2',                        // 大蜗牛C
    'a-031-2', 'a-031-2',              // 战士C ×2
    'a-037-2', 'a-037-2',              // 盗贼C ×2
    'a-002-2',                        // 啮齿小鼠C
    'a-045-2',                        // 食人鱼C
    'a-004-2',                        // 豺狼巡查B
    'a-006-2',                        // 丛林螃蟹B
    'a-032-2',                        // 战士B
    'a-107-2',                        // DM-200B（新卡）
    'a-071-2',                        // 骷髅B
    'a-043-2',                        // 活化石像B
    'a-015-2',                        // 飞刀
    'a-114-2',                        // 回旋镖（新卡）
    'a-016-2',                        // 苦无
    'a-061-2',                        // 飞斧
    'a-025-2',                        // 短剑
    'a-117-2',                        // 爆炸陷阱（新卡）
    'a-089-2'                         // 毒气陷阱
  ]
};