import itertools, unicodedata, json
b=open('g2penv/lib/python3.13/site-packages/sea_g2p/sea_g2p.bin','rb').read()
S=set()
for p in b.split(b'\x00'):
    try: S.add(p.decode())
    except: pass
onsets=['','b','c','ch','d','đ','g','gh','gi','h','k','kh','l','m','n','ng','ngh','nh','p','ph','q','qu','r','s','t','th','tr','v','x']
nuclei=['a','ă','â','e','ê','i','o','ô','ơ','u','ư','y','ai','ao','au','ay','âu','ây','eo','êu','ia','iu','oa','oă','oe','oi','ôi','ơi','ua','uâ','uê','ui','uô','uơ','ưa','ưi','ưu','ươ','uy','iê','yê','uyê','oo','ôô','uya','uyu','oai','oay','oao','oeo','uây','uôi','ươi','ươu','iêu','yêu','ưa','uơ','ia','ya']
codas=['','c','ch','m','n','ng','nh','p','t']
tones={'̀','́','̉','̃','̣'}
vowels=set('aăâeêioôơuưy')
cands=set()
for o in onsets:
    for n in nuclei:
        for c in codas:
            base=o+n+c
            cands.add(base)
            for i,ch in enumerate(base):
                if ch in vowels and i>=len(o)-(1 if o in('gi','qu') else 0):
                    for t in tones:
                        w=unicodedata.normalize('NFC',base[:i]+unicodedata.normalize('NFD',ch)+t+base[i+1:])
                        cands.add(w)
found=sorted(w for w in cands if w in S)
print(len(cands),len(found))
json.dump(found,open('vi_syll.json','w'),ensure_ascii=False)
