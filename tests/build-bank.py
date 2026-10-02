# -*- coding: utf-8 -*-
import json, io, os
DIR = r'D:/Downloads/数独'
ORDER = ['easy','medium','hard','expert','master']
NAMES = {'easy':'\u5165\u95e8','medium':'\u7b80\u5355','hard':'\u4e2d\u7b49','expert':'\u56f0\u96be','master':'\u5927\u5e08'}

def js(s):
    return s.replace('\\', '\\\\').replace("'", "\\'")

def load(d):
    p = os.path.join(DIR, 'tests/.bank-%s.json' % d)
    if os.path.exists(p):
        return json.load(io.open(p, encoding='utf-8'))
    p2 = os.path.join(DIR, 'tests/.bank-raw.json')
    if os.path.exists(p2):
        return json.load(io.open(p2, encoding='utf-8')).get(d, [])
    return []

raw = {}
for d in ORDER:
    raw[d] = load(d)

parts = []
for d in ORDER:
    segs = [r['g'] + '|' + str(r['l'] * 100 + r['c']) for r in raw[d]]
    parts.append("    " + d + ": '" + js(','.join(segs)) + "',")

names = ', '.join(d + ": '" + NAMES[d] + "'" for d in ORDER)
order = '[' + ', '.join("'" + d + "'" for d in ORDER) + ']'
counts = '\u3001'.join(str(len(raw[d])) + ' ' + NAMES[d] for d in ORDER)

TPL = io.open(os.path.join(DIR, 'tests/bank-template.js'), encoding='utf-8').read()
out = TPL.replace('@@COUNTS@@', counts).replace('@@PARTS@@', '\n'.join(parts)).replace('@@NAMES@@', names).replace('@@ORDER@@', order)
io.open(os.path.join(DIR, 'js/core/08b-bank-big.js'), 'w', encoding='utf-8', newline='\n').write(out)
for d in ORDER:
    print('%-8s %d' % (d, len(raw[d])))
print('total', sum(len(raw[d]) for d in ORDER))