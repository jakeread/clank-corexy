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

// core elements 
import OSAP from '../osapjs/core/osap.js'
import TIME from '../osapjs/core/time.js'
import PK from '../osapjs/core/packets.js'

// machine application 
import PowerSwitchVM from '../osapjs/vms/powerSwitches.js'
import AXLCore from '../osapjs/vms/axlCore.js'
import AXLActuator from '../osapjs/vms/axlActuator.js'

// ui elements 
import Grid from '../osapjs/client/interface/grid.js' // main drawing API 
import { Button, EZButton, Slider, TextBlock, TextInput } from '../osapjs/client/interface/basics.js'
import MachineBed from '../osapjs/client/components/machineBed.js'

// handy utes 
import { SaveFile } from '../osapjs/client/utes/saveFile.js'
import { GetFile } from '../osapjs/client/utes/getFile.js'

// path genny 
import snakeGen from '../osapjs/test/snakeGen.js'
import circleGen from '../osapjs/test/circleGen.js'
import ImgToPath2D from '../osapjs/client/components/img2path.js'

console.log(`------------------------------------------`)
console.log("hello AXL controller")

// -------------------------------------------------------- OSAP Object
let osap = new OSAP("axl-testbed")

// -------------------------------------------------------- SETUP NETWORK / PORT 
let wscVPort = osap.vPort("wscVPort")

// -------------------------------------------------------- Clank! Object

let clank = new AXLCore(osap, {       // settings object 
  bounds: [245, 170, 15],
  accelLimits: [750, 750, 500],
  velocityLimits: [200, 200, 80],
  queueStartDelay: 500,
  junctionDeviation: 0.1,
}, [                                  // actuator list (of names, axis)
  {
    name: "rt_axl-stepper_rl",
    axis: 0,
    invert: true,
    microstep: 4,
    spu: 25,
    cscale: 0.3
  },
  {
    name: "rt_axl-stepper_rr",
    axis: 1,
    invert: true,
    microstep: 4,
    spu: 25,
    cscale: 0.3
  },
  {
    name: "rt_axl-stepper_z",
    axis: 2,
    invert: false,
    microstep: 4,
    spu: 105,
    cscale: 0.3
  },
])

// -------------------------------------------------------- Ute to switch system power at the motion-head circuit

let powerSwitchVM = new PowerSwitchVM(osap)

// -------------------------------------------------------- Building the UI 
// -------------------------------------------------------- UI... baseplate 

let grid = new Grid()

// -------------------------------------------------------- Building the UI 

let colOneY = 10
let colOneX = 10
let colOneWidth = 150

// this should link 'em out to machine docs and instructions, ideally a how-to-use-it video 
let titleBtn = new Button({
  xPlace: colOneX, yPlace: colOneY,
  width: colOneWidth, height: 200,
  defaultText: `Clank!`
})

let stateBtn = new Button({
  xPlace: colOneX, yPlace: colOneY += 210,
  width: colOneWidth, height: 40,
  defaultText: `connection ?`
})
stateBtn.red()

let homeBtn = new Button({
  xPlace: colOneX, yPlace: colOneY += 50,
  width: colOneWidth, height: 40,
  defaultText: `homed ?`
})
homeBtn.red()

let zUpBtn = new Button({
  xPlace: colOneX, yPlace: colOneY += 70,
  width: colOneWidth, height: 40,
  defaultText: `z *up* 1 mm`
})

zUpBtn.onClick(async () => {
  try {
    if (!clank.available) return
    zUpBtn.yellow('...')
    await clank.moveRelative([0, 0, 1])
    zUpBtn.resetText()
    zUpBtn.grey()
  } catch (err) {
    console.error(err)
  }
})

let zDownBigBtn = new Button({
  xPlace: colOneX, yPlace: colOneY += 50,
  width: colOneWidth, height: 40,
  defaultText: `z *down* 3 mm`
})

zDownBigBtn.onClick(async () => {
  try {
    if (!clank.available) return
    zDownBigBtn.yellow('...')
    await clank.moveRelative([0, 0, -3])
    zDownBigBtn.resetText()
    zDownBigBtn.grey()
  } catch (err) {
    console.error(err)
  }
})

let zDownBtn = new Button({
  xPlace: colOneX, yPlace: colOneY += 50,
  width: colOneWidth, height: 40,
  defaultText: `z *down* 1 mm`
})

zDownBtn.onClick(async () => {
  try {
    if (!clank.available) return
    zDownBtn.yellow('...')
    await clank.moveRelative([0, 0, -1])
    zDownBtn.resetText()
    zDownBtn.grey()
  } catch (err) {
    console.error(err)
  }
})

let zDownSmallBtn = new Button({
  xPlace: colOneX, yPlace: colOneY += 50,
  width: colOneWidth, height: 40,
  defaultText: `z *down* 0.1 mm`
})

zDownSmallBtn.onClick(async () => {
  try {
    if (!clank.available) return
    zDownSmallBtn.yellow('...')
    await clank.moveRelative([0, 0, -0.1])
    zDownSmallBtn.resetText()
    zDownSmallBtn.grey()
  } catch (err) {
    console.error(err)
  }
})

let zZeroBtn = new Button({
  xPlace: colOneX, yPlace: colOneY += 50,
  width: colOneWidth, height: 40,
  defaultText: `set z = 0`
})

zZeroBtn.onClick(async () => {
  try {
    if (!clank.available) return
    zZeroBtn.yellow('...')
    await clank.setZPosition(0)
    zZeroBtn.resetText()
    zZeroBtn.grey()
  } catch (err) {
    console.error(err)
  }
})

// ---------------------------------------------- Stat Printout 

let netStatPrint = new TextBlock({
  xPlace: colOneX, yPlace: colOneY += 70,
  width: colOneWidth, height: 70,
  defaultText: `netStats`
}, true)

clank.onNetInfoUpdate = (info) => {
  // console.log(info)
  netStatPrint.setHTML(`filtered RTT: \t${info.rtt.toFixed(2)}<br>min RTT: \t\t\t${info.rttMin}<br>max RTT: \t\t\t${info.rttMax}`)
}

// -------------------------------------------------------- Spindle Toggling

let spindleOnBtn = new Button({
  xPlace: colOneX, yPlace: colOneY += 90,
  width: colOneWidth, height: 40,
  defaultText: "spindle on"
})

spindleOnBtn.onClick(async () => {
  try{
    await powerSwitchVM.setPowerStates(true, true, true, true)
  } catch (err) {
    console.error(err)
    spindleOnBtn.bad("err, see console...")  
  }
})

let spindleOffBtn = new Button({
  xPlace: colOneX, yPlace: colOneY += 50,
  width: colOneWidth, height: 40,
  defaultText: "spindle off"
})

spindleOffBtn.onClick(async () => {
  try{
    await powerSwitchVM.setPowerStates(true, true, false, false)
  } catch (err) {
    console.error(err)
    spindleOffBtn.bad("err, see console...")  
  }
})

clank.onSegmentComplete = (seg) => {
  console.warn('done seg', seg)
}

// -------------------------------------------------------- UI Column Two 

let colTwoX = colOneWidth + 20

// let's get a pad setup for all the gerber business, 
// I'm still not sure how to deal with various end-effectors, probably actually 
// dataflow *is* the answer for those types of things, pipe switching on tool state

let stopGapSpindle = {
  setDuty: async function (duty) {
    try {
      if (duty > 0.0) {
        await powerSwitchVM.setPowerStates(true, true, true, true)
        await TIME.delay(500)
      } else {
        await powerSwitchVM.setPowerStates(true, true, false, false)
        await TIME.delay(100)
      }
    } catch (err) {
      throw err
    }
  }
}

let bed = new MachineBed({
  xPlace: colTwoX, yPlace: 10,
  renderWidth: 800
}, clank, stopGapSpindle)

// 2nd col UI 
let colTwoWidth = bed.getRenderDims()[2]
let colTwoY = bed.getRenderDims()[1] + 20

console.log(`colTwoY`, colTwoY)

// -------------------------------------------------------- Basically main() 

let setupCode = async () => {
  try {
    // console.warn(`SETUP: genny png-to-traces path..`)
    // let tracesPath = await gennyTraces()
    // find and set this up... 
    stateBtn.yellow("cycling power...")
    console.warn(`SETUP: finding switches...`)
    await powerSwitchVM.setup()
    console.warn(`SETUP: cycling power...`)
    await powerSwitchVM.setPowerStates(false, false, false, false)
    await TIME.delay(1000)
    await powerSwitchVM.setPowerStates(true, true, false, false)
    await TIME.delay(1000)
    // run keepalive on 'em 
    // await osap.hl.addToKeepAlive("rt_axl-stepper_rl")
    // await osap.hl.addToKeepAlive("rt_motion-head")
    // setup the machine... then park it  
    console.warn(`SETUP: plumbing the core...`)
    await clank.setup()
    stateBtn.green("system looks OK")
    console.warn(`SETUP: core plumbed OK...`)
    console.warn(`SETUP DONE`)
    console.warn(`------------------------------------------`)
    // test some vel-settings,
    // await clank.gotoVelocity([100, 0, 0])
    // await TIME.delay(500)
    // await clank.gotoVelocity([0, 100, 0])
    // await TIME.delay(500)
    // await clank.gotoVelocity([-100, 0, 0])
    // await TIME.delay(500)
    // await clank.gotoVelocity([0, -100, 0])
    // await TIME.delay(500)
    // await clank.gotoVelocity([0, 0, 0])
    /*
    // run a test path ! 
    let points = circleGen([0, 0, 0], 20, 4)
    console.log(`path is originally ${points.length} moves long`)
    // make... lots of these, 
    for (let c = 0; c < 2; c++) {
      points = points.concat(points)
    }
    let path = []
    for (let pt of points) {
      path.push({ target: pt, rate: 200 })
    }
    console.log(`complete path is ${path.length} moves long`)
    for (let m in tracesPath) {
      // console.warn(`Path Sends ${m} / ${path.length - 1}`)
      await clank.addMoveToQueue(tracesPath[m])
    }
    */
  } catch (err) {
    console.error(err)
  }
}

//setTimeout(svgTestCode, 750)
setTimeout(setupCode, 750)

// -------------------------------------------------------- Bottled PNG Path Genny 

let gennyTraces = async () => {
  try {
    // let png = await GetFile(`save/testPNG/hello.D11C.serial.5V.1.1.traces.png`)
    let image = await imageLoader(`save/testPNG/hello.D11C.serial.5V.1.1.traces.png`)
    console.log(image)
    let canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    let context = canvas.getContext('2d')
    context.drawImage(image, 0, 0, image.width, image.height)
    let imageData = context.getImageData(0, 0, image.width, image.height)
    console.log(imageData)
    let path = await ImgToPath2D({
      imageData: imageData,
      realWidth: (imageData.width / 1000) * 25.4,
      toolOffset: 1 / 64 * 0.5 * 25.4,
      zUp: 2,
      zDown: -0.1,
      passDepth: 0.1,
      feedRate: 20,
      jogRate: 100,
    })
    return path
  } catch (err) {
    throw err
  }
}

let imageLoader = (source) => {
  return new Promise((resolve, reject) => {
    let image = new Image()
    image.onload = () => {
      resolve(image)
    }
    image.onerror = (err) => {
      reject(`failed to load image with source ${source}`)
    }
    image.src = source
  })
}

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