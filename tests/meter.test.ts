import {expect,test} from "bun:test";
import {measures} from "../src/choir/meter.ts";

test("measures respect a meter change, compound meter, and a partial ending",()=>{
  const bars=measures({beats:15.5,meter:"3/4",meterChanges:[{beat:12,signature:"5/4"},{beat:6,signature:"6/8"}]});
  expect(bars.map(b=>[b.start,b.end,b.signature,b.printMeter])).toEqual([
    [0,3,"3/4",true],[3,6,"3/4",false],[6,9,"6/8",true],[9,12,"6/8",false],[12,15.5,"5/4",true]
  ]);
});
