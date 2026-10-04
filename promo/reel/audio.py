import json, numpy as np, wave
SR=48000; tl=json.load(open('timeline.json')); T=tl['total']; N=int(T*SR)
L={l['key']:l for l in tl['lines']}
def W(k,w): return next(x[0] for x in L[k]['words'] if x[2].lower().strip('.,')==w.lower())
rng=np.random.default_rng(7)
mus=np.zeros(N); sfx=np.zeros(N)
def add(buf,t,sig,g=1.0):
    i=int(t*SR); j=min(N,i+len(sig))
    if i<N: buf[i:j]+=sig[:j-i]*g
def env(n,a=0.005,r=None,dec=None):
    t=np.arange(n)/SR; e=np.minimum(1,t/a) if a>0 else np.ones(n)
    if dec: e*=np.exp(-t/dec)
    return e
def note(f,dur,dec=0.35,harm=(1,.5,.25),a=0.004):
    n=int(dur*SR); t=np.arange(n)/SR
    s=sum(h*np.sin(2*np.pi*f*(k+1)*t) for k,h in enumerate(harm))
    return s*env(n,a,dec=dec)
def lp(x,a): # one-pole lowpass
    y=np.empty_like(x); acc=0.0
    for i in range(len(x)): acc+= a*(x[i]-acc); y[i]=acc
    return y
mid=lambda m:440*2**((m-69)/12)
BPM=100; beat=60/BPM; bar=4*beat
drop=L['brand']['start']
chords=[[57,60,64],[53,57,60],[48,52,55],[55,59,62]]  # Am F C G
# pad
t=np.arange(N)/SR
for ci in range(int(T/bar)+2):
    ch=chords[ci%4]; t0=ci*bar
    n=int((bar+0.6)*SR); tt=np.arange(n)/SR
    e=np.minimum(1,tt/0.5)*np.minimum(1,np.maximum(0,(bar+0.6-tt))/0.6)
    s=np.zeros(n)
    for m in ch+[ch[0]-12]:
        for det in (-0.12,0.12):
            f=mid(m)*2**(det/12)
            s+=np.sin(2*np.pi*f*tt)+0.3*np.sin(2*np.pi*2*f*tt)+0.12*np.sin(2*np.pi*3*f*tt)
    add(mus,t0,s*e*0.035)
# sub bass from drop
for ci in range(int(T/bar)+2):
    t0=ci*bar
    if t0+bar<drop: continue
    r=chords[ci%4][0]-24
    for b in range(8):
        tb=t0+b*beat/2
        if tb>=drop-0.01: add(mus,tb,note(mid(r),beat/2,dec=0.18,harm=(1,.3)),0.22)
# arpeggio plucks (16ths-ish 8ths) from drop
for ci in range(int(T/bar)+2):
    ch=chords[ci%4]; t0=ci*bar
    seq=[ch[0]+12,ch[1]+12,ch[2]+12,ch[1]+12,ch[0]+24,ch[2]+12,ch[1]+12,ch[2]+12]
    for k,m in enumerate(seq):
        tb=t0+k*beat/2
        if tb>=drop-0.01: add(mus,tb,note(mid(m),0.5,dec=0.12,harm=(1,.15,.05)),0.07)
# drums
def kick():
    n=int(0.35*SR); tt=np.arange(n)/SR; f=45+90*np.exp(-tt/0.04)
    return np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-tt/0.12)
def hat():
    n=int(0.06*SR); x=rng.standard_normal(n); x=np.diff(np.concatenate([[0],x])); return x*np.exp(-np.arange(n)/SR/0.012)
def clap():
    n=int(0.2*SR); x=rng.standard_normal(n); x=x-lp(x,0.15); return x*np.exp(-np.arange(n)/SR/0.05)
k=kick(); h=hat(); c=clap()
end_music=T-1.0
b=0
while True:
    tb=drop+b*beat
    if tb>end_music: break
    add(mus,tb,k,0.55)
    add(mus,tb+beat/2,h,0.10)
    if b%2==1: add(mus,tb,c,0.10)
    b+=1
# heartbeat in the hook
for hb in np.arange(0.0, drop-0.4, 0.9):
    add(mus,hb,kick(),0.35); add(mus,hb+0.22,kick(),0.22)
# master music fade in/out
fade=np.ones(N); fade[:int(0.3*SR)]=np.linspace(0,1,int(0.3*SR))
fo=int((T-2.2)*SR); fade[fo:]=np.linspace(1,0,N-fo)
mus*=fade
# ---- SFX ----
def whoosh(d=0.5,up=True):
    n=int(d*SR); x=rng.standard_normal(n); tt=np.arange(n)/SR
    a=np.linspace(0.02,0.25,n) if up else np.linspace(0.25,0.02,n)
    y=np.empty(n); acc=0
    for i in range(n): acc+=a[i]*(x[i]-acc); y[i]=acc
    e=np.sin(np.pi*tt/d)**2
    return y*e*3
def beep(f=1000,d=0.13):
    n=int(d*SR); tt=np.arange(n)/SR; return np.sin(2*np.pi*f*tt)*np.minimum(1,tt/0.003)*np.minimum(1,(d-tt)/0.02)
def pop(f=900):
    n=int(0.09*SR); tt=np.arange(n)/SR; fr=f*(1+1.5*np.exp(-tt/0.01)); return np.sin(2*np.pi*np.cumsum(fr)/SR)*np.exp(-tt/0.025)
def thud():
    n=int(0.4*SR); tt=np.arange(n)/SR; f=40+120*np.exp(-tt/0.03)
    s=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-tt/0.1); x=rng.standard_normal(n)*np.exp(-tt/0.02)*0.4
    return s+x
keys=[l['key'] for l in tl['lines']]
for kk in keys[2:]:
    add(sfx,L[kk]['start']-0.28-0.2,whoosh(0.5),0.35)
add(sfx,drop-0.55,whoosh(0.75),0.4)          # ECG sweep
add(sfx,drop+0.15,beep(1000),0.22); add(sfx,drop+0.5,beep(1000),0.12)
add(sfx,L['cta']['start']+0.1,beep(1000),0.2)
add(sfx,T-1.4,beep(1000,0.9),0.1)          # final flat beep
cs=L['chat']['start']
for tt_ in [cs+0.15, W('chat','чём'), W('chat','спросили')+0.25, W('chat','спросили')+1.1, W('chat','голосом')]:
    add(sfx,tt_+0.05,pop(900),0.35)
for tt_ in [W('exams','анализы'),W('exams','узи'),W('exams','экг'),W('exams','результаты')-0.15]:
    add(sfx,tt_+0.05,pop(1400),0.3)
add(sfx,W('review','диагноз')+0.35+0.28,thud(),0.55)
for tt_ in [W('review','клиническим'),W('review','упустили')-0.1,W('review','лечить')-0.25,W('free','два')-0.1]:
    add(sfx,tt_+0.05,pop(700),0.3)
def save(fn,x):
    x=np.clip(x,-1,1); w=wave.open(fn,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x*32767).astype('<i2').tobytes()); w.close()
save('music.wav',mus/np.max(np.abs(mus))*0.8); save('sfx.wav',sfx/np.max(np.abs(sfx))*0.8)
print('ok')
