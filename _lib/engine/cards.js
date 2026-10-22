/* ============================================================
 * 《地牢决斗师-踏上征途》卡牌数据库  cards.js
 * 数据来源：策划案第九章「全卡牌数据表」（100 张，逐张转录）
 * 图片命名规则：缩略卡/《stem》.png ｜ 高清卡/《stem》详情.png
 *   注意：个别卡的文件名与卡名不一致（见 thumb/detail 覆盖字段）
 * 字段说明：
 *   id/name/type/tier/hp/atk/effect  卡面基础信息
 *   stem     图片文件名主干
 *   thumb/detail 图片路径覆盖（命名不一致时使用）
 *   maxCopies 卡组同名单卡上限
 *   upgradable 可被升级卷轴升级（武器/防具/法杖）
 *   equip    装备要求 {stat:'atk'|'hp', min:number}
 *   mods     装备/道具的结构化数值（供引擎直接使用）
 *   tags     怪物标签 💰/🍖/🫒/💎
 * ========================================================== */
import { Rules } from './rules.js';

export const CARD_LIST = [
  /* ---------------- C 级怪 ×22（含新卡 4） ---------------- */
  {id:'a-005-2', name:'大蜗牛', type:'monster', tier:'C', hp:6, atk:2, stem:'大蜗牛C', effect:'准备阶段开始时，该卡恢复6生命；该卡于战斗阶段中受到伤害-2。'},
  {id:'a-031-2', name:'战士', type:'monster', tier:'C', hp:8, atk:4, stem:'战士C', effect:'该卡从手牌召唤时，在手牌衍生一张【破损纹章】。'},
  {id:'a-034-2', name:'法师', type:'monster', tier:'C', hp:8, atk:4, stem:'法师C', effect:'该卡从手牌召唤时，在手牌衍生一张【老法杖】。'},
  {id:'a-037-2', name:'盗贼', type:'monster', tier:'C', hp:8, atk:4, stem:'盗贼C', effect:'该卡从手牌召唤时，在手牌衍生一张【暗影斗篷】。'},
  {id:'a-040-2', name:'女猎', type:'monster', tier:'C', hp:8, atk:4, stem:'女猎C', effect:'该卡从手牌召唤时，在手牌衍生一张【灵能弓】。'},
  {id:'a-002-2', name:'啮齿小鼠', type:'monster', tier:'C', hp:8, atk:3, stem:'啮齿小鼠C', detail:'卡牌/高清卡/啮齿小鼠详情.png', effect:'该卡从手牌召唤时，抽一张牌。', tags:['🍖']},
  {id:'a-003-2', name:'水道巨蛇', type:'monster', tier:'C', hp:5, atk:3, stem:'水道巨蛇C', effect:'该卡于战斗阶段中受到攻击时，50%概率触发【闪避】使伤害降为0。', tags:['🍖']},
  {id:'a-045-2', name:'食人鱼', type:'monster', tier:'C', hp:6, atk:4, stem:'食人鱼C', effect:'免疫【毒气】【酸气】；召唤于中位的回合无法被攻击。', tags:['🍖']},
  {id:'a-047-2', name:'金色蜜蜂', type:'monster', tier:'C', hp:8, atk:3, stem:'金色蜜蜂C', effect:'我方玩家生命＜30时，我方金色蜜蜂攻击+4。', tags:['🫒']},
  {id:'a-048-2', name:'喷毒花', type:'monster', tier:'C', hp:8, atk:3, stem:'喷毒花C', effect:'对位存在怪物且我方场上仅有此卡时，攻击+5；回合结束返回手牌。', tags:['🫒']},
  {id:'a-049-2', name:'繁花史莱姆', type:'monster', tier:'C', hp:8, atk:4, stem:'繁花史莱姆C', effect:'进入弃牌堆时，将卡组中随机一张“🫒”类怪物加入手牌。', tags:['🫒']},
  {id:'a-050-2', name:'蚱蜢', type:'monster', tier:'C', hp:8, atk:3, stem:'蚱蜢C', effect:'对方场上存在怪物时，攻击后对方玩家生命-3，并进入弃牌堆。', tags:['🫒']},
  {id:'a-056-2', name:'黄昏史莱姆', type:'monster', tier:'C', hp:6, atk:3, stem:'黄昏史莱姆C', effect:'进入弃牌堆时，对方玩家随机弃置一张手牌。', tags:['💰']},
  {id:'a-057-2', name:'血红史莱姆', type:'monster', tier:'C', hp:6, atk:3, stem:'血红史莱姆C', effect:'进入弃牌堆时，对方随机怪物生命-3。', tags:['💰']},
  {id:'a-075-2', name:'DM-100', type:'monster', tier:'C', hp:8, atk:2, stem:'DM100C', effect:'回合结束时，对一个非对位的随机敌方怪物卡造成5点伤害。', tags:['💎']},
  {id:'a-076-2', name:'怨灵', type:'monster', tier:'C', hp:1, atk:1, stem:'怨灵C', effect:'战斗阶段中无法被攻击。'},
  {id:'a-080-2', name:'腐烂触手', type:'monster', tier:'C', hp:8, atk:3, stem:'腐烂触手C', effect:'从场上进入弃牌堆时，对方叠加一层【毒气】并获得一层腐烂标记。', tags:['🫒']},
  {id:'a-073-2', name:'疯狂小偷', type:'monster', tier:'C', hp:8, atk:2, stem:'疯狂小偷C', effect:'对玩家攻击时，获得其一张手牌；回合结束返回手牌。', tags:['💰']},
  {id:'a-101-2', name:'吸血蝙蝠', type:'monster', tier:'C', hp:8, atk:3, stem:'吸血蝙蝠C', effect:'主动攻击后，自身与相邻的友方怪物恢复造成伤害的等量生命。', tags:['🍖']},
  {id:'a-102-2', name:'矿洞蜘蛛', type:'monster', tier:'C', hp:8, atk:1, stem:'矿洞蜘蛛C', effect:'主动攻击后，对方每有一层【毒气】，其场上怪物受到1点伤害。', tags:['🫒']},
  {id:'a-103-2', name:'赤狼萨满', type:'monster', tier:'C', hp:7, atk:2, stem:'赤狼萨满C', effect:'主动攻击后，使目标攻击-1。', tags:['💰']},
  {id:'a-104-2', name:'能源塔', type:'monster', tier:'C', hp:8, atk:0, stem:'能源塔C', effect:'准备阶段开始时，对对位怪物造成3点伤害，并使己方【💎】类怪物获得1点护盾。', tags:['💎']},

  /* ---------------- B 级怪 ×21（含新卡 3） ---------------- */
  {id:'a-004-2', name:'豺狼巡查', type:'monster', tier:'B', hp:10, atk:6, stem:'豺狼巡查B', effect:'该卡从手牌召唤时，弃置一张手牌，检索一张“💰”类怪物。', tags:['💰']},
  {id:'a-006-2', name:'丛林螃蟹', type:'monster', tier:'B', hp:10, atk:4, stem:'密林螃蟹B', effect:'该卡于战斗阶段中攻击后有50%概率触发【再攻击】，每回合触发一次。', tags:['🍖']},
  {id:'a-007-2', name:'苍蝇群', type:'monster', tier:'B', hp:10, atk:2, stem:'苍蝇群B', effect:'该卡生命＜6时，在我方空位衍生一张1血1攻的苍蝇群。', tags:['💰']},
  {id:'a-043-2', name:'活化石像', type:'monster', tier:'B', hp:10, atk:6, stem:'活化石像B', effect:'从手牌召唤时，检索一张武器。'},
  {id:'a-044-2', name:'白化小鼠', type:'monster', tier:'B', hp:10, atk:5, stem:'白化小鼠B', effect:'战斗阶段中攻击后，攻击的目标生命-2。', tags:['🍖']},
  {id:'a-046-2', name:'血色哨卫', type:'monster', tier:'B', hp:10, atk:0, stem:'血色哨卫B', effect:'准备阶段开始时，对随机敌方怪物卡造成8点伤害。', tags:['💰']},
  {id:'a-001-2', name:'宝箱怪', type:'monster', tier:'B', hp:10, atk:6, stem:'宝箱怪B', effect:'进入弃牌堆时，抽一张牌。', tags:['💰']},
  {id:'a-071-2', name:'骷髅', type:'monster', tier:'B', hp:10, atk:4, stem:'骷髅B', effect:'从场上进入弃牌堆时，对位怪物受到4伤害。', tags:['💰']},
  {id:'a-032-2', name:'战士', type:'monster', tier:'B', hp:10, atk:7, stem:'战士B', effect:'该卡于战斗阶段中受到伤害-1。'},
  {id:'a-035-2', name:'法师', type:'monster', tier:'B', hp:10, atk:4, stem:'法师B', effect:'该卡在我方场上时，每回合施法次数+1。'},
  {id:'a-038-2', name:'盗贼', type:'monster', tier:'B', hp:10, atk:5, stem:'盗贼B', effect:'若该卡无法被攻击，则该卡下一次攻击造成的伤害+3。'},
  {id:'a-041-2', name:'女猎', type:'monster', tier:'B', hp:10, atk:6, stem:'女猎B', effect:'该卡在场，且手牌存在【投掷物】，则抽一张牌，每回合触发一次。'},
  {id:'a-072-2', name:'监狱守卫', type:'monster', tier:'B', hp:10, atk:4, stem:'监狱守卫B', effect:'从手牌召唤上场时，将对方场上随机一张怪物卡移动至自己的对位，并立刻攻击其一次。'},
  {id:'a-078-2', name:'招魂法师', type:'monster', tier:'B', hp:10, atk:0, stem:'招魂法师B', effect:'准备阶段开始时，在己方空位衍生一张【怨灵】。'},
  {id:'a-079-2', name:'死灵法师', type:'monster', tier:'B', hp:10, atk:0, stem:'死灵法师B', effect:'准备阶段开始时，若己方场上没有【骷髅】，则在随机空位衍生一张；否则己方【骷髅】攻击+1。'},
  {id:'a-051-2', name:'深蓝蝾螈', type:'monster', tier:'B', hp:10, atk:5, stem:'深蓝蝾螈B', effect:'回合结束时在场上则返回手牌，这张卡攻击+1。', tags:['🫒']},
  {id:'a-052-2', name:'纯晶元素', type:'monster', tier:'B', hp:10, atk:0, stem:'纯晶元素B', effect:'战斗阶段攻击时，对方玩家随机一张手牌中的怪物返回卡组。', tags:['🫒']},
  {id:'a-054-2', name:'魔化藤', type:'monster', tier:'B', hp:10, atk:3, stem:'魔化藤B', effect:'准备阶段开始时，对方叠加一层【毒气】。', tags:['🫒']},
  {id:'a-105-2', name:'豺狼暴徒', type:'monster', tier:'B', hp:10, atk:4, stem:'豺狼暴徒B', effect:'这张卡生命＜4时，获得4点护盾并且攻击+3。', tags:['💰']},
  {id:'a-106-2', name:'青狼萨满', type:'monster', tier:'B', hp:10, atk:2, stem:'青狼萨满B', effect:'主动攻击后，若目标减伤＞1，其减伤-1。', tags:['💰']},
  {id:'a-107-2', name:'DM-200', type:'monster', tier:'B', hp:10, atk:3, stem:'DM-200B', effect:'从手牌召唤上场时，对方叠加2层【毒气】，并令其场上所有怪物受到1点伤害。', tags:['💎']},

  /* ---------------- A 级怪 ×11（含新卡 3） ---------------- */
  {id:'a-008-2', name:'巨钳蟹', type:'monster', tier:'A', hp:11, atk:5, stem:'巨钳蟹A', effect:'该卡于战斗阶段中仅受到一次伤害。'},
  {id:'a-009-2', name:'腐臭老鼠', type:'monster', tier:'A', hp:14, atk:6, stem:'腐臭老鼠A', effect:'准备阶段开始时，若该卡在场，则对方玩家生命-1。', tags:['🍖']},
  {id:'a-010-2', name:'豺狼猎手', type:'monster', tier:'A', hp:14, atk:6, stem:'豺狼猎手A', effect:'该卡从手牌召唤时，检索两张投掷物。', tags:['💰']},
  {id:'a-074-2', name:'疯狂强盗', type:'monster', tier:'A', hp:14, atk:5, stem:'疯狂强盗A', effect:'对怪物/玩家攻击时，获得其一张装备/手牌；攻击后向右移动一位，无法移动时返回手牌。', tags:['💰']},
  {id:'a-081-2', name:'腐烂之心', type:'monster', tier:'A', hp:14, atk:6, stem:'腐烂之心A', effect:'从手牌召唤上场时，当前每有两层腐烂标记，对手受到【毒气】伤害+1，然后清空腐烂标记。', tags:['🫒']},
  {id:'a-082-2', name:'新生火元素', type:'monster', tier:'A', hp:14, atk:6, stem:'新生火元素A', effect:'准备阶段开始时，对方场上每有一只怪物，对方场上所有怪物生命-1。', tags:['🫒']},
  {id:'a-053-2', name:'绿野精灵', type:'monster', tier:'A', hp:16, atk:8, stem:'绿野精灵A', effect:'纯粹的强大。', tags:['🫒']},
  {id:'a-077-2', name:'咒缚灵', type:'monster', tier:'A', hp:1, atk:4, stem:'咒缚灵A', effect:'进入弃牌堆时，检索一张武器；由【怨灵】进化时，继承其技能。'},
  {id:'a-108-2', name:'重甲暴徒', type:'monster', tier:'A', hp:14, atk:4, stem:'重甲暴徒A', effect:'这张卡生命＜6时，获得4点护盾，并且攻击+5。', tags:['💰']},
  {id:'a-109-2', name:'紫狼萨满', type:'monster', tier:'A', hp:14, atk:2, stem:'紫狼萨满A', effect:'主动攻击后，使目标攻击-1；若其减伤＞1，则其减伤-1。', tags:['💰']},
  {id:'a-110-2', name:'DM-201', type:'monster', tier:'A', hp:14, atk:3, stem:'DM-201A', effect:'主动攻击后，对方叠加3层【酸气】。', tags:['💎']},

  /* ---------------- S 级怪 ×6（含新卡 1） ---------------- */
  {id:'a-058-2', name:'鼠王', type:'monster', tier:'S', hp:18, atk:5, stem:'鼠王S', effect:'准备阶段开始时，在手牌衍生一张神秘宝箱与一张名字含“鼠”的怪物。'},
  {id:'a-011-2', name:'水道螃蟹EX', type:'monster', tier:'S', hp:20, atk:5, stem:'水道螃蟹S', effect:'该卡于战斗阶段中攻击后有50%概率触发【再攻击】。'},
  {id:'a-012-2', name:'黏咕', type:'monster', tier:'S', hp:20, atk:6, stem:'黏咕S', effect:'该卡生命≤10时，对敌方场上所有怪物卡造成10点伤害。', tags:['💰']},
  {id:'a-083-2', name:'天狗', type:'monster', tier:'S', hp:15, atk:4, stem:'天狗S', effect:'回合结束时或受到伤害时，移动至我方随机空位，并在手牌衍生1张【苦无】；移动时攻击+1、生命+1。', tags:['💰']},
  {id:'a-055-2', name:'克里弗斯之果', type:'monster', tier:'S', hp:20, atk:6, stem:'克里弗斯之果S', effect:'受到主动攻击时，对方叠加两层【毒气】；我方场上每有一张“🫒”类怪物，额外加一层。', tags:['🫒']},
  {id:'a-111-2', name:'DM-300', type:'monster', tier:'S', hp:20, atk:6, stem:'DM-300S', effect:'从手牌召唤上场时，令对手的【毒气】与【酸气】层数翻倍；主动攻击时，令非目标的敌方怪物卡受到6点伤害。', tags:['💎']},

  /* ---------------- 典藏系列 ×6 ---------------- */
  {id:'a-95-2', name:'蕾零安洁', type:'monster', tier:'A', hp:14, atk:7, stem:'蕾零安洁A典藏', effect:'战斗阶段中，击杀敌方怪物后进行【再攻击】。'},
  {id:'a-96-2', name:'茉莉伊洛', type:'monster', tier:'A', hp:14, atk:4, stem:'茉莉伊洛A典藏', effect:'准备阶段中，每使用一次法杖，获得2点护盾。'},
  {id:'a-97-2', name:'极影铃虹', type:'monster', tier:'A', hp:14, atk:5, stem:'极影铃虹A典藏', effect:'准备阶段使用卷轴卡后，持续一回合无法被攻击（仅能发动3次）。'},
  {id:'a-98-2', name:'姬莲梅錵', type:'monster', tier:'A', hp:14, atk:6, stem:'姬莲梅錵A典藏', effect:'每使用一张投掷物卡，这张卡恢复5点生命。'},
  {id:'a-99-2', name:'碧灰双刃', type:'weapon', stem:'碧灰双刃典藏', effect:'准备阶段为一只怪物装备，攻击后30%概率对目标造成4点额外伤害。', upgradable:true, equip:{stat:'atk', min:0}, mods:{atkBonus:0, procChance:0.3, procDmg:4, upgrade:[{procChance:0.5},{procChance:1.0}]}},
  {id:'a-100-2', name:'澪', type:'monster', tier:'S', hp:20, atk:0, stem:'澪S典藏', thumb:'卡牌/缩略卡/lingSdaincang.png', effect:'攻击后对目标造成7点伤害；这张卡首次从场上进入弃牌堆后复活并恢复至10点生命。'},

  /* ---------------- 宝藏 ×4 ---------------- */
  {id:'a-013-2', name:'神秘宝箱', type:'treasure', stem:'神秘宝箱', effect:'准备阶段时使用该卡，抽两张牌。', mods:{draw:2}},
  {id:'a-014-2', name:'黄金宝箱', type:'treasure', stem:'黄金宝箱', effect:'准备阶段时使用该卡，弃置一张手牌，抽三张牌。', mods:{draw:3, discard:1}},
  {id:'a-060-2', name:'补给箱', type:'treasure', stem:'补给箱', effect:'准备阶段时使用，将卡组中随机一张食物/药水/卷轴卡加入手牌。'},
  {id:'a-085-2', name:'遗骸', type:'treasure', stem:'遗骸', effect:'准备阶段时使用，抽一张牌，并50%概率在手牌衍生一张【怨灵】。'},
  {id:'a-033-2', name:'破损纹章', type:'treasure', stem:'破损纹章', effect:'准备阶段时对一张防具卡使用，其减伤能力+1（同一防具最多 1 张）；若其等级＞0，进入弃牌堆时在手牌衍生【升级卷轴】。'},
  {id:'a-113-2', name:'水晶宝箱', type:'treasure', stem:'水晶宝箱', effect:'准备阶段时使用，将卡组中随机一张法杖/戒指卡加入手牌。'},

  /* ---------------- 投掷物 ×5 ---------------- */
  {id:'a-015-2', name:'飞刀', type:'throw', stem:'飞刀', effect:'准备阶段时对一张敌方怪物卡使用，对其造成2点伤害。', mods:{dmg:2}},
  {id:'a-016-2', name:'苦无', type:'throw', stem:'苦无', effect:'准备阶段时对一张敌方怪物卡使用，对其造成3点伤害。', mods:{dmg:3}},
  {id:'a-061-2', name:'飞斧', type:'throw', stem:'飞斧', effect:'准备阶段时对一张敌方怪物卡使用，对其造成4点伤害。', mods:{dmg:4}},
  {id:'a-086-2', name:'炸弹', type:'throw', stem:'炸弹', effect:'准备阶段时对一张敌方怪物卡使用，你的下一个准备阶段开始时，对其原位置及其十字方向造成6点伤害。'},
  {id:'a-114-2', name:'回旋镖', type:'throw', stem:'回旋镖', effect:'准备阶段时对一张敌方怪物卡使用，对其造成1点伤害；你的下一个回合开始时，这张卡返回手牌。', mods:{dmg:1, returnToHand:true}},

  /* ---------------- 食物 ×5 ---------------- */
  {id:'a-017-2', name:'口粮', type:'food', stem:'口粮', effect:'准备阶段时使用该卡，玩家恢复3点生命。', mods:{healPlayer:3}},
  {id:'a-018-2', name:'露珠', type:'food', stem:'露珠', effect:'准备阶段时使用该卡，玩家恢复6点生命；若回合结束时存于手牌，则进入弃牌堆。', mods:{healPlayer:6}},
  {id:'a-084-2', name:'炖肉', type:'food', stem:'炖肉', effect:'准备阶段时使用，己方场上随机一张怪物恢复4点生命，且攻击+1。'},
  {id:'a-059-2', name:'肉馅饼', type:'food', stem:'肉馅饼', effect:'准备阶段时使用，己方场上所有怪物与玩家恢复4点生命。'},
  {id:'a-112-2', name:'全肉大饼', type:'food', stem:'全肉大饼', effect:'准备阶段时使用，丢弃手牌中一张【肉馅饼】，己方所有怪物攻击+2；若手牌中没有【肉馅饼】，己方场上所有怪物仅恢复4点生命。'},

  /* ---------------- 药水 ×5 ---------------- */
  {id:'a-019-2', name:'治疗药水', type:'potion', stem:'治疗药水', effect:'准备阶段时使用该卡，我方场上所有怪物卡恢复10点生命。', mods:{healMonsters:10}},
  {id:'a-020-2', name:'力量药水', type:'potion', stem:'力量药水', effect:'准备阶段时使用该卡，我方场上所有怪物卡攻击+1。', mods:{buffAtkAll:1}},
  {id:'a-062-2', name:'冰霜药水', type:'potion', stem:'冰霜药水', effect:'准备阶段使用，对方下一回合召唤次数-1。'},
  {id:'a-087-2', name:'疾速药水', type:'potion', stem:'疾速药水', effect:'准备阶段使用，本回合召唤次数+1（首回合使用无效果）。'},
  {id:'a-115-2', name:'毒气药水', type:'potion', stem:'毒气药水', effect:'准备阶段时使用，对方叠加3层【毒气】。', mods:{poisonStacks:3}},

  /* ---------------- 法杖 ×5 ---------------- */
  {id:'a-021-2', name:'魔弹法杖', type:'wand', stem:'魔弹法杖', effect:'准备阶段时使用该卡：弃置一张手牌，对场上一张敌方怪物卡造成3点伤害。', upgradable:true, mods:{dmg:3, upgrade:[{dmg:5}]}},
  {id:'a-036-2', name:'老法杖', type:'wand', stem:'老法杖', effect:'已装备的该卡可灌注其余法杖，灌注后继承其能力并提升法杖等级；该卡在我方场上时，每回合施法次数+1。'},
  {id:'a-067-2', name:'焰浪法杖', type:'wand', stem:'焰浪法杖', effect:'准备阶段时使用该卡，弃置一张手牌，弃置对方1张手牌。', upgradable:true, mods:{discardEnemy:1, upgrade:[{discardEnemy:2}]}},
  {id:'a-068-2', name:'解离法杖', type:'wand', stem:'解离法杖', effect:'准备阶段时使用，弃置一张手牌，从左至右依次对敌方怪物穿透造成2点伤害，每次穿透额外增加2点伤害。', upgradable:true, mods:{pierce:2, pierceStep:2, upgrade:[{pierceStep:4}]}},
  {id:'a-091-2', name:'冲击波法杖', type:'wand', stem:'冲击波法杖', effect:'准备阶段时使用，弃置一张手牌，对场上的一张怪物卡造成2点伤害并向右移动一位。', upgradable:true, mods:{dmg:2, upgrade:[{dmg:4}]}},

  /* ---------------- 陷阱 ×4 ---------------- */
  {id:'a-022-2', name:'麻痹陷阱', type:'trap', stem:'麻痹陷阱', effect:'若对方进入战斗阶段，该卡在手牌则立刻发动，结束对方回合。'},
  {id:'a-064-2', name:'召唤陷阱', type:'trap', stem:'召唤陷阱', effect:'对方召唤怪物后，这张卡在手牌则立即发动，将手牌中的一张C级怪物召唤至己方随机空位上。'},
  {id:'a-089-2', name:'毒气陷阱', type:'trap', stem:'毒气陷阱', effect:'对方召唤怪物后，若这张卡在手牌，则立即发动，对方叠加3层【毒气】。'},
  {id:'a-117-2', name:'爆炸陷阱', type:'trap', stem:'爆炸陷阱', effect:'对方召唤怪物时，若这张卡在手牌则立即发动，对该怪物造成8点伤害。', mods:{dmg:8}},

  /* ---------------- 戒指 ×4 ---------------- */
  {id:'a-023-2', name:'财富戒指', type:'ring', stem:'财富戒指', effect:'准备阶段时，该卡在手牌则额外抽一张牌。'},
  {id:'a-065-2', name:'极速戒指', type:'ring', stem:'极速戒指', effect:'准备阶段开始时，若这张卡在手牌，则将手牌中随机一张C级怪物召唤。'},
  {id:'a-066-2', name:'狂怒戒指', type:'ring', stem:'狂怒戒指', effect:'准备阶段开始时，若这张卡在手牌，则己方场上随机一张B级怪物攻击次数+1。'},
  {id:'a-090-2', name:'神射戒指', type:'ring', stem:'神射戒指', effect:'这张卡在手牌时，每打出三张投掷物卡，从弃牌堆随机选中一张投掷物卡返回手牌。'},

  /* ---------------- 神器 ×4 ---------------- */
  {id:'a-024-2', name:'丰饶号角', type:'artifact', stem:'丰饶号角', effect:'准备阶段时，每使用一张食物卡，可以抽取一张牌。', maxCopies:1},
  {id:'a-070-2', name:'先见护符', type:'artifact', stem:'先见护符', effect:'若对方手牌含有陷阱卡，这张卡将红光提示；准备阶段开始时，若己方场上怪物数＞1，随机弃置一张对方手牌中的陷阱卡。', maxCopies:1},
  {id:'a-094-2', name:'虚空锁链', type:'artifact', stem:'虚空锁链', effect:'准备阶段限一次，将场上任意一只怪物移动至其场上空位。', maxCopies:1},
  {id:'a-120-2', name:'时光沙漏', type:'artifact', stem:'时光沙漏', effect:'准备阶段使用：直到你的下回合开始前，双方无法使用投掷物与法杖，场上所有怪物无法攻击；使用后冷却6回合。', mods:{cooldown:6}, maxCopies:1},

  /* ---------------- 武器 ×5 + 衍生2 ---------------- */
  {id:'a-025-2', name:'短剑', type:'weapon', stem:'短剑', effect:'准备阶段时为一只怪物装备，其攻击+1。【装备要求：怪物攻击力≥3】', upgradable:true, equip:{stat:'atk', min:3}, mods:{atkBonus:1, upgrade:[{atkBonus:2},{atkBonus:4}]}},
  {id:'a-093-2', name:'长矛', type:'weapon', stem:'长矛', effect:'准备阶段时为一只怪物装备；对非对位怪物攻击后，对其造成1点伤害。【装备要求：怪物攻击力≥5】', upgradable:true, equip:{stat:'atk', min:5}, mods:{atkBonus:0, splash:1, upgrade:[{splash:2},{splash:4}]}},
  {id:'a-069-2', name:'镶钉手套', type:'weapon', stem:'镶钉手套', effect:'准备阶段时为一只怪物装备，其攻击+1；自战斗阶段开始时20%概率抽一张牌。【装备要求：怪物攻击力≥1】', upgradable:true, equip:{stat:'atk', min:1}, mods:{atkBonus:1, procChance:0.2, upgrade:[{procChance:0.5},{procChance:1.0}]}},
  {id:'a-042-2', name:'灵能弓', type:'weapon', stem:'灵能弓', effect:'准备阶段时为一只怪物装备；抽牌时，该卡对一张随机的敌方怪物卡造成1点伤害。【装备要求：怪物攻击力≥0】', equip:{stat:'atk', min:0}, mods:{atkBonus:0, onDrawDmg:1}},
  {id:'a-119-2', name:'硬头锤', type:'weapon', stem:'硬头锤', effect:'准备阶段时为一只怪物装备，其攻击+2。【装备要求：怪物攻击力≥5】', upgradable:true, equip:{stat:'atk', min:5}, mods:{atkBonus:2, upgrade:[{atkBonus:3},{atkBonus:5}]}},

  /* ---------------- 防具 ×6 + 衍生1 ---------------- */
  {id:'a-026-2', name:'圆盾', type:'armor', stem:'圆盾', effect:'准备阶段时为一只怪物装备：其攻击+1，战斗阶段受到伤害-1。【装备要求：怪物攻击力≥3】', upgradable:true, equip:{stat:'atk', min:3}, mods:{atkBonus:1, dmgReduce:1, upgrade:[{atkBonus:2, dmgReduce:1},{atkBonus:3, dmgReduce:2}]}},
  {id:'a-027-2', name:'布甲', type:'armor', stem:'布甲', effect:'准备阶段时为一只怪物装备，其战斗阶段受到伤害-1。【装备要求：怪物血量上限≥6】', upgradable:true, equip:{stat:'hp', min:6}, mods:{dmgReduce:1, upgrade:[{dmgReduce:2},{dmgReduce:3}]}},
  {id:'a-028-2', name:'皮甲', type:'armor', stem:'皮甲', effect:'准备阶段时为一只怪物装备，其战斗阶段受到伤害-2。【装备要求：怪物血量上限≥10】', upgradable:true, equip:{stat:'hp', min:10}, mods:{dmgReduce:2, upgrade:[{dmgReduce:3},{dmgReduce:4}]}},
  {id:'a-092-2', name:'链甲', type:'armor', stem:'链甲', effect:'准备阶段时为一只怪物装备，其战斗阶段受到伤害-1。【装备要求：怪物血量上限≥14】', upgradable:true, equip:{stat:'hp', min:14}, mods:{dmgReduce:1, upgrade:[{dmgReduce:3},{dmgReduce:5}]}},
  {id:'a-039-2', name:'暗影斗篷', type:'armor', stem:'暗影斗篷', effect:'准备阶段时为一只怪物装备，在你的下个回合开始前，该怪物无法被攻击。【装备要求：任意怪物】', equip:{stat:'hp', min:0}, mods:{untargetable:true}},
  {id:'a-118-2', name:'鳞甲', type:'armor', stem:'鳞甲', effect:'准备阶段时为一只怪物装备，其战斗阶段受到伤害-1。【装备要求：怪物血量上限≥15】', upgradable:true, equip:{stat:'hp', min:15}, mods:{dmgReduce:1, upgrade:[{dmgReduce:4},{dmgReduce:6}]}},

  /* ---------------- 卷轴 ×5 ---------------- */
  {id:'a-029-2', name:'升级卷轴', type:'scroll', stem:'升级卷轴', effect:'准备阶段时对装备或法杖使用，其等级+1。'},
  {id:'a-030-2', name:'传送卷轴', type:'scroll', stem:'传送卷轴', effect:'准备阶段时使用该卡，弃置所有手牌，抽四张牌。', mods:{discardAll:true, draw:4}},
  {id:'a-063-2', name:'催眠卷轴', type:'scroll', stem:'催眠卷轴', effect:'准备阶段时使用，你的下回合开始前，场上所有怪物无法攻击。'},
  {id:'a-088-2', name:'盛怒卷轴', type:'scroll', stem:'盛怒卷轴', effect:'准备阶段时使用，场上所有怪物立即受到一次场上随机怪物的力量的伤害。'},
  {id:'a-116-2', name:'镜像卷轴', type:'scroll', stem:'镜像卷轴', effect:'准备阶段时对一张我方怪物使用，在我方随机空位衍生一张同名怪物（攻击与本体相同、生命为1）；复制体继承本体的装备与状态，但镜像带来的装备在其离开场上时直接消失。'}
];

/* ---------- 建立索引 & 图片路径工具 ---------- */
export const CARDS = {};
CARD_LIST.forEach(function (c) {
  if (!c.maxCopies) c.maxCopies = (c.type === 'artifact') ? Rules.ARTIFACT_MAX
    : (c.type === 'monster' ? (Rules.TIER_MAX[c.tier] || 4) : Rules.ITEM_MAX);
  if (c.type === 'monster' && c.upgradable === undefined) c.upgradable = false;
  CARDS[c.id] = c;
});

// 缩略卡路径（手牌显示，130×182 NEAREST）
export function cardThumb(c) { return c.thumb || ('卡牌/缩略卡/' + c.stem + '.png'); }
// 高清卡路径（悬停右侧大图）
export function cardDetail(c) { return c.detail || ('卡牌/高清卡/' + c.stem + '详情.png'); }
export function cardImg(c) { return cardThumb(c); }
export function getCard(id) { return CARDS[id]; }