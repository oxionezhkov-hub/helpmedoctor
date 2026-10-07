# Озвучка комичного приёма: пациентка — ru-RU-SvetlanaNeural, врач — ru-RU-DmitryNeural, мысли врача — тише и с «эхом в голове».
import json, subprocess, time, os
VOICES = {"p": ("ru-RU-SvetlanaNeural", "+22%", "+8Hz"), "d": ("ru-RU-DmitryNeural", "+16%", "+0Hz"), "t": ("ru-RU-DmitryNeural", "+10%", "-4Hz")}
GAP = {"p": 0.2, "d": 0.24, "t": 0.36}
os.makedirs("seg", exist_ok=True)
L = json.load(open("lines.json"))
dur = lambda f: float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f]))
t, out = 0.25, []
for i, line in enumerate(L):
    who, txt = line[0], line[1]
    v, rate, pitch = VOICES[who]
    if i == 0: rate, pitch = "+26%", "+14Hz"     # первая реплика — на крике
    for a in range(5):
        if subprocess.run(["python3","tts.py",txt,v,f"seg/{i}.mp3",rate,pitch],capture_output=True).returncode == 0: break
        time.sleep(2 + 2*a)
    else: raise SystemExit(f"TTS failed: {i}")
    af = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=stop_periods=-1:stop_duration=0.2:stop_silence=0.16:stop_threshold=-42dB"
    if who == "t": af += ",aecho=0.8:0.6:45|90:0.35|0.2,lowpass=f=5200,volume=0.85"
    subprocess.run(["ffmpeg","-y","-v","error","-i",f"seg/{i}.mp3","-af",af,"-ar","48000","-ac","1",f"seg/{i}.wav"],check=True)
    if i: t += GAP[who] + (0.08 if L[i-1][0] != who else 0) + (line[3] if len(line) > 3 else 0)
    w = [x for x in json.load(open(f"seg/{i}.mp3.json")) if x[2].strip() and x[2] not in "—–-:,.…"]
    off = w[0][0]
    d = dur(f"seg/{i}.wav")
    out.append(dict(who=who, text=txt, face=(line[2] if len(line) > 2 else None), cont=(len(line) > 3), start=round(t,3), end=round(t+d,3), words=[[round(t+a-off,3), round(dd,3), s] for a, dd, s in w]))
    t += d
total = round(t + 1.8, 2)
json.dump(dict(total=total, lines=out), open("timeline.json","w"), ensure_ascii=False, indent=1)
inp, fil = [], []
for i, o in enumerate(out):
    ms = int(o["start"]*1000); inp += ["-i", f"seg/{i}.wav"]; fil.append(f"[{i}]adelay={ms}|{ms}[a{i}]")
fil.append("".join(f"[a{i}]" for i in range(len(out))) + f"amix=inputs={len(out)}:normalize=0,apad=whole_dur={total}[v]")
subprocess.run(["ffmpeg","-y","-v","error",*inp,"-filter_complex",";".join(fil),"-map","[v]","-ar","48000","-ac","1","voice.wav"],check=True)
print("total", total)
