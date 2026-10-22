# Свой голос вместо синтеза: запись own/<v>.ogg + тайминги слов (own/<v>.words.json, faster-whisper)
# -> voice-<v>/timeline.json и voice-<v>/voice.wav. Сцены размечены по номерам слов записи.
# Запуск: python3 own_voice.py a   (или b)
import json, os, subprocess, sys
V = sys.argv[1]
LEAD = 0.5  # тишина перед первой фразой
# (сцена, первое слово, последнее слово, доп. параметры); слова — индексы в own/<v>.words.json
CFG = {
  'a': dict(
    fix={18: 'Получаете', 23: 'начинаете', 24: 'приём.', 25: 'Задаёте', 49: 'всё', 37: 'чём', 57: 'приёма', 78: 'препараты,'},
    join=[(91, 92, 'ИИ‑пациентах,')],
    scenes=[('intro', 0, 9), ('onb', 10, 17), ('patient', 18, 24, {'only': ['13-patient-card', '14-start-tap']}),
            ('chat', 25, 26, {'only': ['18-q1-answer']}), ('tests', 27, 28, {'only': ['25-test-blood-result']}),
            ('exam', 29, 30, {'only': ['35-exam-result']}), ('clarify', 31, 45), ('finish', 46, 55), ('eval', 56, 70),
            ('kr', 71, 79), ('quiz', 80, 88), ('level', 89, 98), ('cta', None, None, {'at': 48.3})],
    tail=4.2),
  'b': dict(
    fix={9: 'практики?', 10: 'В', 12: 'тренажёре', 16: 'приёмы', 32: 'задаёшь', 61: 'приёма', 62: 'тренажёр', 77: 'даёт',
         92: 'болезни,', 111: 'me,'},
    join=[(1, 2, 'студент‑медик')],
    scenes=[('intro', 0, 9), ('onb', 10, 21), ('patient', 22, 29, {'only': ['13-patient-card', '14-start-tap']}),
            ('chat', 30, 36, {'only': ['16-q1-typed', '17-q1-stream', '18-q1-answer', '21-q2-answer']}),
            ('tests', 37, 38, {'only': ['25-test-blood-result']}), ('exam', 39, 41, {'only': ['35-exam-result']}),
            ('clarify', 42, 52), ('finish', 53, 59), ('eval', 60, 74), ('kr', 75, 83), ('level', 84, 97), ('battle', 98, 107),
            ('cta', 108, 116, {'title': 'Попробуй <em>бесплатно</em>'})],
    replace={'Ваш уровень': 'Твой уровень', 'Ваш диагноз': 'Твой диагноз'},
    tail=2.4),
}[V]
segs = json.load(open(f'own/{V}.words.json'))
W = [[w['s'] + LEAD, w['e'] - w['s'], w['w'].strip()] for s in segs for w in s['words']]
for i, txt in CFG['fix'].items(): W[i][2] = txt
for a, b, txt in CFG.get('join', []):
    W[a] = [W[a][0], W[b][0] + W[b][1] - W[a][0], txt]
    for i in range(a + 1, b + 1): W[i] = None
src = f'own/{V}.ogg'
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]))
total = round(dur + LEAD + CFG['tail'], 2)
lines = []
for sc in CFG['scenes']:
    key, i0, i1 = sc[:3]; ex = sc[3] if len(sc) > 3 else {}
    ws = [[round(x[0], 3), round(x[1], 3), x[2]] for x in (W[i0:i1 + 1] if i0 is not None else []) if x]
    start = ws[0][0] if ws else ex['at'] + LEAD
    l = dict(key=key, text=' '.join(x[2] for x in ws), start=round(start, 3), end=round(ws[-1][0] + ws[-1][1] if ws else start, 3), words=ws)
    l.update({k: v for k, v in ex.items() if k != 'at'})
    lines.append(l)
os.makedirs(f'voice-{V}', exist_ok=True)
json.dump(dict(total=total, lines=lines, replace=CFG.get('replace', {})), open(f'voice-{V}/timeline.json', 'w'), ensure_ascii=False, indent=1)
# лёгкая обработка: срез низа, мягкое шумоподавление, компрессия, сдвиг на LEAD
ms = int(LEAD * 1000)
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-af',
                f'highpass=f=75,afftdn=nf=-50,acompressor=threshold=-22dB:ratio=2.5:attack=8:release=120,adelay={ms},apad=whole_dur={total}',
                '-ar', '48000', '-ac', '1', f'voice-{V}/voice.wav'], check=True)
print(V, 'total', total, 'scenes', len(lines))
