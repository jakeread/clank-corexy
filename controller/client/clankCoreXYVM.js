/*
clankCoreXYVM

clank corexy virtual machine 

Jake Read at the Center for Bits and Atoms
(c) Massachusetts Institute of Technology 2022

This work may be reproduced, modified, distributed, performed, and
displayed for any purpose, but must acknowledge the open systems assembly protocol (OSAP) project.
Copyright is retained and must be preserved. The work is provided as is;
no warranty is provided, and users accept all liability.
*/

import PK from '../osapjs/core/packets.js'
import { TS, VT } from '../osapjs/core/ts.js'
import TIME from '../osapjs/core/time.js'
import AXLMotorVM from '../osapjs/vms/axlMotorVM.js'
import AXLMotionHeadVM from '../osapjs/vms/axlMotionHeadVM.js'

export default function ClankCoreXY(osap, posnOffset) {
  posnOffset = JSON.parse(JSON.stringify(posnOffset))
  // -------------------------------------------- Settings 

  let motionSettings = {
    junctionDeviation: 0.05,
    accelLimits: [1000, 1000, 750],
    velLimits: [300, 300, 100]
  }

  // note that home rate x accel-rate gives us a home-stop-distance, 
  // which is sometimes *too large* for the endstop-thwapping...
  // todo is axl-calculates-these-results (also max. rates given SPU & clock), and informs... 

  let numDof = 3

  let xyMicroStep = 8
  let xySPU = 40
  let xyHomeRate = 12.5
  let xyHomeOffset = 5

  let zMicroStep = 4
  let zSPU = 105
  let zHomeRate = 100
  let zHomeOffset = 1

  let motorCScale = 0.275

  // -------------------------------------------- CoreXY TF 

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

  // inverts *motion controller pos to machine-space pos* 
  let invert = (vals) => {
    let tfVals = new Array(numDof)
    tfVals[0] = 0.5 * (vals[0] + vals[1])
    tfVals[1] = 0.5 * (vals[0] - vals[1])
    tfVals[2] = vals[2]
    // hmmm 
    for(let a = 0; a < numDof; a ++){
      // add back offset, 
      tfVals[a] += posnOffset[a]
      // modify og array (reference danger!)
      vals[a] = tfVals[a]
    }
  }

  // -------------------------------------------- Guard against too-many-ticks, 

  // we can calculate max rates... 
  let maxTickPerSecond = 10000
  let xyMaxRate = maxTickPerSecond / xySPU
  let zMaxRate = maxTickPerSecond / zSPU

  if (motionSettings.velLimits[0] > xyMaxRate - 5) {
    motionSettings.velLimits[0] = xyMaxRate - 5
    console.warn(`lowering x max rate to ${motionSettings.velLimits[0]} to cover over-ticking`)
  }
  if (motionSettings.velLimits[1] > xyMaxRate - 5) {
    motionSettings.velLimits[1] = xyMaxRate - 5
    console.warn(`lowering y max rate to ${motionSettings.velLimits[1]} to cover over-ticking`)
  }
  if (motionSettings.velLimits[2] > zMaxRate - 5) {
    motionSettings.velLimits[2] = Math.round(zMaxRate - 5) // parseInt aka round... 
    console.warn(`lowering z max rate to ${motionSettings.velLimits[2]} to cover over-ticking`)
  }

  // -------------------------------------------- Plumbing the motion system 

  let AXL_MODE_ACCEL = 1
  let AXL_MODE_VELOCITY = 2
  let AXL_MODE_POSITION = 3
  let AXL_MODE_QUEUE = 4

  let headVM = null
  let graph = null
  let motors = null 

  let stateBroadcaster = osap.endpoint("stateBroadcaster")
  let broadcastMotionState = async (mode, vals, set = false, superset = false) => {
    try {
      if (vals.length != numDof) {
        throw new Error(`need array of len ${numDof} dofs, was given ${vals.length}`);
      }
      // ------------ COREXY 
      // console.log(`target asks`, JSON.parse(JSON.stringify(vals)))
      vals = JSON.parse(JSON.stringify(vals))
      if (!superset) {
        transform(vals, (mode == AXL_MODE_POSITION))
      }
      vals = JSON.parse(JSON.stringify(vals))
      // console.log(`target set`, JSON.parse(JSON.stringify(vals)))
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

  // -------------------------------------------- Machine Motion API 

  // holds until all stopped... 
  this.awaitMotionEnd = async () => {
    try {
      await Promise.all([
        headVM.motion.awaitMotionEnd(), 
        motors[0].motion.awaitMotionEnd(), 
        motors[1].motion.awaitMotionEnd(), 
        motors[2].motion.awaitMotionEnd()
      ])
    } catch (err) {
      throw err 
    }
  }

  // this *should be valid* most of the time ? 
  this.getPosition = async () => {
    try {
      let states = await headVM.motion.getStates()
      console.log(`machine says...`, JSON.parse(JSON.stringify(states.positions)))
      // we have to un-tf it, 
      invert(states.positions)
      console.log(`transform says...`, JSON.parse(JSON.stringify(states.positions)))
      return states.positions
    } catch (err) {
      throw err 
    }
  }

  // I think we just set our own internal offsets ? 
  this.setZPosition = async (zPos) => {
    try {
      let pos = await this.getPosition()
      pos = JSON.parse(JSON.stringify(pos))
      // uuuh, we take the difference between ... 
      console.warn(`prev z-offset \t${posnOffset[2]}`)
      posnOffset[2] += zPos - pos[2]
      console.warn(`new z-offset \t${posnOffset[2]}`)
    } catch (err) {
      throw err 
    }
  }

  // move: { target: [<x>, <y>, <z>], rate: <mm/sec> }
  this.addMoveToQueue = async (move) => {
    try {
      // sanitize, transform, and send to head 
      move = JSON.parse(JSON.stringify(move))
      transform(move.target, true)
      await headVM.motion.addMoveToQueue(move)
    } catch (err) {
      throw err 
    }
  }

  // pos: [<x>, <y>, <z>]
  this.gotoPosition = async (pos) => {
    try {
      await broadcastMotionState(AXL_MODE_POSITION, pos)
      await TIME.delay(50)
      await this.awaitMotionEnd()
    } catch (err) {
      throw err 
    }
  }

  // deltas: [<x>, <y>, <z>]
  this.moveRelative = async (deltas) => {
    try {
      await this.awaitMotionEnd()
      let current = await this.getPosition()
      for(let axis in deltas){
        current[axis] += deltas[axis]
      }
      await this.gotoPosition(current)
    } catch (err) {
      throw err 
    }
  }

  // -------------------------------------------- Main system setup code 

  this.setup = async () => {
    try {
      // find the head... 
      headVM = new AXLMotionHeadVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_motion-head")).route), motionSettings, true)
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
      graph = await osap.nr.sweep()
      console.log(`SETUP: collected a graph...`)
      // collect motors 
      motors = []
      // rear left, rear right motors, 
      // we're going to call them axis 0, 1, and try to just muddle our own corexy hack... 
      motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_rl", graph)).route), {
        motion: motionSettings,
        axis: 0,
        invert: true,
        microstep: xyMicroStep,
        spu: xySPU,
        cscale: motorCScale,
        homeRate: xyHomeRate,
        homeOffset: xyHomeOffset
      }))
      motors.push(new AXLMotorVM(osap, PK.VC2VMRoute((await osap.nr.find("rt_axl-stepper_rr", graph)).route), {
        motion: motionSettings,
        axis: 1,
        invert: true,
        microstep: xyMicroStep,
        spu: xySPU,
        cscale: motorCScale,
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
        cscale: motorCScale,
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
    } catch (err) {
      throw err
    }
  }

  this.home = async () => {
    try {
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
      console.warn(`HOME: found the rl and rr limit outputs`)
      // up -> back down the bus halting route, 
      await osap.mvc.setEndpointRoute(rlLimitOutput.route, PK.route().sib(1).bfwd(0).bbrd(haltCh).end(500, 128))
      console.warn(`HOME: rl's limit output hooked to halting broadcast`)
      // home z, 
      await motors[2].home()
      // now reeeeverse, that's cause a halt... 
      await broadcastMotionState(AXL_MODE_VELOCITY, [0, 100, 0])
      await TIME.delay(50)
      await motors[0].motion.awaitMotionEnd()
      // rm halt route, 
      await osap.mvc.removeEndpointRoute(rlLimitOutput.route, 0)
      await osap.mvc.setEndpointRoute(rrLimitOutput.route, PK.route().sib(1).bfwd(0).bbrd(haltCh).end(500, 128))
      console.warn(`HOME: rr's limit output hooked to halting broadcast`)
      await broadcastMotionState(AXL_MODE_VELOCITY, [100, 0, 0])
      await TIME.delay(50)
      await motors[0].motion.awaitMotionEnd()
      await osap.mvc.removeEndpointRoute(rrLimitOutput.route, 0)
      console.warn(`HOME: we're homed?`)
      // ok, set posns now ? let's just call everything back here actuator-zero... 
      await broadcastMotionState(AXL_MODE_POSITION, [0, 0, 0], true, true)
      console.warn(`HOME: set position-zero...`)
    } catch (err) {
      throw err
    }
  }
}