// Velocity palette in Novation’s Launchkey MK3 Programmer’s Reference, p. 11.
const palette = (
  "616161 b3b3b3 dddddd ffffff ffb3b2 ff615b e35d61 b16160 fff2d7 ffb067 d88f60 b07761 ffeda4 fffe5f dade61 b0b261 " +
  "defca4 c3fe62 a0dc66 81b35d c2feb4 61fd61 61db5d 60b163 c2fec5 60fe94 63da7b 62b36b c3fece 5fffce 5bdfa0 61b57f " +
  "c1fef4 5efde8 5adfc2 61b496 c3f3fe 5ff0fb 60c8db 60a3b2 c1ddfc 60c6ff 5fa2de 5e82af a08dfd 6060fb 6260e0 625fb3 " +
  "c9b3fe a060fd 7f61db 765fb1 feb3fd ff61fe de61de b260ae feb3d6 ff61c1 dc61a0 b3618c fe7660 e8b364 dcc261 a2a061 " +
  "5fb25a 5db389 588ad1 6061fc 5bb2af 8a5ff0 ccb1c0 8a7681 ff5e66 f5fea1 effa61 ccff60 78dc62 61fcca 60e9fd 5e9ffc " +
  "8c5ffa c85ffa ed8adc a3745f fea263 ddf660 d6ff8b 5efe5e b3fd9f cafdd8 aefef7 cbe6ff a2c0f9 d8c2fb fe88ff fd60c9 " +
  "ffbf5d f5ed62 e4fe60 decf5e afa161 5fbd6e 74c08f 7f80a0 828bcc d1a97c e0605c fab39f f6ba78 fcf38a e8f9a0 d5ec7b " +
  "7f81a1 f8f8d4 ddfce4 e9eafb e3d6fe b2b2b0 d5d5d5 f8fefd e7615e ab605e 80f65f 60b461 f2ef61 b1a15f efc061 c27561"
).trim().split(/\s+/).map(hex => parseInt(hex,16));

export function padSwatch(color:string){
  const rgb=parseInt(color.slice(1),16);
  let closest=0, distance=Infinity;
  for(const [i,value] of palette.entries()){
    if (i===0) continue; // Velocity zero extinguishes the LED.
    const dr=(rgb>>16)-(value>>16), dg=((rgb>>8)&255)-((value>>8)&255), db=(rgb&255)-(value&255);
    const d=2*dr*dr+4*dg*dg+db*db;
    if(d<distance){closest=i;distance=d}
  }
  return {index:closest,color:"#"+palette[closest].toString(16).padStart(6,"0")};
}
