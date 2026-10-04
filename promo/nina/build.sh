#!/usr/bin/env bash
# Сборка рилса: озвучка -> музыка/SFX -> покадровый рендер HTML -> сведение.
# Нужно: python3 (edge-tts, numpy), ffmpeg, node + playwright (Chromium).
set -euo pipefail
cd "$(dirname "$0")"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
[ "${SKIP_VOICE:-}" = 1 ] || python3 voice.py
python3 audio.py
N=$(python3 -c "import json;print(round(json.load(open('timeline.json'))['total']*30))"); P=${JOBS:-3}; C=$(( (N+P-1)/P ))
for i in $(seq 0 $((P-1))); do node render.mjs video $((i*C)) $(( (i+1)*C )) part$i.mp4 & done; wait
for i in $(seq 0 $((P-1))); do echo "file 'part$i.mp4'"; done > parts.txt
ffmpeg -y -v error -f concat -safe 0 -i parts.txt -c copy video.mp4
ffmpeg -y -v error -i voice.wav -i music.wav -i sfx.wav -filter_complex "
[0]highpass=f=80,equalizer=f=3500:t=q:w=1:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,volume=1.6,asplit=2[v][vsc];
[1]volume=0.42[m];[m][vsc]sidechaincompress=threshold=0.04:ratio=4:attack=20:release=300[md];[2]volume=0.6[s];
[v][md][s]amix=inputs=3:normalize=0,alimiter=limit=0.89,loudnorm=I=-14:TP=-1.5:LRA=9[out]" -map "[out]" -ar 48000 -ac 2 mix.wav
ffmpeg -y -v error -i video.mp4 -i mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart nina-reel.mp4
echo "готово: $(pwd)/nina-reel.mp4"
