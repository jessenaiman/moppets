import {expect, test} from "bun:test";
import {mixStems, BUS_GAIN, wavBytes} from "../src/choir/mix.ts";
import {VocalBus, vocalPans} from "../src/choir/vocalBus.ts";

test("the offline stereo bounce matches streaming blocks, keeps backing centered and limits both channels", () => {
  const fs=48000, n=8192;
  const singer=Float32Array.from({length:n}, (_, i) => i<3000 ? Math.sin(2*Math.PI*220*i/fs) : 0);
  const backing=new Float32Array(n);
  backing[7000]=8;
  const mix=mixStems([singer,new Float32Array(n),backing],[1,1,1],n,2,fs);
  expect(mix.left).not.toEqual(mix.right);
  expect(mix.limited).toBeGreaterThan(0);
  expect(mix.peak).toBeCloseTo(10**(-1/20),5);
  const pan=vocalPans(2)[0], bus=new VocalBus(fs);
  for (let i=0; i<n; i+=128) {
    const l=singer.slice(i,i+128).map(v=>v*BUS_GAIN*pan.left);
    const r=singer.slice(i,i+128).map(v=>v*BUS_GAIN*pan.right);
    bus.process(l,r,backing.slice(i,i+128).map(v=>v*BUS_GAIN),l.length);
    expect(l).toEqual(mix.left.subarray(i,i+128));
    expect(r).toEqual(mix.right.subarray(i,i+128));
  }
  const dry=mixStems([backing],[1],n,0,fs);
  expect(dry.left).toEqual(dry.right);
  expect(dry.left.filter(v=>v!==0)).toHaveLength(1);
  const wav=new DataView(wavBytes(mix.left,fs,mix.right));
  expect(wav.getUint16(22,true)).toBe(2);
  expect(wav.byteLength).toBe(44+4*n);
});
