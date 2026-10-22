/* ============================================================
 * js/awaken_data.js —— 3★ 觉醒词条表（学院考核专属）
 *
 *   规则：
 *     · 只有学院考核里合成的 3★ 怪物才会掷词条（star 只在学院出现）
 *       —— 因此词条天然只在学院模式生效，不影响单机 / 大赛 / Boss / 联机
 *     · 分配方式：按 cardId 稳定哈希 —— 同一张卡永远是同一个词条，
 *       玩家可以学习、可以围绕它构筑
 *     · 词条挂在怪物实例的 inst.awaken 上（字符串 id）
 *
 *   实现时的分派位置（engine.js）：
 *     spawn    —— 实例生成后（数值类）
 *     calc     —— recalc() 里（攻击力相关）
 *     reduce   —— dmgReduce() 里（减伤相关）
 *     reset    —— startTurn() 里每只怪的字段重置（暴怒）
 *     prep     —— prepStartMonster()（回合开始类）
 *     battleStart —— beginBattle()（战斗阶段开始类）
 *     attack   —— doAttack()（攻击时）
 *     hurt     —— damageMonster()（受到伤害时）
 *     death    —— onDeath() / destroyMonster()（死亡时）
 *     kill     —— 击杀怪物时
 *     summon   —— 召唤时
 * ========================================================== */
import { CARDS } from './cards.js';

export const AWAKEN = {
  sacrifice: { name: '牺牲', hook: 'target',      desc: '对手必须以这张卡为优先攻击目标（有多张时从中任选）' },
  titan:     { name: '庞大', hook: 'spawn',       desc: '生命在三星基础上翻倍' },
  elite:     { name: '精英', hook: 'calc',        desc: '攻击力在三星基础上翻倍' },
  swift:     { name: '迅捷', hook: 'summon',      desc: '召唤这张卡不消耗召唤次数' },
  stealth:   { name: '潜伏', hook: 'prep',        desc: '每隔一回合进入不可选中状态' },
  armor8:    { name: '重甲', hook: 'reduce',      desc: '自带 8 点减伤' },
  regen:     { name: '自愈', hook: 'prep',        desc: '每回合开始时恢复 30% 生命' },
  fury:      { name: '暴怒', hook: 'reset',       desc: '每回合固定拥有 2 次攻击机会' },
  pierce:    { name: '穿透', hook: 'attack',      desc: '攻击怪物时对对手本体造成等量伤害' },
  insight:   { name: '灵视', hook: 'battleStart', desc: '战斗阶段开始时永久清除一只敌方怪物的不可选中状态' },
  boom:      { name: '自爆', hook: 'death',       desc: '死亡时对手场上的随机两只怪物死亡' },
  mirror:    { name: '幻象', hook: 'prep',        desc: '回合开始时在己方随机空位衍生一张该卡 1 命同攻的同名怪物' },
  bind:      { name: '禁锢', hook: 'hurt',        desc: '攻击这张卡的怪物下回合无法攻击' },
  thorn:     { name: '荆棘', hook: 'hurt',        desc: '受到伤害时对攻击者造成该卡攻击力等量的伤害' },
  reborn:    { name: '复生', hook: 'death',       desc: '死亡时以 10 点生命复活一次' },
  drain:     { name: '汲取', hook: 'kill',        desc: '每击杀一只怪物，永久获得其 50% 攻击力（向下取整）' },
  sunder:    { name: '破甲', hook: 'attack',      desc: '攻击时无视对方减伤' },
  command:   { name: '号令', hook: 'summon',      desc: '召唤时随机一只友军攻击力翻倍' },
  greed:     { name: '贪婪', hook: 'kill',        desc: '击杀怪物时额外获得 6 学时' }
};

/* 分配顺序表（改动这个顺序会改变所有卡的觉醒结果） */
export const AWAKEN_ORDER = [
  'sacrifice', 'titan', 'elite', 'swift', 'stealth', 'armor8', 'regen', 'fury',
  'pierce', 'insight', 'boom', 'mirror', 'bind', 'thorn', 'reborn', 'drain',
  'sunder', 'command', 'greed'
];

/* 下面是"按 cardId 稳定分配"的参考表 —— 现在只用于自动化测试（awaken_check 的覆盖检查）。
 *
 * 实际规则（自 v41 起）：觉醒词条在【学院里合成出 3★ 的那一刻】随机抽一个，
 * 抽到什么就写在那张卡的实例上（{ id, star, awaken }），之后召唤 / 回手 / 复活 /
 * 镜像复制都沿用这一个，不再变。
 *   所以"某张卡觉醒成什么"是随机的；但"一个具体的 3★ 实例"是固定的。
 * 见 academy.js 的 tryMerge（抽词条）与 academy_data.js 的 rollAwaken。 */
var _awakenMap = null;
export function buildAwakenMap() {
  if (_awakenMap) return _awakenMap;
  var map = {};
  var ids = (typeof CARDS !== 'undefined' && CARDS) ? Object.keys(CARDS) : [];
  var normal = [], rare = [];
  ids.forEach(function (id) {
    var c = CARDS[id];
    if (!c || c.type !== 'monster') return;
    if (c.tier === 'A' || c.tier === 'S') rare.push(id); else normal.push(id);   // 只怪才有 tier
  });
  var N = AWAKEN_ORDER.length;
  normal.forEach(function (id, i) { map[id] = AWAKEN_ORDER[i % N]; });
  // 献祭卡错开 7 位，避免和常规卡形成同一套规律
  rare.forEach(function (id, i) { map[id] = AWAKEN_ORDER[(i + 7) % N]; });
  _awakenMap = map;
  return map;
}

/* 按 cardId 稳定分配：同一张卡永远同一个词条 */
export function awakenOf(cardId) {
  var id = String(cardId || '');
  var map = buildAwakenMap();
  if (map[id]) return map[id];
  // 兜底（不在 CARDS 里的自定义卡 / 测试卡）：哈希
  var h = 0, i;
  for (i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 999983;
  return AWAKEN_ORDER[h % AWAKEN_ORDER.length];
}

/* 取词条信息（名称 / 说明），给界面用 */
export function awakenInfo(id) { return id ? AWAKEN[id] || null : null; }

/* 是否应该觉醒：只在学院的三星卡上成立 */
export function shouldAwaken(star) { return (star || 1) >= 3; }