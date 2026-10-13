import time, numpy as np
from PIL import Image
import crest2 as m
t=time.time(); psi=m.run(140,9); print('sec', time.time()-t, psi.min(), psi.max())
crest=np.clip(np.cos(2*np.pi*psi*2),0,1)**6
img=(crest*255).astype(np.uint8); img[m.land[m.dom]]=60
Image.fromarray(img[150:450,200:650]).resize((900,600)).save('c2_dbg.png')
Image.fromarray(img).save('c2_full.png')
