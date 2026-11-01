#!/usr/bin/env python3
"""
主题→视频 自动生成脚本
功能：根据分段脚本，生成 TTS 音频 + AI 配图 + 字幕，合成竖版短视频（1080x1920）
依赖：edge-tts, Pillow, ffmpeg, opencv-python
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("错误：请安装 Pillow - pip install Pillow")
    sys.exit(1)

# ─── 配置 ───────────────────────────────────────────────

VIDEO_WIDTH = 1080
VIDEO_HEIGHT = 1920
FPS = 24
FONT_SIZE = 48
SUBTITLE_MAX_CHARS_PER_LINE = 18  # 竖版视频每行最多字数
DEFAULT_VOICE = "zh-CN-YunxiNeural"  # 默认男声，活泼阳光
BG_COLOR = (18, 18, 30)  # 深色背景
ACCENT_COLOR = (255, 200, 60)  # 金色强调色
TEXT_COLOR = (255, 255, 255)
SUBTITLE_BG = (0, 0, 0, 160)

# 尝试加载中文字体
def _find_font():
    """查找系统中可用的中文字体"""
    candidates = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    ]
    for f in candidates:
        if os.path.exists(f):
            return f
    # 搜索系统中所有 ttc/ttf 中含 CJK 的
    try:
        result = subprocess.run(
            ["fc-list", ":lang=zh", "file"],
            capture_output=True, text=True, timeout=10
        )
        if result.stdout.strip():
            return result.stdout.strip().split("\n")[0].split(":")[0].strip()
    except Exception:
        pass
    return None

FONT_PATH = _find_font()

# ─── 脚本解析 ───────────────────────────────────────────

def parse_script(script_path: str) -> list[dict]:
    """
    解析 JSON 格式的分段脚本。
    期望格式：
    [
      {
        "title": "段落标题（可选，用于画面显示）",
        "text": "段落正文（用于 TTS 和字幕）",
        "voice": "zh-CN-YunxiNeural（可选，覆盖默认音色）"
      },
      ...
    ]
    """
    with open(script_path, "r", encoding="utf-8") as f:
        segments = json.load(f)
    
    for seg in segments:
        if "text" not in seg:
            raise ValueError(f"脚本段落缺少 'text' 字段: {seg}")
        seg.setdefault("title", "")
        seg.setdefault("voice", DEFAULT_VOICE)
    
    return segments


# ─── TTS 音频生成 ───────────────────────────────────────

async def generate_tts(text: str, voice: str, output_path: str):
    """使用 edge-tts 生成语音文件"""
    import edge_tts
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)


def generate_tts_sync(text: str, voice: str, output_path: str):
    """同步包装，生成 mp3 后转为 wav 以便 ffmpeg 处理"""
    mp3_path = output_path if output_path.endswith(".mp3") else output_path.rsplit(".", 1)[0] + ".mp3"
    asyncio.run(generate_tts(text, voice, mp3_path))

    # 精简版 ffmpeg 无法解码 mp3，用 Python 转为 wav
    wav_path = mp3_path.rsplit(".", 1)[0] + ".wav"
    try:
        _mp3_to_wav(mp3_path, wav_path)
        if os.path.exists(wav_path) and os.path.getsize(wav_path) > 0:
            os.remove(mp3_path)
            return wav_path
    except Exception as e:
        print(f"  ⚠️ mp3→wav 转换失败: {e}")
    return mp3_path


def _mp3_to_wav(mp3_path: str, wav_path: str):
    """用 miniaudio（纯 Python）将 mp3 转为 wav"""
    import wave
    import miniaudio

    decoded = miniaudio.decode_file(mp3_path)
    with wave.open(wav_path, "w") as wf:
        wf.setnchannels(decoded.nchannels)
        wf.setsampwidth(decoded.sample_width)
        wf.setframerate(decoded.sample_rate)
        wf.writeframes(decoded.samples.tobytes())


def get_audio_duration(audio_path: str) -> float:
    """获取音频时长。wav 用 wave 模块读头部；其他格式用文件大小估算"""
    if audio_path.endswith(".wav"):
        import wave
        try:
            with wave.open(audio_path, "r") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate()
                return frames / float(rate)
        except Exception as e:
            print(f"  ⚠️ wave 读取失败: {e}")

    # Fallback: 根据文件大小估算（假设 128kbps mp3）
    file_size = os.path.getsize(audio_path)
    return file_size * 8 / 128000


# ─── 画面生成 ───────────────────────────────────────────

def _wrap_text(text: str, max_chars: int) -> list[str]:
    """文本换行：每行不超过 max_chars 个字符"""
    lines = []
    for char in text:
        if not lines or len(lines[-1]) >= max_chars:
            lines.append(char)
        else:
            lines[-1] += char
    return lines


def generate_frame_image(
    title: str,
    subtitle_text: str,
    output_path: str,
    width: int = VIDEO_WIDTH,
    height: int = VIDEO_HEIGHT,
):
    """
    生成一帧竖版画面：渐变背景 + 标题 + 字幕
    字幕只显示当前正在朗读的句子
    """
    img = Image.new("RGB", (width, height), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # 绘制渐变装饰条
    for i in range(8):
        y = height // 2 + i * 120 - 400
        alpha = max(0, 40 - i * 5)
        draw.rectangle([(0, y), (width, y + 60)], fill=(ACCENT_COLOR[0], ACCENT_COLOR[1], ACCENT_COLOR[2], alpha))

    font_large = None
    font_small = None
    if FONT_PATH:
        try:
            font_large = ImageFont.truetype(FONT_PATH, 64)
            font_small = ImageFont.truetype(FONT_PATH, FONT_SIZE)
        except Exception:
            font_large = ImageFont.load_default()
            font_small = ImageFont.load_default()
    else:
        font_large = ImageFont.load_default()
        font_small = ImageFont.load_default()

    # 顶部标题
    if title:
        title_lines = _wrap_text(title, 14)
        y_start = 200
        for line in title_lines:
            bbox = draw.textbbox((0, 0), line, font=font_large)
            tw = bbox[2] - bbox[0]
            x = (width - tw) // 2
            draw.text((x, y_start), line, fill=ACCENT_COLOR, font=font_large)
            y_start += 80

    # 中部字幕（带半透明背景条）
    if subtitle_text:
        sub_lines = _wrap_text(subtitle_text, SUBTITLE_MAX_CHARS_PER_LINE)
        # 计算字幕区域
        line_height = FONT_SIZE + 16
        total_height = len(sub_lines) * line_height
        box_top = (height - total_height) // 2 + 100
        box_bottom = box_top + total_height + 40
        # 半透明背景（用 RGBA 模式叠加）
        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.rectangle(
            [(60, box_top - 20), (width - 60, box_bottom)],
            fill=(0, 0, 0, 140)
        )
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(img)

        y_text = box_top
        for line in sub_lines:
            bbox = draw.textbbox((0, 0), line, font=font_small)
            tw = bbox[2] - bbox[0]
            x = (width - tw) // 2
            draw.text((x, y_text), line, fill=TEXT_COLOR, font=font_small)
            y_text += line_height

    img.save(output_path)


def generate_segment_frames(
    segment: dict,
    output_dir: str,
) -> tuple[str, float]:
    """
    为一个段落生成：
    1. TTS 音频
    2. 对应的画面帧序列
    返回 (音频路径, 时长)
    """
    seg_id = id(segment) % 100000
    audio_path = os.path.join(output_dir, f"audio_{seg_id}.mp3")
    frame_dir = os.path.join(output_dir, f"frames_{seg_id}")
    os.makedirs(frame_dir, exist_ok=True)

    # 生成 TTS
    text = segment["text"]
    voice = segment["voice"]
    actual_audio_path = generate_tts_sync(text, voice, audio_path)
    duration = get_audio_duration(actual_audio_path)

    # 按句子拆分字幕，每句生成一个画面帧
    sentences = re.split(r'(?<=[。！？；\n])', text)
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        sentences = [text]

    # 用累计时间点分配帧，避免 int() 截断导致总帧数不足
    total_chars = sum(len(s) for s in sentences)
    total_frames_needed = max(len(sentences), int(duration * FPS))

    frame_idx = 0
    cumulative_time = 0.0
    for sent_idx, sent in enumerate(sentences):
        # 计算该句结束时间点
        if sent_idx == len(sentences) - 1:
            sent_end_time = duration  # 最后一句直接到结尾
        else:
            cumulative_time += len(sent) / max(total_chars, 1) * duration
            sent_end_time = cumulative_time

        # 计算该句应占帧数（用累计时间点相减，避免累积误差）
        target_frame_idx = int(sent_end_time * FPS)
        num_frames = max(1, target_frame_idx - frame_idx)

        frame_path = os.path.join(frame_dir, f"frame_{frame_idx:05d}.png")
        generate_frame_image(
            title=segment.get("title", ""),
            subtitle_text=sent,
            output_path=frame_path,
        )
        # 复制帧以匹配音频时长
        for i in range(1, num_frames):
            import shutil
            shutil.copy2(frame_path, os.path.join(frame_dir, f"frame_{frame_idx + i:05d}.png"))
        frame_idx += num_frames

    return actual_audio_path, duration


# ─── 视频合成（用 PyAV 替代 ffmpeg，因为系统 ffmpeg 精简版无音频编解码器）───

def concat_segments(segment_data: list[dict], output_path: str, work_dir: str):
    """
    将所有段落合并为最终视频，使用 PyAV
    segment_data: [{"audio": path, "frames_dir": path, "duration": float}, ...]
    """
    import av
    import numpy as np
    from PIL import Image as PILImage

    # 收集所有帧和音频
    all_frames = []
    all_audio_samples = []
    audio_sample_rate = 24000

    for seg in segment_data:
        # 读取该段所有帧
        frames_dir = seg["frames_dir"]
        frame_files = sorted([f for f in os.listdir(frames_dir) if f.endswith(".png")])
        for ff in frame_files:
            img = PILImage.open(os.path.join(frames_dir, ff))
            all_frames.append(np.array(img))

        # 读取该段音频（wav 格式）
        audio_path = seg["audio"]
        if audio_path.endswith(".wav"):
            import wave
            with wave.open(audio_path, "r") as wf:
                audio_sample_rate = wf.getframerate()
                raw = wf.readframes(wf.getnframes())
                samples = np.frombuffer(raw, dtype=np.int16)
                all_audio_samples.append(samples)

    if not all_frames:
        print("错误：没有帧可以合成")
        return

    total_frames = len(all_frames)
    video_duration = total_frames / FPS  # 精确视频时长

    # 拼接音频，并严格对齐到视频时长
    if all_audio_samples:
        audio_data = np.concatenate(all_audio_samples)
    else:
        audio_data = np.zeros(int(video_duration * audio_sample_rate), dtype=np.int16)

    # 关键修复：让音频采样数严格匹配视频帧数对应的时长
    target_samples = int(video_duration * audio_sample_rate)
    if len(audio_data) > target_samples:
        audio_data = audio_data[:target_samples]  # 音频比视频长，截断
    elif len(audio_data) < target_samples:
        audio_data = np.pad(audio_data, (0, target_samples - len(audio_data)))  # 音频比视频短，补零

    # 创建输出文件
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    container = av.open(output_path, mode="w")

    # 添加视频流
    video_stream = container.add_stream("h264", rate=FPS)
    video_stream.width = VIDEO_WIDTH
    video_stream.height = VIDEO_HEIGHT
    video_stream.pix_fmt = "yuv420p"
    video_stream.bit_rate = 2_000_000

    # 添加音频流
    audio_stream = container.add_stream("aac", rate=audio_sample_rate)
    audio_stream.layout = "mono"

    # 编码视频帧（设置正确的 PTS）
    print(f"  编码 {total_frames} 帧视频...")
    for i, frame_arr in enumerate(all_frames):
        frame = av.VideoFrame.from_ndarray(frame_arr, format="rgb24")
        frame.pts = i  # 以 1/fps 为单位
        for packet in video_stream.encode(frame):
            container.mux(packet)
        if (i + 1) % 100 == 0:
            print(f"    已编码 {i+1}/{total_frames} 帧")

    # flush 视频
    for packet in video_stream.encode():
        container.mux(packet)

    # 编码音频（AAC 每帧 1024 采样，需分块并设置 PTS）
    AAC_FRAME_SIZE = 1024
    print(f"  编码 {len(audio_data)} 个音频采样...")
    audio_pts = 0
    for offset in range(0, len(audio_data), AAC_FRAME_SIZE):
        chunk = audio_data[offset:offset + AAC_FRAME_SIZE]
        # 最后一帧不足 1024 采样时补零
        if len(chunk) < AAC_FRAME_SIZE:
            chunk = np.pad(chunk, (0, AAC_FRAME_SIZE - len(chunk)))
        audio_arr = chunk.reshape(1, -1)  # mono
        audio_frame = av.AudioFrame.from_ndarray(audio_arr, format="s16", layout="mono")
        audio_frame.sample_rate = audio_sample_rate
        audio_frame.pts = audio_pts
        audio_pts += AAC_FRAME_SIZE
        for packet in audio_stream.encode(audio_frame):
            container.mux(packet)
    for packet in audio_stream.encode():
        container.mux(packet)

    container.close()
    print(f"  视频合成完成: {output_path}")


# ─── 主流程 ─────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("用法: python generate_video.py <脚本JSON路径> <输出视频路径>")
        print("脚本格式: [{\"title\": \"段落标题\", \"text\": \"段落正文\", \"voice\": \"zh-CN-YunxiNeural\"}, ...]")
        sys.exit(1)

    script_path = sys.argv[1]
    output_path = sys.argv[2]

    print(f"📋 解析脚本: {script_path}")
    segments = parse_script(script_path)
    print(f"  共 {len(segments)} 个段落")

    work_dir = tempfile.mkdtemp(prefix="video_gen_")
    print(f"🔧 工作目录: {work_dir}")

    segment_data = []
    for i, seg in enumerate(segments):
        print(f"🎤 生成第 {i+1}/{len(segments)} 段音频和画面...")
        audio_path, duration = generate_segment_frames(seg, work_dir)
        frames_dir = os.path.join(work_dir, f"frames_{id(seg) % 100000}")
        segment_data.append({
            "audio": audio_path,
            "frames_dir": frames_dir,
            "duration": duration,
        })
        print(f"  ✅ 时长 {duration:.1f}s")

    print("🎬 合成最终视频...")
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    concat_segments(segment_data, output_path, work_dir)

    total_duration = sum(s["duration"] for s in segment_data)
    print(f"\n🎉 视频生成完成！")
    print(f"  📁 路径: {output_path}")
    print(f"  ⏱️  总时长: {total_duration:.1f}s")
    print(f"  📐 分辨率: {VIDEO_WIDTH}x{VIDEO_HEIGHT}")


if __name__ == "__main__":
    main()
