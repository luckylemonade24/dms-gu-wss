/* ============================================================
 * 魔绫大赛 · 数据层  tournament_data.js
 *  - 杯名词库（首字 40 / 次字 100）
 *  - AI 参赛选手名库
 *  - 40 套"有套路"的 AI 初始 20 卡组（标准模板，见下）
 *  - 奖励池生成与 AI 选牌亲和度
 *
 * 卡组标准模板（每套 20 张）：
 *   强化版：2×S + 3×A + 7×B/C + 3×过牌 + 5×强力道具（怪 12/60%）
 *   弱卡组（WEAK_ARCHS 标记的 6 套）：2×S + 3×A + 6×B/C + 3×过牌 + 6×道具（保持原模板）
 *   道具优先【过牌】与【强力道具】（冰霜药水/催眠卷轴/炸弹/疾速药水/麻痹陷阱/镜像卷轴等）。
 * ========================================================== */
import { CARD_LIST, CARDS } from './cards.js';
import { Rules, makeRng, hashSeed } from './rules.js';

export const TOUR_DATA = (function () {
  'use strict';

  /* ---------------- 杯名词库 ---------------- */
  var CUP_FIRST = '魔皇绫天圣琼光幽玄冥炎霜雷风云星月霞虹夜曦苍紫金银玉碧赤青白黑血魂龙凤虎狼鹰麟鲸';
  var CUP_SECOND = '龙风火狼凤水虎雷云山海川林森岩石铁钢金银铜玉珠晶冰霜雪雨电光影月星日辰霞虹雾露泉溪江河湖潭渊谷峰岭崖洞穴窟城堡塔楼殿阁宫苑园圃田野原漠洲岛屿港湾岸滩礁桥关门道路径巷街庭墟陵墓祠庙坛台轩斋庐舍居巢窖厢廊';

  function pickChar(str, rng) { return str.charAt(Math.floor(rng() * str.length)); }
  function randomCupName(rng) {
    rng = rng || Math.random;
    return pickChar(CUP_FIRST, rng) + pickChar(CUP_SECOND, rng) + '杯';
  }

  /* ---------------- AI 参赛选手名库 ---------------- */
  var AI_NAMES = [
    '地牢皇帝叶小绿', '阿Ren哥', '罐姐', '神秘的黑猫', 'AAA专业水洗键盘', '本子妈', '柠檬屑猫猫', '魔法绵羊',
    '可爱choco', 'DanielCalan', 'bingo', '天狗的狗', '路人NPC', '泥巴杖子', '幽妹', 'catand',
    '古达子', '西西-日更版', '月华', '李德才', '蓝神', 'Evan', '下元咕', '为什么不喝液火！',
    '莲恩', '鸽子王泰勒', '奶龙', '可爱的黑白', '绿野精灵', '萝卜子', 'zmjjkk', 'nobody',
    '长崎爽世', '千早爱音', '厉飞羽', '咕咕嘎嘎', '关注塔菲喵',
    '设寄师', '水灯芯', '箐筅', '🐖*9'
  ];

  /* ---------------- 模块：过牌 / 道具（复用，保证套路与强度） ---------------- */
  // 过牌（3）
  var DR_BOX = ['a-013-2', 'a-014-2', 'a-023-2'];    // 神秘宝箱 / 黄金宝箱 / 财富戒指
  var DR_SUP = ['a-013-2', 'a-060-2', 'a-113-2'];    // 神秘宝箱 / 补给箱 / 水晶宝箱（新卡：检索法杖·戒指）
  var DR_TEL = ['a-030-2', 'a-014-2', 'a-023-2'];    // 传送卷轴 / 黄金宝箱 / 财富戒指
  var DR_BONE = ['a-013-2', 'a-085-2', 'a-023-2'];   // 神秘宝箱 / 遗骸 / 财富戒指

  // 道具 / 装备 / 法术（6）—— 每个模块至少含 1 张解场/干扰卡（盛怒卷轴/炸弹/催眠卷轴/冰霜药水/疾速药水）
  var IT_DEF = ['a-025-2', 'a-026-2', 'a-027-2', 'a-039-2', 'a-062-2', 'a-019-2'];                 // 短剑/圆盾/布甲/暗影斗篷/冰霜药水/治疗药水
  var IT_ATK = ['a-015-2', 'a-015-2', 'a-016-2', 'a-061-2', 'a-020-2', 'a-088-2'];                 // 飞刀×2/苦无/飞斧/力量药水/盛怒卷轴
  var IT_WAND = ['a-021-2', 'a-068-2', 'a-091-2', 'a-036-2', 'a-063-2', 'a-116-2'];                // 魔弹/解离/冲击波/老法杖/催眠卷轴/镜像卷轴（新卡）
  var IT_CTRL = ['a-062-2', 'a-063-2', 'a-086-2', 'a-086-2', 'a-022-2', 'a-019-2'];                // 冰霜药水/催眠卷轴/炸弹×2/麻痹陷阱/治疗药水
  var IT_POISON = ['a-086-2', 'a-086-2', 'a-062-2', 'a-020-2', 'a-115-2', 'a-019-2'];              // 炸弹×2/冰霜药水/力量药水/毒气药水（新卡）/治疗药水
  var IT_EQUIP = ['a-025-2', 'a-093-2', 'a-026-2', 'a-039-2', 'a-088-2', 'a-029-2'];               // 短剑/长矛/圆盾/暗影斗篷/盛怒卷轴/升级卷轴
  var IT_ICE = ['a-062-2', 'a-062-2', 'a-063-2', 'a-027-2', 'a-019-2', 'a-088-2'];                 // 冰霜药水×2/催眠卷轴/布甲/治疗药水/盛怒卷轴
  var IT_THROW = ['a-015-2', 'a-016-2', 'a-061-2', 'a-061-2', 'a-086-2', 'a-090-2'];               // 飞刀/苦无/飞斧×2/炸弹/神射戒指
  var IT_TRAP = ['a-022-2', 'a-117-2', 'a-064-2', 'a-089-2', 'a-089-2', 'a-063-2'];                // 麻痹陷阱/爆炸陷阱（新卡）/召唤陷阱/毒气陷阱×2/催眠卷轴
  var IT_HEAL = ['a-019-2', 'a-019-2', 'a-059-2', 'a-018-2', 'a-118-2', 'a-088-2'];               // 治疗药水×2/肉馅饼/露珠/鳞甲（新卡）/盛怒卷轴
  var IT_GOLD = ['a-119-2', 'a-069-2', 'a-027-2', 'a-086-2', 'a-016-2', 'a-019-2'];               // 硬头锤（新卡）/镶钉手套/布甲/炸弹/苦无/治疗药水
  var IT_CLOAK = ['a-039-2', 'a-025-2', 'a-025-2', 'a-063-2', 'a-016-2', 'a-019-2'];              // 暗影斗篷/短剑×2/催眠卷轴/苦无/治疗药水
  var IT_TEMPO = ['a-087-2', 'a-087-2', 'a-020-2', 'a-025-2', 'a-114-2', 'a-019-2'];              // 疾速药水×2/力量药水/短剑/回旋镖（新卡）/治疗药水
  var IT_GHOST = ['a-039-2', 'a-063-2', 'a-029-2', 'a-025-2', 'a-019-2', 'a-016-2'];              // 暗影斗篷/催眠卷轴/升级卷轴/短剑/治疗药水/苦无

  /* ---------------- 40 套卡组思路 ----------------
   * s:2 只 S 级 ｜ a:3 只 A 级 ｜ bc:6 只 B/C 级 ｜ d:3 张过牌 ｜ it:6 张道具装备法术
   * 说明：以上为"主题素材池"。强化版（非 WEAK_ARCHS）会按规格重排为
   *       S2 + A3 + B/C7 + 过牌3 + 强力道具5，并从高数值池补齐；弱卡组保持原样。
   */
  var ARCHETYPES = [
    { n: '重装铁壁', t: '🛡', s: ['a-111-2', 'a-012-2'], a: ['a-008-2', 'a-053-2', 'a-008-2'], bc: ['a-032-2', 'a-031-2', 'a-031-2', 'a-003-2', 'a-002-2', 'a-005-2'], d: DR_BOX, it: IT_DEF },
    { n: '秘法法杖', t: '🪄', s: ['a-058-2', 'a-011-2'], a: ['a-96-2', 'a-95-2', 'a-010-2'], bc: ['a-035-2', 'a-035-2', 'a-034-2', 'a-034-2', 'a-002-2', 'a-007-2'], d: DR_TEL, it: IT_WAND },
    { n: '暗影潜袭', t: '🗡', s: ['a-083-2', 'a-058-2'], a: ['a-074-2', 'a-074-2', 'a-95-2'], bc: ['a-038-2', 'a-037-2', 'a-037-2', 'a-073-2', 'a-073-2', 'a-071-2'], d: DR_BOX, it: IT_CLOAK },
    { n: '游侠速射', t: '🏹', s: ['a-083-2', 'a-011-2'], a: ['a-010-2', 'a-95-2', 'a-95-2'], bc: ['a-041-2', 'a-040-2', 'a-040-2', 'a-044-2', 'a-002-2', 'a-006-2'], d: DR_SUP, it: IT_THROW },
    { n: '亡灵军团', t: '💀', s: ['a-058-2', 'a-012-2'], a: ['a-077-2', 'a-077-2', 'a-95-2'], bc: ['a-078-2', 'a-079-2', 'a-076-2', 'a-076-2', 'a-071-2', 'a-056-2'], d: DR_BONE, it: IT_GHOST },
    { n: '毒气花园', t: '🫒', s: ['a-055-2', 'a-055-2'], a: ['a-081-2', 'a-082-2', 'a-081-2'], bc: ['a-054-2', 'a-102-2', 'a-048-2', 'a-048-2', 'a-080-2', 'a-080-2'], d: DR_BOX, it: IT_POISON },
    { n: '金币贪婪', t: '💰', s: ['a-058-2', 'a-083-2'], a: ['a-010-2', 'a-010-2', 'a-074-2'], bc: ['a-004-2', 'a-004-2', 'a-046-2', 'a-105-2', 'a-071-2', 'a-103-2'], d: DR_BONE, it: IT_GOLD },
    { n: '血肉壁垒', t: '🍖', s: ['a-058-2', 'a-058-2'], a: ['a-009-2', 'a-009-2', 'a-008-2'], bc: ['a-044-2', 'a-006-2', 'a-006-2', 'a-003-2', 'a-045-2', 'a-002-2'], d: DR_SUP, it: IT_HEAL },
    { n: '螃蟹连击', t: '🦀', s: ['a-011-2', 'a-011-2'], a: ['a-008-2', 'a-008-2', 'a-008-2'], bc: ['a-006-2', 'a-006-2', 'a-006-2', 'a-006-2', 'a-003-2', 'a-005-2'], d: DR_BOX, it: IT_TEMPO },
    { n: '史莱姆潮', t: '🟢', s: ['a-012-2', 'a-012-2'], a: ['a-081-2', 'a-053-2', 'a-009-2'], bc: ['a-049-2', 'a-049-2', 'a-057-2', 'a-057-2', 'a-056-2', 'a-056-2'], d: DR_BOX, it: IT_HEAL },
    { n: '鼠患成群', t: '🐭', s: ['a-058-2', 'a-058-2'], a: ['a-009-2', 'a-009-2', 'a-074-2'], bc: ['a-002-2', 'a-002-2', 'a-002-2', 'a-007-2', 'a-007-2', 'a-056-2'], d: DR_BOX, it: IT_GOLD },
    { n: '恶魔召唤', t: '🔮', s: ['a-058-2', 'a-011-2'], a: ['a-008-2', 'a-010-2', 'a-96-2'], bc: ['a-035-2', 'a-034-2', 'a-034-2', 'a-002-2', 'a-002-2', 'a-076-2'], d: DR_SUP, it: IT_TRAP },
    { n: '炸弹爆破', t: '💣', s: ['a-012-2', 'a-111-2'], a: ['a-082-2', 'a-082-2', 'a-110-2'], bc: ['a-075-2', 'a-075-2', 'a-107-2', 'a-104-2', 'a-057-2', 'a-005-2'], d: DR_BOX, it: IT_POISON },
    { n: '陷阱大师', t: '🕸', s: ['a-058-2', 'a-012-2'], a: ['a-077-2', 'a-010-2', 'a-009-2'], bc: ['a-054-2', 'a-006-2', 'a-003-2', 'a-005-2', 'a-002-2', 'a-001-2'], d: DR_SUP, it: IT_TRAP },
    { n: '法杖风暴', t: '🌪', s: ['a-058-2', 'a-011-2'], a: ['a-96-2', 'a-96-2', 'a-95-2'], bc: ['a-035-2', 'a-035-2', 'a-034-2', 'a-034-2', 'a-034-2', 'a-002-2'], d: DR_TEL, it: IT_WAND },
    { n: '装备工厂', t: '⚙', s: ['a-111-2', 'a-011-2'], a: ['a-053-2', 'a-053-2', 'a-008-2'], bc: ['a-043-2', 'a-043-2', 'a-032-2', 'a-031-2', 'a-031-2', 'a-005-2'], d: DR_BOX, it: IT_EQUIP },
    { n: '不死复活', t: '♻', s: ['a-100-2', 'a-100-2'], a: ['a-077-2', 'a-077-2', 'a-95-2'], bc: ['a-078-2', 'a-078-2', 'a-071-2', 'a-071-2', 'a-076-2', 'a-056-2'], d: DR_BONE, it: IT_GHOST },
    { n: '典藏集结', t: '✨', s: ['a-100-2', 'a-011-2'], a: ['a-95-2', 'a-96-2', 'a-98-2'], bc: ['a-032-2', 'a-041-2', 'a-035-2', 'a-038-2', 'a-071-2', 'a-005-2'], d: DR_BOX, it: IT_ATK },
    { n: '烈焰焚烧', t: '🔥', s: ['a-055-2', 'a-012-2'], a: ['a-082-2', 'a-082-2', 'a-081-2'], bc: ['a-054-2', 'a-054-2', 'a-080-2', 'a-080-2', 'a-050-2', 'a-047-2'], d: DR_BOX, it: IT_ATK },
    { n: '巨人压制', t: '🗿', s: ['a-111-2', 'a-058-2'], a: ['a-053-2', 'a-053-2', 'a-053-2'], bc: ['a-032-2', 'a-032-2', 'a-031-2', 'a-031-2', 'a-005-2', 'a-005-2'], d: DR_SUP, it: IT_EQUIP },
    { n: '蜗牛消耗', t: '🐌', s: ['a-012-2', 'a-058-2'], a: ['a-008-2', 'a-009-2', 'a-053-2'], bc: ['a-005-2', 'a-005-2', 'a-005-2', 'a-003-2', 'a-045-2', 'a-002-2'], d: DR_BOX, it: IT_HEAL },
    { n: '闪避游斗', t: '💨', s: ['a-083-2', 'a-011-2'], a: ['a-008-2', 'a-008-2', 'a-95-2'], bc: ['a-003-2', 'a-045-2', 'a-045-2', 'a-005-2', 'a-002-2', 'a-031-2'], d: DR_BOX, it: IT_CLOAK },
    { n: '疯狂盗贼', t: '🎭', s: ['a-058-2', 'a-083-2'], a: ['a-074-2', 'a-074-2', 'a-074-2'], bc: ['a-073-2', 'a-073-2', 'a-037-2', 'a-037-2', 'a-071-2', 'a-004-2'], d: DR_BONE, it: IT_CLOAK },
    { n: '献祭进化', t: '⛧', s: ['a-011-2', 'a-100-2'], a: ['a-053-2', 'a-053-2', 'a-95-2'], bc: ['a-031-2', 'a-031-2', 'a-005-2', 'a-005-2', 'a-002-2', 'a-038-2'], d: DR_BOX, it: IT_EQUIP },
    { n: '宝箱宝藏', t: '🎁', s: ['a-058-2', 'a-058-2'], a: ['a-009-2', 'a-010-2', 'a-077-2'], bc: ['a-001-2', 'a-001-2', 'a-002-2', 'a-002-2', 'a-007-2', 'a-007-2'], d: DR_SUP, it: IT_GOLD },
    { n: '悍蟹御守', t: '🛡', s: ['a-011-2', 'a-012-2'], a: ['a-008-2', 'a-008-2', 'a-008-2'], bc: ['a-006-2', 'a-006-2', 'a-006-2', 'a-044-2', 'a-071-2', 'a-005-2'], d: DR_BOX, it: IT_DEF },
    { n: '天狗游击', t: '🦅', s: ['a-083-2', 'a-083-2'], a: ['a-95-2', 'a-95-2', 'a-010-2'], bc: ['a-041-2', 'a-038-2', 'a-037-2', 'a-037-2', 'a-002-2', 'a-031-2'], d: DR_SUP, it: IT_TEMPO },
    { n: '监狱囚笼', t: '⛓', s: ['a-111-2', 'a-011-2'], a: ['a-077-2', 'a-077-2', 'a-009-2'], bc: ['a-072-2', 'a-072-2', 'a-071-2', 'a-071-2', 'a-038-2', 'a-076-2'], d: DR_BOX, it: IT_EQUIP },
    { n: '蕾零连斩', t: '⚔', s: ['a-100-2', 'a-012-2'], a: ['a-95-2', 'a-95-2', 'a-95-2'], bc: ['a-032-2', 'a-032-2', 'a-031-2', 'a-031-2', 'a-006-2', 'a-006-2'], d: DR_BOX, it: IT_ATK },
    { n: '茉莉护盾', t: '🫧', s: ['a-100-2', 'a-012-2'], a: ['a-96-2', 'a-96-2', 'a-96-2'], bc: ['a-035-2', 'a-034-2', 'a-034-2', 'a-034-2', 'a-002-2', 'a-005-2'], d: DR_TEL, it: IT_WAND },
    { n: '极影潜行', t: '🌫', s: ['a-011-2', 'a-083-2'], a: ['a-97-2', 'a-97-2', 'a-97-2'], bc: ['a-038-2', 'a-037-2', 'a-037-2', 'a-073-2', 'a-002-2', 'a-040-2'], d: DR_TEL, it: IT_CLOAK },
    { n: '姬莲投掷', t: '🎯', s: ['a-083-2', 'a-083-2'], a: ['a-98-2', 'a-98-2', 'a-98-2'], bc: ['a-041-2', 'a-040-2', 'a-040-2', 'a-002-2', 'a-031-2', 'a-031-2'], d: DR_SUP, it: IT_THROW },
    { n: '苍蝇之海', t: '🪰', s: ['a-058-2', 'a-058-2'], a: ['a-009-2', 'a-009-2', 'a-053-2'], bc: ['a-007-2', 'a-007-2', 'a-007-2', 'a-007-2', 'a-002-2', 'a-051-2'], d: DR_BOX, it: IT_TEMPO },
    { n: '血怒狂暴', t: '🩸', s: ['a-111-2', 'a-012-2'], a: ['a-053-2', 'a-053-2', 'a-95-2'], bc: ['a-032-2', 'a-032-2', 'a-031-2', 'a-031-2', 'a-006-2', 'a-002-2'], d: DR_BOX, it: IT_ATK },
    { n: '冰霜封锁', t: '❄', s: ['a-111-2', 'a-011-2'], a: ['a-082-2', 'a-082-2', 'a-008-2'], bc: ['a-003-2', 'a-005-2', 'a-005-2', 'a-002-2', 'a-047-2', 'a-045-2'], d: DR_SUP, it: IT_ICE },
    { n: '传送过牌', t: '🌀', s: ['a-058-2', 'a-058-2'], a: ['a-009-2', 'a-010-2', 'a-96-2'], bc: ['a-002-2', 'a-002-2', 'a-002-2', 'a-001-2', 'a-001-2', 'a-035-2'], d: DR_TEL, it: IT_HEAL },
    { n: '宝箱过牌', t: '📦', s: ['a-012-2', 'a-058-2'], a: ['a-077-2', 'a-010-2', 'a-009-2'], bc: ['a-001-2', 'a-001-2', 'a-002-2', 'a-002-2', 'a-035-2', 'a-007-2'], d: DR_SUP, it: IT_GOLD },
    { n: '巨钳之壁', t: '🦞', s: ['a-011-2', 'a-012-2'], a: ['a-008-2', 'a-008-2', 'a-008-2'], bc: ['a-006-2', 'a-006-2', 'a-044-2', 'a-003-2', 'a-005-2', 'a-002-2'], d: DR_BOX, it: IT_DEF },
    { n: '神射投掷', t: '🏹', s: ['a-083-2', 'a-011-2'], a: ['a-010-2', 'a-010-2', 'a-98-2'], bc: ['a-040-2', 'a-040-2', 'a-041-2', 'a-002-2', 'a-031-2', 'a-031-2'], d: DR_SUP, it: IT_THROW },
    { n: '狂怒之戒', t: '💢', s: ['a-012-2', 'a-058-2'], a: ['a-053-2', 'a-009-2', 'a-95-2'], bc: ['a-007-2', 'a-007-2', 'a-032-2', 'a-031-2', 'a-006-2', 'a-002-2'], d: DR_BOX, it: IT_GOLD }
  ];

  /* ---------------- 卡池工具 ---------------- */
  function allIds() { return CARD_LIST.map(function (c) { return c.id; }); }
  function monsterIds(tier) { return CARD_LIST.filter(function (c) { return c.type === 'monster' && (!tier || c.tier === tier); }).map(function (c) { return c.id; }); }

  /* ---------------- 卡组强度规格 ----------------
   * 怪物 60~70%（其中 B/C 50~60%、A 20~30%、S 10~20%），道具 30~40%（优先过牌 + 强力道具）
   * 初始 20 张：S2 + A3 + B/C7 + 过牌3 + 强力道具5 → 怪 12(60%) / 道具 8(40%)
   * 数值校验：B/C 7/12=58%、A 3/12=25%、S 2/12=17%（均在区间内）
   */
  var TARGET = { S: 2, A: 3, BC: 7, DRAW: 3, ITEM: 5 };
  var MON_BANNED = ['a-077-2', 'a-076-2'];   // 咒缚灵 / 怨灵：杂鱼，绝不入卡组
  var POWER_ITEM_SET = {
    'a-022-2': 1, 'a-087-2': 1, 'a-062-2': 1, 'a-063-2': 1, 'a-116-2': 1,
    'a-020-2': 1, 'a-115-2': 1, 'a-088-2': 1, 'a-086-2': 1, 'a-117-2': 1, 'a-016-2': 1, 'a-061-2': 1
  };
  var DRAW_POOL = ['a-013-2', 'a-014-2', 'a-023-2', 'a-060-2', 'a-085-2', 'a-113-2', 'a-030-2'];
  var ITEM_POOL = ['a-022-2', 'a-087-2', 'a-062-2', 'a-063-2', 'a-116-2', 'a-020-2',
    'a-115-2', 'a-088-2', 'a-086-2', 'a-117-2', 'a-016-2', 'a-061-2', 'a-029-2'];
  // 保留的"弱卡组"（不加强，维持原始 2S+3A+6B/C+3过牌+6道具 模板）
  // 选取规则：本身数值偏弱的套路，且不含【咒缚灵/怨灵】等杂鱼
  var WEAK_ARCHS = ['史莱姆潮', '蜗牛消耗', '苍蝇之海', '传送过牌', '巨钳之壁', '悍蟹御守'];
  function isWeakArch(arch) { return !!arch && WEAK_ARCHS.indexOf(arch.n) >= 0; }

  // 怪物数值分（越高越强）→ "高数值池"
  var MON_TIERS = { S: [], A: [], B: [], C: [] };
  CARD_LIST.forEach(function (c) { if (c.type === 'monster') MON_TIERS[c.tier].push(c.id); });
  function statVal(id) { var c = CARDS[id]; return (c.atk || 0) * 1.5 + (c.hp || 0); }
  function topByStat(ids, frac) {
    var arr = ids.filter(function (id) { return MON_BANNED.indexOf(id) < 0; })
      .sort(function (a, b) { return statVal(b) - statVal(a); });
    return arr.slice(0, Math.max(1, Math.ceil(arr.length * (frac == null ? 0.5 : frac))));
  }
  var POOL_S = topByStat(MON_TIERS.S, 0.7);
  var POOL_A = topByStat(MON_TIERS.A, 0.65);
  var POOL_BC = topByStat(MON_TIERS.B, 0.7).concat(topByStat(MON_TIERS.C, 0.45));

  // 强化：按目标构成重组；主题 S/A/B/C 尽量保留，不足的从高数值池补，道具优先过牌 + 强力
  function strengthenDeck(arch, rng) {
    rng = rng || Math.random;
    var pickRnd = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    var keep = function (arr, n) {
      return (arr || []).filter(function (id) { return CARDS[id] && MON_BANNED.indexOf(id) < 0; }).slice(0, n);
    };
    var fill = function (list, pool, n) { while (list.length < n && pool.length) list.push(pickRnd(pool)); return list.slice(0, n); };
    var s = fill(keep(arch.s, TARGET.S), POOL_S, TARGET.S);
    var a = fill(keep(arch.a, TARGET.A), POOL_A, TARGET.A);
    var bc = fill(keep(arch.bc, TARGET.BC), POOL_BC, TARGET.BC);
    var draw = fill(keep(arch.d, TARGET.DRAW), DRAW_POOL, TARGET.DRAW);
    var it = fill(keep(arch.it, TARGET.ITEM), ITEM_POOL, TARGET.ITEM);
    return [].concat(s, a, bc, draw, it);
  }

  // 构建 20 张初始卡组：弱卡组维持原模板，其余按强度规格强化（无 rng 时按套路名派生，保证可复现）
  function buildDeck(arch, rng) {
    var raw;
    if (isWeakArch(arch)) {
      raw = [].concat(arch.s || [], arch.a || [], arch.bc || [], arch.d || [], arch.it || []);
    } else {
      if (!rng) { var nm = arch.n || ''; rng = makeRng(hashSeed(0x70117, nm.length, nm.charCodeAt(0) | 0, nm.charCodeAt(nm.length - 1) | 0)); }
      raw = strengthenDeck(arch, rng);
    }
    var deck = [];
    raw.forEach(function (id) { if (CARDS[id]) deck.push(id); });
    return deck.slice(0, Rules.DECK_START);
  }

  // 随机抽取 n 张不重复卡
  function rewardPool(n, rng, filter) {
    rng = rng || Math.random;
    var pool = CARD_LIST.filter(function (c) { return !filter || filter(c); }).map(function (c) { return c.id; });
    var out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  }

  /* ---------------- AI 选牌（按套路 + 卡组构成 + 种子扰动） ---------------- */
  // 过牌卡判定
  function isDrawCard(id) { var c = CARDS[id]; return !!c && (c.type === 'treasure' || c.type === 'ring'); }
  // 单卡价值（用于满 30 张后替换最弱卡）
  function cardValue(id) {
    var c = CARDS[id]; if (!c) return 0;
    if (c.type === 'monster') return (c.atk || 0) * 1.4 + (c.hp || 0) * 0.5 + ({ C: 0, B: 2, A: 5, S: 8 }[c.tier] || 0);
    if (c.type === 'weapon' || c.type === 'armor') return 3;
    if (c.type === 'wand') return 2.5;
    if (c.type === 'artifact') return 2;
    return 1;
  }
  // 套路画像：从"本套初始卡组"推导它偏好的卡型 / 标签（机制标签真正生效）
  function buildProfile(arch) {
    var ids = [].concat(arch.s || [], arch.a || [], arch.bc || [], arch.d || [], arch.it || []);
    var typeC = {}, tagC = {};
    ids.forEach(function (id) {
      var c = CARDS[id]; if (!c) return;
      typeC[c.type] = (typeC[c.type] || 0) + 1;
      (c.tags || []).forEach(function (t) { tagC[t] = (tagC[t] || 0) + 1; });
    });
    return { typeC: typeC, tagC: tagC };
  }
  function countMonsters(deck) { var n = 0; deck.forEach(function (id) { if (CARDS[id] && CARDS[id].type === 'monster') n++; }); return n; }
  function countDraw(deck) { var n = 0; deck.forEach(function (id) { if (isDrawCard(id)) n++; }); return n; }

  // 单卡评分：清单命中 + 类型/标签贴合 + 高数值/强道具 + 卡组构成修正 + 种子扰动
  function scoreCard(cardId, arch, prof, deck, rng) {
    var c = CARDS[cardId]; if (!c) return -999;
    if (c.type === 'monster' && MON_BANNED.indexOf(cardId) >= 0) return -999;   // 杂鱼不拿
    var s = 0;
    if ((arch.s || []).indexOf(cardId) >= 0) s += 10;                    // S 级核心最高优先（不可被当弱卡替换）
    else if ((arch.a || []).indexOf(cardId) >= 0) s += 8;
    else if ((arch.bc || []).indexOf(cardId) >= 0) s += 5;
    else if ((arch.it || []).indexOf(cardId) >= 0) s += 4;
    else if ((arch.d || []).indexOf(cardId) >= 0) s += 4;
    if (prof && prof.typeC[c.type]) s += Math.min(3, prof.typeC[c.type]) * 0.6;          // 类型贴合
    if (prof) (c.tags || []).forEach(function (t) { if (prof.tagC[t]) s += Math.min(3, prof.tagC[t]) * 0.8; });  // 标签贴合
    if (c.type === 'monster') {
      s += ({ S: 1.2, A: 1.0, B: 0.6, C: 0.1 }[c.tier] || 0);          // 档次：S/A 略优
      s += clamp((c.atk || 0) * 0.3 + (c.hp || 0) * 0.12, 0, 3);        // 高数值怪物优先（封顶，防压过构成）
    } else {
      if (POWER_ITEM_SET[cardId]) s += 2.5;                             // 强力道具优先
      if (isDrawCard(cardId)) s += 1.5;                                 // 过牌/检索优先
    }
    // 卡组构成修正（支配项）：怪物 ≈60~70%（取中值 63%）、其余 30~40%
    if (deck) {
      var mon = countMonsters(deck), items = deck.length - mon, draw = countDraw(deck);
      var targetMon = deck.length * 0.63;
      if (c.type === 'monster') s += clamp((targetMon - mon) * 7, -22, 22);
      else s += clamp(((deck.length - targetMon) - items) * 7, -22, 22);
      if (isDrawCard(cardId)) { if (draw < 3) s += 3; else if (draw > 5) s -= 1.5; }
      // 怪物档次配比（强权重）：B/C 50~60% / A 20~30% / S 10~20%
      if (c.type === 'monster') {
        var cur = { S: 0, A: 0, BC: 0 }, tot = 0;
        deck.forEach(function (id) {
          var x = CARDS[id]; if (!x || x.type !== 'monster') return; tot++;
          if (x.tier === 'S') cur.S++; else if (x.tier === 'A') cur.A++; else cur.BC++;
        });
        if (tot > 0) {
          var bucket = c.tier === 'S' ? 'S' : (c.tier === 'A' ? 'A' : 'BC');
          var have = cur[bucket] / tot;
          var after = (cur[bucket] + 1) / (tot + 1);                                 // 加入后的占比
          var MID = { S: 0.15, A: 0.25, BC: 0.54 }, HI = { S: 0.185, A: 0.29, BC: 0.585 }, LO = { S: 0.10, A: 0.20, BC: 0.50 };
          s += clamp((MID[bucket] - have) * 60, -10, 10);                            // 向区间中值微调
          if (after > HI[bucket]) s -= 22;                                          // 加入后会超上限 → 明显回避
          if (have < LO[bucket]) s += 18;                                           // 当前低于下限 → 明显优先
        }
      }
    }
    if (rng) s += rng() * 1.2;   // 种子扰动：不同届/不同选手成长有变化
    return s;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 基础亲和度（不含卡组构成与扰动）
  function affinity(cardId, arch) { return arch ? scoreCard(cardId, arch, buildProfile(arch), null, null) : 0; }
  function scoreOne(cardId, arch, deck) { return scoreCard(cardId, arch, buildProfile(arch), deck, null); }

  // 硬性构成上限/下限（选卡时直接过滤越界候选，保证最终构成落在规格内）
  var HARD = { monHi: 0.705, monLo: 0.595, sHi: 0.205, aHi: 0.305, bcHi: 0.605 };
  function addOk(deck, id) {
    var c = CARDS[id]; if (!c) return false;
    var isMon = c.type === 'monster';
    var tc = deckComposition(deck);
    var mon = tc.mon + (isMon ? 1 : 0);
    var n = deck.length + 1;
    // 容差 = "一张牌的占比"：小卡组里加任何一张都会让某档变动 ~5pp，
    // 若容差比这小就会把所有候选全判越界 → aiChoose 永远选不出牌（曾导致 AI 卡组冻结在 20 张）
    var mSlop = 1 / (n || 1);
    var r = mon / n;
    if (r > HARD.monHi + mSlop) return false;
    if (!isMon) return r >= HARD.monLo - mSlop;                 // 加道具不得把怪物占比拉低于限
    var t = mon || 1, bSlop = 1 / t;
    var bucket = c.tier === 'S' ? 'S' : (c.tier === 'A' ? 'A' : 'BC');
    var after = ((bucket === 'S' ? tc.S : bucket === 'A' ? tc.A : tc.BC) + 1) / t;
    var hi = { S: HARD.sHi, A: HARD.aHi, BC: HARD.bcHi }[bucket];
    return after <= hi + bSlop;
  }
  // 从候选里挑 k 张最贴合套路的卡（逐张择优 + 硬构成过滤：每选一张后用更新后的卡组重算）
  function aiChoose(candidates, arch, deck, k, rng) {
    if (!arch) return candidates.slice(0, k);
    var prof = buildProfile(arch);
    if (!deck) {
      return candidates.map(function (id) { return { id: id, sc: scoreCard(id, arch, prof, null, rng) }; })
        .sort(function (a, b) { return b.sc - a.sc; }).slice(0, k).map(function (x) { return x.id; });
    }
    var out = [], pool = candidates.slice(), cur = deck.slice();
    for (var i = 0; i < k && pool.length; i++) {
      var scored = pool.map(function (id) { return { id: id, sc: scoreCard(id, arch, prof, cur, rng) }; });
      scored.sort(function (a, b) { return b.sc - a.sc; });
      var pickId = null;
      for (var j = 0; j < scored.length; j++) { if (addOk(cur, scored[j].id)) { pickId = scored[j].id; break; } }
      if (pickId == null) break;                                 // 全部候选都会越界 → 本次不选
      out.push(pickId); cur.push(pickId);
      pool.splice(pool.indexOf(pickId), 1);
    }
    return out;
  }
  // 兼容旧调用
  function aiPick(candidates, arch, k) { return aiChoose(candidates, arch, null, k, null); }
  // 卡组中"最弱"的一张（满 30 后用于替换）
  function weakestIndex(deck, arch) {
    var prof = buildProfile(arch), best = -1, bestSc = Infinity;
    deck.forEach(function (id, i) { var sc = scoreCard(id, arch, prof, deck, null); if (sc < bestSc) { bestSc = sc; best = i; } });
    return best;
  }

  /* ---------------- 卡组构成校验 & 满 30 后的替换 ----------------
   * 构成是否达标：怪物 60~70%；怪物中 B/C 50~60% / A 20~30% / S 10~20%（默认 0.5% 容差）
   */
  function deckComposition(deck) {
    var mon = 0, S = 0, A = 0, BC = 0;
    deck.forEach(function (id) {
      var c = CARDS[id]; if (!c || c.type !== 'monster') return;
      mon++; if (c.tier === 'S') S++; else if (c.tier === 'A') A++; else BC++;
    });
    var n = deck.length || 1, t = mon || 1;
    return { n: deck.length, mon: mon, monR: mon / n, S: S, A: A, BC: BC, sR: S / t, aR: A / t, bcR: BC / t };
  }
  function compOk(deck) {
    var c = deckComposition(deck);
    if (c.n < Rules.DECK_START) return true;   // 启动期不约束
    var mS = 1 / (c.n || 1), bS = 1 / (c.mon || 1);   // 容差同样按"一张牌"计
    return c.monR >= HARD.monLo - mS && c.monR <= HARD.monHi + mS &&
      c.bcR <= HARD.bcHi + bS && c.aR <= HARD.aHi + bS && c.sR <= HARD.sHi + bS;
  }
  // 满 30 后的替换：候选明显更强、且"替换后构成仍达标"才执行（防止把怪物换成道具而失衡）
  function tryReplace(deck, arch, pool, rng) {
    var cand = aiChoose(pool, arch, deck, 1, rng)[0];
    if (!cand) return false;
    var idx = weakestIndex(deck, arch);
    if (idx < 0) return false;
    if (scoreOne(cand, arch, deck) <= scoreOne(deck[idx], arch, deck) + 3) return false;
    var trial = deck.slice(); trial.splice(idx, 1); trial.push(cand);
    if (!compOk(trial)) return false;
    deck.splice(idx, 1); deck.push(cand);
    return true;
  }

  // 卡组强度评估（用于 AI vs AI 模拟）
  function deckPower(deck) {
    var p = 0;
    deck.forEach(function (id) {
      var c = CARDS[id]; if (!c) return;
      if (c.type === 'monster') p += (c.atk || 0) * 1.4 + (c.hp || 0) * 0.5 + ({ C: 0, B: 2, A: 5, S: 8 }[c.tier] || 0);
      else if (c.type === 'weapon' || c.type === 'armor') p += 3;
      else if (c.type === 'wand') p += 2.5;
      else if (c.type === 'artifact') p += 2;
      else p += 1;
    });
    return p;
  }

  return {
    CUP_FIRST: CUP_FIRST, CUP_SECOND: CUP_SECOND,
    randomCupName: randomCupName,
    AI_NAMES: AI_NAMES,
    ARCHETYPES: ARCHETYPES,
    allIds: allIds, monsterIds: monsterIds,
    buildDeck: buildDeck, rewardPool: rewardPool,
    affinity: affinity, aiPick: aiPick, aiChoose: aiChoose,
    scoreOne: scoreOne, weakestIndex: weakestIndex, cardValue: cardValue, isDrawCard: isDrawCard,
    deckComposition: deckComposition, compOk: compOk, tryReplace: tryReplace,
    deckPower: deckPower
  };
})();