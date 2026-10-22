# edge-tts: текст -> mp3 + тайминги слов (mp3.json)
import certifi, sys, os
if os.environ.get("SSL_CERT_FILE"): certifi.where = lambda: os.environ["SSL_CERT_FILE"]  # за прокси со своим CA
import asyncio, edge_tts
async def main(text, voice, out, rate, pitch):
    c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    subs = []
    with open(out, "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio": f.write(ch["data"])
            elif ch["type"] in ("WordBoundary","SentenceBoundary"): subs.append((ch["offset"]/1e7, ch["duration"]/1e7, ch["text"]))
    import json; json.dump(subs, open(out+".json","w"), ensure_ascii=False)
asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv)>4 else "+0%", sys.argv[5] if len(sys.argv)>5 else "+0Hz"))
