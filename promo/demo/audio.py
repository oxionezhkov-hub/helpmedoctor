# Музыка и звуки для демо: светлый поп 100 BPM (C–G–Am–F), щелчки нажатий, «поп» подсказок, вжух на смене шага.
import json, os, numpy as np, wave
SR = 48000; tl = json.load(open(os.environ.get('TL', 'timeline.json'))); T = tl['total']; N = int(T * SR)
ev = json.load(open(os.environ.get('EVENTS', 'events.json')))
rng = np.random.default_rng(11)
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
beat = 60 / 100; bar = 4 * beat
chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]
# пэд
for ci in range(int(T / bar) + 1):
    ch = chords[ci % 4]; n = int((bar + .5) * SR); t = np.arange(n) / SR
    e = np.minimum(1, t / .4) * np.minimum(1, np.maximum(0, bar + .5 - t) / .5)
    s = sum(np.sin(2 * np.pi * mid(m) * 2 ** (d / 12) * t) for m in ch for d in (-.08, .08))
    add(mus, ci * bar, s * e * .03)
# «пианино»: арпеджио восьмыми, бас, лёгкий бит
for ci in range(int(T / bar) + 1):
    ch = chords[ci % 4]; t0 = ci * bar
    for k, m in enumerate([ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12, ch[0] + 24, ch[2] + 12, ch[1] + 12, ch[2] + 12]):
        add(mus, t0 + k * beat / 2, tone(mid(m), .6, dec=.22, harm=(1, .35, .12, .05)), .06)
    for k in range(4): add(mus, t0 + k * beat, tone(mid(ch[0] - 24), beat, dec=.25, harm=(1, .4)), .16)
def kick():
    n = int(.3 * SR); t = np.arange(n) / SR; f = 50 + 80 * np.exp(-t / .03); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .1)
def shaker():
    n = int(.06 * SR); x = np.diff(np.concatenate([[0], rng.standard_normal(n)])); return x * np.exp(-np.arange(n) / SR / .015)
K = kick()
b = 0
while b * beat < T - 2:
    tb = b * beat
    if tb > 1.5:
        if b % 2 == 0: add(mus, tb, K, .35)
        add(mus, tb + beat / 2, shaker(), .05)
    b += 1
fade = np.ones(N); fi = int(1.0 * SR); fade[:fi] = np.linspace(0, 1, fi); fo = int((T - 2.5) * SR); fade[fo:] = np.linspace(1, 0, N - fo); mus *= fade
# звуки
def click():
    n = int(.05 * SR); t = np.arange(n) / SR; return (np.sin(2 * np.pi * 1800 * t) * .5 + rng.standard_normal(n) * .3) * np.exp(-t / .008)
def pop(f=880):
    n = int(.12 * SR); t = np.arange(n) / SR; fr = f * (1 + .6 * np.exp(-t / .02)); return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / .04)
def whoosh(d=.45):
    n = int(d * SR); t = np.arange(n) / SR; x = rng.standard_normal(n); y = lp(x - lp(x, .03), .2 + .5 * t / d)
    return y * np.sin(np.pi * t / d) ** 2 * 1.4
for e in ev:
    if e['type'] == 'tap': add(sfx, e['t'], click(), .5)
    elif e['type'] == 'tip': add(sfx, e['t'], pop(1046), .22)
    elif e['type'] == 'scene': add(sfx, e['t'] - .2, whoosh(), .28)
def save(fn, x):
    x = np.clip(x, -1, 1); w = wave.open(fn, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype('<i2').tobytes()); w.close()
P = os.environ.get('PREFIX', ''); save(P + 'music.wav', mus / np.max(np.abs(mus)) * .8); save(P + 'sfx.wav', sfx / max(1e-9, np.max(np.abs(sfx))) * .8); print('ok', len(ev), 'events')
