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
import circleGen from '../osapjs/test/circleGen.js'

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
  accelLimits: [3000, 3000, 2500],
  velLimits: [300, 300, 100]
}

// note that home rate x accel-rate gives us a home-stop-distance, 
// which is sometimes *too large* for the endstop-thwapping...
// todo is axl-calculates-these-results (also max. rates given SPU & clock), and informs... 

let numDof = 3

let xyMicroStep = 4
let xySPU = 20
let xyHomeRate = 12.5
let xyHomeOffset = 5

let zMicroStep = 4
let zSPU = 105
let zHomeRate = 100
let zHomeOffset = 1

let posnOffset = [280, 230, 10]

let transform = (vals, position = false) => {
  if (position) {
    //console.log('posn offsets!')
    for (let a = 0; a < numDof; a++) {
      vals[a] -= posnOffset[a]
    }
    //console.log(JSON.parse(JSON.stringify(vals)))
  }
  // do the transform... 
  let tfVals = new Array(numDof)
  // tfVals[0] = 0.5 * (vals[0] + vals[1])
  // tfVals[1] = 0.5 * (vals[0] - vals[1])
  tfVals[0] = vals[0] + vals[1]
  tfVals[1] = vals[0] - vals[1]
  // set back to og array, don't touch z 
  vals[0] = tfVals[0]
  vals[1] = tfVals[1]
  //console.log(JSON.parse(JSON.stringify(vals)))
}

// we can calculate max rates... 
let maxTickPerSecond = 10000
let xyMaxRate = maxTickPerSecond / xySPU
let zMaxRate = maxTickPerSecond / zSPU

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

// setup to broadcast motion out... 

let AXL_MODE_ACCEL = 1
let AXL_MODE_VELOCITY = 2
let AXL_MODE_POSITION = 3
let AXL_MODE_QUEUE = 4

let headVM = null

let stateBroadcaster = osap.endpoint("stateBroadcaster")
let broadcastMotionState = async (mode, vals, set = false, superset = false) => {
  try {
    if (vals.length != numDof) {
      throw new Error(`need array of len ${numDof} dofs, was given ${vals.length}`);
    }
    // ------------ COREXY 
    if (!superset) {
      transform(vals, (mode == AXL_MODE_POSITION))
    }
    console.log(JSON.parse(JSON.stringify(vals)))
    // ------------ END COREXY 
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
    await stateBroadcaster.write(datagram, "ackless")
    // also updoot the headVM if in position-mode, 
    if (headVM && (mode == AXL_MODE_POSITION)) {
      await headVM.motion.setPosition(vals)
    }
  } catch (err) {
    throw err
  }
}

let haltBroadcaster = osap.endpoint("haltBroadcaster")

let sketchToMoves = (sketch) => {
  console.log(sketch)
  let curves = sketch.curves 
  let moves = []
  let zUp = -8
  let zDown = -15
  let jogRate = 300
  let penRate = 200
  let scale = 25.4 / 2
  // some awkward parsing...
  let keys = Object.keys(curves)
  for(let key of keys){
    let obj = curves[key]
    switch(obj.type){
      case "adsk::fusion::SketchLine":
        moves.push({
          target: [obj.startpt.x * scale, obj.startpt.y * scale, zUp],
          rate: jogRate
        })
        moves.push({
          target: [obj.startpt.x * scale, obj.startpt.y * scale, zDown],
          rate: penRate
        })
        moves.push({
          target: [obj.endpt.x * scale, obj.endpt.y * scale, zDown],
          rate: penRate
        })
        moves.push({
          target: [obj.endpt.x * scale, obj.endpt.y * scale, zUp],
          rate: jogRate
        })
        break
      default:
        console.error(`unknown obj type ${obj.type} found, bailing...`)
    }
  } // end key-of-keys
  return moves 
}

let testImportCode = async () => {
  try {
    let data = await GetFile("save/adskTestData.json")
    return sketchToMoves(data)
  } catch (err) {
    console.error(err)
  }
}

let adskPull = () => {
  return new Promise((resolve, reject) => {
    let addr = "ws://localhost:8769"
    console.log('starting socket to remote at', addr)
    let adskWS = new WebSocket(addr)
    // testImportCode().then((res) => {
    //   resolve(res)
    // })
    // opens, 
    adskWS.onopen = (evt) => {
      console.log("WS Opened (!)")
      // implement rx
      adskWS.onmessage = (msg) => {
        console.log("RX from ADSK...")
        console.log(JSON.parse(msg.data))
        resolve(sketchToMoves(JSON.parse(msg.data)))
        // let uint = new Uint8Array(msg.data)
        // wscVPort.receive(uint)
      }
      // implement tx 
      let send = (buffer) => {
        // if (LOGPHY) console.log('PHY WSC Send', buffer)
        adskWS.send(buffer)
      }
    
      // we should be in echo town, so,
      adskWS.send("hello...")
    }
    
    adskWS.onerror = (err) => {
      // wscVPortStatus = "closed"
      console.log('sckt err', err)
    }
    
    adskWS.onclose = (evt) => {
      // wscVPortStatus = "closed"
      console.log('sckt closed', evt)
    }  
  })
}

let setupCode = async () => {
  try {
    let moves = await adskPull()
    console.log('supplied moves are...', moves)
    // find the head... 
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
    // get ahn graph to operate on, 
    let graph = await osap.nr.sweep()
    // collect motors 
    let motors = []
    // rear left, rear right motors, 
    // we're going to call them axis 0, 1, and try to just muddle our own corexy hack... 
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_rl", graph)).route), {
      motion: motionSettings,
      axis: 0,
      invert: true,
      microstep: xyMicroStep,
      spu: xySPU,
      cscale: 0.35,
      homeRate: xyHomeRate,
      homeOffset: xyHomeOffset
    }))
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_rr", graph)).route), {
      motion: motionSettings,
      axis: 1,
      invert: true,
      microstep: xyMicroStep,
      spu: xySPU,
      cscale: 0.35,
      homeRate: xyHomeRate,
      homeOffset: xyHomeOffset
    }))
    // Z Motor 
    motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_z", graph)).route), {
      motion: motionSettings,
      axis: 2,
      invert: false,
      microstep: zMicroStep,
      spu: zSPU,
      cscale: 0.35,
      homeRate: zHomeRate,
      homeOffset: zHomeOffset
    }))
    // set 'em up, 
    for (let motor of motors) {
      motor.setup()
    }
    console.warn(`SETUP: motors all config'd`)
    // make a motion broadcast, 
    let stateCh = await osap.hl.buildBroadcastRoute(
      "ep_stateBroadcaster",
      [
        "rt_axl-stepper_rl", "rt_axl-stepper_rr", "rt_axl-stepper_z"
      ],
      "ep_states",
      false,
      graph
    )
    console.warn(`SETUP: motion-state broadcast on ch ${stateCh} setup OK`)
    // make a halting broadcast, and stash the channel... 
    let haltCh = await osap.hl.buildBroadcastRoute(
      "ep_haltBroadcaster",
      [
        "rt_axl-stepper_rl", "rt_axl-stepper_rr", "rt_axl-stepper_z"
      ],
      "ep_halt",
      false,
      graph
    )
    console.warn(`SETUP: halt broadcast on ch ${haltCh} setup OK`)
    // now we can wire the rl motor's limit output & wire it to the halt signal... 
    let rlLimitOutput = await osap.nr.findWithin("ep_limitOutput", "rt_axl-stepper_rl", graph)
    let rrLimitOutput = await osap.nr.findWithin("ep_limitOutput", "rt_axl-stepper_rr", graph)
    console.warn(`SETUP: found the rl and rr limit outputs`)
    // up -> back down the bus halting route, 
    await osap.mvc.setEndpointRoute(rlLimitOutput.route, PK.route().sib(1).bfwd(0).bbrd(haltCh).end(500, 128))
    console.warn(`SETUP: rl's limit output hooked to halting broadcast`)
    // home z, 
    await motors[2].home()
    // now reeeeverse, that's cause a halt... 
    await broadcastMotionState(AXL_MODE_VELOCITY, [0, 100, 0])
    await TIME.delay(50)
    await motors[0].motion.awaitMotionEnd()
    // rm halt route, 
    await osap.mvc.removeEndpointRoute(rlLimitOutput.route, 0)
    await osap.mvc.setEndpointRoute(rrLimitOutput.route, PK.route().sib(1).bfwd(0).bbrd(haltCh).end(500, 128))
    console.warn(`SETUP: rr's limit output hooked to halting broadcast`)
    await broadcastMotionState(AXL_MODE_VELOCITY, [100, 0, 0])
    await TIME.delay(50)
    await motors[0].motion.awaitMotionEnd()
    await osap.mvc.removeEndpointRoute(rrLimitOutput.route, 0)
    console.warn(`SETUP: we're homed?`)
    // ok, set posns now ? let's just call everything back here actuator-zero... 
    await broadcastMotionState(AXL_MODE_POSITION, [0, 0, 0], true, true)
    // and hookup the actual motion flows, 
    await osap.hl.buildBroadcastRoute(
      "ep_precalculatedMoveOutput",
      [
        "rt_axl-stepper_rl", "rt_axl-stepper_rr", "rt_axl-stepper_z"
      ],
      "ep_precalculatedMoves",
      false,
      graph
    )
    console.warn(`SETUP: queued motion is plumb-ed`)

    // get the autodesk test path:
    for(let move of moves){
      transform(move.target, true)
    }
    for(let move of moves){
      await headVM.motion.addMoveToQueue(move)
    }
    // let path = await testImportCode()
    // for(let move of path){
    //   transform(move.target, true)
    // }
    // for(let move of path){
    //   await headVM.motion.addMoveToQueue(move)
    // }
    let park = {
      target: [200, 200, 10],
      rate: 200
    }
    transform(park.target, true)
    await headVM.motion.addMoveToQueue(park)
    // now we should be able to genny a circular path and traverse it ? 
    // let circlePath = circleGen([25, 25, 5], 25, 1)
    // circlePath = circlePath.concat(circleGen([25, 25, 5], 20, 1))
    // circlePath = circlePath.concat(circleGen([25, 25, 5], 15, 1))
    // circlePath = circlePath.concat(circleGen([25, 25, 5], 10, 1))
    // console.log(circlePath)
    // // transform these... 
    // for (let point of circlePath) {
    //   transform(point, true)
    // }
    // // then do...
    // for (let point of circlePath) {
    //   await headVM.motion.addMoveToQueue({
    //     target: point,
    //     rate: 250
    //   })
    // }

    // then we can use an offset, this would be equivalent to our position-after-home... 
    // I'm assuming now that accelerations etc are preserved through the transform,
    // but let's test a few positions... 
    // await broadcastMotionState(AXL_MODE_POSITION, [10, 10, 10])
    // await TIME.delay(250)
    // await Promise.all([motors[0].motion.awaitMotionEnd(), motors[1].motion.awaitMotionEnd(), motors[2].motion.awaitMotionEnd()])
    // await broadcastMotionState(AXL_MODE_POSITION, [20, 10, 10])
    // await TIME.delay(250)
    // await Promise.all([motors[0].motion.awaitMotionEnd(), motors[1].motion.awaitMotionEnd(), motors[2].motion.awaitMotionEnd()])
    // await broadcastMotionState(AXL_MODE_POSITION, [20, 20, 10])
    // await TIME.delay(250)
    // await Promise.all([motors[0].motion.awaitMotionEnd(), motors[1].motion.awaitMotionEnd(), motors[2].motion.awaitMotionEnd()])
    // await broadcastMotionState(AXL_MODE_POSITION, [10, 10, 0])
    // await TIME.delay(250)
    // await Promise.all([motors[0].motion.awaitMotionEnd(), motors[1].motion.awaitMotionEnd(), motors[2].motion.awaitMotionEnd()])
    console.warn(`DONE`)
    console.log(`------------------------------------------`)
    console.error("NEXT: below")
    /*
    to go transform-complete, we need to be able to request goto-posns, goto-rates, and also queued-motions all 
    happily mode switching... also set 0,0,0's - etc. should probably bottle setup etc up into a new Clankite() thing and give 
    it an API, then we can hand-off to i.e. UI-improvers and workflow-pros 
    */
  } catch (err) {
    console.error(err)
  }
}

setTimeout(setupCode, 750)
//setTimeout(testImportCode, 250)

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