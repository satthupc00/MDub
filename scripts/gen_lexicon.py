import json,re
from vig2p import VietnameseG2P
from wordfreq import top_n_list
g=VietnameseG2P()
vi=json.load(open('vi_syll.json'))
WORD_RE=re.compile(r"^[A-Za-zÀ-ỹĐđ]+(?:[-'][A-Za-zÀ-ỹĐđ]+)*$")
tech="""mesh bone bones rig rigging rigged weight weights keyframe keyframes skin skins slot slots ik fk timeline spine cocos animation animator animate animated sprite sprites atlas texture textures shader shaders vertex vertices vertices uv uvs blender maya photoshop unity unreal render rendering renderer viewport layer layers mask masks path paths constraint constraints transform transforms deform deformation curve curves bezier tangent pivot origin scale rotate rotation translate shear clipping physics particle particles frame frames fps pixel pixels canvas brush brushes stroke strokes opacity blend blending mode export import json png psd fbx gltf obj workflow tutorial plugin plugins script scripts mesh-deform skeleton skeletons attachment attachments setup pose poses tween tweening easing loop loops subdivision topology retopology sculpt sculpting modeling modelling lowpoly highpoly normal normals bake baking lighting light lights camera cameras keying graph editor dopesheet node nodes inspector preview hierarchy prefab prefabs asset assets component components gameplay game games ui ux""".split()
words=set(w for w in top_n_list('en',40000) if WORD_RE.match(w))|set(tech)
vs=set(vi)
words=[w for w in sorted(words) if w not in vs]
lex={}
for w in vi: lex[w]=g(w)
en={}
for w in words: en[w]=g(w)
letters={c:g(c.upper()) for c in 'abcdefghijklmnopqrstuvwxyz'}
json.dump({'vi':lex,'en':en,'letters':letters},open('lex_raw.json','w'),ensure_ascii=False)
print(len(lex),len(en)); print(letters)
for w in ['mesh','bone','weight','rig','keyframe','ik','spine','youtube','tutorial']: print(w,en.get(w) or lex.get(w))
