/*
clank-client.js

clank controller client side

Jake Read at the Center for Bits and Atoms
(c) Massachusetts Institute of Technology 2020

This work may be reproduced, modified, distributed, performed, and
displayed for any purpose, but must acknowledge the open systems assembly protocol (OSAP) project.
Copyright is retained and must be preserved. The work is provided as is;
no warranty is provided, and users accept all liability.
*/

'use strict'

import OSAP from '../osapjs/core/osap.js'
import PK from '../osapjs/core/packets.js'
import { TS, VT } from '../osapjs/core/ts.js'
import TIME from '../osapjs/core/time.js'
// import BladePlateVM from '../osapjs/vms/bladePlateVirtualMachine.js'

import Grid from '../osapjs/client/interface/grid.js' // main drawing API 
import { Button, EZButton, Slider, TextBlock, TextInput } from '../osapjs/client/interface/basics.js'
import AXLMotorVM from '../osapjs/vms/axlMotorVM.js'
import AXLMotionHeadVM from '../osapjs/vms/axlMotionHeadVM.js'
import LoadVM from '../osapjs/vms/loadcellVirtualMachine.js'
import LoadPanel from '../osapjs/client/components/loadPanel.js'
import TempVM from '../osapjs/vms/tempVirtualMachine.js'
import TempPanel from '../osapjs/client/components/tempPanel.js'
import Pad from '../osapjs/client/components/pad.js'

import { flattenSVG } from "./svglib/flattenSVG.js"

import { SaveFile } from '../osapjs/client/utes/saveFile.js'
import { GetFile } from '../osapjs/client/utes/getFile.js'

// lol, snake genny 
import snakeGen from '../osapjs/test/snakeGen.js'

/*
import Pad from '../osapjs/client/components/pad.js'
import AXLClankVM from './axlClankVM.js'

// test / etc... 
import { flattenSVG } from "./svglib/flattenSVG.js"
import testPath from './save/pathTest.js'
import testSVGs from './svglib/svgLazyImport.js'
*/

console.log("hello AXL controller")

// the osap root node:
let osap = new OSAP("axl-testbed")

let grid = new Grid()

// -------------------------------------------------------- SETUP NETWORK / PORT 

let wscVPort = osap.vPort("wscVPort")

// -------------------------------------------------------- New Config Shit 

let motionSettings = {
  junctionDeviation: 0.05,
  accelLimits: [1500, 1500, 250, 250],
  velLimits: [300, 300, 100, 50]
}

// note that home rate x accel-rate gives us a home-stop-distance, 
// which is sometimes *too large* for the endstop-thwapping...
// todo is axl-calculates-these-results (also max. rates given SPU & clock), and informs... 

let numDof = 4

let xyMicroStep = 8
let xySPU = 40
let xyHomeRate = 12.5
let xyHomeOffset = 5

let zMicroStep = 4
let zSPU = 107.1428571
let zHomeRate = 8
let zHomeOffset = 5

// we're ostensibly doing cubic mm/sec in the request 
let eMicrostep = 8
let eSPU = 23.5

// we can calculate max rates... 
let maxTickPerSecond = 10000
let xyMaxRate = maxTickPerSecond / xySPU
let zMaxRate = maxTickPerSecond / zSPU
let eMaxRate = maxTickPerSecond / eSPU

if (motionSettings.velLimits[0] > xyMaxRate - 5) {
  motionSettings.velLimits[0] = xyMaxRate - 5
  console.warn(`lowering x max rate to ${motionSettings.velLimits[0]}`)
}
if (motionSettings.velLimits[1] > xyMaxRate - 5) {
  motionSettings.velLimits[1] = xyMaxRate - 5
  console.warn(`lowering y max rate to ${motionSettings.velLimits[1]}`)
}
if (motionSettings.velLimits[2] > zMaxRate - 5) {
  motionSettings.velLimits[2] = Math.round(zMaxRate - 5) // parseInt aka round... 
  console.warn(`lowering z max rate to ${motionSettings.velLimits[2]}`)
}
if (motionSettings.velLimits[3] > zMaxRate - 1) {
  motionSettings.velLimits[3] = Math.round(zMaxRate - 1) // parseInt aka round... 
  console.warn(`lowering e max rate to ${motionSettings.velLimits[e]}`)
}

let posnAfterHome = [250, 210, 195, 0]

let broadcaster = osap.endpoint("stateBroadcaster")

let tapListener = osap.endpoint("tapListener")
tapListener.onData = (data) => {
  console.warn(`! tap`)
}

let AXL_MODE_ACCEL = 1
let AXL_MODE_VELOCITY = 2
let AXL_MODE_POSITION = 3
let AXL_MODE_QUEUE = 4

let headVM = null

let broadcastMotionState = async (mode, vals, set = false) => {
  try {
    if (vals.length != numDof) {
      throw new Error(`need array of len ${numDof} dofs, was given ${vals.length}`);
    }
    // pack, 
    let datagram = new Uint8Array(numDof * 4 + 2)
    datagram[0] = mode
    // set, or target?
    set ? datagram[1] = 1 : datagram[1] = 0;
    // write args... 
    for (let a = 0; a < numDof; a++) {
      TS.write("float32", vals[a], datagram, a * 4 + 2)
    }
    // ship it, 
    await broadcaster.write(datagram, "ackless")
    // also updoot the headVM if in position-mode, 
    if (headVM && (mode == AXL_MODE_POSITION)) {
      await headVM.motion.setPosition(vals)
    }
  } catch (err) {
    throw err
  }
}

// use to load minimal filament-loading interface 
let loadMode = false 
let useSavedReadings = false

let setupCode = async () => {
  try {
    // get previous readings...
    let savedReadings = await GetFile('save/testZMeshProbeData.json')
    //await osap.hl.addToKeepAlive("rt_motion-head")
    //console.log(`SETUP: KA to head is setup, now building head VM`)
    headVM = new AXLMotionHeadVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_motion-head")).route), motionSettings)
    await headVM.motion.setup()
    console.log(`SETUP: motion-head VM seems OK`)
    // power cycle... long wait for the power come-down, welp, 
    // another note: cycling 24v *on* does some murderous stuff, avoid if you want to avoid deleting remote state 
    await headVM.setPowerStates(false, false)
    await TIME.delay(1500)
    await headVM.setPowerStates(true, true)
    await TIME.delay(2500)
    console.log(`SETUP: cycled power...`)
    // let's do the heater & extruder motor, then we can operate in a setup situation,
    // get the heater module & set temp, 
    let heaterVM = new TempVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_heater-module")).route))
    //await heaterVM.setExtruderTemp(210)
    await heaterVM.setPCF(0)
    // build a plotter for it, 
    let tempPanel = new TempPanel(heaterVM, 30, 10, 220, 'hotend')
    let motors = []
    // E Motor 
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_e")).route), {
      motion: motionSettings,
      axis: 3,
      invert: false,
      microstep: eMicrostep,
      spu: eSPU,
      cscale: 0.0,
      homeRate: xyHomeRate,
      homeOffset: xyHomeOffset
    }))
    motors[0].setup()
    console.warn(`SETUP: e motor config'd`)
    // buttons to load / unload fil 
    let fwdFillButton = new Button(10, 500, 84, 84, 'load fil')
    fwdFillButton.onClick(async () => {
      try {
        console.log(`fil down`)
        await motors[0].motion.targetVelocity([0, 0, 0, 5])
      } catch (err) {
        console.error(err)
      }
    })
    let stopFilButton = new Button(10, 600, 84, 84, 'stop')
    stopFilButton.onClick(async () => {
      try {
        console.log(`fil down`)
        await motors[0].motion.targetVelocity([0, 0, 0, 0])
      } catch (err) {
        console.error(err)
      }
    })
    let backFilButton = new Button(10, 700, 84, 84, 'unload fil')
    backFilButton.onClick(async () => {
      try {
        console.log(`fil down`)
        await motors[0].motion.targetVelocity([0, 0, 0, -10])
      } catch (err) {
        console.error(err)
      }
    })
    // get the load panel... 
    let loadcellVM = new LoadVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_loadcell-amps")).route))
    console.warn(`SETUP: loadcell config'd`)
    let loadPanel = new LoadPanel(loadcellVM, 10, 280, 'nozzle_p')
    if (loadMode) {
      return
    }
    // confirm motor is here / available, 
    //await osap.hl.addToKeepAlive("rt_axl-stepper_x") // it'd be tite also to have "class" and "name" semantics 
    //await osap.hl.addToKeepAlive("rt_axl-stepper_y")
    //console.log(`SETUP: KA to motors is ok... `)
    await osap.hl.buildBroadcastRoute(
      "ep_stateBroadcaster",
      [
        "rt_axl-stepper_x", "rt_axl-stepper_y-left", "rt_axl-stepper_y-right",
        "rt_axl-stepper_z-front-left", "rt_axl-stepper_z-rear-left", "rt_axl-stepper_z-front-right", "rt_axl-stepper_z-rear-right",
        "rt_axl-stepper_e"
      ],
      "ep_states",
      // true
    )
    console.warn(`SETUP: state broadcast route is complete...`)
    await osap.hl.buildBroadcastRoute(
      "ep_precalculatedMoveOutput",
      [
        "rt_axl-stepper_x", "rt_axl-stepper_y-left", "rt_axl-stepper_y-right",
        "rt_axl-stepper_z-front-left", "rt_axl-stepper_z-rear-left", "rt_axl-stepper_z-front-right", "rt_axl-stepper_z-rear-right",
        "rt_axl-stepper_e"
      ],
      "ep_precalculatedMoves",
      // true
    )
    console.warn(`SETUP: calc'd moves broadcast route is complete...`)
    // each of the motors... yikes 
    // get the motors, AFAIK we can treat these as a group almost always... 
    // X Motor
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_x")).route), {
      motion: motionSettings,
      axis: 0,
      invert: false,
      microstep: xyMicroStep,
      spu: xySPU,
      cscale: 0.25,
      homeRate: xyHomeRate,
      homeOffset: xyHomeOffset
    }))
    console.warn(`SETUP: x motor config'd`)
    // Y Motors 
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_y-left")).route), {
      motion: motionSettings,
      axis: 1,
      invert: true,
      microstep: xyMicroStep,
      spu: xySPU,
      cscale: 0.25,
      homeRate: xyHomeRate,
      homeOffset: xyHomeOffset
    }))
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_y-right")).route), {
      motion: motionSettings,
      axis: 1,
      invert: false,
      microstep: xyMicroStep,
      spu: xySPU,
      cscale: 0.25,
      homeRate: xyHomeRate,
      homeOffset: xyHomeOffset
    }))
    console.warn(`SETUP: y motors config'd`)
    // Z Motors 
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_z-front-left")).route), {
      motion: motionSettings,
      axis: 2,
      invert: true,
      microstep: zMicroStep,
      spu: zSPU,
      cscale: 0.4,
      homeRate: zHomeRate,
      homeOffset: zHomeOffset
    }))
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_z-rear-left")).route), {
      motion: motionSettings,
      axis: 2,
      invert: false,
      microstep: zMicroStep,
      spu: zSPU,
      cscale: 0.4,
      homeRate: zHomeRate,
      homeOffset: zHomeOffset
    }))
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_z-front-right")).route), {
      motion: motionSettings,
      axis: 2,
      invert: false,
      microstep: zMicroStep,
      spu: zSPU,
      cscale: 0.4,
      homeRate: zHomeRate,
      homeOffset: zHomeOffset
    }))
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_z-rear-right")).route), {
      motion: motionSettings,
      axis: 2,
      invert: true,
      microstep: zMicroStep,
      spu: zSPU,
      cscale: 0.4,
      homeRate: zHomeRate,
      homeOffset: zHomeOffset
    }))
    console.warn(`SETUP: z motors config'd`)
    // call all setups, 
    for (let mot of motors) {
      await mot.setup()
    }
    console.warn(`SETUP: motors initialized, homeing...`)
    // now we'd like to home 'em, 
    // ... do all four z-motors first, 
    // let's try this Promise.all() ? works well, nice 
    await Promise.all([motors[4].home(), motors[5].home(), motors[6].home(), motors[7].home()])
    console.warn(`SETUP: z motors homed...`)
    await Promise.all([motors[1].home(), motors[2].home(), motors[3].home()])
    console.warn(`SETUP: xy motors homed...`)
    // now we want to try this quick hack to test is set-posn works as expected 
    let prmses = []
    for (let mot of motors) {
      prmses.push(mot.motion.setPosition(posnAfterHome))
    }
    await Promise.all(prmses)
    console.warn(`SETUP: set all posns to X: ${posnAfterHome[0]}, Y: ${posnAfterHome[1]}, Z: ${posnAfterHome[2]}`)
    // then see if we can move 'em... 
    let posn = [25, 25, 25, 0]
    console.warn(`SETUP: moving...`)
    await broadcastMotionState(AXL_MODE_POSITION, posn)
    await TIME.delay(150)
    await Promise.all([motors[0].motion.awaitMotionEnd(), motors[1].motion.awaitMotionEnd(), motors[3].motion.awaitMotionEnd()])
    // -------------------------------------------------- refit, or dont 
    let polyFit = null 
    if (useSavedReadings) {
      console.warn(`SETUP: using saved leveling data`)
      polyFit = await planeFit(savedReadings)
    } else {
      // tap tap 
      console.log(`PP: setting up tap routes...`)
      let broadcastChannel = await osap.hl.buildBroadcastRoute(
        "ep_loadcell-comparator",
        [
          "rt_axl-stepper_x", "rt_axl-stepper_y-left", "rt_axl-stepper_y-right",
          "rt_axl-stepper_z-front-left", "rt_axl-stepper_z-rear-left", "rt_axl-stepper_z-front-right", "rt_axl-stepper_z-rear-right",
          "rt_axl-stepper_e"
        ],
        "ep_halt",
        true
      )
      // get the z-height of the bed, in current WCS, at x,y -> 
      let probePoint = async (x, y) => {
        let zUp = 5
        console.log(`PP: casting motion state...`)
        await broadcastMotionState(AXL_MODE_POSITION, [x, y, zUp, 0])
        await TIME.delay(150)
        await Promise.all([motors[0].motion.awaitMotionEnd(), motors[1].motion.awaitMotionEnd(), motors[3].motion.awaitMotionEnd()])
        // -------------- 
        console.log(`PP: reset tappet`)
        await loadcellVM.setupTapComparator('negative', 6000)
        console.log(`PP: set z -ve motion`)
        await broadcastMotionState(AXL_MODE_VELOCITY, [0, 0, -5, 0])
        console.log(`PP: awaiting tap -------------------------------`)
        await TIME.delay(250)
        await Promise.all([motors[0].motion.awaitMotionEnd(), motors[1].motion.awaitMotionEnd(), motors[3].motion.awaitMotionEnd()])
        console.log(`PP: motion ended, getting posns`)
        // collect *all* z motor states, get their avg and print deviations... 
        let zStates = await Promise.all([motors[3].motion.getStates(), motors[4].motion.getStates(), motors[5].motion.getStates(), motors[6].motion.getStates()])
        let avg = 0
        for (let state of zStates) {
          avg += state.positions[2]
        }
        avg = avg / 4
        console.log(`PP: got zPosition ${avg}, deviations:
      ${(avg - zStates[0].positions[2]).toFixed(3)}, 
      ${(avg - zStates[1].positions[2]).toFixed(3)},
      ${(avg - zStates[2].positions[2]).toFixed(3)},
      ${(avg - zStates[3].positions[2]).toFixed(3)}`)
        // now decrease comparator sensitivity... 
        console.log(`PP: desensitize tappet`)
        await loadcellVM.setupTapForLift()
        // go *up* before next 
        console.log(`PP: lift z`)
        await broadcastMotionState(AXL_MODE_POSITION, [x, y, zUp, 0])
        await TIME.delay(150)
        await Promise.all([motors[0].motion.awaitMotionEnd(), motors[1].motion.awaitMotionEnd(), motors[3].motion.awaitMotionEnd()])
        return avg
      }
      // ok now try to do...
      let yDomain = [40, 200]
      let xDomain = [40, 200]
      let intervals = 3
      let probeData = []
      console.warn(`SETUP: getting freshy bed points...`)
      for (let y = yDomain[0]; y <= yDomain[1] + 0.5; y += (yDomain[1] - yDomain[0]) / intervals) {
        for (let x = xDomain[0]; x <= xDomain[1] + 0.5; x += (xDomain[1] - xDomain[0]) / intervals) {
          let zPos = await probePoint(x, y)
          probeData.push([x, y, zPos])
          console.log('probed ---------------------------------')
        }
      }
      await TIME.delay(100)
      await Promise.all([motors[0].motion.awaitMotionEnd(), motors[1].motion.awaitMotionEnd()])
      await broadcastMotionState(AXL_MODE_POSITION, [100, 100, 180, 0])
      // now RM tap-loadcell-routes... this might be buggy, 
      console.warn(`PP: trying to rm broadcast routes...`)
      await osap.hl.removeBroadcastRoute(broadcastChannel)
      console.warn(`PP: done rm broad routes`)
      // we should save this... 
      console.warn(`PP: saving...`)
      SaveFile(probeData, 'json', 'probeData')
      // let's compare, 
      for (let p in probeData) {
        console.log(`Probe compare at ${p} is ${probeData[p][2].toFixed(3)} new vs. ${savedReadings[p][2].toFixed(3)}, diff ${(probeData[p][2] - savedReadings[p][2]).toFixed(3)}`)
      }
      // ok we can use the fit now... 
      polyFit = await planeFit(probeData)
    }
    // snakegen! 
    let path = snakeGen(11, 11, 11, 0.4, 0.4, 5)
    console.warn(`SNAKE path is ${path.length} moves in length, offsetting z's...`)
    for (let p of path) {
      p[0] += 50
      p[1] += 50
      p[2] += polyFit.predict([[p[0], p[1]]])[0][0] + 1.5
      p[3] = p[3] * 1.5
    }
    console.warn(`SNAKE offset...`)
    console.log(path)
    // send 'em, right? 
    for (let p in path) {
      let targ = path[p]
      console.warn(`sending ${p}/${path.length}... ${path[p][3].toFixed(3)}`)
      await headVM.motion.addMoveToQueue({
        target: targ,
        rate: 50
      })
    }
    console.warn(`DONE`)
    console.log(`------------------------------------------`)
  } catch (err) {
    console.error(err)
  }
}

setTimeout(setupCode, 750)

let planeFit = async (readings) => {
  try {
    if (!readings) readings = await GetFile('save/testZMeshProbeData.json')
    console.log(`fitting quadratic surface for`, readings)
    let pr = new RegressionMultivariatePolynomial.PolynomialRegressor(2)
    // we do pr.fit(x, y) where x are md data, y are md outputs... (?)
    let x = []
    let y = []
    for (let s = 0; s < readings.length; s++) {
      x.push([readings[s][0], readings[s][1]])
      y.push([readings[s][2]])
    }
    pr.fit(x, y)
    return pr
  } catch (err) {
    console.error(err)
  }
}

/*
let plotMachinePosition = async () => {
  try {
    let states = await glHeadVM.motion.getStates()
    pad.drawPosition(states.positions)
    pad.redraw()
    //console.log(states.positions)
    setTimeout(plotMachinePosition, 0)
  } catch (err) {
    console.error(err)
  }
}

let lpBtn = new Button(10, 10, 84, 84, 'goto...')
lpBtn.onClick(async () => {
  try {
    await mvm.motion.setPosition([25000, 0, 0])
    console.warn(`set position...`)
    let stopLoop = false
    lpBtn.onClick(() => {
      stopLoop = true
    })
    while (!stopLoop) {
      let states = await mvm.motion.getStates()
      let msg = ""
      msg += `${states.positions[0].toFixed(2)},\t ${states.velocities[0].toFixed(2)},\t ${states.accelerations[0].toFixed(2)}, `
      console.log(msg)
      await TIME.delay(100)
    }
    console.warn(`lp broken`)
  } catch (err) {
    console.error(err)
  }
})

let xBox = new Button(10, 110, 84, 124, 'x')
let yBox = new Button(10, 250, 84, 124, 'y')
let startUpdateLoop = async () => {
  try {
    let stopLoop = false
    xBox.onClick(() => { stopLoop = true })
    while (!stopLoop) {
      let states = await mvm1.motion.getStates()
      let axis = 0
      xBox.setHTML(`${states.positions[axis].toFixed(2)}<br>${states.velocities[axis].toFixed(2)}<br>${states.accelerations[axis].toFixed(2)}`)
      axis = 1
      //yBox.setHTML(`${states.positions[axis].toFixed(2)}<br>${states.velocities[axis].toFixed(2)}<br>${states.accelerations[axis].toFixed(2)}`)
      //pad.drawPosition(states.positions)
      //pad.redraw()
    }
  } catch (err) {
    console.error(err)
  }
}
xBox.onClick(startUpdateLoop)
*/

/*
// don't rm this quite yet, will want it back when this returns to actually being the AXL test page... 
// -------------------------------------------------------- SVG Kit
// deltas, one-pass: 0.114, 0.109 
// deltas, four-pass: 0.266, 0.437 
// after the 'fix' - 0.369, 0.120 

let svgImport = async (path) => {
  try {
    let file = await GetFile(path)
    let txt = new XMLSerializer().serializeToString(file.documentElement);
    //console.log(txt)
    // put it in the temp element (in index.html)
    const temp = document.querySelector("#temp");
    temp.innerHTML = txt;
    let paths = flattenSVG(temp);
    for (let l = 1; l < paths.length; l++) {
      for (let p = 0; p < paths[l].points.length; p++) {
        let pnt = paths[l].points[p]
        pad.addPoint(pnt)
        //console.log(pnt)
      }
    }
    pad.redraw()
    // kick das loop, 
    startUpdateLoop()
    // now try adding 'em to queue,
    for (let l = 1; l < paths.length; l++) {
      let nextPt = 0
      let aroundCount = 0
      let getNext = async () => {
        let ret = nextPt
        nextPt++
        if (nextPt >= paths[l].points.length) {
          nextPt = 0
          aroundCount++
          if (aroundCount > 3) {
            await mvm.motion.awaitMotionEnd()
            let pos = await mvm.motion.getStates()
            pos = pos.positions
            let xd = Math.abs(pos[0] - paths[l].points[0][0])
            let yd = Math.abs(pos[1] - paths[l].points[0][1])
            throw new Error(`deltas are ${xd}, ${yd}`)
          }
        }
        return ret
      }
      while (true) {
        let pnt = paths[l].points[await getNext()]
        await mvm.motion.addMoveToQueue({
          target: [pnt[0], pnt[1], 0],
          rate: 500
        })
        console.log(`${nextPt}/${paths[l].points.length} ... ${aroundCount}`)
      }
    }
  } catch (err) {
    console.error(err)
  }
}

// -------------------------------------------------------- The 'PAD' 

let pad = new Pad(120, 10, 700, 700, 1000, 1000)
pad.onNewTarget = async (pos) => {
  try {
    console.warn(`onNewTarget...`, pos)
    // we want to write a position target to the broadcaster, it should pump out on broadcast...
    await broadcastMotionState(3, [pos[0], pos[1], 0.0])
    console.warn(`... broadcast ok?`)
    // await mvm.motion.setPosition([pos[0], pos[1], 0])
    // console.log(`set ${pos[0]}`)
  } catch (err) {
    console.error(err)
  }
}
*/

// -------------------------------------------------------- Initializing the WSC Port 

// verbosity 
let LOGPHY = false
// to test these systems, the client (us) will kickstart a new process
// on the server, and try to establish connection to it.
console.log("making client-to-server request to start remote process,")
console.log("and connecting to it w/ new websocket")

let wscVPortStatus = "opening"
// here we attach the "clear to send" function,
// in this case we aren't going to flowcontrol anything, js buffers are infinite
// and also impossible to inspect  
wscVPort.cts = () => { return (wscVPortStatus == "open") }
// we also have isOpen, similarely simple here, 
wscVPort.isOpen = () => { return (wscVPortStatus == "open") }

// ok, let's ask to kick a process on the server,
// in response, we'll get it's IP and Port,
// then we can start a websocket client to connect there,
// automated remote-proc. w/ vPort & wss medium,
// for args, do '/processName.js?args=arg1,arg2'
jQuery.get('/startLocal/osapSerialBridge.js', (res) => {
  if (res.includes('OSAP-wss-addr:')) {
    let addr = res.substring(res.indexOf(':') + 2)
    if (addr.includes('ws://')) {
      wscVPortStatus = "opening"
      // start up, 
      console.log('starting socket to remote at', addr)
      let ws = new WebSocket(addr)
      ws.binaryType = "arraybuffer"
      // opens, 
      ws.onopen = (evt) => {
        wscVPortStatus = "open"
        // implement rx
        ws.onmessage = (msg) => {
          let uint = new Uint8Array(msg.data)
          wscVPort.receive(uint)
        }
        // implement tx 
        wscVPort.send = (buffer) => {
          if (LOGPHY) console.log('PHY WSC Send', buffer)
          ws.send(buffer)
        }
      }
      ws.onerror = (err) => {
        wscVPortStatus = "closed"
        console.log('sckt err', err)
      }
      ws.onclose = (evt) => {
        wscVPortStatus = "closed"
        console.log('sckt closed', evt)
      }
    }
  } else {
    console.error('remote OSAP not established', res)
  }
})