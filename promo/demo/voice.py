# Озвучка по фразам из lines.json -> seg/*.wav, timeline.json (тайминги слов), voice.wav
import json, subprocess, time, os
VOICE, RATE = "ru-RU-DmitryNeural", "+8%"
GAPS = [0.6] + [0.9] * 13  # пауза перед фразой: время на смену экрана
os.makedirs("seg", exist_ok=True)
L = json.load(open("lines.json"))
dur = lambda f: float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f]))
t, out = 0, []
for i, (k, txt) in enumerate(L):
    for a in range(5):  # edge-tts иногда отвечает пусто — повторяем
        if subprocess.run(["python3","tts.py",txt,VOICE,f"seg/{i}.mp3",RATE,"+0Hz"],capture_output=True).returncode == 0: break
        time.sleep(2 + 2*a)
    else: raise SystemExit(f"TTS failed: {k}")
    trim = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"*2
    subprocess.run(["ffmpeg","-y","-v","error","-i",f"seg/{i}.mp3","-af",trim.rstrip(","),"-ar","48000","-ac","1",f"seg/{i}.wav"],check=True)
    t += GAPS[i]
    w = [x for x in json.load(open(f"seg/{i}.mp3.json")) if x[2].strip() and x[2] not in "—–-:,."]
    off = w[0][0]
    out.append(dict(key=k, text=txt, start=round(t,3), end=round(t+dur(f"seg/{i}.wav"),3),
                    words=[[round(t+a-off,3), round(d,3), s] for a, d, s in w]))
    t = out[-1]["end"]
total = round(t + 2.0, 2)
json.dump(dict(total=total, lines=out), open("timeline.json","w"), ensure_ascii=False, indent=1)
inp, fil = [], []
for i, o in enumerate(out):
    ms = int(o["start"]*1000); inp += ["-i", f"seg/{i}.wav"]; fil.append(f"[{i}]adelay={ms}|{ms}[a{i}]")
fil.append("".join(f"[a{i}]" for i in range(len(out))) + f"amix=inputs={len(out)}:normalize=0,apad=whole_dur={total}[v]")
subprocess.run(["ffmpeg","-y","-v","error",*inp,"-filter_complex",";".join(fil),"-map","[v]","-ar","48000","-ac","1","voice.wav"],check=True)
print("total", total)
