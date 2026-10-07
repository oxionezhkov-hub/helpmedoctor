#!/usr/bin/env bash
# Сборка демо-ролика: озвучка -> покадровый рендер HTML -> музыка/SFX -> сведение.
#   ./build.sh            — синтетический голос (voice.py), helpmedoctor-demo.mp4
#   VAR=a ./build.sh      — свой голос из own/a.ogg (own_voice.py), helpmedoctor-demo-a.mp4 (то же для b)
# Нужно: python3 (edge-tts, numpy), ffmpeg, node + playwright (Chromium).
set -euo pipefail
cd "$(dirname "$0")"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
if [ -n "${VAR:-}" ]; then
  D=voice-$VAR; python3 own_voice.py "$VAR"; OUT=helpmedoctor-demo-$VAR.mp4
else
  D=.; [ "${SKIP_VOICE:-}" = 1 ] || python3 voice.py; OUT=helpmedoctor-demo.mp4
fi
export TL=$D/timeline.json EVENTS=$D/events.json PREFIX=$D/
N=$(python3 -c "import json;print(round(json.load(open('$TL'))['total']*30))"); P=${JOBS:-3}; C=$(( (N+P-1)/P ))
for i in $(seq 0 $((P-1))); do node render.mjs video $((i*C)) $(( (i+1)*C )) $D/part$i.mp4 & done; wait
for i in $(seq 0 $((P-1))); do echo "file 'part$i.mp4'"; done > $D/parts.txt
ffmpeg -y -v error -f concat -safe 0 -i $D/parts.txt -c copy $D/video.mp4
python3 audio.py   # нужен events.json, его пишет render.mjs
ffmpeg -y -v error -i $D/voice.wav -i $D/music.wav -i $D/sfx.wav -filter_complex "
[0]highpass=f=80,equalizer=f=3500:t=q:w=1:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,volume=1.6,asplit=2[v][vsc];
[1]volume=0.32[m];[m][vsc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[md];[2]volume=0.45[s];
[v][md][s]amix=inputs=3:normalize=0,alimiter=limit=0.89,loudnorm=I=-14:TP=-1.5:LRA=9[out]" -map "[out]" -ar 48000 -ac 2 $D/mix.wav
ffmpeg -y -v error -i $D/video.mp4 -i $D/mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart $OUT
echo "готово: $(pwd)/$OUT"
