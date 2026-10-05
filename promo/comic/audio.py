# Музыка и звуки для комичного приёма: «ситкомный» пиццикато-бас и маримба 116 BPM (F–C–Dm–Bb),
# удар в хуке, «бульк» сообщений, щелчки, вжухи шторок, драматичное «дан-дан-дааан» на плохих новостях
# (музыка замирает), «дзынь» на «поесть», арфа на «обниму», рим-шот в конце.
import json, numpy as np, wave
SR = 48000; tl = json.load(open('timeline.json')); T = tl['total']; N = int(T * SR)
ev = json.load(open('events.json'))
rng = np.random.default_rng(7)
mus = np.zeros(N); sfx = np.zeros(N)
def add(buf, t, sig, g=1.0):
    i = int(t * SR)
    if i < 0: sig = sig[-i:]; i = 0
    j = min(N, i + len(sig))
    if i < N: buf[i:j] += sig[:j - i] * g
mid = lambda m: 440 * 2 ** ((m - 69) / 12)
def tone(f, d, dec=.3, harm=(1, .5, .2), a=.004):
    n = int(d * SR); t = np.arange(n) / SR
    return sum(h * np.sin(2 * np.pi * f * (k + 1) * t) for k, h in enumerate(harm)) * np.minimum(1, t / a) * np.exp(-t / dec)
def lp(x, a):
    y = np.empty_like(x); acc = 0.0; a = np.broadcast_to(a, x.shape)
    for i in range(len(x)): acc += a[i] * (x[i] - acc); y[i] = acc
    return y
def ev_t(kind, default=None):
    xs = [e['t'] for e in ev if e['type'] == kind]; return xs[0] if xs else default
t_drama, t_ding, t_end = ev_t('drama'), ev_t('ding'), ev_t('rimshot', T - 1.5)
# --- музыка ---
beat = 60 / 116; bar = 4 * beat
chords = [[53, 57, 60], [48, 52, 55], [50, 53, 57], [46, 50, 53]]
mel = [0, 2, 1, 2, -1, 2, 1, 0]  # индексы нот аккорда (−1 — пауза) для маримбы
def marimba(f): return tone(f, .5, dec=.13, harm=(1, 0, .25, 0, .08), a=.002)
def pizz(f): return tone(f, .4, dec=.11, harm=(1, .6, .3, .15), a=.003)
def kick():
    n = int(.25 * SR); t = np.arange(n) / SR; f = 55 + 90 * np.exp(-t / .025); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .08)
def snap():
    n = int(.08 * SR); x = rng.standard_normal(n); x = x - lp(x, .15); return x * np.exp(-np.arange(n) / SR / .02)
K = kick()
start = 1.6
for ci in range(int((T - start) / bar) + 1):
    ch = chords[ci % 4]; t0 = start + ci * bar
    for k in range(8):
        tb = t0 + k * beat / 2
        if tb >= t_end: break
        if t_drama and t_drama - .1 <= tb < t_ding - .05: continue  # тишина на «плохих новостях»
        if mel[k] >= 0: add(mus, tb, marimba(mid(ch[mel[k]] + 24)), .11)
        if k % 2 == 0: add(mus, tb, pizz(mid(ch[0 if k % 4 == 0 else 2] - 12)), .30)
        if k % 4 == 0: add(mus, tb, K, .28)
        if k % 4 == 2: add(mus, tb, snap(), .16)
        if k % 2 == 1: add(mus, tb, snap(), .04)
fade = np.ones(N); fi = int(.3 * SR); i0 = int(start * SR); fade[:i0] = 0; fade[i0:i0 + fi] = np.linspace(0, 1, fi); mus *= fade
# --- звуки ---
def click():
    n = int(.05 * SR); t = np.arange(n) / SR; return (np.sin(2 * np.pi * 1800 * t) * .5 + rng.standard_normal(n) * .3) * np.exp(-t / .008)
def bloop(f0, f1, d=.12):
    n = int(d * SR); t = np.arange(n) / SR; fr = f1 + (f0 - f1) * np.exp(-t / .025); return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / (d / 3))
def whoosh(d=.45):
    n = int(d * SR); t = np.arange(n) / SR; x = rng.standard_normal(n); y = lp(x - lp(x, .03), .2 + .5 * t / d)
    return y * np.sin(np.pi * t / d) ** 2 * 1.4
def boom():
    n = int(1.4 * SR); t = np.arange(n) / SR; f = 38 + 110 * np.exp(-t / .07)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .45) + lp(rng.standard_normal(n), .05) * np.exp(-t / .2) * 1.5
    return np.tanh(x * 1.6)
def stamp():
    n = int(.4 * SR); t = np.arange(n) / SR; f = 70 + 120 * np.exp(-t / .02)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .09) + lp(rng.standard_normal(n), .3) * np.exp(-t / .02) * .6
def brass(m, d):  # грубая «медь»: пила через фильтр
    n = int(d * SR); t = np.arange(n) / SR; f = mid(m) * (1 + .004 * np.sin(2 * np.pi * 5.5 * t * np.minimum(1, t / .4)))
    ph = np.cumsum(f) / SR; x = sum(np.sin(2 * np.pi * ph * k) / k for k in range(1, 12))
    env = np.minimum(1, t / .03) * np.minimum(1, (d - t) / .15)
    return lp(x, .12) * env
def drama():
    out = np.zeros(int(2.4 * SR)); s = lambda tt, sig: out.__setitem__(slice(int(tt * SR), int(tt * SR) + len(sig)), out[int(tt * SR):int(tt * SR) + len(sig)] + sig)
    for tt, d, ms in ((0, .32, (40, 52, 55)), (.42, .32, (39, 51, 54)), (.9, 1.45, (38, 50, 53, 57))):
        s(tt, sum(brass(m, d) for m in ms)); s(tt, boom()[:int(min(d + .3, 1.4) * SR)] * .5)
    return out
def ding():
    return sum(tone(mid(m), 1.6, dec=.5, harm=(1, 0, .3, 0, 0, .12), a=.001) * g for m, g in ((88, 1), (95, .5)))
def harp():
    out = np.zeros(int(1.6 * SR))
    for k, m in enumerate([65, 69, 72, 76, 77, 81, 84, 88, 89, 93]):
        sig = tone(mid(m), 1.0, dec=.4, harm=(1, .3, .1), a=.002); i = int(k * .055 * SR); out[i:i + len(sig)] += sig
    return out
def rimshot():
    out = np.zeros(int(1.6 * SR))
    def tom(f):
        n = int(.35 * SR); t = np.arange(n) / SR; fr = f * (1 + .5 * np.exp(-t / .02)); return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / .12)
    for tt, sig in ((0, tom(180)), (.16, tom(130)), (.38, None)):
        i = int(tt * SR)
        if sig is None:  # «тсссс»: тарелка
            n = int(1.1 * SR); x = rng.standard_normal(n); x = x - lp(x, .5); sig = x * np.exp(-np.arange(n) / SR / .35) * .6
            sig = sig + np.concatenate([snap(), np.zeros(n - len(snap()))]) * 1.2
        out[i:i + len(sig)] += sig
    return out
for e in ev:
    t, k = e['t'], e['type']
    if k == 'tap': add(sfx, t, click(), .45)
    elif k == 'pop_p': add(sfx, t, bloop(520, 760), .22)
    elif k == 'pop_d': add(sfx, t, bloop(900, 640), .18)
    elif k == 'think': add(sfx, t, bloop(300, 620, .25), .2); add(sfx, t + .12, bloop(450, 900, .25), .14)
    elif k == 'sheet': add(sfx, t - .15, whoosh(.35), .25)
    elif k == 'card': add(sfx, t, bloop(700, 1100), .2)
    elif k == 'stamp': add(sfx, t, stamp(), .7)
    elif k == 'boom': add(sfx, t, boom(), .95)
    elif k == 'drama': add(sfx, t, drama(), .55)
    elif k == 'ding': add(sfx, t, ding(), .4)
    elif k == 'love': add(sfx, t, harp(), .35)
    elif k == 'rimshot': add(sfx, t, rimshot(), .7)
def save(fn, x):
    x = np.clip(x, -1, 1); w = wave.open(fn, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype('<i2').tobytes()); w.close()
save('music.wav', mus / np.max(np.abs(mus)) * .8); save('sfx.wav', sfx / max(1e-9, np.max(np.abs(sfx))) * .8); print('ok', len(ev), 'events')
