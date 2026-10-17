# Музыка и звуки для ролика Нины: хаус 128 BPM, скрип пластинки и «грустный тромбон» на паузе, удары на «бац» и оценке.
import json, numpy as np, wave
SR=48000; tl=json.load(open('timeline.json')); T=tl['total']; N=int(T*SR)
L={l['key']:l for l in tl['lines']}
def W(k,w): return next(x[0] for x in L[k]['words'] if x[2].lower().strip('.,!«»')==w.lower())
rng=np.random.default_rng(3)
mus=np.zeros(N); sfx=np.zeros(N)
def add(buf,t,sig,g=1.0):
    i=int(t*SR)
    if i<0: sig=sig[-i:]; i=0
    j=min(N,i+len(sig))
    if i<N: buf[i:j]+=sig[:j-i]*g
mid=lambda m:440*2**((m-69)/12)
def tone(f,d,dec=0.2,harm=(1,.5,.25),a=0.003):
    n=int(d*SR); t=np.arange(n)/SR
    return sum(h*np.sin(2*np.pi*f*(k+1)*t) for k,h in enumerate(harm))*np.minimum(1,t/a)*np.exp(-t/dec)
def lp(x,a):
    y=np.empty_like(x); acc=0.0; a=np.broadcast_to(a,x.shape)  # коэффициент может меняться во времени
    for i in range(len(x)): acc+=a[i]*(x[i]-acc); y[i]=acc
    return y
beat=60/128; bar=4*beat
stop0=L['but']['start']-0.12          # музыка обрывается на «А вот…»
back=L['app']['start']-0.12           # и возвращается на «Поэтому…»
def on(t): return t<stop0-0.02 or t>=back-0.01
chords=[[60,64,67],[67,71,74],[69,72,76],[65,69,72]]  # C G Am F — мажор, весело
def kick():
    n=int(.3*SR); t=np.arange(n)/SR; f=48+110*np.exp(-t/.035); return np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t/.11)
def clap():
    n=int(.18*SR); x=rng.standard_normal(n); x=x-lp(x,.2); t=np.arange(n)/SR; e=np.exp(-t/.045)*(1+.6*(np.sin(2*np.pi*t/.012)>0)*(t<.03)); return x*e
def hat(d=.05):
    n=int(d*SR); x=np.diff(np.concatenate([[0],rng.standard_normal(n)])); return x*np.exp(-np.arange(n)/SR/.012)
def stab(ch):
    n=int(.22*SR); t=np.arange(n)/SR; s=np.zeros(n)
    for m in ch:
        for det in(-.1,.1):
            f=mid(m+12)*2**(det/12); s+=np.sign(np.sin(2*np.pi*f*t))*.35+np.sin(2*np.pi*f*t)
    return lp(s*np.exp(-t/.07),.25)
K,C=kick(),clap()
grid=np.arange(0,T,beat/4)  # 16-е
for i,tb in enumerate(grid):
    if not on(tb) or tb>T-0.5: continue
    q=i%16; ch=chords[int(tb/bar)%4]
    if q%4==0: add(mus,tb,K,.6)
    if q in(4,12): add(mus,tb,C,.16)
    add(mus,tb,hat(.03 if q%2 else .05),.05 if q%2 else .08)
    if q in(2,6,10,14): add(mus,tb,stab(ch),.10)          # офбит-стабы
    if q in(0,3,6,8,11,14): add(mus,tb,tone(mid(ch[0]-24),beat/2,dec=.12,harm=(1,.4)),.20)  # бас
    if q in(0,4,8,12,2,10): add(mus,tb,tone(mid(ch[(q//2)%3]+24),.3,dec=.08,harm=(1,.1)),.05)  # блестящий арп
# riser перед возвращением
n=int(1.0*SR); t=np.arange(n)/SR; x=rng.standard_normal(n); r=x-lp(x,.05+.5*t/1.0); add(mus,back-1.0,r*(t/1.0)**2*.25)
# конец — короткий хвост
fade=np.ones(N); fo=int((T-0.6)*SR); fade[fo:]=np.linspace(1,0,N-fo); mus*=fade
# --- SFX ---
def scratch():
    n=int(.45*SR); t=np.arange(n)/SR; x=rng.standard_normal(n)
    sp=np.sin(2*np.pi*t*5)*np.exp(-t/.3)  # скорость «вперёд-назад»
    y=lp(x,.08+.3*np.abs(sp)); return y*np.abs(sp)*4
def trombone():  # «уа-уа-уа-уааа»
    out=[]
    for i,(m,d) in enumerate([(58,.32),(57,.32),(56,.32),(55,1.0)]):
        n=int(d*SR); t=np.arange(n)/SR; f=mid(m)*(1+(.012*np.sin(2*np.pi*6*t) if i==3 else 0))
        ph=2*np.pi*np.cumsum(np.ones(n)*f)/SR
        s=sum(h*np.sin(k*ph) for k,h in enumerate([1,.7,.5,.35,.2],1))
        e=np.minimum(1,t/.03)*np.minimum(1,(d-t)/.06)
        out.append(lp(s*e,.18))
    return np.concatenate(out)
def whoosh(d=.3):
    n=int(d*SR); t=np.arange(n)/SR; x=rng.standard_normal(n); y=x-lp(x,.02); y=lp(y,.3)
    return y*np.sin(np.pi*t/d)**2*1.5
def pop(f=900):
    n=int(.08*SR); t=np.arange(n)/SR; fr=f*(1+2*np.exp(-t/.008)); return np.sin(2*np.pi*np.cumsum(fr)/SR)*np.exp(-t/.022)
def boom():
    n=int(.9*SR); t=np.arange(n)/SR; f=35+140*np.exp(-t/.04)
    return np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t/.28)+rng.standard_normal(n)*np.exp(-t/.05)*.5
def ding():
    return tone(1568,1.2,dec=.35,harm=(1,.3,.1))+tone(2093,1.2,dec=.3,harm=(1,))*.6
for k in ['skel','app','score','cta']: add(sfx,L[k]['start']-0.12-0.12,whoosh(),.5)
add(sfx,stop0-0.05,scratch(),.7)
add(sfx,W('but','вести')+0.05,trombone(),.45)
for w in [('hi','нина'),('hi','четвёртый'),('skel','скелет'),('skel','теорию'),('app','спросила'),('app','назначила'),('app','диагноз'),('cta','бесплатно')]:
    add(sfx,W(*w),pop(800+200*(hash(w[1])%4)),.4)
add(sfx,W('app','бац'),boom(),.9)
add(sfx,L['score']['start']-0.1,boom(),.6); add(sfx,L['score']['start'],ding(),.35)
add(sfx,W('cta','приём')+0.3,ding(),.3)
def save(fn,x):
    x=np.clip(x,-1,1); w=wave.open(fn,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x*32767).astype('<i2').tobytes()); w.close()
save('music.wav',mus/np.max(np.abs(mus))*.8); save('sfx.wav',sfx/np.max(np.abs(sfx))*.8); print('ok')
