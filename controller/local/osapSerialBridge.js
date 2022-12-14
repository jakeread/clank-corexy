/*
osap-usb-bridge.js

osap bridge to firmwarelandia

Jake Read at the Center for Bits and Atoms
(c) Massachusetts Institute of Technology 2020

This work may be reproduced, modified, distributed, performed, and
displayed for any purpose, but must acknowledge the open systems assembly protocol (OSAP) project.
Copyright is retained and must be preserved. The work is provided as is;
no warranty is provided, and users accept all liability.
*/

// big s/o to https://github.com/standard-things/esm for allowing this
import OSAP from '../osapjs/core/osap.js'
import { TS } from '../osapjs/core/ts.js'
import PK from '../osapjs/core/packets.js'

import WSSPipe from './utes/wssPipe.js'
import VPortSerial from '../osapjs/vport/vPortSerial.js'

import { SerialPort } from 'serialport'

// we include an osap object - a node
let osap = new OSAP("local-usb-bridge")
osap.description = "node featuring wss to client and usbserial cobs connection to hardware"

// -------------------------------------------------------- WSS VPort

let wssVPort = osap.vPort("wssVPort")   // 0

// -------------------------------------------------------- FIFO 

let fifoIn = osap.endpoint("fifoInput")
let fifoOut = osap.endpoint("fifoOutput")
fifoOut.setTimeoutLength(60000)
let fifoLength = 128 
let fifoBuffer = [] 

// we can attach 'onData' handlers, which fire whenever something is tx'd to us: 
fifoIn.onData = (data) => {
  return new Promise((resolve, reject) => {
    try {
      let ingestCheck = () => {
        if(fifoBuffer.length >= fifoLength){
          setTimeout(ingestCheck, 10)
        } else {
          fifoBuffer.push(data)
          console.log(`>>> fifo ${fifoBuffer.length} / ${fifoLength}`)
          checkFifoLoop()
          resolve()
        }
      }
      ingestCheck()
    } catch (err) {
      console.error(err)
    }
  })
}

let fifoCheckTimer = null 
let currentlyAwaiting = false 

let checkFifoLoop = async () => {
  try {
    if(currentlyAwaiting == true) return 
    if(fifoCheckTimer) return 
    if(fifoBuffer.length > 0){
      let data = fifoBuffer.shift()
      if(!data){
        console.error('que???')
        return
      }
      currentlyAwaiting = true 
      await fifoOut.write(data, "acked")
      currentlyAwaiting = false 
      console.log(`fifo >>> ${fifoBuffer.length} / ${fifoLength}`)
      if(fifoBuffer.length > 0){
        fifoCheckTimer = setTimeout(() => {
          fifoCheckTimer = false 
          checkFifoLoop()
        }, 0)
      } else {
        fifoCheckTimer = null 
      }
    }
  } catch (err) {
    console.error(err) 
  }
}


// then resolves with the connected webSocketServer to us 
let LOGWSSPHY = false 
wssVPort.maxSegLength = 16384
let wssVPortStatus = "opening"
// here we attach the "clear to send" function,
// in this case we aren't going to flowcontrol anything, js buffers are infinite
// and also impossible to inspect  
wssVPort.cts = () => { return (wssVPortStatus == "open") }
// we also have isOpen, similarely simple here, 
wssVPort.isOpen = () => { return (wssVPortStatus == "open") }

WSSPipe.start().then((ws) => {
  // no loop or init code, 
  // implement status 
  wssVPortStatus = "open"
  // implement rx,
  ws.onmessage = (msg) => {
    if (LOGWSSPHY) console.log('PHY WSS Recv')
    if (LOGWSSPHY) TS.logPacket(msg.data)
    wssVPort.receive(msg.data)
  }
  // implement transmit 
  wssVPort.send = (buffer) => {
    if (LOGWSSPHY) console.log('PHY WSS Send')
    if (LOGWSSPHY) PK.logPacket(buffer)
    ws.send(buffer)
  }
  // local to us, 
  ws.onerror = (err) => {
    wssVPortStatus = "closed"
    console.log('wss error', err)
  }
  ws.onclose = (evt) => {
    wssVPortStatus = "closed"
    // because this local script is remote-kicked,
    // we shutdown when the connection is gone
    console.log('wss closes, exiting')
    process.exit()
    // were this a standalone network node, this would not be true
  }
})

// -------------------------------------------------------- USB Serial VPort

// we'd like to periodically poke around and find new ports... 
let pidCandidates = [
  '801E', '80CB', '8031', '80CD', '800B'
]
let activePorts = []
let portSweeper = () => {
  SerialPort.list().then((ports) => {
    for(let port of ports){
      let cand = pidCandidates.find(elem => elem == port.productId)
      if(cand && !activePorts.find(elem => elem.portName == port.path)){ 
        // we have a match, but haven't already opened this port, 
        console.log(`FOUND desired prt at ${port.path}, launching vport...`)
        activePorts.push(new VPortSerial(osap, port.path))
        console.log(activePorts)
      }
    }
    // also... check deadies, 
    for(let vp of activePorts){
      if(vp.status == "closed"){
        console.log(`CLOSED and rming ${vp.portName}`)
        console.log('at indice...', activePorts.findIndex(elem => elem == vp))
        activePorts.splice(activePorts.findIndex(elem => elem == vp), 1)
        console.log(activePorts)
      }
    }
    // set a timeout, 
    // setTimeout(portSweeper, 500)
  })
}

portSweeper()