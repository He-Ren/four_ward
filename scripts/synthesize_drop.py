"""Generate a soft, short drop cue using only Python's standard library.

Run from any directory with: python scripts/synthesize_drop.py
The game ships the generated WAV; no synthesis tools are needed to play.
"""
import math
from pathlib import Path
import random
import struct
import wave

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "assets" / "merge" / "drop-soft.wav"
SETTINGS = {
    "sample_rate": 48000,
    "duration": 0.135,
    "attack": 0.008,
    "decay": 0.026,
    "tail_fade": 0.015,
    "start_hz": 280,
    "end_hz": 190,
    "pitch_decay": 0.018,
    "overtone_ratio": 2.1,
    "overtone_gain": 0.035,
    "overtone_decay": 0.012,
    "noise_gain": 0.004,
    "noise_cutoff_hz": 1000,
    "peak": 0.55,
    "seed": 17,
}


def synthesize():
    cfg = SETTINGS
    rng = random.Random(cfg["seed"])
    phase = 0.0
    noise = 0.0
    response = 1 - math.exp(-math.tau * cfg["noise_cutoff_hz"] / cfg["sample_rate"])
    count = round(cfg["duration"] * cfg["sample_rate"])
    samples = []
    for index in range(count):
        time = index / cfg["sample_rate"]
        frequency = cfg["end_hz"] + (cfg["start_hz"] - cfg["end_hz"]) * math.exp(-time / cfg["pitch_decay"])
        phase += math.tau * frequency / cfg["sample_rate"]
        attack = 0.5 - 0.5 * math.cos(math.pi * min(1, time / cfg["attack"]))
        tail = min(1, (count - 1 - index) / (cfg["tail_fade"] * cfg["sample_rate"]))
        envelope = attack * math.exp(-time / cfg["decay"]) * tail
        noise += response * (rng.uniform(-1, 1) - noise)
        tone = math.sin(phase)
        tone += cfg["overtone_gain"] * math.sin(phase * cfg["overtone_ratio"]) * math.exp(-time / cfg["overtone_decay"])
        samples.append(envelope * (tone + cfg["noise_gain"] * noise))
    gain = cfg["peak"] / max(abs(sample) for sample in samples)
    pcm = b"".join(struct.pack("<h", round(sample * gain * 32767)) for sample in samples)
    with wave.open(str(OUTPUT), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(cfg["sample_rate"])
        output.writeframes(pcm)
    print(f"Generated {OUTPUT.relative_to(ROOT)} ({cfg['duration'] * 1000:.0f} ms)")


if __name__ == "__main__":
    synthesize()
