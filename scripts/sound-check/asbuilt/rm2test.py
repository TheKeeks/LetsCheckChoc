import time, numpy as np
from PIL import Image
import raymodel2 as m
t=time.time(); K,psi=m.trace(140,9); print('sec',time.time()-t)
crest=np.clip(np.cos(2*np.pi*psi),0,1)**6
hgt=np.clip(K/1.5,0,1)
img=np.zeros(K.shape+(3,))
img[...,2]=80+120*hgt; img[...,1]=40+150*hgt; img[...,0]=20+60*hgt
img+= (crest*hgt*180)[...,None]
img[~m.water]=(60,55,50)
Image.fromarray(np.clip(img,0,255).astype(np.uint8)).save('rm2_140_9.png')
