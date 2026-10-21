"""Build the report font from licensed local sources; preserve original font files."""
from pathlib import Path
import unicodedata,json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
base=Path('public/fonts')
font=TTFont(base/'Cairo.ttf')
if 'fvar' in font:font=instantiateVariableFont(font,{a.axisTag:(400 if a.axisTag=='wght' else a.defaultValue) for a in font['fvar'].axes},inplace=False)
cmap=font.getBestCmap();aliases=[]
# Cairo's base Unicode glyph is the isolated form. Only alias ISOLATED forms.
for cp in range(0xfe70,0xff00):
 if cp in cmap or not unicodedata.name(chr(cp),'').endswith('ISOLATED FORM'):continue
 text=unicodedata.normalize('NFKC',chr(cp))
 if len(text)!=1 or ord(text) not in cmap:continue
 for table in font['cmap'].tables:
  if table.isUnicode():table.cmap[cp]=cmap[ord(text)]
 aliases.append(hex(cp))
# Include the attendance check from DejaVu, decomposed and scaled to Cairo's UPEM.
symbols=TTFont(base/'DejaVuSans.ttf');symbol=symbols.getBestCmap()[0x2713]
record=DecomposingRecordingPen(symbols.getGlyphSet());symbols.getGlyphSet()[symbol].draw(record)
pen=TTGlyphPen(font.getGlyphSet());scale=font['head'].unitsPerEm/symbols['head'].unitsPerEm
record.replay(TransformPen(pen,(scale,0,0,scale,0,0)))
glyph_name='fanu_attendance_check'
font.setGlyphOrder(font.getGlyphOrder()+[glyph_name]);font['glyf'][glyph_name]=pen.glyph()
advance,lsb=symbols['hmtx'][symbol];font['hmtx'][glyph_name]=(round(advance*scale),round(lsb*scale))
for table in font['cmap'].tables:
 if table.isUnicode():table.cmap[0x2713]=glyph_name
font['maxp'].numGlyphs=len(font.getGlyphOrder())
for record in font['name'].names:
 if record.nameID in (1,3,4,6,16):record.string=('FANUArabic-Regular' if record.nameID==6 else 'FANU Arabic').encode(record.getEncoding(),errors='replace')
 if record.nameID in (2,17):record.string='Regular'.encode(record.getEncoding(),errors='replace')
font.save(base/'FANUArabic.ttf')
license_text=(base/'LICENSE-Cairo.txt').read_text('utf8')+'\n\nDejaVu attendance check glyph:\n'+(base/'LICENSE-DejaVu.txt').read_text('utf8')
(base/'LICENSE-FANUArabic.txt').write_text(license_text,'utf8')
print(json.dumps({'isolated_aliases':aliases,'allah_ligature':0xfdf2 in font.getBestCmap(),'attendance_check':0x2713 in font.getBestCmap(),'font':'FANUArabic.ttf'}))

