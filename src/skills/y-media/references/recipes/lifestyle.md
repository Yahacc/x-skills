# recipes/lifestyle.md · 生活 / 质感 / 氛围

> **路由触发**:brief 含以下关键词时加载本文件
> 早安 · 咖啡 · 家居 · 阅读 · 旅行 · 节日 · 仪式感 · 圣诞 · 新年 · 生日 · 慢生活 · vlog

---

## 1. 板块共性

- **日常美学 + 慢生活 + 治愈;无戏剧冲突**
- **首选骨架**:骨架 B 慢切(5-7 镜,单镜 2.5-4.0s)
- **视听路线**:无字幕或极简 OS
- **叙事禁区**:戏剧冲突/商业感/过度精致广告化
- **美学母体**:暖光系(米白/原木/奶咖/苔绿),色温 3000-4500K,胶片/复古质感

## 1.5 风格调色板(L4 · 必选 1 个)

> brief 不强制要求时,AI 在本表**选 1 个 anchor**。

| 锚点 | 关键词 | 适合 | 视觉+音频特征 |
| --- | --- | --- | --- |
| **A · 晨光日常** | 暖光 · 慢节奏 · 私语 | 早安/咖啡/家居/独处 | 侧窗光 4000K / 暖民谣 65-90 / 微动作密集 |
| **B · 节日仪式感** | 暖灯 · 装饰 · 团聚 | 圣诞/新年/生日/纪念日 | 暖灯串 3000K / 钢琴+钟琴 / 仪式微动作 |
| **C · 旅行发现** | 自然光 · 街景 · 好奇 | 旅行随拍/慢游/Vlog | 黄金时刻 3500K / 清新民谣 90-110 / 移动视角 |

**多样性预算**:一次 brief 选 1 个 anchor;若 brief 跨 2 类(如"圣诞旅行"),可 A+B 混用,但每镜必须明确属于哪类。

## 2. 四大子场景差异

### 2.1 晨间日常(咖啡/晨光)

- **光影**:侧窗光 4000K 光比 2:1 / 晨光 3500K 金色侧光
- **音频**:暖民谣 65-90BPM / 钢琴独奏 60-80
- **7s 高潮**:蒸汽升腾 / 咖啡注入 / 阳光斜入光斑
- **3+1 真实环境**:木质餐桌 / 棉麻桌布 / 陶瓷杯具 + 一束小花/绿植

### 2.2 家居氛围(阅读/独处)

- **光影**:暖台灯 3000K / 侧窗漫射 4500K
- **音频**:钢琴独奏 / 雨声白噪音 / 暖民谣
- **7s 高潮**:翻页光斑移动 / 猫咪跳上沙发 / 烛光摇曳
- **3+1 真实环境**:实木书架 / 旧皮革沙发 / 编织毛毯 + 窗光/暖灯

### 2.3 慢生活 / 旅行随拍

- **光影**:黄金时刻 3500K / 阴天漫射 6000K
- **音频**:清新民谣 / 旅行 vlog BGM
- **7s 高潮**:列车窗景流光 / 街角转角光影 / 远眺地平线
- **3+1 真实环境**:异国街角 / 复古小店 / 暖光路灯 + 手提物件

### 2.4 节日 / 仪式感(圣诞/新年/生日)

- **光影**:暖灯串 3000K / 烛光 2500K / 窗光
- **音频**:钢琴 + 钟琴 / 节日民谣
- **7s 高潮**:礼物拆开 / 烛光点燃 / 雪花飘落
- **3+1 真实环境**:暖灯串 / 蜡烛 / 装饰物 + 木质桌面/壁炉

## 3. 视听默认(一句话)

- **音频皮肤**:暖民谣(65-90BPM) / 钢琴独奏(60-80) / 纯环境音
- **字幕默认**:**不用**;节日/教学类可加极简 OS 字幕(≤2 条)
- **美学母体**:暖光系(米白/原木/奶咖/苔绿),色温 3000-4500K,胶片颗粒质感

## 4. prompt 模板片段(本场景常用)

**主体描述**(从 M1 §1 提炼):

- 咖啡: `A cup of [type] coffee on a wooden table, steam rising slowly, soft window light from the side, gentle morning mood`
- 书本: `An open book with cream-colored pages, gentle hand turning pages, warm lamp light, quiet room atmosphere`
- 家居: `A cozy living room with a linen sofa, woven blanket, warm lamp, soft afternoon light filtering through curtains`
- 节日: `A wooden table with candles flickering, gift boxes wrapped in kraft paper, warm string lights, festive mood`

**光影句**(暖光治愈,数字留 §4 声场设计稿):
```
Warm tungsten key light from a single source,
low contrast, soft diffusion, gentle window light from side,
no hard shadows, no high contrast
```

**运动句**(慢生活):
```
Subtle slow motion (1/2x speed), micro-actions only:
[steam rises slowly / page turns / candle flame flickers / light shifts],
no fast motion, no whip pans, contemplative pacing
```

## 5. 反模式(本场景专属)

| 反模式 | 症状 | 修复 |
| --- | --- | --- |
| 棚拍感 | 纯色背景空盒子 | 3+1 真实家居环境(见 §2) |
| 商业过载 | 像广告片 | 降饱和 -5,加生活痕迹(杯渍/折痕) |
| 戏剧冲突 | 突然插入矛盾 | 改平静微动,只留微动作 |
| 光影闪烁 | 跨镜色温跳变 | 锁单一光源方向,跨镜 ≤300K |
| 节日过度精致 | 灯串太亮太密 | 加 `gentle glow, not overwhelming` |

## 6. examples 入口

> 输出格式全局统一,完整可工作示例仅一份:[C4-example.md](../library/C4-example.md)(骨架 B 完整示范,已标 [MUST-KEEP] / [CAN-ROTATE] L5 分层)。本场景节日/旅行锚点直接套 §1.5 按同一格式自主生成,不另开 example。
