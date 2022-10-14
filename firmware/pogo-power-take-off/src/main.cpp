#include <Arduino.h>

#include "indicators.h"
#include "utils_samd51/clock_utils.h"

#include "osape/core/osap.h"
#include "osape/vertices/endpoint.h"

#include "osape_arduino/vp_arduinoSerial.h"

#include "osape_ucbus/vb_ucBusHead.h"

// -------------------------------------------------------- OSAP ENDPOINTS SETUP

OSAP osap("motion-head");

VPort_ArduinoSerial vpUSBSer(&osap, "arduinoUSBSerial", &Serial);   // 0

VBus_UCBusHead vbUCBusHead(&osap, "ucBusHead");                     // 1

/*

// -------------------------------------------------------- 2: States

EP_ONDATA_RESPONSES onStateData(uint8_t* data, uint16_t len){
  ERRLIGHT_TOGGLE;
  // check for partner-config badness, 
  if(len != AXL_NUM_DOF * 4 + 2){ OSAP::error("state req has bad DOF count"); return EP_ONDATA_REJECT; }
  // we have accel, rate, posn data, 
  dofs targ;
  uint16_t rptr = 0;
  uint8_t mode = data[rptr ++];
  uint8_t set = data[rptr ++];
  for(uint8_t a = 0; a < AXL_NUM_DOF; a ++){
    targ.axis[a] = ts_readFloat32(data, &rptr);
  }
  // set or target?
  if(set){
    switch(mode){
      case AXL_MODE_POSITION:
        if(axl_isMoving()){
          OSAP::error("AXL can't set pos while moving");
          break;
        }
        axl_setPosition(targ);
        break;
      default:
        OSAP::error("we can only 'set' position, others are targs");
        break;
    }
  } else {
    switch(mode){
      case AXL_MODE_ACCEL:
        axl_setAccelTarget(targ);
        break;
      case AXL_MODE_VELOCITY:
        axl_setVelocityTarget(targ);
        break;
      case AXL_MODE_POSITION:
        axl_setPositionTarget(targ);
        break;
      default:
        OSAP::error("AXL state targ has bad / unrecognized mode");
        break;
    }
  }
  // since we routinely update it w/ actual states (not requests) 
  return EP_ONDATA_REJECT;
}

Endpoint statesEP(&osap, "states", onStateData);

void updateStatesEP(void){
  uint8_t numBytes = AXL_NUM_DOF * 4 * 3 + 2;
  uint8_t stash[numBytes]; uint16_t wptr = 0;
  stash[wptr ++] = axl_getMode();
  axl_isMoving() ? stash[wptr ++] = 1 : stash[wptr ++] = 0;
  dofs temp = axl_getPositions();
  for(uint8_t a = 0; a < AXL_NUM_DOF; a ++){
    ts_writeFloat32(temp.axis[a], stash, &wptr);
  }
  temp = axl_getVelocities();
  for(uint8_t a = 0; a < AXL_NUM_DOF; a ++){
    ts_writeFloat32(temp.axis[a], stash, &wptr);
  }
  temp = axl_getAccelerations();
  for(uint8_t a = 0; a < AXL_NUM_DOF; a ++){
    ts_writeFloat32(temp.axis[a], stash, &wptr);
  }
  statesEP.write(stash, numBytes);
}

// -------------------------------------------------------- 3: Halt

uint32_t haltLightOnTime = 0;

EP_ONDATA_RESPONSES onHaltData(uint8_t* data, uint16_t len){
  axl_halt();
  ERRLIGHT_ON;
  haltLightOnTime = millis();
  return EP_ONDATA_REJECT;
}

Endpoint haltEP(&osap, "halt", onHaltData);

// -------------------------------------------------------- 4: Moves -> Queue

EP_ONDATA_RESPONSES onMoveData(uint8_t* data, uint16_t len){
  // this (and states-input) could watch <len> to make sure that 
  // this code & transmitter code are agreeing on how many DOFs are specd 
  if(axl_hasQueueSpace()){
    uint16_t rptr = 0;
    float rate = ts_readFloat32(data, &rptr);
    dofs targ;
    for(uint8_t a = 0; a < AXL_NUM_DOF; a ++){
      targ.axis[a] = ts_readFloat32(data, &rptr);
    }
    axl_addMoveToQueue(targ, rate);
    return EP_ONDATA_ACCEPT;
  } else {
    return EP_ONDATA_WAIT;
  }
}

Endpoint moveEP(&osap, "moves", onMoveData);

// -------------------------------------------------------- 5: AXL Settings

EP_ONDATA_RESPONSES onAXLSettingsData(uint8_t* data, uint16_t len){
  // jd, then pairs of accel & vel limits,
  float jd;
  dofs accelLimits;
  dofs velLimits;
  uint16_t rptr = 0;
  jd = ts_readFloat32(data, &rptr);
  for(uint8_t a = 0; a < AXL_NUM_DOF; a ++){
    accelLimits.axis[a] = ts_readFloat32(data, &rptr);
    velLimits.axis[a] = ts_readFloat32(data, &rptr);
  }
  axl_setJunctionDeviation(jd);
  axl_setAccelLimits(accelLimits);
  axl_setVelLimits(velLimits);
  return EP_ONDATA_ACCEPT;
}

Endpoint axlSettingsEP(&osap, "axlSettings", onAXLSettingsData);

*/

// -------------------------------------------------------- POWER MODES 

#define V5_ON PIN_HI(0, 11)
#define V5_OFF PIN_LO(0, 11)
#define V5_SETUP PIN_SETUP_OUTPUT(0, 11); PIN_LO(0, 11)
#define V24_ON PIN_HI(0, 10)
#define V24_OFF PIN_LO(0, 10)
#define V24_SETUP PIN_SETUP_OUTPUT(0, 10); PIN_LO(0, 10)

// 5V Switch on PA11, 24V Switch on PA10
/*  5v  | 24v | legal 
    0   | 0   | yes
    1   | 0   | yes 
    0   | 1   | no 
    1   | 1   | yes 

lol, pretty easy I guess: just no 24v when no 5v...
we also want to turn on in-order though: 5v first, then 24v, and 24v off, then 5v 
*/

// track states 
boolean state5V = false;
boolean state24V = false;

void publishPowerStates(void);

// make changes 
void powerStateUpdate(boolean st5V, boolean st24V){
  // guard against bad state
  if(st24V && !st5V) st24V = false;
  // check order-of-flip... if 5v is turning off, we will turn 24v first, 
  // in all other scenarios, we flip 5v first 
  if(state5V && !st5V){
    state24V = st24V; state5V = st5V;
    // publish, 24v first, and allow charge to leave... 
    state24V ? V24_ON : V24_OFF;
    delay(50);
    state5V ? V5_ON : V5_OFF;
  } else {
    state24V = st24V; state5V = st5V;
    // publish, 5v first, and allow some bring-up... 
    state5V ? V5_ON : V5_OFF;
    delay(10);
    state24V ? V24_ON : V24_OFF;
  }
  // now ... would like to write to the endpoint 
  publishPowerStates();
}

EP_ONDATA_RESPONSES onPowerData(uint8_t* data, uint16_t len){
  // read requested states out 
  boolean st5V, st24V;
  uint16_t rptr = 0;
  ts_readBoolean(&st5V, data, &rptr);
  ts_readBoolean(&st24V, data, &rptr);
  // run the update against our statemachine 
  powerStateUpdate(st5V, st24V);
  // here's a case where we'll never want to let senders to 
  // update our internal state, so we just return 
  return EP_ONDATA_REJECT;
  // this means that the endpoint's data store will remain unchanged (from the write) 
  // but remains true to what was written in when we updated w/ the powerStateUpdate fn... 
}

Endpoint powerEp(&osap, "powerSwitches", onPowerData);      // 6: Power Switches 

void publishPowerStates(void){
  uint8_t powerData[2];
  uint16_t wptr = 0;
  ts_writeBoolean(state5V, powerData, &wptr);
  ts_writeBoolean(state24V, powerData, &wptr);
  powerEp.write(powerData, 2);
}

// -------------------------------------------------------- 8: Precalcd-move-adder / producer 

// Endpoint precalculatedMoveEP(&osap, "precalculatedMoveOutput");

// -------------------------------------------------------- SETUP 

void setup() {
  ERRLIGHT_SETUP;
  CLKLIGHT_SETUP;
  DEBUG1PIN_SETUP;
  DEBUG2PIN_SETUP;
  DEBUG3PIN_SETUP;
  DEBUG4PIN_SETUP;
  DEBUG5PIN_SETUP;
  // setup the power stuff 
  V5_SETUP;
  V24_SETUP;
  powerStateUpdate(false, false);
  // osap
  vpUSBSer.begin();
  vbUCBusHead.begin();
  // startup axl, 
  // axl_setup(); 
  // bus runs on 10kHz ticker 
  d51ClockUtils->start_ticker_a(1000000/10000); 
  // turn 5v on by default,  
  powerStateUpdate(true, true);
}

unsigned long epUpdateInterval = 250; // ms 
unsigned long lastUpdate = 0;
uint16_t moveDataLen = 0;
uint8_t moveBuffer[128];

void loop() {
  // main recursive osap loop:
  osap.loop();
  // check for axl broadcast data, 
  // if(precalculatedMoveEP.clearToWrite()){
  //   moveDataLen = axl_netLoop(moveBuffer);
  //   if(moveDataLen){
  //     precalculatedMoveEP.write(moveBuffer, moveDataLen);
  //   }
  // }
  // run 10Hz endpoint update:
  if(millis() > lastUpdate + epUpdateInterval){
    lastUpdate = millis();
    DEBUG5PIN_TOGGLE;
    // updateStatesEP();
  }
  // if(haltLightOnTime + 250 < millis()){
  //   ERRLIGHT_OFF;
  // }
} // end loop 

// noop for actuator-free-zone 
void axl_onPositionDelta(uint8_t axis, float delta){}
void axl_limitSetup(void){}
boolean axl_checkLimit(void){ return true; }

// runs on period defined by timer_a setup: 
volatile uint32_t timeTick = 0;
volatile uint64_t timeBlink = 0;

void TC0_Handler(void){
  // runs at period established above... 
  TC0->COUNT32.INTFLAG.bit.MC0 = 1;
  TC0->COUNT32.INTFLAG.bit.MC1 = 1;
  DEBUG1PIN_HI;
  // do bus action first: want downstream clocks to be deterministic-ish
  vbUCBusHead.timerISR();
  // do axl integration, 
  // axl_integrator();
  // do blinking, lol
  timeBlink ++;
  if(timeBlink > 500){
    CLKLIGHT_TOGGLE;
    timeBlink = 0; 
  }
  DEBUG1PIN_LO;
}