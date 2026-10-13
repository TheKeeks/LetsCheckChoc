# wrap site/choc-big.html as the repo's research/index.html (full document, body margin 0)
import sys
a=open('site/choc-big.html').read()
k=a.find('<div class="wrap">'); s=a.rfind('</style>\n',0,k); assert k>0 and s>0
out='<!doctype html>\n<html lang="en">\n<head>\n'+a[:s]+'body { margin: 0; }\n</style>\n<link rel="stylesheet" href="methods-theme.css">\n</head>\n<body>\n\n'+a[s+len('</style>\n'):].rstrip('\n')+'\n</body>\n</html>\n'
open(sys.argv[1],'w').write(out)
