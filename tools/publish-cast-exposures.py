"""Publish the same exposure keys as the editable projects into the Remotion stage library."""
from pathlib import Path
from PIL import Image
import json,math
root=Path(__file__).resolve().parents[1];out=root/'public/rehearsal/exposure-keys';out.mkdir(exist_ok=True);catalog=[]
for src in sorted((root/'out/animation-examples/cast').glob('*/exposures.json')):
    item=json.loads(src.read_text());keys=item['keys'];width,height=item['canvas']
    scale=min(1,480/max(width,height));w,h=round(width*scale),round(height*scale)
    sheet=Image.new('RGBA',(8*w,math.ceil(len(keys)/8)*h))
    for i,key in enumerate(keys):
        cel=Image.open(src.parent/key['image']).convert('RGBA')
        cel.thumbnail((w,h),Image.Resampling.LANCZOS)
        sheet.alpha_composite(cel,(i%8*w+(w-cel.width)//2,i//8*h+(h-cel.height)//2))
    slug=src.parent.name
    sheet.save(out/(slug+'.webp'),quality=94,method=4)
    catalog.append(dict(id=slug.title()+'-Exposure-Keys',slug=slug,width=w,height=h,count=len(keys),hold=keys[0]['duration']))
(root/'src/rehearsal/exposure-catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
