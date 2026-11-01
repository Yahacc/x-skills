# recipes/food.md · 美食 / ASMR

> **路由触发**:brief 含以下关键词时加载本文件
> 烹饪 · 成品 · 摆盘 · 拉花 · 饮品 · 鲜食 · ASMR · 食欲 · 食物

---

## 1. 板块共性

- **感官细节 + 质地纹理 + 治愈食欲;近景/特写为主**
- **首选骨架**:骨架 A 快切(切/倒/咬,9-12 镜,1.0-2.0s) / ASMR 极慢(3-5 镜,3-5s)
- **视听路线**:无字幕或极简;ASMR 无字幕
- **美学母体**:暖食欲(暖金/焦糖/奶白/番茄红),色温 3000-4500K

## 1.5 风格调色板(L4 · 必选 1 个)

> 美食 4 个 anchor 物理上互斥(慢/快、有无 BGM、远近景),选错 = 全视频垮。

| 锚点 | 关键词 | 适合 | 视觉+音频特征 |
| --- | --- | --- | --- |
| **A · 烹饪嗞啦** | 快切 · 油光 · 烟火气 | 烹饪过程/开箱/教程 | 骨架 A 快切 1.0-2.0s / 无 BGM 纯烹饪音 / 微距 |
| **B · 极慢 ASMR** | 微距 · 拟声词 · 暗背景 | 撕包装/切开/咀嚼 | 极慢 1/4x / 无 BGM / 暗背景 + 单束顶光 |
| **C · 摆盘仪式** | 360° · 钢琴 · 仪式 | 成品展示/高端甜品 | 骨架 B 慢 / 钢琴 60-80 / 360° 旋转 + 拉丝 |
| **D · 拉花治愈** | 蒸汽 · 木吉他 · 温暖 | 饮品/咖啡/拉花 | 骨架 B / 木吉他+钟琴 90-110 / 蒸汽 + 拉花瞬间 |

**多样性预算**:A 与 C/D 互斥(快 vs 慢);A+B 同视频罕见(节奏跳变);一次 brief 选 1。

## 2. 四大子场景差异

### 2.1 烹饪过程(嗞啦声向)

- **光影**:顶光 4000K 柔光 / 厨房暖光 3000K
- **音频**:无 BGM(纯烹饪音) / 暖民谣极淡
- **7s 高潮**:油嗞啦 / 切面展开 / 蒸汽升腾
- **3+1 真实环境**:木质砧板 / 铸铁锅 / 陶瓷碗 + 蒸汽/油光

### 2.2 成品展示(摆盘向)

- **光影**:顶光 4500K 柔光 / 侧窗 4000K
- **音频**:钢琴独奏 / 无 BGM
- **7s 高潮**:360° 旋转 / 蒸汽升腾 / 拉丝/拉花
- **3+1 真实环境**:木质餐桌 / 亚麻桌布 / 餐具 + 鲜花/绿植

### 2.3 ASMR / 极慢感官

- **光影**:顶光柔光 4500K / 环形灯 5000K
- **音频**:**无 BGM**,纯环境音
- **7s 高潮**:撕包装 / 切开 / 咀嚼 / 滴落
- **3+1 真实环境**:微距主体 + 一束顶光 + 暗背景

### 2.4 饮品 / 拉花

- **光影**:顶光 4500K 柔光 / 侧窗 4000K
- **音频**:钢琴独奏 / 暖民谣
- **7s 高潮**:拉花成型 / 蒸汽升腾 / 注入瞬间
- **3+1 真实环境**:陶瓷杯 / 木质托盘 / 拉花缸 + 暖光

## 3. 视听默认(一句话)

- **音频皮肤**:钢琴独奏 / 暖民谣 / 纯烹饪音无 BGM
- **字幕默认**:**不用**;成品讲解/教程类可加极简(品类名+温度)
- **美学母体**:暖食欲(暖金/焦糖/奶白/番茄红),色温 3000-4500K

## 4. prompt 模板片段(本场景常用)

**主体描述模板**:

- 通用菜: `A [size] [dish name] on a [plate type], with [garnish], [lighting], [micro-action: steam rising slowly]`
- 烘焙: `A [size] [baked good] with [texture: golden crust / soft crumb], on a wooden board, warm light`
- 饮品: `A [type] drink in a [cup] with [topping: latte art / foam], steam rising, soft window light`
- ASMR: `A close-up of [object], with [micro-action: tearing / pouring / cutting], under top key light, dark background`

**光影句**(美食特写,数字留 §4 声场设计稿):
```
Top key light at 30° from camera, soft gentle fill from side,
no harsh shadows, natural food texture, slight steam particles in light
```

**运动句**(微距慢镜):
```
Macro close-up with shallow depth of field, slow 1/2x speed motion,
[sizzling oil / steam rising / knife slicing / pouring slowly],
single continuous action, no jump cuts
```

## 5. 反模式(本场景专属)

| 反模式 | 症状 | 修复 |
| --- | --- | --- |
| 食物变形 | 食物中间塌陷/拉长 | 加 `food keeps natural shape, no deformation` |
| 塑料感 | 颜色过饱和/反光异常 | 降饱和 -5,加 `natural food texture` |
| 火焰异常 | 厨房火苗突变 | 简化,不写明火,改写"蒸汽升腾" |
| 餐具穿模 | 刀叉穿过食物 | 简化餐具,或避免与食物同镜 |
| ASMR 失焦 | 主体模糊 | 浅景深但主体对焦明确,加 `main subject in sharp focus` |
| 跨镜主体突变 | 同样一道菜换盘换色 | 锁主体外观(餐具+摆盘+色系) |

## 6. examples 入口

> 输出格式全局统一,完整可工作示例仅一份:[C4-example.md](../library/C4-example.md)(骨架 B 完整示范,已标 [MUST-KEEP] / [CAN-ROTATE] L5 分层)。本场景 ASMR / 摆盘 / 拉花锚点与 A 物理互斥,AI 读完 §1.5 后按同一格式自主生成,不另开 example。
