/*
axlClankVM.js

new motion proto clank vm 

Jake Read at the Center for Bits and Atoms
(c) Massachusetts Institute of Technology 2022

This work may be reproduced, modified, distributed, performed, and
displayed for any purpose, but must acknowledge the open systems assembly protocol (OSAP) project.
Copyright is retained and must be preserved. The work is provided as is;
no warranty is provided, and users accept all liability.
*/

import { PK } from "../osapjs/core/ts.js";
import AXLMotionVM from "../osapjs/vms/axlMotionVM.js" ///./axlMotionVM.js";
import AXLMotorVM from "../osapjs/vms/axlMotorVM.js";

export default function AXLClankVM(osap, route, numDof = 4) {

  // uuuh, SPU are stashed in the function, gd, 
  let ticksPerSecond = 10000
  // max *rate* is spu / tps, making one step / tick, 

  // new coordinator vm, for that ? 
  this.motion = new AXLMotionVM(osap, route, numDof)

  // then, motors:
  this.motors = {
    //x: new AXLMotorVM(osap, route, numDof),//.sib(1).bfwd(1).end(), numDof),
    x: new AXLMotorVM(osap, PK.route(route).sib(1).bfwd(1).end(), numDof),
    yl: new AXLMotorVM(osap, PK.route(route).sib(1).bfwd(2).end(), numDof),
    yr: new AXLMotorVM(osap, PK.route(route).sib(1).bfwd(3).end(), numDof),
    z: new AXLMotorVM(osap, PK.route(route).sib(1).bfwd(4).end(), numDof),
    theta: new AXLMotorVM(osap, PK.route(route).sib(1).bfwd(5).end(), numDof),
  }

  // yep, have made some mistakes, want typescript 
  this.motors.x.settings.motor.axis = 0
  this.motors.x.settings.motor.invert = false
  this.motors.x.settings.motor.microstep = 4
  this.motors.x.settings.motor.spu = 20
  this.motors.x.settings.motor.cscale = 0.45

  this.motors.yl.settings.motor.axis = 1
  this.motors.yl.settings.motor.invert = true
  this.motors.yl.settings.motor.microstep = 4
  this.motors.yl.settings.motor.spu = 20
  this.motors.yl.settings.motor.cscale = 0.45

  this.motors.yr.settings.motor.axis = 1
  this.motors.yr.settings.motor.invert = false
  this.motors.yr.settings.motor.microstep = 4
  this.motors.yr.settings.motor.spu = 20
  this.motors.yr.settings.motor.cscale = 0.45

  this.motors.z.settings.motor.axis = 2
  this.motors.z.settings.motor.invert = false 
  this.motors.z.settings.motor.invert = true
  this.motors.z.settings.motor.microstep = 8
  //this.motors.z.settings.motor.spu = 200
  this.motors.z.settings.motor.spu = 105
  this.motors.z.settings.motor.cscale = 0.45

  // 20t on the pinion, 127t on the output... 
  // 8 * 200 (1600) steps / 20t, 
  // theta is in radians, my friends 
  this.motors.theta.settings.motor.axis = 3
  this.motors.theta.settings.motor.invert = true
  this.motors.theta.settings.motor.microstep = 4
  this.motors.theta.settings.motor.spu = (4 * 200 * (127/20)) / (2 * Math.PI)
  console.warn(this.motors.theta.settings.motor.spu)
  this.motors.theta.settings.motor.cscale = 0.2

  // motion settings... 
  this.motion.settings.junctionDeviation = 0.15
  // remember... radians / second for theta, lol 
  this.motion.settings.accelLimits = [750, 750, 500, 25]
  this.motion.settings.velLimits = [400, 400, 50, 8]

  // I'm so sorry everybody 
  let mixmap = { x: 0, yl: 1, yr: 1, z: 2, theta: 3 }

  // would like to check each speed limit,
  for (let m in this.motors) {
    let stepMaxVelocity = ticksPerSecond / this.motors[m].settings.motor.spu
    // omg I've bungled this so absolutely 
    if (this.motion.settings.velLimits[mixmap[m]] > stepMaxVelocity){
      console.warn(`${m} max velocity per setting 
      (${this.motion.settings.velLimits[mixmap[m]].toFixed(2)}) 
      (${this.motors[m].settings.motor.spu.toFixed(2)} spu)
      is too fast per steps, using ${stepMaxVelocity.toFixed(2)}`)
      this.motion.settings.velLimits[mixmap[m]] = stepMaxVelocity
      console.log(this.motion.settings)
    }
  }

  // duplicate motion settings, a bit awkward innit 
  for (let m in this.motors) {
    try{
      this.motors[m].motion.settings = JSON.parse(JSON.stringify(this.motion.settings))
    } catch (err) {
      console.warn(err)
    }
  }

  // ok, lol ? typscript would help bigly 
  this.setup = async () => {
    try {
      await this.motion.setup()
    } catch (err) {
      console.warn('at usb')
      throw err
    }
    for (let mot in this.motors) {
      try {
        console.warn(mot)
        //if(mot == 'theta') continue;
        await this.motors[mot].setup()
      } catch (err) {
        console.warn(`at ${mot}`)
        throw err
      }
    }
    console.warn('done setup')
    return 
  }
}