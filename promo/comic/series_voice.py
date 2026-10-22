# Озвучка серии: python3 series_voice.py series/<id> -> seg/, timeline.json (тайминги слов + реплики сценария), voice.wav
# Голоса и темп — в episode.json (cast.<кто>.voice); мысли врача (t) — тише и с «эхом в голове».
import json, subprocess, time, os, sys
D = sys.argv[1]
ep = json.load(open(f"{D}/episode.json"))
if "--merge" in sys.argv:  # обновить в timeline.json всё, кроме таймингов (тексты реплик должны совпадать)
    tl = json.load(open(f"{D}/timeline.json"))
    assert [l["text"] for l in tl["lines"]] == [l["text"] for l in ep["lines"]], "тексты изменились — нужна новая озвучка"
    tl["lines"] = [{**l, **{k: o[k] for k in ("start", "end", "words")}} for l, o in zip(ep["lines"], tl["lines"])]
    tl["meta"] = {k: v for k, v in ep.items() if k != "lines"}
    json.dump(tl, open(f"{D}/timeline.json", "w"), ensure_ascii=False, indent=1); print(D, "merged"); sys.exit()
GAP = {"d": 0.24, "t": 0.36}
os.makedirs(f"{D}/seg", exist_ok=True)
dur = lambda f: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))
t, out = 0.25, []
for i, l in enumerate(ep["lines"]):
    who, txt = l["who"], l["text"]
    v, rate, pitch = ep["cast"][who]["voice"]
    if l.get("loud"):  # первая реплика — на крике
        rate = f"{int(rate.rstrip('%')) + 4:+d}%"; pitch = f"{int(pitch.rstrip('Hz')) + 6:+d}Hz"
    mp3 = f"{D}/seg/{i}.mp3"
    for a in range(6):
        if subprocess.run(["python3", "tts.py", txt, v, mp3, rate, pitch], capture_output=True).returncode == 0: break
        time.sleep(2 + 2 * a)
    else: raise SystemExit(f"TTS failed: {i}")
    af = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=stop_periods=-1:stop_duration=0.2:stop_silence=0.16:stop_threshold=-42dB"
    if who == "t": af += ",aecho=0.8:0.6:45|90:0.35|0.2,lowpass=f=5200,volume=0.85"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", mp3, "-af", af, "-ar", "48000", "-ac", "1", f"{D}/seg/{i}.wav"], check=True)
    if i: t += GAP.get(who, 0.2) + (0.08 if ep["lines"][i - 1]["who"] != who else 0) + l.get("gap", 0)
    w = [x for x in json.load(open(mp3 + ".json")) if x[2].strip() and x[2] not in "—–-:,.…"]
    off = w[0][0]; d = dur(f"{D}/seg/{i}.wav")
    out.append({**l, "start": round(t, 3), "end": round(t + d, 3), "words": [[round(t + a - off, 3), round(dd, 3), s] for a, dd, s in w]})
    t += d
total = round(t + 1.9, 2)
meta = {k: v for k, v in ep.items() if k != "lines"}
json.dump(dict(total=total, meta=meta, lines=out), open(f"{D}/timeline.json", "w"), ensure_ascii=False, indent=1)
inp, fil = [], []
for i, o in enumerate(out):
    ms = int(o["start"] * 1000); inp += ["-i", f"{D}/seg/{i}.wav"]; fil.append(f"[{i}]adelay={ms}|{ms}[a{i}]")
fil.append("".join(f"[a{i}]" for i in range(len(out))) + f"amix=inputs={len(out)}:normalize=0,apad=whole_dur={total}[v]")
subprocess.run(["ffmpeg", "-y", "-v", "error", *inp, "-filter_complex", ";".join(fil), "-map", "[v]", "-ar", "48000", "-ac", "1", f"{D}/voice.wav"], check=True)
print(D, "total", total)
