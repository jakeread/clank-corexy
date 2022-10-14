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

import Grid from '../osapjs/client/interface/grid.js' // main drawing API 
import { Button, EZButton, Slider, TextBlock, TextInput } from '../osapjs/client/interface/basics.js'
import Pad from '../osapjs/client/components/pad.js'

import { SaveFile } from '../osapjs/client/utes/saveFile.js'
import { GetFile } from '../osapjs/client/utes/getFile.js'

// lol, snake genny 
import snakeGen from '../osapjs/test/snakeGen.js'
import circleGen from '../osapjs/test/circleGen.js'

// should be part of some wrapped-up class, 
import dt from '../osapjs/client/interface/domTools.js'

// ... yar ok,
import ImgToPath2D from '../osapjs/client/components/img2path.js'
import ClankCoreXY from './clankCoreXYVM.js'
import MachineBed from '../osapjs/client/components/machineBed.js'

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

// -------------------------------------------------------- Clank! Object

// below is ~= position-after-home... 
let machineSize = [200, 200, 23]

let clank = new ClankCoreXY(osap, machineSize)

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

// 2nd col UI 

let colTwoX = colOneWidth + 20
let colTwoWidth = 700
let colTwoY = Math.ceil((colTwoWidth * (machineSize[1] / machineSize[0])) / 10) * 10 + 20

console.log(`colTwoY`, colTwoY)

// let's get a pad setup for all the gerber business, 
let bed = new MachineBed({
  xPlace: colTwoX, yPlace: 10,
  machineSize: machineSize,
  renderWidth: 700
}, clank)

/*
top: state / red when machine disconnected or timed out 
below: file load... should do this before we setup the machine... 
below: homed, or not ? later, this should be a flag... 
below: power OK 
*/

// -------------------------------------------------------- Basically main() 

let setupCode = async () => {
  try {
    // setup the machine... then park it  
    stateBtn.yellow(`configuring clank...`)
    await clank.setup()
    stateBtn.green(`connection seems OK`)
    homeBtn.yellow(`homing...`)
    await clank.home()
    await clank.gotoPosition([180, 180, 20])
    homeBtn.green(`home seems OK`)
    clank.available = true
    console.warn(`SETUP DONE`)
    console.log(`------------------------------------------`)
  } catch (err) {
    stateBtn.red(`error during setup, see console...`)
    console.error(err)
  }
}

//setTimeout(svgTestCode, 750)
setTimeout(setupCode, 750)

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