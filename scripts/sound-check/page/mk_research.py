# wrap site/choc-big.html as the repo's research/index.html (full document, body margin 0), and site/choc-map.html as
# research/map.html when a second path is given
import sys
for src, dst in zip(('site/choc-big.html', 'site/choc-map.html'), sys.argv[1:]):
    a=open(src).read()
    k=a.find('<div class="wrap">'); s=a.rfind('</style>\n',0,k); assert k>0 and s>0
    out='<!doctype html>\n<html lang="en">\n<head>\n'+a[:s]+'body { margin: 0; }\n</style>\n<link rel="stylesheet" href="methods-theme.css">\n</head>\n<body>\n\n'+a[s+len('</style>\n'):].rstrip('\n')+'\n</body>\n</html>\n'
    open(dst,'w').write(out)
